import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import {
  AppConfig,
  BatchEvent,
  FileEntry,
  PreviewParams,
  PreviewResponse,
  generatePreview,
  getConfig,
  listFolder,
  runBatch,
  saveConfig,
  waitForSidecar,
} from "./api";

type FileStatus = "" | "doing" | "done" | "skipped" | "error";

const KSIZE_OPTIONS = [0, 3, 5, 7];

const DEFAULT_CONFIG: AppConfig = {
  folder: "",
  blur_ksize: 5,
  threshold: 220,
  close_ksize: 5,
  keep_view: true,
  output_subdir: "処理済み",
  skip_existing: false,
};

export default function App() {
  const [sidecarReady, setSidecarReady] = useState(false);
  const [sidecarError, setSidecarError] = useState<string | null>(null);

  const [cfg, setCfg] = useState<AppConfig>(DEFAULT_CONFIG);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [statuses, setStatuses] = useState<Record<string, FileStatus>>({});
  const [curIdx, setCurIdx] = useState<number>(-1);
  const [showMode, setShowMode] = useState<"after" | "before" | "split">("after");

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [toast, setToast] = useState<{ msg: string; kind: "info" | "warn" | "error" } | null>(null);
  const toastTimer = useRef<number | null>(null);

  const [batchActive, setBatchActive] = useState(false);
  const [batchEvent, setBatchEvent] = useState<BatchEvent | null>(null);

  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  const params: PreviewParams = useMemo(
    () => ({
      blur_ksize: cfg.blur_ksize,
      threshold: cfg.threshold,
      close_ksize: cfg.close_ksize,
    }),
    [cfg.blur_ksize, cfg.threshold, cfg.close_ksize],
  );

  // -- bootstrap: wait for sidecar, then load config --
  useEffect(() => {
    waitForSidecar()
      .then(async () => {
        setSidecarReady(true);
        try {
          const loaded = await getConfig();
          setCfg(loaded);
          if (loaded.folder) {
            try {
              const r = await listFolder(loaded.folder);
              setFiles(r.files);
            } catch {
              /* folder no longer exists */
            }
          }
        } catch {
          /* use defaults */
        }
      })
      .catch((e) => setSidecarError(String(e)));
  }, []);

  // -- persist config (debounced) --
  useEffect(() => {
    if (!sidecarReady) return;
    const t = window.setTimeout(() => {
      saveConfig(cfgRef.current).catch(() => {});
    }, 400);
    return () => window.clearTimeout(t);
  }, [cfg, sidecarReady]);

  const showToast = useCallback(
    (msg: string, kind: "info" | "warn" | "error" = "info") => {
      setToast({ msg, kind });
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToast(null), 2800);
    },
    [],
  );

  const selectFolder = useCallback(async () => {
    const dir = await openDialog({ directory: true, multiple: false });
    if (!dir || typeof dir !== "string") return;
    try {
      const r = await listFolder(dir);
      setFiles(r.files);
      setStatuses({});
      setCurIdx(r.files.length > 0 ? 0 : -1);
      setPreview(null);
      setCfg((c) => ({ ...c, folder: dir }));
      showToast(`${r.files.length} 個の PNG を検出`, "info");
    } catch (e) {
      showToast(String(e), "error");
    }
  }, [showToast]);

  const runPreview = useCallback(
    async (idx: number) => {
      if (idx < 0 || idx >= files.length) return;
      const f = files[idx];
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const r = await generatePreview(f.path, params, showMode !== "after");
        setPreview(r);
      } catch (e) {
        setPreviewError(String(e));
        setPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    },
    [files, params, showMode],
  );

  // auto-preview when selection changes
  useEffect(() => {
    if (curIdx >= 0 && curIdx < files.length) runPreview(curIdx);
  }, [curIdx, files, runPreview]);

  // -- keyboard shortcuts: ←/→/F5 --
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (batchActive) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        setCurIdx((i) => Math.min(i + 1, files.length - 1));
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        setCurIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "F5") {
        e.preventDefault();
        if (curIdx >= 0) runPreview(curIdx);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [files.length, curIdx, runPreview, batchActive]);

  const startBatch = useCallback(async () => {
    if (!cfg.folder || files.length === 0) {
      showToast("フォルダを選択してください", "warn");
      return;
    }
    if (!window.confirm(`${files.length} 個のファイルを処理します。続行しますか？`)) return;

    setBatchActive(true);
    setStatuses({});
    try {
      for await (const ev of runBatch(
        cfg.folder,
        files.map((f) => f.path),
        params,
        cfg.output_subdir,
        cfg.skip_existing,
      )) {
        setBatchEvent(ev);
        if (ev.name) {
          setStatuses((prev) => ({
            ...prev,
            [ev.name as string]: (ev.status === "complete" ? "done" : ev.status) as FileStatus,
          }));
        }
        if (ev.status === "complete") {
          showToast(`✅ 完了: ${ev.output_dir}`, "info");
        }
      }
    } catch (e) {
      showToast(String(e), "error");
    } finally {
      setBatchActive(false);
    }
  }, [cfg, files, params, showToast]);

  if (sidecarError) {
    return (
      <div className="boot-error">
        <h2>サイドカー起動エラー</h2>
        <pre>{sidecarError}</pre>
        <p>開発時は別ターミナルで <code>cd sidecar && uvicorn main:app --port 8766</code> を実行してください。</p>
      </div>
    );
  }
  if (!sidecarReady) {
    return <div className="boot">サイドカー起動中…</div>;
  }

  return (
    <div className="app">
      <header className="folder-bar">
        <button onClick={selectFolder}>📁 フォルダを選択…</button>
        <input
          type="text"
          value={cfg.folder}
          readOnly
          placeholder="フォルダ未選択"
        />
        <span className="muted">{files.length} 個の PNG</span>
      </header>

      <section className="params">
        <ParamGroup
          label="① Gaussian Blur"
          hint="微細ノイズを均す"
          value={cfg.blur_ksize}
          options={KSIZE_OPTIONS}
          onChange={(v) => setCfg({ ...cfg, blur_ksize: v })}
        />
        <ThresholdSlider
          value={cfg.threshold}
          onChange={(v) => setCfg({ ...cfg, threshold: v })}
        />
        <ParamGroup
          label="③ Morphology Close"
          hint="黒領域内の白い穴を塗りつぶす"
          value={cfg.close_ksize}
          options={KSIZE_OPTIONS}
          onChange={(v) => setCfg({ ...cfg, close_ksize: v })}
        />
        <div className="param-group">
          <label className="bold">表示</label>
          <div className="radio-row">
            {([
              ["after", "処理後"],
              ["before", "処理前"],
              ["split", "左右分割"],
            ] as const).map(([k, lbl]) => (
              <label key={k}>
                <input
                  type="radio"
                  name="showMode"
                  checked={showMode === k}
                  onChange={() => setShowMode(k)}
                />
                {lbl}
              </label>
            ))}
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={cfg.skip_existing}
              onChange={(e) => setCfg({ ...cfg, skip_existing: e.target.checked })}
            />
            既存ファイルをスキップ
          </label>
        </div>
      </section>

      <main className="split">
        <aside className="files">
          <button
            className="primary"
            onClick={() => curIdx >= 0 ? runPreview(curIdx) : showToast("ファイルを選択してください", "warn")}
            disabled={batchActive}
          >
            🔄 プレビュー再生成 <span className="kbd">F5</span>
          </button>
          <div className="files-count">
            {files.length === 0
              ? "ファイルなし"
              : `${curIdx + 1} / ${files.length}`}
          </div>
          <ul className="file-list">
            {files.map((f, i) => (
              <li
                key={f.path}
                className={[
                  i === curIdx ? "sel" : "",
                  statuses[f.name] ?? "",
                ].join(" ")}
                onClick={() => setCurIdx(i)}
              >
                {f.name}
              </li>
            ))}
          </ul>
        </aside>

        <section className="preview">
          {previewLoading && <div className="overlay">処理中…</div>}
          {previewError && <div className="overlay error">{previewError}</div>}
          {preview && <PreviewView preview={preview} mode={showMode} />}
          {!preview && !previewLoading && !previewError && (
            <div className="placeholder">
              {files.length === 0
                ? "フォルダを選択してください"
                : "ファイルを選択してください"}
            </div>
          )}
        </section>
      </main>

      <footer className="batch-bar">
        <button onClick={startBatch} disabled={batchActive || files.length === 0}>
          ▶ 一括処理を実行
        </button>
        {batchActive && batchEvent && (
          <>
            <progress max={batchEvent.total} value={batchEvent.index + 1} />
            <span>
              {batchEvent.index + 1} / {batchEvent.total} — {batchEvent.name ?? batchEvent.status}
            </span>
          </>
        )}
      </footer>

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}

function ParamGroup({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  options: number[];
  onChange: (v: number) => void;
}) {
  return (
    <div className="param-group">
      <label className="bold">{label}</label>
      <div className="radio-row">
        {options.map((opt) => (
          <label key={opt}>
            <input
              type="radio"
              checked={value === opt}
              onChange={() => onChange(opt)}
            />
            {opt === 0 ? "なし" : `k=${opt}`}
          </label>
        ))}
      </div>
      <div className="hint">{hint}</div>
    </div>
  );
}

function ThresholdSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="param-group">
      <label className="bold">② Threshold</label>
      <div className="slider-row">
        <input
          type="range"
          min={100}
          max={245}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
        />
        <span className="value">{value}</span>
      </div>
      <div className="hint">グレーエッジを黒側に取り込む（高い=黒↑）</div>
    </div>
  );
}

function PreviewView({
  preview,
  mode,
}: {
  preview: PreviewResponse;
  mode: "after" | "before" | "split";
}) {
  const afterSrc = `data:image/png;base64,${preview.after_png_b64}`;
  const beforeSrc = preview.before_png_b64
    ? `data:image/png;base64,${preview.before_png_b64}`
    : null;

  if (mode === "split" && beforeSrc) {
    return (
      <div className="split-preview">
        <div>
          <div className="caption">処理前</div>
          <img src={beforeSrc} alt="before" />
        </div>
        <div>
          <div className="caption">処理後</div>
          <img src={afterSrc} alt="after" />
        </div>
      </div>
    );
  }
  if (mode === "before" && beforeSrc) {
    return <img className="single" src={beforeSrc} alt="before" />;
  }
  return <img className="single" src={afterSrc} alt="after" />;
}

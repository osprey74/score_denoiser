import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { AboutDialog } from "./components/AboutDialog";
import { PreviewCanvas, Viewport } from "./components/PreviewCanvas";
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

interface BatchResult {
  name: string;
  status: FileStatus;
  error?: string;
}

const KSIZE_MAX = 31; // 最大カーネルサイズ (奇数)
const KSIZE_MAX_POS = (KSIZE_MAX - 1) / 2; // スライダー位置の最大値

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
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [curIdx, setCurIdx] = useState<number>(-1);
  const [showMode, setShowMode] = useState<"after" | "before" | "split">("after");
  const [filter, setFilter] = useState("");

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // 分割表示で左右を連動させるため、view 状態を App に持つ（両 canvas 共有）
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [pendingFit, setPendingFit] = useState(true); // 初回は fit
  const shouldFitNextRef = useRef(false); // 次回プレビュー到着時に fit を発火

  const [toast, setToast] = useState<{ msg: string; kind: "info" | "warn" | "error" } | null>(null);
  const toastTimer = useRef<number | null>(null);

  const [batchActive, setBatchActive] = useState(false);
  const [batchEvent, setBatchEvent] = useState<BatchEvent | null>(null);
  const batchAbortRef = useRef<AbortController | null>(null);

  const [aboutOpen, setAboutOpen] = useState(false);

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

  // 検索フィルタ後のリスト
  const visibleFiles = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.name.toLowerCase().includes(q));
  }, [files, filter]);

  // -- bootstrap --
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
      shouldFitNextRef.current = true; // 次回プレビューで fit を発火
      setFiles(r.files);
      setStatuses({});
      setBatchResults([]);
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
        // 「ファイル変更」または「フォルダ選択」由来のフィットは、setPreview の直後に発火する
        // (imageB64 が新しい値になってから pendingFit が立つように、レース回避)
        if (shouldFitNextRef.current) {
          shouldFitNextRef.current = false;
          setPendingFit(true);
        }
      } catch (e) {
        setPreviewError(String(e));
        setPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    },
    [files, params, showMode],
  );

  // ファイル変更を検出し、!keep_view ならフィットフラグを立てる
  const prevFilePathRef = useRef<string>("");
  useEffect(() => {
    const cur = curIdx >= 0 && curIdx < files.length ? files[curIdx].path : "";
    if (prevFilePathRef.current !== "" && prevFilePathRef.current !== cur && !cfgRef.current.keep_view) {
      shouldFitNextRef.current = true;
    }
    prevFilePathRef.current = cur;
  }, [curIdx, files]);

  // auto-preview on selection / params / showMode change
  useEffect(() => {
    if (curIdx >= 0 && curIdx < files.length) runPreview(curIdx);
  }, [curIdx, files, runPreview]);

  // -- keyboard shortcuts --
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        if (!batchActive) selectFolder();
        return;
      }
      if (isInput) return;
      if (batchActive) return;

      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        setCurIdx((i) => Math.min(i + 1, files.length - 1));
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        setCurIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "F5") {
        e.preventDefault();
        if (curIdx >= 0) runPreview(curIdx);
      } else if (e.key === "Home") {
        e.preventDefault();
        setPendingFit(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [files.length, curIdx, runPreview, batchActive, selectFolder]);

  const startBatch = useCallback(async () => {
    if (!cfg.folder || files.length === 0) {
      showToast("フォルダを選択してください", "warn");
      return;
    }
    if (!window.confirm(`${files.length} 個のファイルを処理します。続行しますか？`)) return;

    setBatchActive(true);
    setStatuses({});
    setBatchResults([]);
    const collected: BatchResult[] = [];
    const ac = new AbortController();
    batchAbortRef.current = ac;
    try {
      for await (const ev of runBatch(
        cfg.folder,
        files.map((f) => f.path),
        params,
        cfg.output_subdir,
        cfg.skip_existing,
        ac.signal,
      )) {
        setBatchEvent(ev);
        if (ev.name && ev.status !== "doing") {
          const st = (ev.status === "complete" ? "done" : ev.status) as FileStatus;
          setStatuses((prev) => ({ ...prev, [ev.name as string]: st }));
          collected.push({ name: ev.name, status: st, error: ev.error });
        } else if (ev.name) {
          setStatuses((prev) => ({ ...prev, [ev.name as string]: "doing" }));
        }
        if (ev.status === "complete") {
          showToast(`✅ 完了: ${ev.output_dir}`, "info");
        }
      }
    } catch (e) {
      const msg = String(e);
      if (msg.includes("abort")) {
        showToast("キャンセルしました", "warn");
      } else {
        showToast(msg, "error");
      }
    } finally {
      setBatchActive(false);
      batchAbortRef.current = null;
      setBatchResults(collected);
    }
  }, [cfg, files, params, showToast]);

  const cancelBatch = useCallback(() => {
    batchAbortRef.current?.abort();
  }, []);

  const exportCSV = useCallback(() => {
    if (batchResults.length === 0) {
      showToast("エクスポートするバッチ結果がありません", "warn");
      return;
    }
    const lines = ["filename,status,error"];
    for (const r of batchResults) {
      const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
      lines.push(`${esc(r.name)},${esc(r.status)},${esc(r.error ?? "")}`);
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `batch-result-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [batchResults, showToast]);

  if (sidecarError) {
    return (
      <div className="boot-error">
        <h2>サイドカー起動エラー</h2>
        <pre>{sidecarError}</pre>
        <p>別ターミナルで <code>npm run sidecar</code> を実行してください。</p>
      </div>
    );
  }
  if (!sidecarReady) {
    return (
      <div className="boot">
        <div className="spinner" />
        <div>サイドカー起動中…</div>
      </div>
    );
  }

  const beforeB64 = preview?.before_png_b64 ?? null;
  const afterB64 = preview?.after_png_b64 ?? null;

  return (
    <div className="app">
      <header className="folder-bar">
        <button type="button" onClick={selectFolder} title="Ctrl+O">📁 フォルダを選択… <span className="kbd">Ctrl+O</span></button>
        <input type="text" value={cfg.folder} readOnly placeholder="フォルダ未選択" aria-label="選択中のフォルダパス" />
        <span className="muted">{files.length} 個の PNG</span>
        <button type="button" className="about-btn" onClick={() => setAboutOpen(true)} title="このアプリについて">
          ℹ️ このアプリについて
        </button>
      </header>

      <section className="params">
        <KernelSlider
          id="blur-slider"
          label="① Gaussian Blur"
          hint="微細ノイズを均す（k=0 でスキップ）"
          value={cfg.blur_ksize}
          onChange={(v) => setCfg({ ...cfg, blur_ksize: v })}
        />
        <ThresholdSlider
          value={cfg.threshold}
          onChange={(v) => setCfg({ ...cfg, threshold: v })}
        />
        <KernelSlider
          id="close-slider"
          label="③ Morphology Close"
          hint="黒領域内の白い穴を塗りつぶす（k=0 でスキップ）"
          value={cfg.close_ksize}
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
              checked={cfg.keep_view}
              onChange={(e) => setCfg({ ...cfg, keep_view: e.target.checked })}
            />
            ファイル切替時にズーム維持
          </label>
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
            type="button"
            className="primary"
            onClick={() => (curIdx >= 0 ? runPreview(curIdx) : showToast("ファイルを選択してください", "warn"))}
            disabled={batchActive}
          >
            🔄 プレビュー再生成 <span className="kbd">F5</span>
          </button>
          <input
            type="search"
            className="file-search"
            placeholder="🔍 ファイル名で絞り込み"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="files-count">
            {files.length === 0
              ? "ファイルなし"
              : filter
                ? `${visibleFiles.length} / ${files.length} 件`
                : `${curIdx + 1} / ${files.length}`}
          </div>
          <ul className="file-list">
            {visibleFiles.map((f) => {
              const trueIdx = files.indexOf(f);
              return (
                <li
                  key={f.path}
                  className={[
                    trueIdx === curIdx ? "sel" : "",
                    statuses[f.name] ?? "",
                  ].join(" ")}
                  onClick={() => setCurIdx(trueIdx)}
                  title={f.name}
                >
                  {f.name}
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="preview">
          {previewError && <div className="overlay error">{previewError}</div>}
          {showMode === "split" && beforeB64 ? (
            <div className="split-preview">
              <PreviewCanvas
                imageB64={beforeB64}
                caption="処理前"
                view={view}
                onViewChange={setView}
                pendingFit={pendingFit}
                onFitDone={() => setPendingFit(false)}
                loading={previewLoading}
              />
              <PreviewCanvas
                imageB64={afterB64}
                caption="処理後"
                view={view}
                onViewChange={setView}
                pendingFit={pendingFit}
                onFitDone={() => setPendingFit(false)}
                loading={previewLoading}
              />
            </div>
          ) : showMode === "before" && beforeB64 ? (
            <PreviewCanvas
              imageB64={beforeB64}
              caption="処理前"
              view={view}
              onViewChange={setView}
              pendingFit={pendingFit}
              onFitDone={() => setPendingFit(false)}
              loading={previewLoading}
            />
          ) : afterB64 ? (
            <PreviewCanvas
              imageB64={afterB64}
              caption="処理後"
              view={view}
              onViewChange={setView}
              pendingFit={pendingFit}
              onFitDone={() => setPendingFit(false)}
              loading={previewLoading}
            />
          ) : !previewLoading ? (
            <div className="placeholder">
              {files.length === 0
                ? "フォルダを選択してください (Ctrl+O)"
                : "ファイルを選択してください"}
            </div>
          ) : (
            <div className="canvas-spinner standalone">
              <div className="spinner" />
              <div>処理中…</div>
            </div>
          )}
        </section>
      </main>

      <footer className="batch-bar">
        {!batchActive ? (
          <button type="button" className="batch-go" onClick={startBatch} disabled={files.length === 0}>
            ▶ 一括処理を実行
          </button>
        ) : (
          <button type="button" className="batch-cancel" onClick={cancelBatch}>
            ■ キャンセル
          </button>
        )}
        {batchActive && batchEvent && (
          <>
            <progress max={batchEvent.total} value={batchEvent.index + 1} />
            <span className="batch-status">
              {batchEvent.index + 1} / {batchEvent.total} — {batchEvent.name ?? batchEvent.status}
            </span>
          </>
        )}
        {!batchActive && batchResults.length > 0 && (
          <button type="button" onClick={exportCSV} title="バッチ結果を CSV で保存">
            📊 CSV エクスポート ({batchResults.length})
          </button>
        )}
      </footer>

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </div>
  );
}

function KernelSlider({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}) {
  // 位置 0 = カーネル 0 (off), 位置 N (>=1) = カーネル 2N+1 (奇数)
  const sliderPos = value === 0 ? 0 : Math.floor((value - 1) / 2);
  const handleChange = (p: number) => onChange(p === 0 ? 0 : 2 * p + 1);

  return (
    <div className="param-group">
      <label className="bold" htmlFor={id}>{label}</label>
      <div className="slider-row">
        <input
          id={id}
          type="range"
          min={0}
          max={KSIZE_MAX_POS}
          step={1}
          value={sliderPos}
          aria-label={label}
          onChange={(e) => handleChange(parseInt(e.target.value, 10))}
        />
        <span className="value">{value === 0 ? "なし" : `k=${value}`}</span>
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
      <label className="bold" htmlFor="threshold-slider">② Threshold</label>
      <div className="slider-row">
        <input
          id="threshold-slider"
          type="range"
          min={100}
          max={245}
          value={value}
          aria-label="Threshold 値"
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
        />
        <span className="value">{value}</span>
      </div>
      <div className="hint">グレーエッジを黒側に取り込む（高い=黒↑）</div>
    </div>
  );
}

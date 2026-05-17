// サイドカー(FastAPI) クライアント

const BASE = "http://127.0.0.1:8766";

export interface FileEntry {
  name: string;
  path: string;
  size: number;
}

export interface FolderResponse {
  folder: string;
  files: FileEntry[];
}

export interface PreviewParams {
  blur_ksize: number;
  threshold: number;
  close_ksize: number;
}

export interface PreviewResponse {
  width: number;
  height: number;
  after_png_b64: string;
  before_png_b64: string | null;
}

export interface AppConfig {
  folder: string;
  blur_ksize: number;
  threshold: number;
  close_ksize: number;
  keep_view: boolean;
  output_subdir: string;
  skip_existing: boolean;
}

export interface BatchEvent {
  index: number;
  total: number;
  name?: string;
  status: "doing" | "done" | "skipped" | "error" | "complete";
  error?: string;
  output_dir?: string;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function waitForSidecar(timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Sidecar did not become healthy within timeout");
}

export function listFolder(path: string): Promise<FolderResponse> {
  return jsonFetch(`${BASE}/folder/list`, {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export function generatePreview(
  path: string,
  params: PreviewParams,
  includeBefore = false,
): Promise<PreviewResponse> {
  return jsonFetch(`${BASE}/preview`, {
    method: "POST",
    body: JSON.stringify({ path, ...params, include_before: includeBefore }),
  });
}

export function getConfig(): Promise<AppConfig> {
  return jsonFetch(`${BASE}/config`);
}

export function saveConfig(cfg: AppConfig): Promise<AppConfig> {
  return jsonFetch(`${BASE}/config`, {
    method: "PUT",
    body: JSON.stringify(cfg),
  });
}

export async function* runBatch(
  folder: string,
  files: string[],
  params: PreviewParams,
  output_subdir = "処理済み",
  skip_existing = false,
  signal?: AbortSignal,
): AsyncGenerator<BatchEvent> {
  const res = await fetch(`${BASE}/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder, files, ...params, output_subdir, skip_existing }),
    signal,
  });
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const p of parts) {
      const line = p.trim();
      if (!line.startsWith("data:")) continue;
      const json = line.slice(5).trim();
      if (json) yield JSON.parse(json) as BatchEvent;
    }
  }
}

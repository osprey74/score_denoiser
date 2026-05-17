import { useEffect, useRef, useState } from "react";

const MINIMAP_W = 220;
const MINIMAP_MAX_H = 160;
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 16;
const WHEEL_STEP = 1.15;

interface Viewport {
  x: number; // image-space top-left
  y: number;
  zoom: number; // canvas_px / image_px
}

interface PreviewCanvasProps {
  imageB64: string | null;
  caption?: string;
  resetSignal: number; // bump to force fit
  loading?: boolean;
}

export function PreviewCanvas({
  imageB64,
  caption,
  resetSignal,
  loading,
}: PreviewCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);

  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 600, h: 400 });
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });

  const viewRef = useRef(view);
  viewRef.current = view;
  const sizeRef = useRef(containerSize);
  sizeRef.current = containerSize;
  const bitmapRef = useRef(bitmap);
  bitmapRef.current = bitmap;

  // ── ImageBitmap の生成 ───────────────────────────
  useEffect(() => {
    if (!imageB64) {
      setBitmap(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      createImageBitmap(img).then((bmp) => {
        if (!cancelled) setBitmap(bmp);
      });
    };
    img.src = `data:image/png;base64,${imageB64}`;
    return () => {
      cancelled = true;
    };
  }, [imageB64]);

  // ── コンテナサイズ追跡 ───────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ── 「fit-to-view」計算 ──────────────────────────
  const fitView = (bmp: ImageBitmap, w: number, h: number): Viewport => {
    const zoom = Math.min(w / bmp.width, h / bmp.height);
    const x = bmp.width / 2 - w / 2 / zoom;
    const y = bmp.height / 2 - h / 2 / zoom;
    return { x, y, zoom };
  };

  // ── 初回ロード時 + resetSignal で fit ────────────
  useEffect(() => {
    if (!bitmap) return;
    setView(fitView(bitmap, sizeRef.current.w, sizeRef.current.h));
  }, [bitmap, resetSignal]);

  // ── ビューポート制約（画像外に飛ばない） ────────
  const clampView = (v: Viewport, bmp: ImageBitmap, w: number, h: number): Viewport => {
    const visW = w / v.zoom;
    const visH = h / v.zoom;
    let x = v.x;
    let y = v.y;
    if (visW >= bmp.width) x = bmp.width / 2 - visW / 2;
    else x = Math.max(0, Math.min(x, bmp.width - visW));
    if (visH >= bmp.height) y = bmp.height / 2 - visH / 2;
    else y = Math.max(0, Math.min(y, bmp.height - visH));
    return { x, y, zoom: v.zoom };
  };

  // ── キャンバス描画 ───────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = containerSize.w;
    const ch = containerSize.h;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#666";
    ctx.fillRect(0, 0, cw, ch);

    if (bitmap) {
      const visW = cw / view.zoom;
      const visH = ch / view.zoom;
      ctx.imageSmoothingEnabled = view.zoom < 1;
      ctx.drawImage(
        bitmap,
        view.x, view.y, visW, visH,
        0, 0, cw, ch,
      );
    }
  }, [bitmap, view, containerSize]);

  // ── ミニマップ描画 ───────────────────────────────
  useEffect(() => {
    const mm = minimapRef.current;
    if (!mm || !bitmap) return;
    const dpr = window.devicePixelRatio || 1;
    const scaleH = MINIMAP_MAX_H / bitmap.height;
    const scaleW = MINIMAP_W / bitmap.width;
    const scale = Math.min(scaleH, scaleW);
    const mw = Math.max(1, Math.round(bitmap.width * scale));
    const mh = Math.max(1, Math.round(bitmap.height * scale));
    mm.width = mw * dpr;
    mm.height = mh * dpr;
    mm.style.width = `${mw}px`;
    mm.style.height = `${mh}px`;
    const ctx = mm.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, mw, mh);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bitmap, 0, 0, mw, mh);

    // ビューポート枠
    const vx = view.x * scale;
    const vy = view.y * scale;
    const vw = (containerSize.w / view.zoom) * scale;
    const vh = (containerSize.h / view.zoom) * scale;
    ctx.strokeStyle = "#ff5722";
    ctx.lineWidth = 2;
    ctx.strokeRect(vx, vy, vw, vh);
    ctx.fillStyle = "rgba(255, 87, 34, 0.15)";
    ctx.fillRect(vx, vy, vw, vh);
  }, [bitmap, view, containerSize]);

  // ── マウス: ホイールズーム ───────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      const bmp = bitmapRef.current;
      if (!bmp) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const v = viewRef.current;
      const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.zoom * factor));
      // ズーム中心がマウス位置になるよう x,y を調整
      const imgX = v.x + mx / v.zoom;
      const imgY = v.y + my / v.zoom;
      const newX = imgX - mx / newZoom;
      const newY = imgY - my / newZoom;
      setView(clampView({ x: newX, y: newY, zoom: newZoom }, bmp, sizeRef.current.w, sizeRef.current.h));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // ── マウス: ドラッグパン ─────────────────────────
  const dragRef = useRef<{ startX: number; startY: number; vx: number; vy: number } | null>(null);
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      vx: viewRef.current.x,
      vy: viewRef.current.y,
    };
    (e.target as HTMLElement).setPointerCapture?.(e.nativeEvent.button);
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const d = dragRef.current;
    const bmp = bitmapRef.current;
    if (!d || !bmp) return;
    const dx = (e.clientX - d.startX) / viewRef.current.zoom;
    const dy = (e.clientY - d.startY) / viewRef.current.zoom;
    setView(
      clampView(
        { x: d.vx - dx, y: d.vy - dy, zoom: viewRef.current.zoom },
        bmp,
        sizeRef.current.w,
        sizeRef.current.h,
      ),
    );
  };
  const onMouseUp = () => {
    dragRef.current = null;
  };

  // ── ミニマップクリックでビューポートジャンプ ─────
  const onMinimapClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const bmp = bitmapRef.current;
    if (!bmp) return;
    const rect = minimapRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const scale = rect.width / bmp.width;
    const imgX = mx / scale;
    const imgY = my / scale;
    const v = viewRef.current;
    const visW = sizeRef.current.w / v.zoom;
    const visH = sizeRef.current.h / v.zoom;
    setView(
      clampView(
        { x: imgX - visW / 2, y: imgY - visH / 2, zoom: v.zoom },
        bmp,
        sizeRef.current.w,
        sizeRef.current.h,
      ),
    );
  };

  // ── fit ボタン ──────────────────────────────────
  const onFit = () => {
    if (!bitmap) return;
    setView(fitView(bitmap, containerSize.w, containerSize.h));
  };

  return (
    <div className="canvas-wrap" ref={containerRef}>
      <canvas
        ref={canvasRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        className="main-canvas"
      />
      {caption && <div className="canvas-caption">{caption}</div>}
      {bitmap && (
        <div className="minimap">
          <canvas ref={minimapRef} onClick={onMinimapClick} />
          <div className="minimap-info">
            {Math.round(view.zoom * 100)}% — {bitmap.width}×{bitmap.height}
          </div>
        </div>
      )}
      <button type="button" className="fit-btn" onClick={onFit} title="フィット (Home)">
        ⬚ fit
      </button>
      {loading && (
        <div className="canvas-spinner">
          <div className="spinner" />
          <div>処理中…</div>
        </div>
      )}
    </div>
  );
}

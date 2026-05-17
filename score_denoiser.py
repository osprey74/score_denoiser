#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
楽譜ノイズ除去ツール v2.6
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
変更点 (v2.5 → v2.6):
  ① パラメータを inner.pack(anchor='w') で左詰め固定幅に変更
     全画面でも3セクションが間延びしない
  ② フォルダ選択を2ボタン＋直打ちの3方式に整理
     「フォルダを指定…」→ askdirectory (通常操作)
     「ファイルから指定…」→ askopenfilename (PNG一覧目視確認)
     パス直打ち後 Enter → そのまま読み込み

依存: opencv-python, Pillow, numpy
  pip install opencv-python pillow numpy
"""

import sys
import threading
from pathlib import Path

import cv2
import numpy as np
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from PIL import Image, ImageTk, ImageDraw


APP_DIR = Path(__file__).resolve().parent
ICON_ICO = APP_DIR / "music-score.ico"
ICON_PNG = APP_DIR / "music-score.png"


# ─────────────────────────────────────────────────────
#  日本語パス対応
# ─────────────────────────────────────────────────────

def imread_u(path, flags=cv2.IMREAD_GRAYSCALE):
    try:
        buf = np.fromfile(str(path), dtype=np.uint8)
        return cv2.imdecode(buf, flags)
    except Exception:
        return None


def imwrite_u(path, img):
    try:
        ext = Path(path).suffix.lower()
        ret, buf = cv2.imencode(ext, img)
        if ret:
            buf.tofile(str(path))
        return ret
    except Exception:
        return False


# ─────────────────────────────────────────────────────
#  コア処理
# ─────────────────────────────────────────────────────

def process_score(gray_img, blur_ksize, threshold, close_ksize):
    src = gray_img.copy()
    if blur_ksize >= 3:
        src = cv2.GaussianBlur(src, (blur_ksize, blur_ksize), 0.8)
    _, binary = cv2.threshold(src, threshold, 255, cv2.THRESH_BINARY)
    if close_ksize >= 3:
        inv  = cv2.bitwise_not(binary)
        kern = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,
                                         (close_ksize, close_ksize))
        binary = cv2.bitwise_not(cv2.morphologyEx(inv, cv2.MORPH_CLOSE, kern))
    return binary


# ─────────────────────────────────────────────────────
#  定数
# ─────────────────────────────────────────────────────

MINIMAP_W      = 240
MINIMAP_M      = 8
MINIMAP_MAX_H  = 180

SPINNER_R      = 36
SPINNER_WIDTH  = 7
SPINNER_STEP   = 16
SPINNER_FPS    = 50

TOAST_W        = 360
TOAST_H        = 54
TOAST_MARGIN   = 16
TOAST_SHOW_MS  = 2800

LIST_PANE_INIT = 230   # ファイルリスト初期幅
LIST_ROW_H     = 30    # Treeview 行高さ (余白込み)
LIST_FONT_SIZE = 11    # ファイル名フォントサイズ

# Treeview 行タグ色
CLR_DOING = "#fff8e1"
CLR_DONE  = "#e8f5e9"
CLR_ERROR = "#ffebee"


# ─────────────────────────────────────────────────────
#  GUI
# ─────────────────────────────────────────────────────

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("楽譜ノイズ除去ツール v2.6")
        self.geometry("1100x880")
        self.minsize(800, 600)
        self._set_app_icon()

        # パラメータ変数
        self.folder_var    = tk.StringVar()
        self.blur_var      = tk.IntVar(value=5)
        self.thresh_var    = tk.IntVar(value=220)
        self.close_var     = tk.IntVar(value=5)
        self.keep_view_var = tk.BooleanVar(value=True)

        self.png_files: list[Path] = []
        self.is_busy  = False
        self._cur_idx = -1
        self._tree_ids: list[str] = []   # Treeview iid リスト

        # プレビュー
        self._before_rgb: np.ndarray | None = None
        self._after_rgb:  np.ndarray | None = None
        self._last_pil:   Image.Image | None = None
        self._show_mode = tk.StringVar(value="after")

        # ビューポート
        self._vx   = 0.0
        self._vy   = 0.0
        self._zoom = 1.0
        self._cw   = 840
        self._ch   = 450

        # ミニマップ
        self._mm_rect  = None
        self._mm_scale = (1.0, 1.0)

        # ドラッグ
        self._drag = None

        # スピナー
        self._spinning    = False
        self._spin_angle  = 0
        self._spinner_job = None

        self._build_ui()

        # ── 初回表示後にサッシ位置を設定 ────────────
        # <Map>: ウィンドウが画面に表示された最初のタイミング
        def _on_first_show(event):
            self.unbind("<Map>")
            self.after(20, self._init_sash)

        self.bind("<Map>", _on_first_show)

    def _set_app_icon(self):
        """アプリアイコン設定（Windows: .ico / その他: PNG fallback）"""
        if sys.platform.startswith("win") and ICON_ICO.exists():
            try:
                self.iconbitmap(default=str(ICON_ICO))
                return
            except Exception:
                pass
        if ICON_PNG.exists():
            try:
                self._icon_img = ImageTk.PhotoImage(Image.open(ICON_PNG))
                self.iconphoto(True, self._icon_img)
            except Exception:
                pass

    def _init_sash(self):
        """PanedWindow のサッシ位置を設定（ウィンドウ描画後に呼ぶ）"""
        try:
            self._paned.update_idletasks()
            self._paned.sashpos(0, LIST_PANE_INIT)
        except Exception:
            self.after(50, self._init_sash)   # 描画が間に合わなければリトライ

    # ── UI 構築 ─────────────────────────────────────

    def _build_ui(self):
        P = dict(padx=10, pady=4)

        # ▸ フォルダ選択
        f = ttk.LabelFrame(self, text="📁  フォルダ選択", padding=8)
        f.pack(fill="x", **P)

        entry = ttk.Entry(f, textvariable=self.folder_var, width=70)
        entry.pack(side="left", padx=(0,6))
        # パスを直打ちして Enter でも読み込み可能
        entry.bind("<Return>", lambda _: self._load_folder_from_entry())

        ttk.Button(f, text="フォルダを指定…",
                   command=self._sel_folder_dir).pack(side="left", padx=(0,3))
        ttk.Button(f, text="ファイルから指定…",
                   command=self._sel_folder_via_file).pack(side="left", padx=(0,6))

        self._lbl_cnt = ttk.Label(f, text="", foreground="#555")
        self._lbl_cnt.pack(side="left", padx=4)

        # ▸ 処理パラメータ（3セクション＋縦区切り）
        self._build_params(P)

        # ▸ プレビュー操作バー
        f3 = ttk.Frame(self, padding=(8,2))
        f3.pack(fill="x", **P)
        ttk.Button(f3, text="⤢ 全体表示",
                   command=self._fit_view).pack(side="left", padx=4)
        ttk.Separator(f3, orient="vertical").pack(side="left", fill="y", padx=6)
        ttk.Label(f3, text="表示:").pack(side="left")
        for v, lb in [("before","処理前"),("after","処理後"),("diff","差分")]:
            ttk.Radiobutton(f3, text=lb, variable=self._show_mode,
                            value=v, command=self._redraw).pack(side="left", padx=2)
        ttk.Separator(f3, orient="vertical").pack(side="left", fill="y", padx=6)
        ttk.Checkbutton(f3, text="ズーム維持（ファイル切替時）",
                        variable=self.keep_view_var).pack(side="left", padx=4)
        self._lbl_zm = ttk.Label(f3, text="", foreground="#555", font=("Courier",9))
        self._lbl_zm.pack(side="left", padx=10)

        # ▸ メインエリア: ファイルリスト (左) ＋ キャンバス (右)
        self._paned = ttk.PanedWindow(self, orient="horizontal")
        self._paned.pack(fill="both", expand=True, padx=10, pady=4)

        # ── 左ペイン: ファイルリスト ──
        self._build_file_list()

        # ── 右ペイン: キャンバス ──
        hint = "ホイール: ズーム  /  ドラッグ: スクロール  /  右下ミニマップ: 移動"
        f4 = ttk.LabelFrame(self._paned, text=f"プレビュー  （{hint}）", padding=4)
        self._paned.add(f4, weight=1)

        self._canvas = tk.Canvas(f4, bg="#444", cursor="crosshair")
        self._canvas.pack(fill="both", expand=True)
        self._canvas.bind("<Configure>",       self._on_resize)
        self._canvas.bind("<ButtonPress-1>",   self._on_press)
        self._canvas.bind("<B1-Motion>",       self._on_drag_mouse)
        self._canvas.bind("<ButtonRelease-1>", self._on_release)
        self._canvas.bind("<MouseWheel>",      self._on_wheel)
        self._canvas.bind("<Button-4>",        self._on_wheel)
        self._canvas.bind("<Button-5>",        self._on_wheel)

        # ▸ バッチ処理
        f5 = ttk.Frame(self, padding=(8,4))
        f5.pack(fill="x", padx=10, pady=(2,10))
        self._btn_batch = ttk.Button(f5, text="▶  一括処理 実行",
                                     command=self._run_batch)
        self._btn_batch.pack(side="left", padx=4)
        self._progress = ttk.Progressbar(f5, mode="determinate", length=380)
        self._progress.pack(side="left", padx=8, fill="x", expand=True)
        self._lbl_st = ttk.Label(f5, text="フォルダを選択してください",
                                  foreground="#555")
        self._lbl_st.pack(side="left")

    # ── パラメータセクション ─────────────────────────

    def _build_params(self, P):
        f2 = ttk.LabelFrame(self, text="⚙️  処理パラメータ", padding=10)
        f2.pack(fill="x", **P)

        # コンテンツ幅で止まる内部フレームを左詰めに配置
        # fill / expand をつけないので右側には伸びない
        inner = ttk.Frame(f2)
        inner.pack(anchor="w")

        # ─ セクション 1: Gaussian Blur ─
        s1 = ttk.Frame(inner)
        s1.pack(side="left", anchor="n", padx=(0, 4))

        ttk.Label(s1, text="① Gaussian Blur",
                  font=("", 9, "bold")).grid(row=0, column=0, columnspan=4, sticky="w")
        for c, (v, lb) in enumerate([(0,"なし"),(3,"k=3"),(5,"k=5"),(7,"k=7")]):
            ttk.Radiobutton(s1, text=lb, variable=self.blur_var,
                            value=v).grid(row=1, column=c, sticky="w", padx=2, pady=2)
        ttk.Label(s1, text="ノイズをぼかして均す",
                  foreground="#666", font=("",8)
                  ).grid(row=2, column=0, columnspan=4, sticky="w", pady=(2,0))

        # ─ 縦区切り 1 ─
        ttk.Separator(inner, orient="vertical").pack(side="left", fill="y", padx=12)

        # ─ セクション 2: Threshold ─
        s2 = ttk.Frame(inner)
        s2.pack(side="left", anchor="n", padx=4)

        ttk.Label(s2, text="② 閾値 (Threshold)",
                  font=("", 9, "bold")).grid(row=0, column=0, columnspan=3, sticky="w")
        ttk.Scale(s2, from_=100, to=245, variable=self.thresh_var,
                  orient="horizontal", length=210,
                  ).grid(row=1, column=0, columnspan=2, sticky="w", padx=2, pady=2)
        self._lbl_th = ttk.Label(s2, text="220", width=4, anchor="e")
        self._lbl_th.grid(row=1, column=2, padx=(0,2))
        self.thresh_var.trace_add("write",
            lambda *_: self._lbl_th.config(text=str(self.thresh_var.get())))
        ttk.Label(s2, text="高いほど黒面積↑　推奨: 200〜230",
                  foreground="#666", font=("",8)
                  ).grid(row=2, column=0, columnspan=3, sticky="w", pady=(2,0))

        # ─ 縦区切り 2 ─
        ttk.Separator(inner, orient="vertical").pack(side="left", fill="y", padx=12)

        # ─ セクション 3: Morphology Close ─
        s3 = ttk.Frame(inner)
        s3.pack(side="left", anchor="n", padx=(4, 0))

        ttk.Label(s3, text="③ Morphology Close",
                  font=("", 9, "bold")).grid(row=0, column=0, columnspan=4, sticky="w")
        for c, (v, lb) in enumerate([(0,"なし"),(3,"k=3"),(5,"k=5"),(7,"k=7")]):
            ttk.Radiobutton(s3, text=lb, variable=self.close_var,
                            value=v).grid(row=1, column=c, sticky="w", padx=2, pady=2)
        ttk.Label(s3, text="黒領域内の白い穴を塗りつぶす",
                  foreground="#666", font=("",8)
                  ).grid(row=2, column=0, columnspan=4, sticky="w", pady=(2,0))

    # ── ファイルリストペイン ──────────────────────────

    def _build_file_list(self):
        f_list = ttk.LabelFrame(self._paned, text="📄  ファイル一覧", padding=4)
        self._paned.add(f_list, weight=0)

        self._lbl_cnt2 = ttk.Label(f_list, text="ファイルなし",
                                    foreground="#777", font=("", 8))
        self._lbl_cnt2.pack(anchor="w", padx=2, pady=(0,3))

        list_frame = ttk.Frame(f_list)
        list_frame.pack(fill="both", expand=True)

        sb = ttk.Scrollbar(list_frame, orient="vertical")
        sb.pack(side="right", fill="y")

        # Treeview スタイル設定
        sty = ttk.Style()
        sty.configure("Files.Treeview",
                       rowheight=LIST_ROW_H,
                       font=("", LIST_FONT_SIZE),
                       borderwidth=0)
        sty.configure("Files.Treeview.Heading", font=("", 8))
        sty.layout("Files.Treeview", [
            ("Files.Treeview.treearea", {"sticky": "nswe"})
        ])
        sty.map("Files.Treeview",
                background=[("selected", "#90caf9")],
                foreground=[("selected", "#000000")])

        self._tree = ttk.Treeview(
            list_frame,
            style="Files.Treeview",
            show="tree",
            selectmode="browse",
            yscrollcommand=sb.set,
        )
        self._tree.pack(side="left", fill="both", expand=True)
        sb.config(command=self._tree.yview)

        # タグ色（行の状態表示）
        self._tree.tag_configure("doing", background=CLR_DOING)
        self._tree.tag_configure("done",  background=CLR_DONE)
        self._tree.tag_configure("error", background=CLR_ERROR)

        self._tree.bind("<<TreeviewSelect>>", self._on_tree_select)

    # ── フォルダ読み込み共通処理 ────────────────────

    def _load_folder(self, folder: Path, preselect: Path | None = None):
        """フォルダを読み込んでファイルリストを更新する共通処理"""
        if not folder.is_dir():
            messagebox.showwarning("警告", f"フォルダが見つかりません:\n{folder}")
            return

        self.png_files = sorted(folder.glob("*.png"))
        n = len(self.png_files)

        if n == 0:
            messagebox.showinfo("情報", f"フォルダ内にPNGファイルが見つかりませんでした:\n{folder}")
            return

        self.folder_var.set(str(folder))

        # Treeview を更新
        for iid in self._tree.get_children():
            self._tree.delete(iid)
        self._tree_ids = []
        for f in self.png_files:
            iid = self._tree.insert("", tk.END, text=f.name)
            self._tree_ids.append(iid)

        self._lbl_cnt.config(text=f"{n} 枚の PNG")
        self._lbl_cnt2.config(text=f"{n} 枚")
        self._cur_idx = -1
        self._reset_preview(force_reset_view=True)
        self._set_st(f"{n} 枚の PNG が見つかりました  ({folder.name})")

        # 指定ファイルがあればそれを選択してプレビュー
        if preselect and preselect in self.png_files:
            idx = self.png_files.index(preselect)
            self._tree.selection_set(self._tree_ids[idx])
            self._tree.see(self._tree_ids[idx])
            # _on_tree_select を手動でトリガー
            self._cur_idx = idx
            self._reset_preview(force_reset_view=True)
            self._run_preview(idx)

    def _load_folder_from_entry(self):
        """エントリに直打ちされたパスを読み込む（Enterキー対応）"""
        p = Path(self.folder_var.get().strip())
        self._load_folder(p)

    # ── フォルダ選択（通常: フォルダダイアログ）─────

    def _sel_folder_dir(self):
        """
        通常のフォルダ選択ダイアログ。
        ダイアログ内ではファイルは表示されないが操作感は自然。
        選択後、ファイルリストで PNG を確認してからクリックでプレビュー。
        """
        init = self.folder_var.get() or None
        p = filedialog.askdirectory(
            title="楽譜 PNG フォルダを選択（選択後にファイルリストで内容確認できます）",
            initialdir=init,
            mustexist=True,
        )
        if not p:
            return
        self._load_folder(Path(p))

    # ── フォルダ選択（ファイルから: PNG一覧を目視確認）

    def _sel_folder_via_file(self):
        """
        PNG を1枚選択するとその親フォルダが設定される。
        ダイアログ内でフォルダ内の PNG 一覧を目視確認しながら選択できる。
        選択した PNG が自動的にプレビューされる。
        """
        init = self.folder_var.get() or None
        file = filedialog.askopenfilename(
            title="楽譜フォルダ内の PNG を1枚選択（フォルダが自動設定されます）",
            initialdir=init,
            filetypes=[("PNG 画像", "*.png"), ("すべてのファイル", "*.*")],
        )
        if not file:
            return
        selected = Path(file)
        self._load_folder(selected.parent, preselect=selected)

    # ── ファイルリスト選択 → 自動プレビュー ──────────

    def _on_tree_select(self, event):
        if self._spinning or self.is_busy:
            return
        sel = self._tree.selection()
        if not sel:
            return
        iid = sel[0]
        try:
            idx = self._tree_ids.index(iid)
        except ValueError:
            return
        if idx == self._cur_idx:
            return

        self._cur_idx = idx
        self._reset_preview(force_reset_view=not self.keep_view_var.get())
        self._run_preview(idx)

    # ── プレビュー生成（非同期）─────────────────────

    def _run_preview(self, idx: int | None = None):
        if not self.png_files or self._spinning:
            return

        if idx is None:
            sel = self._tree.selection()
            if not sel:
                return
            try:
                idx = self._tree_ids.index(sel[0])
            except ValueError:
                return

        if idx < 0 or idx >= len(self.png_files):
            return

        ip   = self.png_files[idx]
        bk   = self.blur_var.get()
        th   = self.thresh_var.get()
        ck   = self.close_var.get()
        keep = self.keep_view_var.get()
        iid  = self._tree_ids[idx]

        # 行を「処理中」に
        self._tree.item(iid, tags=("doing",))
        self._tree.see(iid)
        self._start_spinner()
        self._set_st(f"処理中: {ip.name} …")

        def worker():
            gray = imread_u(ip)
            if gray is None:
                def on_err():
                    self._tree.item(iid, tags=("error",))
                    self._stop_spinner()
                    messagebox.showerror("エラー", f"読み込み失敗:\n{ip}")
                self.after(0, on_err)
                return

            result = process_score(gray, bk, th, ck)
            before = cv2.cvtColor(gray,   cv2.COLOR_GRAY2RGB)
            after  = cv2.cvtColor(result, cv2.COLOR_GRAY2RGB)
            diff   = int((gray != result).sum())

            def finish():
                self._before_rgb = before
                self._after_rgb  = after
                self._stop_spinner()
                self._tree.item(iid, tags=("done",))
                self._tree.selection_set(iid)

                if not keep or (self._vx == 0 and self._vy == 0
                                and abs(self._zoom - 1.0) < 1e-3):
                    self._fit_view(redraw=False)
                else:
                    self._clamp()
                self._redraw()
                self._set_st(
                    f"完了: {ip.name}  |  変化: {diff:,} px "
                    f"({diff / gray.size * 100:.2f}%)")
                self._show_toast(f"✅  {ip.name}  プレビュー完了")

            self.after(0, finish)

        threading.Thread(target=worker, daemon=True).start()

    def _fit_view(self, redraw=True):
        if self._before_rgb is None:
            return
        ih, iw = self._before_rgb.shape[:2]
        self._zoom = min(self._cw / iw, self._ch / ih)
        self._vx = self._vy = 0.0
        if redraw:
            self._redraw()

    # ── スピナー ────────────────────────────────────

    def _start_spinner(self):
        self._spinning   = True
        self._spin_angle = 0
        self._spinner_loop()

    def _stop_spinner(self):
        self._spinning = False
        if self._spinner_job is not None:
            self.after_cancel(self._spinner_job)
            self._spinner_job = None

    def _spinner_loop(self):
        if not self._spinning:
            return
        cw, ch = self._cw, self._ch
        cx, cy = cw // 2, ch // 2

        base = (self._last_pil.copy()
                if self._last_pil is not None
                else Image.new("RGB", (cw, ch), (56, 56, 56)))
        if base.size != (cw, ch):
            base = Image.new("RGB", (cw, ch), (56, 56, 56))

        dark = Image.new("RGB", (cw, ch), (0, 0, 0))
        base = Image.blend(base, dark, alpha=0.55)

        d = ImageDraw.Draw(base)
        r = SPINNER_R
        d.arc([cx-r, cy-r, cx+r, cy+r], 0, 360,
              fill=(70, 70, 70), width=SPINNER_WIDTH)
        a = self._spin_angle
        d.arc([cx-r, cy-r, cx+r, cy+r], a, a + 270,
              fill=(255, 255, 255), width=SPINNER_WIDTH)
        d.text((cx, cy + r + 16), "処理中…", fill=(200, 200, 200), anchor="mt")

        photo = ImageTk.PhotoImage(base)
        self._canvas.delete("all")
        self._canvas.create_image(0, 0, image=photo, anchor="nw")
        self._canvas.image = photo

        self._spin_angle  = (self._spin_angle + SPINNER_STEP) % 360
        self._spinner_job = self.after(SPINNER_FPS, self._spinner_loop)

    # ── トースト ────────────────────────────────────

    def _show_toast(self, message: str, bg="#1565c0"):
        self.update_idletasks()
        sx = self.winfo_x() + self.winfo_width()  - TOAST_W - TOAST_MARGIN
        sy = self.winfo_y() + self.winfo_height() - TOAST_H - TOAST_MARGIN

        toast = tk.Toplevel(self)
        toast.wm_overrideredirect(True)
        toast.wm_attributes("-topmost", True)
        try:
            toast.wm_attributes("-alpha", 0.93)
        except Exception:
            pass
        toast.geometry(f"{TOAST_W}x{TOAST_H}+{sx}+{sy}")
        toast.configure(bg=bg)

        inner = tk.Frame(toast, bg=bg)
        inner.pack(fill="both", expand=True, padx=2, pady=2)
        tk.Label(inner, text=message, bg=bg, fg="white",
                 font=("", 10, "bold"), anchor="w",
                 padx=14).pack(fill="both", expand=True)

        def dismiss(_=None):
            try: toast.destroy()
            except Exception: pass
        toast.bind("<Button-1>", dismiss)
        inner.bind("<Button-1>", dismiss)

        def fade(alpha=0.93):
            try:
                if alpha <= 0.0:
                    toast.destroy(); return
                toast.wm_attributes("-alpha", alpha)
                toast.after(30, lambda: fade(alpha - 0.04))
            except Exception:
                pass
        toast.after(TOAST_SHOW_MS, fade)

    # ── 描画 ────────────────────────────────────────

    def _redraw(self):
        if self._before_rgb is None:
            self._canvas.delete("all"); return
        if self._spinning:
            return

        mode = self._show_mode.get()
        ih, iw = self._before_rgb.shape[:2]

        vx = int(max(0, min(self._vx, iw - 1)))
        vy = int(max(0, min(self._vy, ih - 1)))
        vw = max(1, min(int(self._cw / self._zoom) + 1, iw - vx))
        vh = max(1, min(int(self._ch / self._zoom) + 1, ih - vy))

        if mode == "before":
            crop = self._before_rgb[vy:vy+vh, vx:vx+vw]
        elif mode == "after":
            crop = self._after_rgb[vy:vy+vh, vx:vx+vw]
        else:
            b = self._before_rgb[vy:vy+vh, vx:vx+vw]
            a = self._after_rgb[vy:vy+vh, vx:vx+vw]
            mask = np.any(b != a, axis=2)
            crop = a.copy(); crop[mask] = [210, 35, 35]

        dw = max(1, min(int(vw * self._zoom), self._cw))
        dh = max(1, min(int(vh * self._zoom), self._ch))
        interp = cv2.INTER_NEAREST if self._zoom >= 2 else cv2.INTER_AREA
        tile   = cv2.resize(crop, (dw, dh), interpolation=interp)

        canvas_img = Image.new("RGB", (self._cw, self._ch), (56, 56, 56))
        canvas_img.paste(Image.fromarray(tile), (0, 0))

        mm, mm_h = self._make_minimap(iw, ih, vx, vy, vw, vh)
        mm_x = self._cw - MINIMAP_W - MINIMAP_M
        mm_y = self._ch - mm_h     - MINIMAP_M
        canvas_img.paste(mm, (mm_x, mm_y))
        self._mm_rect  = (mm_x, mm_y, mm_x + MINIMAP_W, mm_y + mm_h)
        self._mm_scale = (iw / MINIMAP_W, ih / mm_h)

        draw = ImageDraw.Draw(canvas_img)
        LBLS = {"before":"処理前","after":"処理後","diff":"差分"}
        COLS = {"before":"cyan","after":"#aaffaa","diff":"#ffaaaa"}
        info = (f" [{LBLS[mode]}]  ({vx},{vy})–({vx+vw},{vy+vh})"
                f"  ×{self._zoom:.2f}")
        draw.rectangle([0,0, len(info)*6+6, 16], fill=(0,0,0))
        draw.text((4, 2), info, fill=COLS[mode])

        self._last_pil = canvas_img.copy()
        photo = ImageTk.PhotoImage(canvas_img)
        self._canvas.delete("all")
        self._canvas.create_image(0, 0, image=photo, anchor="nw")
        self._canvas.image = photo
        self._lbl_zm.config(text=f"×{self._zoom:.2f}")

    def _make_minimap(self, iw, ih, vx, vy, vw, vh):
        mm_h  = max(40, min(int(MINIMAP_W * ih / iw), MINIMAP_MAX_H))
        mode  = self._show_mode.get()
        src   = self._after_rgb if mode in ("after","diff") else self._before_rgb
        thumb = cv2.resize(src, (MINIMAP_W, mm_h), interpolation=cv2.INTER_AREA)

        sx, sy = MINIMAP_W / iw, mm_h / ih
        rx0 = int(max(0, vx         * sx)); ry0 = int(max(0, vy         * sy))
        rx1 = int(min(MINIMAP_W-1, (vx+vw)*sx)); ry1 = int(min(mm_h-1, (vy+vh)*sy))

        arr  = thumb.astype(np.float32)
        dark = (arr * 0.45).astype(np.uint8)
        mask = np.zeros((mm_h, MINIMAP_W), dtype=bool)
        mask[ry0:ry1+1, rx0:rx1+1] = True
        result = np.where(mask[:,:,None], arr.astype(np.uint8), dark)
        mm = Image.fromarray(result)

        draw = ImageDraw.Draw(mm)
        for t in range(2):
            draw.rectangle([rx0+t, ry0+t, rx1-t, ry1-t], outline=(30, 144, 255))
        draw.rectangle([0, 0, MINIMAP_W-1, mm_h-1], outline=(160, 160, 160))
        draw.text((4, 2), "MAP", fill=(220, 220, 100))
        return mm, mm_h

    # ── マウスイベント ───────────────────────────────

    def _in_mm(self, x, y):
        if self._mm_rect is None: return False
        x0,y0,x1,y1 = self._mm_rect
        return x0 <= x <= x1 and y0 <= y <= y1

    def _on_press(self, e):
        if self._before_rgb is None or self._spinning: return
        if self._in_mm(e.x, e.y):
            self._drag = ("mm", e.x, e.y, self._vx, self._vy)
            self._mm_jump(e.x, e.y)
        else:
            self._drag = ("main", e.x, e.y, self._vx, self._vy)

    def _on_drag_mouse(self, e):
        if self._before_rgb is None or self._drag is None: return
        mode, sx, sy, ox, oy = self._drag
        if mode == "mm":
            self._mm_jump(e.x, e.y)
        else:
            dx = (sx - e.x) / self._zoom
            dy = (sy - e.y) / self._zoom
            self._vx = ox + dx; self._vy = oy + dy
            self._clamp(); self._redraw()

    def _on_release(self, e): self._drag = None

    def _mm_jump(self, mx, my):
        if self._mm_rect is None: return
        x0, y0 = self._mm_rect[:2]
        img_cx = (mx - x0) * self._mm_scale[0]
        img_cy = (my - y0) * self._mm_scale[1]
        self._vx = img_cx - self._cw / (2 * self._zoom)
        self._vy = img_cy - self._ch / (2 * self._zoom)
        self._clamp(); self._redraw()

    def _on_wheel(self, e):
        if self._before_rgb is None or self._spinning: return
        delta = 1 if (e.num == 4 or (hasattr(e,"delta") and e.delta > 0)) else -1
        old = self._zoom
        new = max(0.05, min(12.0, old * (1.25 if delta > 0 else 0.8)))
        img_mx = self._vx + e.x / old
        img_my = self._vy + e.y / old
        self._zoom = new
        self._vx   = img_mx - e.x / new
        self._vy   = img_my - e.y / new
        self._clamp(); self._redraw()

    def _on_resize(self, e):
        nw, nh = max(e.width, 100), max(e.height, 100)
        if nw == self._cw and nh == self._ch: return
        self._cw, self._ch = nw, nh
        if self._before_rgb is not None and not self._spinning:
            self._clamp(); self._redraw()

    def _clamp(self):
        if self._before_rgb is None: return
        ih, iw = self._before_rgb.shape[:2]
        vw = self._cw / self._zoom; vh = self._ch / self._zoom
        self._vx = max(0, min(self._vx, max(0, iw - vw)))
        self._vy = max(0, min(self._vy, max(0, ih - vh)))

    # ── プレビューリセット ───────────────────────────

    def _reset_preview(self, force_reset_view=False):
        self._stop_spinner()
        self._before_rgb = self._after_rgb = self._last_pil = None
        if force_reset_view:
            self._vx = self._vy = 0.0
            self._zoom = 1.0
        self._canvas.delete("all")

    # ── 一括処理 ────────────────────────────────────

    def _run_batch(self):
        if not self.png_files:
            messagebox.showwarning("警告", "フォルダを選択してください"); return
        if self.is_busy or self._spinning: return

        n  = len(self.png_files)
        bk = self.blur_var.get()
        th = self.thresh_var.get()
        ck = self.close_var.get()

        if not messagebox.askyesno(
            "一括処理の確認",
            f"{n} 枚の PNG を以下の設定で処理します:\n\n"
            f"  ① Blur:      {'なし' if bk==0 else f'Gaussian k={bk}'}\n"
            f"  ② Threshold: {th}\n"
            f"  ③ Close:     {'なし' if ck==0 else f'Ellipse k={ck}'}\n\n"
            "保存先: 選択フォルダ内「処理済み」フォルダ\n"
            "元ファイルは変更されません。\n\n続行しますか？"
        ):
            return

        self.is_busy = True
        self._btn_batch.config(state="disabled")
        self._progress["maximum"] = n
        self._progress["value"]   = 0

        def _worker():
            folder     = Path(self.folder_var.get())
            output_dir = folder / "処理済み"
            output_dir.mkdir(exist_ok=True)
            errors = []

            for i, img_path in enumerate(self.png_files):
                iid = self._tree_ids[i]
                self.after(0, lambda iid=iid, i=i: (
                    self._tree.item(iid, tags=("doing",)),
                    self._tree.see(iid),
                    self._set_st(
                        f"処理中 ({i+1}/{n}): {self.png_files[i].name}")
                ))
                try:
                    gray = imread_u(img_path)
                    if gray is None: raise OSError("読み込み失敗")
                    result = process_score(gray, bk, th, ck)
                    if not imwrite_u(output_dir / img_path.name, result):
                        raise OSError("書き込み失敗")
                    self.after(0, lambda iid=iid:
                        self._tree.item(iid, tags=("done",)))
                except Exception as exc:
                    errors.append(f"{img_path.name}: {exc}")
                    self.after(0, lambda iid=iid:
                        self._tree.item(iid, tags=("error",)))

                self._progress["value"] = i + 1
                self.update_idletasks()

            self.is_busy = False
            self._btn_batch.config(state="normal")

            if errors:
                self._set_st(f"完了（{len(errors)} 件のエラー）")
                messagebox.showwarning("一部エラー",
                    "処理失敗:\n" + "\n".join(errors[:8]))
            else:
                self._set_st(f"✅ 完了: {n} 枚 → 「処理済み」フォルダ")
                messagebox.showinfo("完了",
                    f"{n} 枚の処理が完了しました。\n保存先:\n{output_dir}")
                self.after(200, lambda: self._show_toast(
                    f"✅  一括処理完了  {n} 枚を保存", bg="#2e7d32"))

        threading.Thread(target=_worker, daemon=True).start()

    def _set_st(self, msg):
        self._lbl_st.config(text=msg)
        self.update_idletasks()


# ─────────────────────────────────────────────────────

if __name__ == "__main__":
    app = App()
    app.mainloop()

# -*- coding: utf-8 -*-
"""画像処理コア — Tkinter版 v2.6 の process_score をそのまま移植"""

from pathlib import Path

import cv2
import numpy as np


def imread_u(path, flags=cv2.IMREAD_GRAYSCALE):
    """日本語パス対応 imread"""
    try:
        buf = np.fromfile(str(path), dtype=np.uint8)
        return cv2.imdecode(buf, flags)
    except Exception:
        return None


def imwrite_u(path, img) -> bool:
    """日本語パス対応 imwrite"""
    try:
        ext = Path(path).suffix.lower()
        ret, buf = cv2.imencode(ext, img)
        if ret:
            buf.tofile(str(path))
        return bool(ret)
    except Exception:
        return False


def process_score(gray_img: np.ndarray,
                   blur_ksize: int,
                   threshold: int,
                   close_ksize: int) -> np.ndarray:
    """
    Tkinter版 v2.6 と完全同一のアルゴリズム
      ① Gaussian Blur: 微細ノイズを均す（ksize 0 でスキップ）
      ② Threshold: グレーエッジを黒側に取り込む
      ③ Morphology Close: 黒領域内の残留白穴を塗りつぶす（ksize 0 でスキップ）
    """
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


def encode_png_bytes(img: np.ndarray) -> bytes:
    """numpy 画像を PNG バイト列にエンコード"""
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise RuntimeError("PNG encoding failed")
    return buf.tobytes()

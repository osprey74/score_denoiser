# -*- coding: utf-8 -*-
"""プレビュー生成 — 元画像とパラメータを受け取り処理後 PNG を返す"""

import base64
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from services.processor import imread_u, process_score, encode_png_bytes

router = APIRouter(prefix="/preview", tags=["preview"])


class PreviewRequest(BaseModel):
    path: str
    blur_ksize: int = 5
    threshold: int = 220
    close_ksize: int = 5
    include_before: bool = False


class PreviewResponse(BaseModel):
    width: int
    height: int
    after_png_b64: str
    before_png_b64: str | None = None


@router.post("", response_model=PreviewResponse)
def make_preview(req: PreviewRequest):
    p = Path(req.path)
    if not p.is_file():
        raise HTTPException(status_code=400, detail=f"File not found: {req.path}")

    gray = imread_u(p)
    if gray is None:
        raise HTTPException(status_code=400, detail=f"Could not read image: {req.path}")

    after = process_score(gray, req.blur_ksize, req.threshold, req.close_ksize)

    after_b64 = base64.b64encode(encode_png_bytes(after)).decode("ascii")
    before_b64 = None
    if req.include_before:
        before_b64 = base64.b64encode(encode_png_bytes(gray)).decode("ascii")

    h, w = after.shape[:2]
    return PreviewResponse(
        width=w,
        height=h,
        after_png_b64=after_b64,
        before_png_b64=before_b64,
    )


class ThumbnailRequest(BaseModel):
    path: str
    max_dim: int = 800


@router.post("/thumb")
def make_thumbnail(req: ThumbnailRequest):
    """元画像のサムネイル PNG をバイナリ返却（プレビュー用の軽量版）"""
    import cv2

    p = Path(req.path)
    if not p.is_file():
        raise HTTPException(status_code=400, detail=f"File not found: {req.path}")

    gray = imread_u(p)
    if gray is None:
        raise HTTPException(status_code=400, detail=f"Could not read image: {req.path}")

    h, w = gray.shape[:2]
    scale = min(1.0, req.max_dim / max(h, w))
    if scale < 1.0:
        gray = cv2.resize(gray, (int(w * scale), int(h * scale)),
                          interpolation=cv2.INTER_AREA)

    return Response(content=encode_png_bytes(gray), media_type="image/png")

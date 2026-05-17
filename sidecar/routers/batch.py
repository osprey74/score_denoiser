# -*- coding: utf-8 -*-
"""一括処理 — SSE で進捗をストリーミング"""

import asyncio
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.processor import imread_u, imwrite_u, process_score

router = APIRouter(prefix="/batch", tags=["batch"])


class BatchRequest(BaseModel):
    folder: str
    files: list[str]
    blur_ksize: int = 5
    threshold: int = 220
    close_ksize: int = 5
    output_subdir: str = "処理済み"
    skip_existing: bool = False


@router.post("")
async def batch_process(req: BatchRequest):
    folder = Path(req.folder)
    if not folder.is_dir():
        raise HTTPException(status_code=400, detail=f"Not a directory: {req.folder}")

    out_dir = folder / req.output_subdir
    out_dir.mkdir(exist_ok=True)
    total = len(req.files)

    async def gen():
        for i, src_path in enumerate(req.files):
            src = Path(src_path)
            dst = out_dir / src.name
            event = {
                "index": i,
                "total": total,
                "name": src.name,
                "status": "doing",
            }
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0)

            if req.skip_existing and dst.exists():
                event = {**event, "status": "skipped"}
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                continue

            try:
                gray = imread_u(src)
                if gray is None:
                    raise RuntimeError("read failed")
                out = process_score(gray, req.blur_ksize, req.threshold, req.close_ksize)
                if not imwrite_u(dst, out):
                    raise RuntimeError("write failed")
                event = {**event, "status": "done"}
            except Exception as exc:
                event = {**event, "status": "error", "error": str(exc)}

            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0)

        final = {"index": total, "total": total, "status": "complete",
                 "output_dir": str(out_dir)}
        yield f"data: {json.dumps(final, ensure_ascii=False)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")

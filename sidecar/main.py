# -*- coding: utf-8 -*-
"""楽譜ノイズ除去ツール — Python サイドカー (FastAPI)"""

import os
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import batch, config, folder, preview

PORT = 8766

app = FastAPI(title="Nitido sidecar")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(folder.router)
app.include_router(preview.router)
app.include_router(batch.router)
app.include_router(config.router)


@app.get("/health")
async def health():
    return {"status": "ok", "frozen": getattr(sys, "frozen", False)}


@app.post("/shutdown")
async def shutdown():
    import asyncio
    asyncio.get_event_loop().call_later(0.5, lambda: os._exit(0))
    return {"status": "shutting_down"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=PORT)

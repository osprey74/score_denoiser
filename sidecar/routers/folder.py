# -*- coding: utf-8 -*-
"""フォルダ内 PNG 一覧取得"""

from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/folder", tags=["folder"])


class FolderRequest(BaseModel):
    path: str


class FileEntry(BaseModel):
    name: str
    path: str
    size: int


class FolderResponse(BaseModel):
    folder: str
    files: list[FileEntry]


@router.post("/list", response_model=FolderResponse)
def list_pngs(req: FolderRequest):
    folder = Path(req.path)
    if not folder.is_dir():
        raise HTTPException(status_code=400, detail=f"Not a directory: {req.path}")

    files = sorted(folder.glob("*.png"))
    return FolderResponse(
        folder=str(folder),
        files=[
            FileEntry(name=f.name, path=str(f), size=f.stat().st_size)
            for f in files
        ],
    )

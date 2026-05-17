# -*- coding: utf-8 -*-
"""設定の永続化 — config.json で blur/threshold/close/folder/zoom 等を保存"""

import json
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/config", tags=["config"])

CONFIG_PATH = Path.home() / ".score_denoiser" / "config.json"
CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)


class AppConfig(BaseModel):
    folder: str = ""
    blur_ksize: int = 5
    threshold: int = 220
    close_ksize: int = 5
    keep_view: bool = True
    output_subdir: str = "処理済み"
    skip_existing: bool = False


def _load() -> AppConfig:
    if CONFIG_PATH.exists():
        try:
            return AppConfig(**json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
        except Exception:
            pass
    return AppConfig()


def _save(cfg: AppConfig) -> None:
    CONFIG_PATH.write_text(
        json.dumps(cfg.model_dump(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


@router.get("", response_model=AppConfig)
def get_config():
    return _load()


@router.put("", response_model=AppConfig)
def put_config(cfg: AppConfig):
    _save(cfg)
    return cfg

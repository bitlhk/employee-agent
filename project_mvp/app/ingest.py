from __future__ import annotations

import json
import os
from typing import List, Dict

from .config import settings


STANDARD_KEYS = [
    "id", "title", "source", "url", "publish_time", "content", "category", "score", "tags"
]


def _normalize(item: Dict, idx: int) -> Dict:
    out = {
        "id": item.get("id") or f"local-{idx}",
        "title": (item.get("title") or "").strip(),
        "source": (item.get("source") or "未知来源").strip(),
        "url": (item.get("url") or "").strip(),
        "publish_time": (item.get("publish_time") or item.get("publishDate") or "").strip(),
        "content": (item.get("content") or item.get("summary") or "").strip(),
        "category": (item.get("category") or "").strip(),
        "score": float(item.get("score") or 0),
        "tags": item.get("tags") or [],
    }
    if not isinstance(out["tags"], list):
        out["tags"] = [str(out["tags"])]
    return out


def load_local_crawler_news() -> List[Dict]:
    """
    MVP: read local crawler output JSON.
    Expected: list[dict] with standard keys.
    """
    path = settings.crawler_input_json
    if not path:
        return []
    if not os.path.exists(path):
        return []

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        return []

    normalized = [_normalize(x, i) for i, x in enumerate(data, start=1)]
    return [x for x in normalized if x["title"]]

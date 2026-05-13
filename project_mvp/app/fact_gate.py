from __future__ import annotations

import re
from typing import List, Dict

HIGH_RISK_STATUS = ["已发布", "已通过", "即将落地", "已收购", "已完成融资"]


def _has_number_claim(text: str) -> bool:
    return bool(re.search(r"\d+(\.\d+)?(%|亿|万|点)?", text or ""))


def _has_source(item: Dict) -> bool:
    return bool(item.get("source")) and bool(item.get("url") or item.get("content"))


def _downgrade_status(text: str) -> str:
    text = text.replace("已发布", "媒体报道称已发布")
    text = text.replace("已通过", "媒体报道称已通过")
    text = text.replace("即将落地", "市场预期即将落地，仍待进一步确认")
    text = text.replace("已收购", "媒体报道称已收购")
    text = text.replace("已完成融资", "媒体报道称已完成融资")
    return text


def apply_fact_gate(items: List[Dict]) -> List[Dict]:
    safe = []
    for it in items:
        title = it.get("title", "")
        content = it.get("content", "")
        text = f"{title} {content}"

        # A. number claim must have source support
        if _has_number_claim(text) and not _has_source(it):
            continue

        # B. high-risk status downgrade if weak evidence
        if any(k in text for k in HIGH_RISK_STATUS):
            if not _has_source(it):
                it["title"] = _downgrade_status(title)
                it["content"] = _downgrade_status(content)

        safe.append(it)

    return safe

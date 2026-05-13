from __future__ import annotations

from difflib import SequenceMatcher
from typing import List, Dict


OFFICIAL_SOURCES = {"中国人民银行", "国家金融监督管理总局", "中国证监会"}


def title_sim(a: str, b: str) -> float:
    return SequenceMatcher(None, a or "", b or "").ratio()


def dedupe_news(items: List[Dict]) -> List[Dict]:
    out: List[Dict] = []
    seen_urls = set()
    for item in items:
        url = item.get("url", "")
        title = item.get("title", "")
        if url and url in seen_urls:
            continue

        duplicated = False
        for ex in out:
            if title_sim(title, ex.get("title", "")) > 0.85:
                duplicated = True
                break
        if duplicated:
            continue

        if url:
            seen_urls.add(url)
        out.append(item)
    return out


def rank_news(items: List[Dict]) -> List[Dict]:
    ranked = []
    for it in items:
        score = float(it.get("score") or 50)
        title = it.get("title", "")
        source = it.get("source", "")

        if source in OFFICIAL_SOURCES:
            score += 20
        if any(k in title for k in ["通知", "办法", "意见", "规定", "实施"]):
            score += 12
        if any(k in title.lower() for k in ["gpt", "claude", "gemini", "agent", "nvidia", "rubin", "stablecoin"]):
            score += 8

        it["score"] = min(score, 100)
        ranked.append(it)

    ranked.sort(key=lambda x: x.get("score", 0), reverse=True)
    return ranked


def merge_and_rank(local_news: List[Dict], brave_news: List[Dict]) -> List[Dict]:
    merged = local_news + brave_news
    deduped = dedupe_news(merged)
    return rank_news(deduped)

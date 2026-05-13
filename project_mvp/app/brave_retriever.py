from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List, Dict

import requests

from .config import settings


QUERIES = [
    "OpenAI Anthropic Google Meta Nvidia model release agent chip today",
    "stablecoin regulation GENIUS Act SEC CFTC digital payment infrastructure",
    "big tech AI capex data center electricity grid policy",
]

ALLOWED_HOST_KEYWORDS = [
    "reuters.com", "ft.com", "bloomberg.com", "wsj.com", "cnbc.com",
    "theinformation.com", "techcrunch.com", "openai.com", "anthropic.com",
    "blog.google", "nvidia.com", "imf.org", "worldbank.org", "bis.org",
]

BLOCKED_HOST_KEYWORDS = [
    "reddit.com", "news.ycombinator.com", "x.com", "twitter.com", "youtube.com"
]


def _parse_result(r: Dict, idx: int) -> Dict:
    source = (r.get("meta_url", {}).get("hostname") or r.get("source") or "Brave").strip().lower()
    return {
        "id": f"brave-{idx}",
        "title": (r.get("title") or "").strip(),
        "source": source,
        "url": (r.get("url") or "").strip(),
        "publish_time": (r.get("age") or "").strip(),
        "content": (r.get("description") or "").strip(),
        "category": "",
        "score": 0,
        "tags": ["brave"],
    }


def retrieve_brave_news(max_per_query: int = 6) -> List[Dict]:
    if not settings.brave_api_key:
        return []

    headers = {
        "Accept": "application/json",
        "X-Subscription-Token": settings.brave_api_key,
    }

    collected: List[Dict] = []
    now = datetime.now(timezone.utc)

    for q in QUERIES:
        params = {
            "q": q,
            "count": max_per_query,
            "freshness": "day",
            "search_lang": "en",
            "country": "US",
        }
        try:
            resp = requests.get(settings.brave_base_url, headers=headers, params=params, timeout=20)
            if resp.status_code != 200:
                continue
            data = resp.json()
            results = data.get("web", {}).get("results", [])
            for i, r in enumerate(results, start=1):
                item = _parse_result(r, len(collected) + i)
                if not item["title"] or not item["url"]:
                    continue

                host = item["source"]
                if any(b in host for b in BLOCKED_HOST_KEYWORDS):
                    continue
                if ALLOWED_HOST_KEYWORDS and not any(a in host for a in ALLOWED_HOST_KEYWORDS):
                    continue

                # MVP 24h bias: if age is present and contains larger buckets, skip
                age = item["publish_time"].lower()
                if any(k in age for k in ["week", "month", "year"]):
                    continue
                collected.append(item)
        except Exception:
            continue

    return collected

#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

import requests

# local imports
ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT))

from app.config import settings
from app.ingest import load_local_crawler_news
from app.brave_retriever import retrieve_brave_news
from app.merge_rank import merge_and_rank
from app.fact_gate import apply_fact_gate
from app.insight_generator import generate_core_insights
from app.formatter import render_markdown


def _read_push_token(project_env: Path) -> str:
    if not project_env.exists():
        return ""
    txt = project_env.read_text(encoding="utf-8")
    m = re.search(r"^INSIGHTS_PUSH_TOKEN=(.*)$", txt, re.M)
    return m.group(1).strip() if m else ""


def main() -> int:
    local_news = load_local_crawler_news()
    brave_news = retrieve_brave_news(max_per_query=6)

    merged = merge_and_rank(local_news, brave_news)
    gated = apply_fact_gate(merged)

    top_news = gated[: max(10, settings.max_news_per_section)]
    core = generate_core_insights(top_news, settings.max_core_insights)
    md = render_markdown(core, top_news, max_news=10)

    out_dir = ROOT / "outputs"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "daily_report.md"
    out_file.write_text(md, encoding="utf-8")

    print(f"[OK] report written: {out_file}")
    print(f"[INFO] local={len(local_news)} brave={len(brave_news)} merged={len(merged)} gated={len(gated)}")

    # Optional: push to existing insights endpoint for homepage
    token = _read_push_token(Path("/home/ubuntu/linggan/finance-ai-landing-new/finance-ai-landing/.env"))
    if token:
        from datetime import datetime, timezone, timedelta
        bj = (datetime.now(timezone.utc) + timedelta(hours=8)).strftime("%Y-%m-%d")
        payload = {
            "date": bj,
            "title": f"📊 今日财经简报要点 · {bj}（北京时间）",
            "summary": "\n".join(["📊 今日财经简报要点", *core]) if core else "今日新闻不足，稍后更新。",
            "content": md,
            "source": "mvp-pipeline-v1",
        }
        try:
            r = requests.post(
                "http://127.0.0.1:5174/api/insights/upsert",
                json=payload,
                headers={"x-insights-token": token, "content-type": "application/json"},
                timeout=20,
            )
            print("[INFO] upsert", r.status_code)
        except Exception as e:
            print("[WARN] upsert failed:", e)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

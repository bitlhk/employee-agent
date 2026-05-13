from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import List, Dict


def render_markdown(core_insights: List[str], news: List[Dict], max_news: int = 10) -> str:
    bj_date = (datetime.now(timezone.utc) + timedelta(hours=8)).strftime("%Y-%m-%d")

    lines = [f"# 每日财经简报 · {bj_date}（北京时间）", "", "## 今日核心判断"]
    if not core_insights:
        lines.append("1. 今日高质量新闻不足，建议等待下一轮更新。")
    else:
        for i, x in enumerate(core_insights, start=1):
            lines.append(f"{i}. {x}")

    lines += ["", "## 今日重要资讯"]
    for x in news[:max_news]:
        title = x.get("title", "")
        source = x.get("source", "")
        score = x.get("score", 0)
        lines.append(f"- [{title}]({x.get('url','')})（{source}，score={score}）")

    lines += ["", "## 来源链接（节选）"]
    for x in news[:max_news]:
        if x.get("url"):
            lines.append(f"- {x.get('source','来源')}: {x.get('url')}")

    lines += ["", "⚠️ 免责声明：本简报由AI基于公开信息生成，仅供参考，不构成投资建议。"]
    return "\n".join(lines)

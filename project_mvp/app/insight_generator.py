from __future__ import annotations

from typing import List, Dict

from .config import settings


def _rule_based_insights(top_news: List[Dict], n: int = 3) -> List[str]:
    insights = []
    for item in top_news[:n]:
        title = item.get("title", "")
        source = item.get("source", "")
        fact = f"事实：{source}披露“{title}”。"
        analysis = "解读：该信息反映政策与产业主线变化，需结合后续资金与监管信号持续验证。"
        insights.append(f"{fact} {analysis}")
    return insights


def generate_core_insights(news: List[Dict], max_items: int | None = None) -> List[str]:
    """
    MVP: stable by default (rule-based).
    Future: replace with model call using prompt template.
    """
    k = max_items or settings.max_core_insights
    if not news:
        return []
    return _rule_based_insights(news, k)

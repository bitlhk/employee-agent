import os
from dataclasses import dataclass


@dataclass
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "")
    brave_api_key: str = os.getenv("BRAVE_API_KEY", "")
    brave_base_url: str = os.getenv("BRAVE_BASE_URL", "https://api.search.brave.com/res/v1/web/search")
    report_timezone: str = os.getenv("REPORT_TIMEZONE", "Asia/Shanghai")
    report_mode: str = os.getenv("REPORT_MODE", "daily_finance")
    max_news_per_section: int = int(os.getenv("MAX_NEWS_PER_SECTION", "5"))
    max_core_insights: int = int(os.getenv("MAX_CORE_INSIGHTS", "3"))
    fact_gate_strict: bool = os.getenv("FACT_GATE_STRICT", "true").lower() == "true"
    crawler_input_json: str = os.getenv("CRAWLER_INPUT_JSON", "")


settings = Settings()

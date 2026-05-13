# Daily Finance / FinAI Report MVP

A lightweight 2-day MVP pipeline:

- existing crawler news as fact base
- Brave API as supplement (no Brave HTML scraping)
- merge + dedupe + rank
- basic fact gate
- 3 core insights
- markdown output

## Structure

```
project_mvp/
  app/
    config.py
    ingest.py
    brave_retriever.py
    merge_rank.py
    fact_gate.py
    insight_generator.py
    formatter.py
  prompts/
    core_insight.md
  scripts/
    run_report.py
  requirements.txt
  .env.example
  README.md
```

## Quick Start

1. Install deps:
```bash
cd project_mvp
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2. Configure env:
```bash
cp .env.example .env
# set BRAVE_API_KEY and CRAWLER_INPUT_JSON
```

3. Run:
```bash
python scripts/run_report.py
```

Output:
- `project_mvp/outputs/daily_report.md`
- optional upsert to `/api/insights/upsert` if token exists in main project `.env`

## Notes

- This MVP does **not** implement full long-form report generation.
- Fact gate in MVP only enforces:
  - number claim source support
  - status phrase downgrade for weak evidence
- Core insights are currently rule-based for stability.

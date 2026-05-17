# TrendRadar AWS Evaluation — 2026-05-04

Status: evaluation sidecar running on AWS, not wired into Lingxia production.

## Runtime Location

- Host: `ubuntu@3.16.70.167`
- Path: `/home/ubuntu/TrendRadar-eval`
- Python: `3.12.3`
- Virtualenv: `/home/ubuntu/TrendRadar-eval/.venv`
- MCP URL: `http://127.0.0.1:3333/mcp`
- MCP process: `python -m mcp_server.server --transport http --host 127.0.0.1 --port 3333 --project-root /home/ubuntu/TrendRadar-eval`
- MCP PID file: `/tmp/trendradar-mcp.pid`
- MCP log: `/tmp/trendradar-mcp.log`

The MCP service is bound to localhost only. It is not exposed publicly.

## Safety Configuration

Evaluation mode intentionally disables push and AI-dependent features:

- `schedule.enabled = false`
- `notification.enabled = false`
- `filter.method = "keyword"`
- `display.regions.ai_analysis = false`
- `ai_analysis.enabled = false`
- `ai_translation.enabled = false`

This means no API key is required for crawl + keyword filtering + MCP query.

AI API key is only required if we later enable AI classification, AI summary, or translation inside TrendRadar itself.

## Feed Configuration

Default TrendRadar hotlists are too broad for Lingxia's "AI finance trend PPT" scenario. The evaluation adds curated RSS feeds:

- `openai-news`: `https://openai.com/news/rss.xml`
- `google-ai`: `https://blog.google/technology/ai/rss/`
- `nvidia-blog`: `https://blogs.nvidia.com/feed/`
- `venturebeat-ai`: `https://venturebeat.com/category/ai/feed/`
- `mit-tech-review`: `https://www.technologyreview.com/feed/`
- `planet-ai`: `https://planet-ai.net/rss.xml`
- `finextra-headlines`: `https://www.finextra.com/rss/headlines.aspx`
- `banking-dive`: `https://www.bankingdive.com/feeds/news/`

Two feeds were tested but disabled because TrendRadar's RSS parser failed on them:

- `google-cloud-ai`: `https://cloud.google.com/blog/products/ai-machine-learning/rss`
- `azure-blog`: `https://azure.microsoft.com/en-us/blog/feed/`

## Crawl Results

Latest clean run:

- Hotlist sources: 11/11 success
- Hotlist current items: 255
- Hotlist keyword matches: 34/255
- RSS sources: 10/10 success
- RSS items: 283
- RSS freshness-filtered keyword matches: 60/183
- Notifications: disabled
- AI analysis/translation: disabled

MCP smoke test:

- Tool count: 27
- First tools include `get_latest_news`, `get_trending_topics`, `get_latest_rss`, `search_rss`, `trigger_crawl`
- `get_latest_rss` works over HTTP MCP.

## Initial Quality Judgment

TrendRadar default hotlists alone are not enough for Lingxia's target scenario. They are useful for general awareness but too noisy for "AI × finance trend PPT".

TrendRadar becomes useful after adding curated RSS feeds:

- Official / semi-official AI sources provide enough freshness for AI trend detection.
- Finance sources provide banking/fintech angle, but the intersection of "AI + finance" is still relatively sparse.
- The best Stage 1 behavior is not "dump all TrendRadar results into PPT"; it should be:
  - collect candidate news from TrendRadar RSS + hotlists,
  - rank by AI/finance relevance,
  - keep citations and URLs,
  - pass a concise `trend_candidates.json` to Hermes reviewer.

## Product Implication

For `AI Finance Trend PPT` V1.1, recommended chain:

1. `TrendRadarProvider` on AWS collects fresh candidates from local MCP.
2. Hermes reviewer (`墨衡`) turns candidates into a narrative line + PPT outline.
3. Claude Code PPT agent (`简页`) generates deck artifacts.

TrendRadar should remain a pull-side data provider. It should not push directly into user workspace or main chat.

## Next Implementation Step

Implement a read-only `TrendRadarProvider` adapter that calls local MCP / local DB and returns:

```ts
type TrendCandidate = {
  title: string;
  url: string;
  sourceName: string;
  publishedAt?: string;
  tags: string[];
  relevanceReason?: string;
};
```

Do not expose TrendRadar directly to users. The task template runner should consume the provider output and include it in stage artifacts.

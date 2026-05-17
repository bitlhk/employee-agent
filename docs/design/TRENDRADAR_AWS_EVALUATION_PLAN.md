# TrendRadar AWS Evaluation Plan

Date: 2026-05-04
Status: Pre-implementation evaluation plan.
Related:
- `AI_FINANCE_TREND_TO_PPT_CHAIN_CONTRACT.md`
- https://github.com/sansan0/TrendRadar

## 1. Goal

Evaluate whether TrendRadar should become the trend-data provider for the
`AI 金融趋势洞察 PPT` task.

The decision must be based on source freshness, relevance, stability, and
integration cost, not on intuition.

## 2. Deployment Location

Deploy TrendRadar on the AWS agent node, not on the Lingxia main host.

Rationale:

- TrendRadar performs external network collection; keep that fault domain away
  from the Lingxia business host.
- AWS already hosts OpenClaw public, Hermes, and Claude Code providers.
- MCP/local HTTP integration is easier on the same agent node.
- If crawlers are rate-limited or noisy, Lingxia UI/auth/audit remains isolated.

Network rule:

- Bind TrendRadar app and MCP to `127.0.0.1` during evaluation.
- Do not expose TrendRadar publicly.
- Lingxia accesses it only through an agent provider, not direct browser calls.

## 3. Evaluation Questions

1. Does TrendRadar find fresher and broader AI/fintech material than the current
   `daily-briefing-xing` search prompt?
2. Does it reduce repeated old news?
3. Can it provide usable source metadata for citations?
4. Can MCP tools answer topic queries fast enough for an interactive task?
5. Does it add too much operational weight compared with direct search?

## 4. Baselines

Compare three sources:

| Source | Role |
|---|---|
| TrendRadar | Continuous collection + MCP query |
| daily-briefing-xing | Existing OpenClaw search/prompt skill |
| Direct web fallback | Minimal emergency fallback |

## 5. Test Topics

Run each source against the same topics:

1. `AI Agent 对银行财富管理的影响，过去 7 天`
2. `大模型在银行风控与合规中的最新应用，过去 30 天`
3. `AI 推理成本下降与金融机构私有化部署，过去 30 天`
4. `OpenAI Anthropic Google 最新模型能力变化对企业软件的影响，过去 7 天`
5. `金融科技监管与 AI 治理最新动态，过去 30 天`

## 6. Metrics

For each topic:

```ts
type TrendRadarEvaluationResult = {
  topic: string;
  source: "trendradar" | "daily-briefing-xing" | "direct-search";
  freshItemCount24h: number;
  freshItemCount7d: number;
  financeRelevantCount: number;
  duplicateRatio: number;
  sourceUrlCoverage: number;       // items with URL / total items
  usableForPptCount: number;       // strong enough to support a slide
  latencyMs: number;
  notes: string[];
};
```

Go criteria:

- TrendRadar provides at least 30% more finance-relevant fresh items than the
  baseline on 3/5 topics, or
- TrendRadar provides materially better source metadata/citations even when
  item count is similar.

No-go criteria:

- high duplicate/noise ratio,
- weak source URLs,
- unstable service,
- MCP latency too high for interactive use,
- requires exposing public endpoints or unsafe secrets.

## 7. API Key Policy

TrendRadar can run without AI keys for basic collection and MCP data access.

Use API keys only for optional AI analysis features:

- `AI_ANALYSIS_ENABLED=true`
- `AI_API_KEY`
- `AI_MODEL`
- `AI_API_BASE`

Evaluation sequence:

1. Run collector without AI analysis first.
2. Validate freshness and source coverage.
3. Enable AI analysis only if raw collection quality is useful.

Secrets:

- Store keys only on AWS in environment/config files with restrictive
  permissions.
- Do not copy keys into Lingxia DB.
- Do not send keys in MCP responses or task run metadata.

## 8. Deployment Sketch

Preferred evaluation deployment:

```bash
git clone https://github.com/sansan0/TrendRadar.git /home/ubuntu/TrendRadar
cd /home/ubuntu/TrendRadar
cp config/config.example.yaml config/config.yaml
# configure sources, keywords, database path, and localhost bind
docker compose up -d trendradar trendradar-mcp
```

If Docker is not suitable, use the repo's local Node deployment path.

Evaluation ports:

```text
TrendRadar app: 127.0.0.1:<candidate-port>
TrendRadar MCP: 127.0.0.1:3333/mcp
```

Avoid conflicting with existing OpenClaw ports (`18789`, `19789`).

## 9. Keywords And Sources

Initial keyword groups:

- AI Agent / agentic AI / autonomous agent
- OpenAI / Anthropic / Gemini / Claude / Codex
- inference cost / GPU / private deployment
- fintech / digital finance / banking AI
- wealth management / risk control / compliance
- model release / MCP / tool use / workflow automation

Initial RSS/source preference:

- official AI labs and model providers,
- cloud/infra vendors,
- major tech media,
- fintech/banking regulation sources,
- GitHub trending / Hacker News / TechMeme-style sources if available.

## 10. Integration Shape If Accepted

If accepted, build:

```text
TrendRadarProvider
  listRecent(topic, window)
  search(topic, filters)
  related(itemId)
  summarizeTopic(topic, window)
```

The provider returns normalized `TrendCandidate[]`. It does not return raw
TrendRadar internals to the UI.

## 11. Implementation Steps

1. Deploy TrendRadar on AWS localhost.
2. Configure AI/finance keyword groups.
3. Let collector run for 24-48h if possible.
4. Run the five test topics against TrendRadar.
5. Run the same topics through `daily-briefing-xing`.
6. Produce comparison table.
7. Decide:
   - `accept_as_provider`,
   - `use_as_optional_fallback`,
   - `do_not_adopt`.

## 12. Temporary Decision

Until evaluation finishes:

- Do not make TrendRadar a hard dependency of the workbench.
- `AI 金融趋势洞察 PPT` may be implemented with provider interface and fallback
  mock data, but not marketed as fresh-trend capable until TrendRadar or an
  equivalent source passes evaluation.


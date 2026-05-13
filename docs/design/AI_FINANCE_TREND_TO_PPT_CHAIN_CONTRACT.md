# AI Finance Trend To PPT Chain Contract

Date: 2026-05-04
Status: Implementation overlay for the main task workbench scenario.
Related:
- `AGENT_REGISTRY_AND_CLUSTER_CONTRACT.md`
- `AGENT_REGISTRY_AND_CLUSTER_CONTRACT_TASK_PATCH.md`
- `TASK_TEMPLATE_SCHEMA.md`
- `TASK_TEMPLATE_RUNNER_DESIGN.md`
- `TRENDRADAR_AWS_EVALUATION_PLAN.md`

## 1. Goal

Make the primary task workbench scenario:

```text
AI 金融趋势洞察 PPT
```

The user asks for a timely trend insight presentation, for example:

```text
帮我做一份最近 AI Agent 对银行财富管理影响的汇报 PPT，面向业务部门负责人。
```

The system turns recent AI / fintech / banking technology signals into a
structured, source-backed PPT.

This scenario is more valuable than stock-analysis-to-PPT for internal usage
because it matches weekly/monthly strategy briefings, technology sharing,
customer conversations, and management reporting.

## 2. Chain Shape

```text
Stage 1: 闻舟 (AI) · 趋势雷达
  data provider: TrendRadar on AWS + daily-briefing-xing fallback
  output: trend_candidates.json + trend_brief.md

Stage 2: 墨衡 (AI) · 研究审阅员
  runtime: Hermes profile
  output: trend_handoff.json + ppt_outline.json

Stage 3: 简页 (AI) · PPT 制作师
  runtime: Claude Code task-ppt
  output: PPT preview/download + concise completion summary
```

The chain is deterministic, admin-defined, and user-triggered. It is not an LLM
planner chain. Planner may recommend it later, but cannot silently execute it.

## 3. Responsibilities

### 3.1 Stage 1 - WenZhou Trend Radar

Goal: find fresh, relevant, source-backed material.

Inputs:
- user topic,
- time window: `24h | 7d | 30d`,
- audience: `executive | product | technology | client`,
- domain filters: AI, agent, model, infra, fintech, banking, wealth management,
  risk, operation, regulation.

Sources:
- TrendRadar MCP / local API on AWS,
- existing `daily-briefing-xing` outputs as fallback/context,
- direct web fallback only when TrendRadar data is insufficient.

Outputs:

```ts
type TrendCandidate = {
  id: string;
  title: string;
  url?: string;
  sourceName?: string;
  publishedAt?: string;
  freshness: "24h" | "48h" | "7d" | "30d" | "unknown";
  domainTags: string[];
  relevanceScore?: number;       // 0-1
  summary: string;               // short, no copied article body
  whyItMattersForFinance?: string;
};

type TrendRadarOutput = {
  topic: string;
  timeWindow: "24h" | "7d" | "30d";
  candidates: TrendCandidate[];
  queryLog: Array<{ query: string; provider: string; resultCount: number }>;
  generatedAt: string;
};
```

Guardrails:
- Do not include unverified old news as fresh news.
- Do not copy full article text into run output.
- Do not pass TrendRadar service secrets to downstream stages.
- If no fresh material is found, explicitly return `insufficient_fresh_sources`.

### 3.2 Stage 2 - MoHeng Research Reviewer

Goal: turn material into a coherent presentation logic line.

Runtime:
- Hermes profile, not main chat PM.
- No persistent personal memory.

Inputs:
- original user request,
- `TrendRadarOutput`,
- optional uploaded file summaries,
- no raw binary files.

Outputs:

```ts
type TrendPptHandoff = {
  handoffVersion: "ai-finance-trend-v1";
  topic: string;
  audience: "executive" | "product" | "technology" | "client";
  logicLine: string;             // one sentence thesis
  coreClaims: Array<{
    claim: string;
    evidenceIds: string[];
    financialImpact: string;
    confidence: "high" | "medium" | "low";
  }>;
  pptOutline: Array<{
    slideNo: number;
    title: string;
    purpose: string;
    keyPoints: string[];
    evidenceIds: string[];
    suggestedLayout?: "hero" | "kpi-board" | "two-col-split" | "three-col-cards" | "multi-col-grid" | "timeline" | "infographic";
  }>;
  riskNotes: string[];
  disclaimerKinds: Array<"ai_generated_label" | "fact_check_required">;
  sourceCandidateIds: string[];
};
```

Review rules:
- Every core claim should point to at least one evidence id unless it is marked
  `confidence: "low"`.
- Claims must explain financial/business implications, not only summarize AI
  product news.
- Remove "AI will change everything" style generic claims.
- Prefer 5-8 strong sources over 30 weak sources.
- Produce 8-12 slide outline by default.

### 3.3 Stage 3 - JianYe PPT Maker

Goal: generate presentation artifacts from a bounded outline.

Inputs:
- original user request,
- `TrendPptHandoff`,
- short source table with titles and URLs,
- no raw TrendRadar database dump,
- no raw uploaded binary file bytes.

Outputs:
- editable `.pptx`,
- HTML preview,
- high-fidelity print/download variant if available,
- concise summary.

PPT rules:
- Use `TrendPptHandoff.pptOutline` as the source of truth.
- Do not invent new facts not present in the handoff.
- Preserve source footnotes / source panel where possible.
- Include `ai_generated_label` and `fact_check_required` disclaimers.
- If the outline is weak, fail with `validation_failed` instead of generating
  a generic deck.

## 4. Frontend Contract

The task starts with all stages visible:

```text
闻舟 (AI) · 趋势雷达        running
墨衡 (AI) · 研究审阅员      waiting
简页 (AI) · PPT 制作师      waiting
```

Rendering rules:
- Execution traces are boxed and collapsible.
- Final trend brief, reviewer logic line, and PPT summary render as page
  content, not inside scroll boxes.
- Artifacts render as file cards inline with the final stage and can open in
  the right-side preview panel.
- The right-side panel is for artifact preview, not duplicate final text.

## 5. Upload Contract

Uploads are optional context.

Allowed uses:
- uploaded PDF/Word/text as internal reference material,
- uploaded PPT/PPTX as style reference,
- uploaded Excel/CSV as factual table context.

Required processing:
- store upload as run input artifact,
- extract text/table/style metadata before LLM use,
- pass summaries/references to stages,
- never pass raw binary bytes into prompts,
- keep uploaded file access scoped to the run/user.

## 6. TrendRadar Provider Boundary

TrendRadar runs on AWS as a data provider. It is not the product-facing agent.

TrendRadar may provide:
- recent news/items,
- RSS and source metadata,
- topic trend queries,
- related-news search,
- MCP tools for trend analysis.

TrendRadar must not:
- decide the final presentation thesis,
- directly generate PPT,
- send notifications to end users for this task,
- bypass Lingxia audit and workspace rules.

## 7. Failure Policy

- If TrendRadar is unavailable, Stage 1 may fall back to `daily-briefing-xing`
  plus direct search. The UI must mark the run as "fallback source used".
- If Stage 1 returns insufficient fresh sources, stop before Stage 2 and show a
  clear "fresh material insufficient" result.
- If Stage 2 cannot produce a coherent logic line, stop before Stage 3.
- If Stage 3 fails, keep Stage 1/2 outputs visible and downloadable.

## 8. Template Definition

Template id:

```text
ai_finance_trend_ppt
```

Default fields:

```ts
{
  id: "ai_finance_trend_ppt",
  version: 1,
  status: "lab",
  displayName: "AI 金融趋势洞察 PPT",
  shortDescription: "检索最近 AI 与金融科技动态，提炼趋势判断，并生成汇报 PPT。",
  category: "presentation",
  estimatedDurationMs: 180_000,
  maxDurationMs: 600_000,
  stages: [
    {
      id: "trend_radar",
      displayName: "收集趋势素材",
      personaId: "wenzhou",
      agentDefinitionId: "trendradar-provider",
      inputMapping: { original: true },
      expectedOutputs: ["markdown_report", "handoff_json"],
      timeoutMs: 180_000,
      onFailure: "stop"
    },
    {
      id: "research_review",
      displayName: "提炼观点与大纲",
      personaId: "moheng",
      agentDefinitionId: "task-my-wealth", // Hermes profile until dedicated reviewer exists
      inputMapping: { original: true, fromStages: ["trend_radar"] },
      expectedOutputs: ["markdown_report", "handoff_json"],
      timeoutMs: 180_000,
      onFailure: "stop"
    },
    {
      id: "ppt_generation",
      displayName: "生成演示文稿",
      personaId: "jianye",
      agentDefinitionId: "task-ppt",
      inputMapping: { original: true, fromStages: ["trend_radar", "research_review"] },
      expectedOutputs: ["ppt_preview", "file_download"],
      timeoutMs: 300_000,
      onFailure: "retry_once_then_stop"
    }
  ],
  outputPolicy: {
    allowedArtifactTypes: ["markdown_report", "ppt_preview", "file_download", "summary_artifact"],
    disclaimers: ["ai_generated_label", "fact_check_required"],
    citationRequired: true,
    saveToWorkspaceDefault: false
  }
}
```

## 9. Acceptance Criteria

- User can run `AI 金融趋势洞察 PPT` from the lab page.
- The page shows three stages from the start.
- Stage 1 uses TrendRadar when available and records query/source metadata.
- Stage 2 produces a clear logic line and slide outline.
- Stage 3 produces a PPT artifact and preview.
- Output includes source/citation panel or equivalent source list.
- No provider endpoint, token, tunnel detail, or TrendRadar internal config is
  visible to the user.
- The chain can run with TrendRadar disabled using fallback, but UI marks the
  fallback.
- `pnpm run check` and build pass.


# Agent Registry Contract - Task Workbench Patch

Date: 2026-05-03
Status: Patch overlay on `AGENT_REGISTRY_AND_CLUSTER_CONTRACT.md` v1.
Owner: Lingxia task workbench design.

This document is a patch overlay for the Agent Registry and Cluster contract. It does not replace the frozen v1 contract yet. Once the task workbench V1 stabilizes, the sections below should be merged into the main contract as v1.1.

The purpose of this patch is to support user-facing task templates, deterministic multi-stage workflows, upstream citation propagation, and banking-grade disclaimer rendering without reopening the broader autonomous planner scope.

## 1. V1 Scope Decision

V1 task workbench uses only capabilities that have already passed Agent Cluster Lab validation on the new cluster path:

| V1 Task | Primary Persona | Backing Agent | Cluster Lab Status |
|---|---|---|---|
| PPT 汇报写作 | 简页 (AI) · PPT 制作师 | `task-ppt` | validated |
| 股票数据研究 | 衡岳 (AI) · 股票数据研究员 | `task-stock` | validated |
| 程序开发 / 代码改造 | 青栈 (AI) · 代码工程师 | `task-code` | validated |

V1 intentionally does not depend on unvalidated or degraded agents such as `task-trace`, and does not depend on Hermes tunnel-backed banking-native agents such as `task-credit-risk`.

The V1 tasks may be single-stage. This is intentional. Do not create fake multi-stage UI by calling the same agent multiple times under different names. Multi-stage task timelines are a V1.1 product goal after each backing stage has a real provider and has passed cluster lab validation.

## 2. Deterministic Task Template Exception (§3.7.1)

The current §3.7 LLM-Assisted Selection Boundary limits planner-assisted execution to `parallel | sequential-2stage`. That limit targets LLM planner output, where chain composition is generated dynamically and cannot be pre-audited.

Pre-baked task templates are categorically different. They are admin-curated, version-controlled, statically defined workflows. The chain composition is not LLM-generated and is auditable end-to-end before any user invocation.

### 2.1 Exception Rule

Pre-baked task templates may use N-stage chains beyond the v1.5 two-stage planner limit if all of the following conditions hold:

- Stage composition is statically defined in `task_templates.chain_json` and versioned.
- Stage composition does not change at runtime.
- Stages cannot dynamically add, remove, or substitute agents.
- Execution still requires explicit user trigger.
- Templates do not auto-dispatch from chat input, schedules, or background events.
- Each stage propagates citations downstream.
- Stage side effects are limited to the run record and artifact store unless explicitly approved by a later contract.

LLM planner output remains restricted to `parallel | sequential-2stage`. This exception applies only to admin-defined deterministic task templates.

### 2.2 Template Versioning

`task_templates` rows are immutable per version. Any template change creates a new row or version with incremented `version`; the previous version becomes `deprecated` but remains queryable for audit.

`cluster_runs.runtimeSnapshotJson` must include:

```ts
type TaskTemplateSnapshot = {
  taskTemplateId: string;
  taskTemplateVersion: number;
  taskTemplateName: string;
  chainHash: string;
};
```

This allows a historical run to be explained against the exact chain that executed.

## 3. Upstream Citation Propagation (§9.7)

The current §9.7 envelope captures citations mainly on the cluster-level summary artifact. Multi-stage task templates need citation propagation across stages so final PPT/Word/Markdown artifacts can trace claims back to the original upstream research or data source.

### 3.1 Agent Citation Type

```ts
type AgentCitation = {
  id: string;
  sourceAgentDefinitionId?: string;
  sourceRunResultId?: string;
  sourceStageId?: string;
  excerpt: string;
  externalUrl?: string;
  externalTitle?: string;
};
```

Constraints:

- `excerpt` must be short and paraphrased where possible.
- `excerpt` should not exceed 240 Chinese characters.
- Do not store full source documents in citation metadata.
- `externalUrl` is optional and should only point to sources the user is authorized to view.

### 3.2 AgentRunResult Extension

```ts
type AgentRunResult = {
  envelopeVersion: "v1";
  id: string;
  agentDefinitionId: string;
  clusterRunId?: string;
  status: "success" | "failed";
  summary?: string;
  output?: string;
  artifacts: AgentArtifact[];
  metadata?: Record<string, unknown>;
  error?: { code: string; detail: string };
  producedAt: string;

  // v1.1 task workbench extension
  upstreamCitations?: AgentCitation[];
  ownCitations?: AgentCitation[];
};
```

### 3.3 Propagation Rules

- Stage 1 starts with empty `upstreamCitations`.
- Stage 1 writes any new citations into `ownCitations`.
- Stage N receives all prior `upstreamCitations` and `ownCitations` merged by the task runner, not by the agent.
- Downstream agents may add new citations into `ownCitations`, but must not delete upstream citations.
- The final result view must expose a "查看引用来源" panel for all final artifacts when `citationRequired` is true.

### 3.4 UI Rendering Rules

For PPT/Word/Markdown results, cited statements should display footnote markers where feasible. The citation panel maps each citation to:

- persona display label, e.g. `闻舟 (AI) · 趋势洞察师`
- source stage name
- short excerpt
- external title or URL when available

## 4. Artifact Type and Disclaimer Rendering (§9.8)

The contract continues to prefer rendering by artifact type, not by agent identity.

### 4.1 Rejected Artifact Type Proposals

The following are not permitted as new artifact types in V1/V1.1:

- `stock_analysis_report`: use `markdown_report` with `metadata.reportType = "stock_research"`.
- `tool_trace`: this is a UI event panel, not a persistent artifact.
- `citation_summary`: citations are already represented by `AgentSummaryArtifact.citations[]` and the `AgentCitation` extension above.

Rationale: agent-specific artifact types recreate per-agent UI coupling and violate the v1 invariant that renderers are type-based.

### 4.2 Task Output Policy

```ts
type TaskOutputPolicy = {
  allowedArtifactTypes: string[];
  disclaimers?: DisclaimerKind[];
  citationRequired?: boolean;
};

type DisclaimerKind =
  | "ai_generated_label"
  | "investment_advisory"
  | "code_review_required"
  | "fact_check_required";
```

Rules:

- `allowedArtifactTypes` is a strict whitelist. The renderer rejects artifacts outside the whitelist.
- `ai_generated_label` is required for every task. If omitted, the renderer adds it automatically.
- Other disclaimers must be declared explicitly in the template.
- Agents cannot override, remove, or rewrite disclaimer text.
- Final artifact renderers append standardized disclaimer text in a fixed location:
  - PPT: final page or footer region
  - Word/Markdown: final section
  - Excel/table: metadata sheet or visible footer note

### 4.3 V1 Disclaimer Assignment

| Task | Required Disclaimers |
|---|---|
| PPT 汇报写作 | `ai_generated_label`, `fact_check_required` |
| 股票数据研究 | `ai_generated_label`, `investment_advisory`, `fact_check_required` |
| 程序开发 / 代码改造 | `ai_generated_label`, `code_review_required` |

## 5. North Star UX Note

The target task workbench experience is an AI project team timeline, for example:

```text
任务：AI 趋势洞察 PPT 写作

1. 闻舟 (AI) · 趋势洞察师
   正在检索资料... 已完成，引用 8 条

2. 墨衡 (AI) · 研究审阅员
   正在提炼观点... 已完成，生成 5 个核心结论

3. 简页 (AI) · PPT 制作师
   正在生成演示文稿... 70%

4. 砚白 (AI) · 质检员
   等待中
```

This is a V1.1 north star, not a V1 implementation promise. V1 must not fake stages that do not have real backing providers.

## 6. Patch Lifecycle

During V1 development, contract review must reference both:

- `AGENT_REGISTRY_AND_CLUSTER_CONTRACT.md`
- `AGENT_REGISTRY_AND_CLUSTER_CONTRACT_TASK_PATCH.md`

If either document conflicts with implementation, block the merge.

After V1 task workbench stabilizes, merge this patch into the main contract as v1.1.

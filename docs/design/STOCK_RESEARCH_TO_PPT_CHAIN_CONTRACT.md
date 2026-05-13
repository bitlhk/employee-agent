# Stock Research To PPT Chain Contract

Date: 2026-05-04
Status: Implementation overlay for task workbench lab.
Related:
- `AGENT_REGISTRY_AND_CLUSTER_CONTRACT.md`
- `AGENT_REGISTRY_AND_CLUSTER_CONTRACT_TASK_PATCH.md`
- `TASK_TEMPLATE_SCHEMA.md`
- `TASK_TEMPLATE_RUNNER_DESIGN.md`

## 1. Goal

Create the first real deterministic multi-stage task in the task workbench:

```text
股票数据研究生成 PPT

Stage 1: 衡岳 (AI) · 股票数据研究员
  backing agent: task-stock
  output: full markdown research report + structured handoff

Stage 2: 简页 (AI) · PPT 制作师
  backing agent: task-ppt
  input: original user request + Stage 1 structured handoff
  output: PPT preview/download + short completion summary
```

This task is a lab-validated deterministic chain, not an LLM-planned swarm.
The chain is statically defined, user-triggered, and auditable.

## 2. Why This Is Allowed Now

The prior V1 product spec intentionally kept V1 tasks single-stage because
multi-stage chains should not be faked.

This task is not faked:

- `task-stock` has passed cluster lab execution on the new provider path.
- `task-ppt` has passed cluster lab execution on the new provider path.
- The two stages use different backing agents and different user-facing
  personas.
- The chain is deterministic and does not dynamically add or replace agents.

Therefore this chain may ship in lab before general V1.1 planner work.

## 3. Non-Goals

- Do not expose LLM planner auto-selection.
- Do not let the user edit the chain.
- Do not save artifacts into the user's main workspace automatically.
- Do not send raw uploaded binary files directly into either LLM prompt.
- Do not ask `task-ppt` to infer investment advice from the stock report.
- Do not show internal endpoint, tunnel, token, provider metadata, or migration
  notes in the UI.

## 4. Stage 1 Output Contract

`task-stock` must produce a user-facing markdown report and the Lingxia adapter
must derive a structured handoff for downstream stages.

### 4.1 User-Facing Markdown

The markdown report is rendered as normal page content, not inside a scroll box.
It must include:

- report nature: data research and risk reminder only,
- company / stock identity,
- market data and valuation data when available,
- technical / trend / risk sections when available,
- explicit statement that it is not investment advice.

### 4.2 Handoff JSON

The adapter derives `handoffJson` from the stage output. V1 may extract it from
markdown heuristically; V1.1 should ask `task-stock` to emit it directly.

```ts
type StockResearchHandoff = {
  handoffVersion: "stock-research-v1";
  subject: {
    ticker?: string;
    name?: string;
    market?: string;
  };
  reportNature: "data_research_not_investment_advice";
  executiveSummary: string[];        // 3-6 concise findings
  keyMetrics: Array<{
    label: string;
    value: string;
    note?: string;
  }>;
  sections: Array<{
    title: string;
    takeaways: string[];             // concise bullets for slides
  }>;
  risks: string[];                   // must be present, may be empty only with warning
  disclaimerKinds: Array<"ai_generated_label" | "investment_advisory" | "fact_check_required">;
  sourceRunResultId: string;
};
```

### 4.3 Handoff Guardrails

- `executiveSummary` and `sections[].takeaways` must avoid direct buy/sell
  language.
- If the report contains words like `买入`, `卖出`, `推荐`, `目标价`, or `仓位建议`,
  the adapter must either strip/rewrite that claim into neutral research
  language or fail the handoff with `validation_failed`.
- `disclaimerKinds` must include `investment_advisory`, `fact_check_required`,
  and `ai_generated_label`.

## 5. Stage 2 Input Contract

`task-ppt` receives a bounded, structured prompt rather than the full raw stock
report.

Allowed inputs:

- original user request,
- `StockResearchHandoff`,
- a short excerpt of the full markdown report for context,
- artifact references, not artifact bytes.

Disallowed inputs:

- full raw report when it exceeds the prompt budget,
- raw uploaded files,
- binary artifacts,
- internal provider metadata.

Prompt shape:

```text
你是简页 (AI) · PPT 制作师。请基于下方结构化研究交接材料生成一份 PPT。

用户原始需求:
...

研究交接材料:
{StockResearchHandoff JSON}

要求:
- 8-12 页。
- 标题结论化，一页一个核心观点。
- 保留“仅数据研究，不构成投资建议”的免责声明。
- 不输出买入/卖出/目标价/仓位建议。
- 若信息不足，做成“研究框架 + 风险提示”，不要编造数据。
```

## 6. Frontend Rendering Contract

The UI must make the chain visible without becoming noisy.

Initial state:

```text
衡岳 (AI) · 股票数据研究员    running
简页 (AI) · PPT 制作师        waiting
```

After Stage 1 completes:

```text
衡岳 completed
  execution trace collapsible
  markdown report rendered as page content

简页 running
  execution trace collapsible
```

After Stage 2 completes:

```text
简页 completed
  execution trace collapsible
  generated PPT file cards
  optional short summary only, not a duplicate full report
```

Only execution traces are boxed/collapsible. Final markdown report and final
assistant text render as page content.

## 7. Artifacts

Expected artifacts:

- Stage 1:
  - `markdown_report` for stock research.
  - optional `handoff_json` stored in run metadata; not user-facing by default.
- Stage 2:
  - `ppt_preview`
  - `file_download`
  - optional `markdown_report` summary.

The task-level result should show a unified "交付文件" section with:

- stock research report,
- PPT preview/download,
- "save to workspace" action when workspace import is available.

## 8. Upload Handling

Uploads are supported as input artifacts.

V1 lab behavior:

- accepted types: pdf, docx, xlsx, pptx, txt, md, csv, images;
- store in the run workspace;
- extract text/table/image metadata before passing to agents;
- never pass raw binary bytes into LLM prompts;
- show uploaded files in the user's task card.

For PPT style-reference uploads:

- if the user uploads a PPT/PPTX and asks to use it as a template, mark it as
  `style_reference`;
- Stage 2 may use extracted style metadata but must not blindly copy protected
  content from the uploaded file.

## 9. Planner Future Boundary

This deterministic chain does not require planner.

Future planner behavior:

- planner may recommend this chain when user intent is stock research plus
  presentation/reporting;
- planner must show the recommended chain and require confirmation;
- planner cannot rewrite the per-stage agent list after confirmation;
- planner cannot bypass stock investment disclaimer rules.

## 10. Implementation Plan

### Phase A - Contract And Template

- Add this contract overlay.
- Add a new template id: `stock_research_ppt`.
- Template stages:
  - `stock_research`: `task-stock`, `inputMapping: { original: true }`.
  - `ppt_generation`: `task-ppt`, `inputMapping: { original: true, fromStages: ["stock_research"] }`.
- Mark template as lab-visible, not customer GA.

### Phase B - Handoff Adapter

- Add `deriveStockResearchHandoff(runResult)` helper.
- Validate forbidden investment-advice language.
- Store handoff in stage metadata and task run metadata.
- Add unit tests for clean handoff, forbidden language, missing risk section,
  and long report truncation.

### Phase C - Sequential Runner

- Extend `TaskTemplateRunner` to support deterministic two-stage execution for
  this template.
- Keep `AgentClusterRunner` unchanged; `TaskTemplateRunner` orchestrates stages
  sequentially.
- Emit stage waiting/running/completed events.
- Stop Stage 2 if Stage 1 fails or handoff validation fails.

### Phase D - Frontend Lab UX

- Left task list shows only:
  - `PPT 汇报写作`
  - `股票研究生成 PPT`
- Render Stage 2 as waiting from task start.
- Render Stage 1 report as page content.
- Render Stage 2 PPT artifacts in the same flow and right preview panel.
- Keep execution trace boxed/collapsible.

### Phase E - PPT Skill Quality Upgrade

- Update `ppt-insight` prompt to prefer bounded `StockResearchHandoff`.
- Add reviewer step inside `task-ppt` skill before final script execution:
  - check titles are conclusion-like,
  - check slide count,
  - check disclaimer,
  - check no direct investment advice,
  - check no repeated generic content.
- Do not replace the PPT engine yet.

## 11. Acceptance Criteria

- Running `股票研究生成 PPT` shows two personas from the start: 衡岳 running,
  简页 waiting.
- Stage 1 output is complete markdown page content, not truncated.
- Stage 2 receives structured handoff, not raw full report only.
- Generated PPT includes investment/fact-check disclaimers.
- If Stage 1 fails, Stage 2 does not run.
- If handoff validation finds direct buy/sell advice, Stage 2 does not run.
- UI does not expose provider internals.
- `pnpm run check` and build pass.


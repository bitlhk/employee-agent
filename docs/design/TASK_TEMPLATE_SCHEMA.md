# Task Template Schema

Date: 2026-05-03
Status: Draft for Agent Task Workbench V1.
Related:
- `AGENT_TASK_WORKBENCH_PRODUCT_SPEC_v1.md`
- `AGENT_REGISTRY_AND_CLUSTER_CONTRACT_TASK_PATCH.md`
- `AGENT_PERSONA_REGISTRY.md`

## 1. Goal

Task templates turn technical agent execution into user-facing business tasks.

A task template answers:

- what the user is trying to accomplish,
- which AI personas participate,
- which backing agents run,
- how stage inputs are composed,
- which artifact types are allowed,
- which disclaimers are required,
- which template version was used for audit.

## 2. Core Rules

- V1 task templates may be single-stage.
- Do not fake multi-stage execution by calling the same agent multiple times under different names.
- V1 persona to agent mapping is 1:1.
- Template versions are immutable.
- Running a task snapshots the template id, version, chain hash, selected personas, and backing agent ids.
- Runtime planner output cannot modify template chain composition.

## 3. Data Model

```ts
type TaskTemplate = {
  id: string;
  version: number;
  status: "draft" | "active" | "deprecated";
  displayName: string;
  shortDescription: string;
  category: TaskTemplateCategory;
  estimatedDurationMs: number;
  maxDurationMs?: number;
  stages: TaskStage[];
  outputPolicy: TaskOutputPolicy;
  createdAt: string;
  updatedAt: string;
  updatedBy: number;
};

type TaskTemplateCategory =
  | "presentation"
  | "stock_research"
  | "code_development"
  | "due_diligence"
  | "risk_review"
  | "training_material"
  | "general";
```

## 4. Stage Schema

```ts
type TaskStage = {
  id: string;
  displayName: string;
  personaId: string;
  agentDefinitionId: string;
  executionMode: "single";
  inputMapping: TaskInputMapping;
  expectedOutputs: string[];
  timeoutMs: number;
  onFailure: "stop" | "continue" | "partial_success" | "retry_once_then_stop";
};

type TaskInputMapping = {
  original?: boolean;
  fromStages?: string[];
  fromArtifacts?: Array<{
    stageId: string;
    artifactType?: string;
  }>;
};
```

`inputMapping` is structured because downstream stages often need both the original user request and one or more upstream outputs.

Example:

```ts
const pptGenerationInput: TaskInputMapping = {
  original: true,
  fromStages: ["trend_research", "research_review"],
  fromArtifacts: [{ stageId: "trend_research", artifactType: "markdown_report" }],
};
```

## 5. Output Policy

```ts
type TaskOutputPolicy = {
  allowedArtifactTypes: AgentArtifactType[];
  disclaimers: DisclaimerKind[];
  citationRequired: boolean;
  saveToWorkspaceDefault: false;
};

type AgentArtifactType =
  | "markdown_report"
  | "ppt_preview"
  | "docx_preview"
  | "xlsx_table"
  | "code_workspace"
  | "file_download"
  | "summary_artifact";

type DisclaimerKind =
  | "ai_generated_label"
  | "investment_advisory"
  | "code_review_required"
  | "fact_check_required";
```

Rules:

- `allowedArtifactTypes` is a strict whitelist. Renderer rejects other artifact types.
- `ai_generated_label` is always required even if the template omits it.
- `saveToWorkspaceDefault` must be false in V1. Users must explicitly save artifacts to their workspace.
- `citationRequired=true` means the final artifact must show citations or a clear "no external citations used" state.

## 6. V1 Templates

### 6.1 PPT 汇报写作

```ts
const pptReportTemplate: TaskTemplate = {
  id: "ppt_report_writing",
  version: 1,
  status: "active",
  displayName: "PPT 汇报写作",
  shortDescription: "将主题或材料整理成结构化演示文稿草稿。",
  category: "presentation",
  estimatedDurationMs: 90_000,
  maxDurationMs: 300_000,
  stages: [
    {
      id: "ppt_generation",
      displayName: "生成演示文稿",
      personaId: "jianye",
      agentDefinitionId: "task-ppt",
      executionMode: "single",
      inputMapping: { original: true },
      expectedOutputs: ["ppt_preview", "markdown_report"],
      timeoutMs: 300_000,
      onFailure: "retry_once_then_stop",
    },
  ],
  outputPolicy: {
    allowedArtifactTypes: ["ppt_preview", "markdown_report", "file_download"],
    disclaimers: ["ai_generated_label", "fact_check_required"],
    citationRequired: false,
    saveToWorkspaceDefault: false,
  },
  createdAt: "2026-05-03T00:00:00.000Z",
  updatedAt: "2026-05-03T00:00:00.000Z",
  updatedBy: 2,
};
```

### 6.2 股票数据研究

```ts
const stockResearchTemplate: TaskTemplate = {
  id: "stock_data_research",
  version: 1,
  status: "active",
  displayName: "股票数据研究",
  shortDescription: "整理股票数据、历史走势、指标和风险因素；不提供投资建议。",
  category: "stock_research",
  estimatedDurationMs: 60_000,
  maxDurationMs: 180_000,
  stages: [
    {
      id: "stock_research",
      displayName: "生成股票数据研究报告",
      personaId: "hengyue",
      agentDefinitionId: "task-stock",
      executionMode: "single",
      inputMapping: { original: true },
      expectedOutputs: ["markdown_report"],
      timeoutMs: 180_000,
      onFailure: "retry_once_then_stop",
    },
  ],
  outputPolicy: {
    allowedArtifactTypes: ["markdown_report", "file_download"],
    disclaimers: ["ai_generated_label", "investment_advisory", "fact_check_required"],
    citationRequired: false,
    saveToWorkspaceDefault: false,
  },
  createdAt: "2026-05-03T00:00:00.000Z",
  updatedAt: "2026-05-03T00:00:00.000Z",
  updatedBy: 2,
};
```

### 6.3 程序开发 / 代码改造

```ts
const codeDevelopmentTemplate: TaskTemplate = {
  id: "code_development",
  version: 1,
  status: "active",
  displayName: "程序开发 / 代码改造",
  shortDescription: "协助分析代码、起草方案、生成改造建议和代码变更。",
  category: "code_development",
  estimatedDurationMs: 90_000,
  maxDurationMs: 300_000,
  stages: [
    {
      id: "code_work",
      displayName: "处理代码任务",
      personaId: "qingzhan",
      agentDefinitionId: "task-code",
      executionMode: "single",
      inputMapping: { original: true },
      expectedOutputs: ["code_workspace", "markdown_report"],
      timeoutMs: 300_000,
      onFailure: "retry_once_then_stop",
    },
  ],
  outputPolicy: {
    allowedArtifactTypes: ["code_workspace", "markdown_report", "file_download"],
    disclaimers: ["ai_generated_label", "code_review_required"],
    citationRequired: false,
    saveToWorkspaceDefault: false,
  },
  createdAt: "2026-05-03T00:00:00.000Z",
  updatedAt: "2026-05-03T00:00:00.000Z",
  updatedBy: 2,
};
```

## 7. V1.1 Example Template

This example is a product target, not V1 scope:

```ts
const trendInsightPptTemplateV11: TaskTemplate = {
  id: "ai_trend_insight_ppt",
  version: 1,
  status: "draft",
  displayName: "AI 趋势洞察 PPT 写作",
  shortDescription: "检索趋势资料、提炼观点、生成 PPT，并做质量检查。",
  category: "presentation",
  estimatedDurationMs: 180_000,
  maxDurationMs: 600_000,
  stages: [
    {
      id: "trend_research",
      displayName: "检索趋势资料",
      personaId: "wenzhou",
      agentDefinitionId: "task-trace",
      executionMode: "single",
      inputMapping: { original: true },
      expectedOutputs: ["markdown_report"],
      timeoutMs: 180_000,
      onFailure: "retry_once_then_stop",
    },
    {
      id: "research_review",
      displayName: "提炼核心观点",
      personaId: "moheng",
      agentDefinitionId: "reviewer-agent-tbd",
      executionMode: "single",
      inputMapping: { original: true, fromStages: ["trend_research"] },
      expectedOutputs: ["markdown_report"],
      timeoutMs: 120_000,
      onFailure: "stop",
    },
    {
      id: "ppt_generation",
      displayName: "生成演示文稿",
      personaId: "jianye",
      agentDefinitionId: "task-ppt",
      executionMode: "single",
      inputMapping: { original: true, fromStages: ["trend_research", "research_review"] },
      expectedOutputs: ["ppt_preview"],
      timeoutMs: 300_000,
      onFailure: "stop",
    },
  ],
  outputPolicy: {
    allowedArtifactTypes: ["markdown_report", "ppt_preview", "file_download", "summary_artifact"],
    disclaimers: ["ai_generated_label", "fact_check_required"],
    citationRequired: true,
    saveToWorkspaceDefault: false,
  },
  createdAt: "2026-05-03T00:00:00.000Z",
  updatedAt: "2026-05-03T00:00:00.000Z",
  updatedBy: 2,
};
```

Do not activate this template until `task-trace` and the reviewer stage have passed cluster lab validation.

## 8. Versioning And Audit

Task template rows are immutable per version.

Required run snapshot:

```ts
type TaskTemplateRunSnapshot = {
  taskTemplateId: string;
  taskTemplateVersion: number;
  taskTemplateName: string;
  chainHash: string;
  stageSnapshots: Array<{
    stageId: string;
    personaId: string;
    agentDefinitionId: string;
    inputMapping: TaskInputMapping;
    timeoutMs: number;
    onFailure: string;
  }>;
};
```

`chainHash` should be a stable hash of stage order, persona ids, agent ids, input mappings, output policy, and disclaimer config.

## 9. Renderer Contract

The renderer must:

- reject artifact types outside `allowedArtifactTypes`,
- append standardized disclaimers,
- preserve citations,
- show `(AI)` labels for persona output,
- never auto-save artifacts to user workspace,
- use copy-on-import when the user explicitly saves an artifact.

The renderer must not:

- create task-specific renderers such as `stock_analysis_report`,
- hide disclaimer blocks,
- render raw provider endpoint, token, tunnel, or migration metadata,
- present AI personas as human specialists.

## 10. Open Questions For Implementation

1. Should task templates live in JSON first or DB first?
   Recommendation: JSON first for V1, DB migration after UI stabilizes.

2. Should V1 history use existing cluster run in-memory shape or a DB table?
   Recommendation: DB table before customer demo; history is part of banking trust.

3. Should `task-ppt` artifacts be imported from legacy agent workspace or generated through standardized artifact store immediately?
   Recommendation: lab adapter can normalize legacy outputs first; standardized store follows after artifact renderer contract lands.

4. Should V1 expose task template editing to admins?
   Recommendation: no. V1 admin changes via JSON/config review only. Admin UI for template editing is V1.5.

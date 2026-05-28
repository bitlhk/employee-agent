# Workbench Ability Home Design

Date: 2026-05-24
Status: Draft for staged implementation
Related:
- `docs/design/FINANCIAL_DATA_PACK_ORCHESTRATION.md`
- `docs/design/DOCUMENT_WORKBENCH_UI_CONTRACT.md`
- `docs/design/TASK_TEMPLATE_RUNNER_DESIGN.md`
- `docs/design/TASK_TEMPLATE_SCHEMA.md`

## 1. Goal

The office workspace should move from one page per feature to one Manus-like ability home and one reusable task workbench.

The current office-space scope has seven visible abilities:

- General office:
  - meeting notes
  - Excel filling
  - research PPT / slides
  - video outline
- Professional finance:
  - market research brief
  - client meeting preparation
  - Wind announcement digest

Future abilities such as meeting minutes, Excel filling, video outline, Wind company one-page memo, fund comparison, earnings analysis, and macro interpretation should reuse the same home and workbench contract.

The product shape is:

```text
ability home
  -> user selects or describes a task
  -> controlled task router resolves an ability
  -> unified task workbench runs stages
  -> artifacts are previewed / downloaded / revised
```

This is not a general free-chat surface. Chat is the entry and revision interface. The product core is task execution and artifact delivery.

## 2. Product Principles

### 2.1 One Visual System

All document and office tasks should share the same visual grammar:

- restrained warm white background
- centered idle composition
- compact composer
- ability chips below the composer
- Manus-like low-noise execution timeline
- right-side preview card for heavy content
- inline artifact cards for final deliverables
- history and follow-up supported by task run context

Task-specific UI should be injected as setup panels, not as standalone pages.

### 2.2 Ability Selection Is Not Execution

Category chips such as "通用办公" and "专业金融" are navigation controls only.

Only concrete abilities such as "幻灯片", "研究简报", "公告解读", or "客户会议" count as selected tasks.

Execution starts only when the user submits text, or when the router auto-selects an ability from a sufficiently explicit request.

### 2.3 Unified Frontend, Different Runtimes

The frontend should normalize all abilities into one workbench model.

The backend runtime may differ by ability:

- PPT: Hermes profiles for research / insight / outline, deterministic PPT renderer, checker.
- Market brief: Hermes reader / analyst / writer, or OpenClaw fallback.
- Client meeting preparation: Hermes reader / profiler / writer.
- Wind announcement digest: Wind MCP data pack, Hermes report writer, OpenClaw fallback.
- Future meeting minutes: ASR, Hermes minutes writer.
- Future Excel filling: deterministic parser/filler, LLM for mapping and wording.
- Future video outline: URL/transcript extractor, Hermes/OpenClaw writer.

Runtime difference must not leak into bespoke frontend pages.

## 3. Ability Home UX

### 3.1 Default Idle State

Default state has no selected concrete ability.

```text
center title
composer
[通用办公 v] [专业金融 v] [更多]
global examples
```

The default examples should be cross-category, but limited to common work outcomes.

Example default chips:

- 幻灯片
- 研究简报
- 公告解读
- 客户会议

The default placeholder can be:

```text
分配一个任务或提问任何问题
```

### 3.2 Ability Group Expansion

Group expansion happens inline below the composer. It should not open a drawer and should not cover the composer.

Default:

```text
[通用办公 v] [专业金融 v] [更多]
```

General expanded:

```text
[通用办公 ^] [幻灯片] [研究简报] [客户会议] [会议纪要] [更多] [专业金融 v]
```

Finance expanded:

```text
[通用办公 v] [专业金融 ^] [公告解读] [金融简报] [公司一页纸] [基金对比] [更多]
```

Rules:

- Clicking a group only expands or collapses the group.
- Clicking a concrete ability sets `selectedAbilityId`.
- `更多` opens a compact popover with all enabled abilities grouped by category.
- On narrow screens the chip row can wrap or horizontally scroll, but it should not become a full-screen picker.

### 3.3 Selected Ability State

After selecting a concrete ability, the home surface updates dynamically.

The following regions are derived from `selectedAbilityId`:

- selected task chip in composer
- placeholder
- quick prompts
- optional setup panel
- expected stages
- history scope
- preview affordances

Example:

```text
selectedAbilityId = research_ppt
  composer chip: 幻灯片制作
  placeholder: 描述汇报主题、受众、页数和风格要求
  quick prompts: PPT-specific
  setup panel: PPT template picker + slide range
```

```text
selectedAbilityId = wind_announcement_digest
  composer chip: 公告解读
  placeholder: 输入公司、股票代码或公告主题
  quick prompts: announcement-specific
  setup panel: none in V1
```

Selecting another ability before submit replaces the home surface and clears incompatible setup state.

## 4. Frontend State Model

The home should be driven by a small explicit state machine.

```ts
type AbilityGroupId = "general" | "finance";

type WorkbenchHomeState = {
  expandedGroup: AbilityGroupId | null;
  selectedAbilityId: string | null;
  draftText: string;
  runState: "idle" | "routing" | "running" | "completed" | "failed";
  activeTaskRunId?: string;
  activeArtifactIds: string[];
};
```

Recommended derived values:

```ts
type HomeSurface = {
  title: string;
  placeholder: string;
  quickPrompts: string[];
  setupPanel?: "ppt-template" | "none";
  historyScope?: string;
  allowedInputModes: Array<"text" | "file" | "audio" | "video" | "url">;
};
```

The UI should avoid branching on task ids outside the registry. Components receive `HomeSurface` and render accordingly.

## 5. Ability Registry

The registry is the bridge between product ability and task template.

```ts
type AbilityDefinition = {
  id: string;
  group: "general" | "finance";
  label: string;
  shortLabel: string;
  taskTemplateId: string;
  icon: string;
  featured?: boolean;
  enabled: boolean;
  placeholder: string;
  quickPrompts: string[];
  setupPanel?: "ppt-template" | "none";
  runnerKind:
    | "hermes-chain"
    | "openclaw"
    | "wind-mcp-hermes"
    | "deterministic";
  previewTypes: Array<
    | "document"
    | "slides"
    | "source-pack"
    | "spreadsheet"
    | "transcript"
    | "video-outline"
  >;
};
```

Initial registry:

| Ability | Group | Existing template | Setup panel | Runtime |
|---|---|---|---|---|
| 会议纪要 | general | current `MeetingNotesPage` route | audio upload | ASR + OpenClaw/Hermes writer |
| Excel 填表 | general | current `ExcelFillPage` route | workbook/context upload | deterministic parser/filler + writer |
| 幻灯片制作 | general | `research_ppt` | `ppt-template` | OpenClaw research + renderer |
| 视频提纲 | general | current `VideoOutlinePage` route | video URL | URL/transcript extractor + writer |
| 研究简报 | general | `market_research_brief` | none | Hermes/OpenClaw |
| 客户会议准备 | general | `meeting_prep_agent` | none | Hermes/OpenClaw |
| 公告解读 | finance | `wind_announcement_digest` | none | Wind MCP + Hermes |

Near-future finance registry entries can be disabled until backend runners exist:

| Ability | Group | Setup panel | Preview |
|---|---|---|---|
| 公司一页纸 | finance | optional company picker | document |
| 基金对比 | finance | fund picker | table + document |
| 财报点评 | finance | company + period | document |

Disabled abilities can be visible only in `更多`, with a "即将支持" state, or hidden entirely for V1.

## 6. Business Prompts

Prompts must be concrete and business-shaped. They are not marketing examples.

### 6.1 Slides

Placeholder:

```text
描述汇报主题、受众、页数和风格要求
```

Examples:

- 生成 8 页企业 AI Agent 落地趋势 PPT
- 围绕银行业 AI 应用趋势生成汇报材料
- 把产品方案整理成 8 页商务路演 PPT
- 生成客户汇报用的 OpenClaw 部署方案 PPT

### 6.2 Market Research Brief

Placeholder:

```text
输入研究主题、行业、公司或趋势方向
```

Examples:

- 洞察近期金融 AI 应用趋势，生成领导简报
- 分析跨境支付新动态，关注监管和银行机会
- 梳理财富管理行业 AI Agent 落地机会
- 研究企业级智能体平台的市场机会和风险

### 6.3 Client Meeting Preparation

Placeholder:

```text
输入客户、会议目标、参会对象和关注方向
```

Examples:

- 准备拜访某银行科技部的会议材料
- 生成客户高层交流的议题和问题清单
- 整理续约会议的客户背景和沟通重点
- 准备一次产品方案介绍会的会前材料

### 6.4 Wind Announcement Digest

Placeholder:

```text
输入公司、股票代码或公告主题
```

Examples:

- 解读贵州茅台最新公告对经营的影响
- 分析宁德时代近期公告里的关键风险
- 梳理某上市公司年报中的核心变化
- 解读回购公告对市场预期的影响

## 7. Routing When No Ability Is Selected

If `selectedAbilityId` is null and the user submits a prompt, the backend must route before execution.

### 7.1 Router Outcomes

```ts
type RouterDecision =
  | {
      kind: "task";
      abilityId: string;
      confidence: "high" | "medium";
      reason: string;
    }
  | {
      kind: "clarify";
      message: string;
      candidateAbilityIds: string[];
    }
  | {
      kind: "help";
      answer: string;
    }
  | {
      kind: "reject";
      reason: string;
    };
```

### 7.2 Explicit Task Intent

If the user clearly requests an artifact, auto-select and run the matching ability.

Examples:

- "帮我做一个银行 AI 应用趋势的 8 页 PPT" -> `research_ppt`
- "解读一下宁德时代最新公告" -> `wind_announcement_digest`
- "准备拜访某银行科技部的材料" -> `meeting_prep_agent`

The UI should display:

```text
已识别：幻灯片制作
```

Then update the home surface and enter running state.

### 7.3 Ambiguous Task Intent

If the user asks for "整理材料", "做个汇报", "帮我看看", or other unclear work, do not guess aggressively.

Return a clarification with concrete buttons:

```text
你想整理成哪类产物？
[幻灯片] [研究简报] [客户会议材料] [公告解读]
```

### 7.4 Controlled Help / Chitchat

If the user asks "你好", "你能做什么", or "这个系统怎么用", answer in a restricted help mode.

Help mode must not:

- call Hermes task profiles
- call Wind MCP
- read workspace files
- read memory
- read previous artifacts
- access user uploads

It can:

- explain supported abilities
- suggest examples
- ask the user to choose a task
- answer basic product-use questions

This keeps the home useful without becoming a general personal assistant.

## 8. Backend Orchestration

Frontend-selected ability is only a request. The backend is the authority.

Backend flow:

```text
POST /run-stream
  1. authenticate user
  2. validate ability/template access
  3. if no ability: route prompt
  4. load task template
  5. enforce ability permission
  6. run ability-specific runner
  7. normalize events
  8. persist task run history
  9. return artifacts
```

### 8.1 Runtime Mapping

| Ability | Orchestrator | Profiles / tools |
|---|---|---|
| 幻灯片制作 | employee-agent | OpenClaw research PPT agent, renderer, checker |
| 研究简报 | employee-agent | Financial Data Pack builder + `market-data-analyst`, `market-brief-writer` |
| 客户会议准备 | employee-agent | Financial Data Pack builder + `meeting-data-analyst`, `meeting-pack-writer` |
| 公告解读 | employee-agent | Wind MCP docs/news + `wind-report-writer` |

Do not use a "main Hermes agent" as unrestricted orchestrator. Employee-agent owns orchestration and permissions. Hermes profiles are bounded workers.

#### 8.1.1 Professional Finance P0 Data Pack

Professional finance tasks should not rely on public-search reader profiles as the primary path. The P0 path for `market_research_brief` and `meeting_prep_agent` is:

```text
user request
  -> task-specific DataPackBuilder
  -> FinancialDataProvider
  -> WindFinancialDataProvider
  -> Hermes analyst / writer
  -> artifact preview / download / audit
```

Wind workflow skills are used as methodology references, not as unrestricted Hermes runtime skills. Wind MCP calls stay in employee-agent so that API keys, tenant isolation, tool allowlists, timeouts, and audit records remain server-side.

See `docs/design/FINANCIAL_DATA_PACK_ORCHESTRATION.md` for the P0 data plan, borrowed Wind skill methodology, Hermes prompt responsibilities, and Alice usage policy.

### 8.2 Event Normalization

All runners emit the same event envelope:

```ts
type WorkbenchEvent =
  | { type: "run_started"; taskRunId: string; abilityId: string }
  | { type: "router_decision"; decision: RouterDecision }
  | { type: "stage_started"; stage: StageRef }
  | { type: "tool_call"; stageId: string; label: string; detail?: string }
  | { type: "source_collected"; stageId: string; sourcePackId: string }
  | { type: "stage_output"; stageId: string; markdown?: string; summary?: string }
  | { type: "artifact_created"; artifact: WorkbenchArtifact }
  | { type: "run_done"; taskRun: WorkbenchTaskRun }
  | { type: "run_failed"; error: SafeError };
```

The frontend timeline should not care whether the event came from Hermes, OpenClaw, Wind MCP, ASR, or deterministic code.

## 9. Preview and Artifact Contract

Preview is registry-driven.

```ts
type WorkbenchArtifact = {
  id: string;
  ownerUserId: number;
  adoptId: string;
  taskRunId: string;
  type:
    | "markdown"
    | "html"
    | "docx"
    | "pptx"
    | "slides-preview"
    | "xlsx"
    | "source-pack"
    | "transcript";
  name: string;
  previewUrl?: string;
  downloadUrl?: string;
  metadata?: Record<string, unknown>;
};
```

Preview registry:

| Type | Preview |
|---|---|
| `html`, `docx` with `previewUrl` | document preview |
| `slides-preview` | inline slides preview |
| `pptx` | download card, optional generated preview |
| `source-pack` | evidence/source drawer |
| `xlsx` | spreadsheet preview |
| `transcript` | transcript preview |

Final outputs should be visible inline when useful. Heavy evidence and data packs should open in the right preview panel.

## 10. Security and Isolation

The design must assume the frontend is untrusted.

### 10.1 User and Workspace Isolation

Rules:

- Every task run is scoped to `userId + adoptId`.
- Workspace paths are resolved server-side.
- Resolved paths must stay inside the user's workspace root.
- Artifact preview/download must validate artifact ownership.
- History is filtered server-side by user and adopt.
- Frontend-provided paths are never used directly.

### 10.2 Ability Permissions

Each ability has a backend permission record.

```ts
type AbilityPermission = {
  abilityId: string;
  taskTemplateId: string;
  allowedProfiles: string[];
  allowedMcpTools: string[];
  allowedFileTypes: string[];
  allowedArtifactTypes: string[];
  allowWorkspaceRead: boolean;
  allowMemoryRead: boolean;
};
```

Examples:

- Announcement digest can call Wind announcement/news tools and `wind-report-writer`.
- Slides can call PPT profiles and renderer, but not Wind MCP unless a finance PPT ability explicitly allows it.
- Help mode allows no profiles, no MCP tools, no workspace read, and no memory read.

### 10.3 Prompt and File Safety

User uploads and retrieved documents are untrusted context.

Worker prompts must separate:

- system/developer instructions
- user request
- retrieved source text
- previous artifacts

Profiles must be instructed not to follow commands embedded in source documents.

### 10.4 Log and SSE Redaction

Never emit:

- API keys
- Wind credentials
- cookies
- absolute host paths
- provider tokens
- raw internal error stacks

SSE events should carry user-visible summaries and artifact ids, not secrets or server internals.

## 11. Follow-Up and Revision

After a task completes, the composer stays active.

Follow-up requests are bound to:

```ts
type FollowupContext = {
  taskRunId: string;
  abilityId: string;
  artifactIds: string[];
  lastPreviewArtifactId?: string;
};
```

Examples:

- "改成领导汇报版"
- "把这份简报压缩到一页"
- "把 PPT 改成面向客户版本"
- "把公告解读里的风险点展开"

The backend must validate that every referenced artifact belongs to the current user before revision.

If the user switches to a different ability, the UI should warn or clearly start a new task context.

## 12. Implementation Plan

The implementation order was revised after reading the current office-space code. The product still moves toward one unified workbench, but the safest path is to migrate the three standalone pages first, before adding the dynamic ability home.

### Phase 0: Baseline and Guardrails

Goal: preserve current behavior before refactor.

Tasks:

- Document current seven office-space abilities and their backing pages/task ids.
- Snapshot current UI behavior for idle, running, completed, preview-open states.
- Add basic smoke cases for each existing ability route if missing.
- Confirm current history, artifact preview, and download paths.

Exit criteria:

- Existing seven abilities still open.
- No visual regression intended by this phase.

### Phase 1: Shared Workbench UI Slots

Goal: extract the reusable workbench UI slots needed by standalone page migration.

Tasks:

- Formalize composer, prompt cards, setup panel, timeline, preview panel, and artifact card contracts.
- Keep current `DocumentTaskWorkbench` behavior visually unchanged.
- Do not migrate meeting notes, Excel, or video yet.

Exit criteria:

- Existing workbench-backed abilities look unchanged.
- Shared slots are ready for video / meeting / Excel adapters.

### Phase 2: Migrate Video Outline

Goal: move the simplest standalone ability into the unified workbench shell.

Tasks:

- Represent video outline as a workbench ability.
- Use a `video-url` setup panel.
- Adapt current video-outline API output to timeline + artifact shape.
- Keep old route as fallback during migration.

Exit criteria:

- Video outline opens in the unified workbench UI.
- Existing video outline generation and download still work.
- Other six abilities are not regressed.

### Phase 3: Migrate Meeting Notes

Goal: move audio-upload meeting minutes into the unified workbench shell.

Tasks:

- Prefer upload-only in the unified workbench.
- Adapt current meeting-notes process and ask APIs.
- Render transcript and minutes as previewable artifacts.
- Keep recording-specific behavior out of the first unified version unless explicitly needed.

Exit criteria:

- User uploads an audio file and sees ASR/summary stages.
- Transcript and minutes are previewable.
- Follow-up remains bound to the selected meeting note.

### Phase 4: Migrate Excel Filling

Goal: move workbook fill planning and apply flow into the unified workbench shell.

Tasks:

- Add workbook/context upload setup panel.
- Adapt plan/apply APIs.
- Add fill-plan and spreadsheet preview artifact types.
- Keep deterministic code responsible for workbook mutation.

Exit criteria:

- User can upload workbook and context.
- Plan preview is readable.
- Apply produces downloadable XLSX.

### Phase 5: Ability Registry and Dynamic Home

Goal: add the Manus-like dynamic ability home after all visible abilities can land in the same shell.

Tasks:

- Add `AbilityDefinition` registry for all seven abilities.
- Add `expandedGroup` and `selectedAbilityId`.
- Implement inline group expansion for `通用办公` and `专业金融`.
- Keep office-space cards as deep links that preselect abilities.

Exit criteria:

- All seven abilities are selectable from the unified home.
- Selecting an ability refreshes placeholder, prompts, setup panel, and history scope.

### Phase 6: Conservative Router and Help Mode

Goal: support unselected user input without accidental task execution.

Tasks:

- If no ability is selected and router identifies a task, auto-select but require confirmation.
- If intent is ambiguous, recommend candidates.
- If user asks help/chitchat, answer in no-tool help mode.
- Manual ability selection + submit still runs directly.

Exit criteria:

- "生成 8 页银行 AI 趋势 PPT" auto-selects slides but does not run until confirmation.
- "帮我整理一下材料" returns candidate ability chips.
- "你好" returns controlled help and starts no task.

### Phase 7: Hermes Intent Router Profile

Goal: replace brittle routing with a bounded model router.

Tasks:

- Add Hermes profile `workspace-intent-router`.
- No tools, no memory, no workspace reads, no file content.
- JSON output only.
- Backend validates all model decisions.

Exit criteria:

- Router improves fuzzy intent handling.
- Bad router output cannot start a task.

### Phase 8: Permission Gate and Isolation Hardening

Goal: make backend authority explicit.

Tasks:

- Add ability permission registry.
- Enforce allowed profiles, MCP tools, file types, artifact types.
- Validate artifact ownership and workspace path containment.
- Ensure help mode cannot call tools/profiles/files.

Exit criteria:

- Forged ability/artifact ids are rejected.
- Cross-user file preview/download is blocked.

### Phase 9: Follow-Up Context

Goal: allow controlled artifact revision.

Tasks:

- Persist `FollowupContext`.
- Route follow-up to ability-specific revision path.
- Clear context when switching abilities.

Exit criteria:

- User can revise the current artifact.
- Switching ability starts a new task context.

## 13. Open Decisions

1. Should the default quick chips show only groups plus "更多", or include four global common abilities?
   - Recommendation: groups plus "更多" first; test if discoverability is enough.

2. Should disabled future abilities be visible as "即将支持"?
   - Recommendation: hide in production, show in internal lab.

3. Should `market_research_brief` live in general or finance?
   - Recommendation: current office-space code places it under professional finance. Keep it there. Add a separate generic research brief later if needed.

4. Should help mode call a model?
   - Recommendation: start with deterministic help text and simple rule-based router. Add a small classifier only if rule routing is insufficient.

## 14. Definition of Done for V1

V1 is done when:

- Existing seven office-space abilities are represented in the ability registry.
- The four DocumentTaskWorkbench-backed abilities are selectable from one dynamic home first.
- Meeting notes, Excel filling, and video outline remain compatible during migration.
- Direct routes from office space still work.
- Task-specific prompts and setup panels refresh without navigating to different pages.
- No selected ability + explicit task request auto-routes safely.
- No selected ability + ambiguous request asks for clarification.
- No selected ability + casual help stays in no-tool help mode.
- All artifact preview/download paths are server-side ownership checked.
- Existing visual style is preserved or improved.

# Workbench Ability Home Implementation Plan

Date: 2026-05-24
Status: Revised staged implementation plan
Related:
- `docs/design/FINANCIAL_DATA_PACK_ORCHESTRATION.md`
- `docs/design/WORKBENCH_ABILITY_HOME_DESIGN.md`
- `docs/design/DOCUMENT_WORKBENCH_UI_CONTRACT.md`
- `client/src/components/pages/OfficeSpacePage.tsx`
- `client/src/components/pages/MeetingNotesPage.tsx`
- `client/src/components/pages/ExcelFillPage.tsx`
- `client/src/components/pages/VideoOutlinePage.tsx`
- `client/src/components/document-workbench/DocumentTaskWorkbench.tsx`
- `server/_core/agent/task-workbench-router.ts`
- `server/_routes/task-workbench-lab.ts`

## 1. Current Reality

The office-space homepage currently has seven visible abilities.

General office:

- `meeting-notes` / 会议纪要 / standalone `MeetingNotesPage`
- `excel-fill` / Excel 填表 / standalone `ExcelFillPage`
- `ppt-create` / PPT 制作 / `DocumentTaskWorkbench` with `research_ppt`
- `video-outline` / 视频提纲 / standalone `VideoOutlinePage`

Professional finance:

- `market-research-brief` / 金融市场研究简报 / `DocumentTaskWorkbench` with `market_research_brief`
- `meeting-prep-agent` / 客户会议准备 / `DocumentTaskWorkbench` with `meeting_prep_agent`
- `wind-announcement-digest` / 公告解读 / `DocumentTaskWorkbench` with `wind_announcement_digest`

The visual split is therefore:

```text
already unified enough:
  PPT
  financial market brief
  client meeting prep
  Wind announcement digest

not unified yet:
  video outline
  meeting notes
  Excel filling
```

The implementation should avoid a risky "migrate all seven and add router and add dynamic home" change. The safer route is:

```text
first unify the three standalone pages into the same workbench shell
then add the ability registry and dynamic home
then add conservative router behavior
then harden permissions and follow-up
```

## 2. Target Architecture

The final target remains one Manus-like workbench.

```text
OfficeSpacePage
  -> ability entry cards / later unified ability home
  -> DocumentTaskWorkbench shell
      -> composer
      -> task-specific setup panel
      -> timeline
      -> preview panel
      -> artifact cards
      -> history / follow-up
```

Backend runtimes do not need to be identical.

- PPT: Hermes profiles + deterministic PPT renderer
- Financial brief: Hermes/OpenClaw chain
- Meeting prep: Hermes/OpenClaw chain
- Announcement digest: Wind MCP + Hermes writer
- Video outline: video URL extractor + outline writer
- Meeting notes: ASR + minutes writer
- Excel filling: deterministic workbook parser/filler + LLM mapping/writing

The shared contract is UI event and artifact shape, not a single backend runtime.

### 2.1 Controlled Professional Finance Harness Plan

The finance backend should be improved before adding many more finance abilities. The direction is controlled intelligence:

```text
market research brief / client meeting preparation
  -> financial-harness planner
     -> task
     -> data_requirements
     -> optional compute_requirements
     -> worker stages
  -> employee-agent policy gate
  -> FinancialDataProvider / WindFinancialDataProvider
  -> optional controlled compute sandbox
  -> Hermes analyst / writer profiles
```

This replaces the current public-search-first reader behavior, but it should not make the workflow rigid. Harness can plan what data and computation are needed. Employee-agent validates and executes the plan, so Wind keys, provider calls, Python execution, artifact storage, and audit records stay server-side and controlled.

Current code facts:

- `tools/financial-harness-executor.py` already acts as the finance harness planner.
- Its current `stage_policy` is mostly fixed:
  - market research: `market-sector-reader` -> `market-comps-spreader` -> `market-note-writer`
  - meeting prep: `meeting-news-reader` -> `meeting-profiler` -> `meeting-pack-writer`
- `server/_core/agent/task-workbench-router.ts` calls `/v1/harness/route` and carries the returned `harnessPlan`.
- `server/_routes/task-workbench-lab.ts` executes `/v1/harness/execute-stream`.
- Wind calls currently live in the announcement digest path inside `task-workbench-lab.ts`.

Scope for the finance backend migration:

- extract a finance data provider from the existing Wind announcement digest code
- extend harness plan schema with `data_requirements`
- later extend harness plan schema with allowlisted `compute_requirements`
- add `buildMarketResearchDataPack(plan.dataRequirements)`
- add `buildMeetingPrepDataPack(plan.dataRequirements)`
- update Hermes prompts so Reader-style workers become analyst/writer workers fed by DataPack
- keep Alice as optional benchmark or advanced mode, not default runtime
- keep old Reader profiles as fallback until the new path is stable

Validation:

- wind_announcement_digest still works
- route-only decisions do not fetch data
- market_research_brief can build a Wind-backed data pack from harness requirements
- meeting_prep_agent can build a client data pack from harness requirements
- unsupported data or compute requirements are visible as gaps, not silently executed
- all provider calls are auditable and redacted
- existing workbench UI remains unchanged

Detailed design: `docs/design/FINANCIAL_DATA_PACK_ORCHESTRATION.md`.

## 3. Phase 0: Baseline and Scope Lock

### Goal

Freeze current behavior before migration.

### Work

- Confirm seven office-space cards are still visible.
- Confirm four existing `DocumentTaskWorkbench` tasks still work.
- Confirm three standalone pages still work:
  - video outline generate/list/download
  - meeting notes upload/process/follow-up/history
  - Excel upload/plan/apply/history
- Capture screenshots for idle/running/completed states where possible.
- Add or update a simple manual smoke checklist.

### Validation

- Office-space homepage renders 4 general + 3 finance cards.
- Clicking every card opens the current feature.
- No source code behavior change except documentation/checklist.

## 3.1 Finance Phase 0: Harness Contract Lock

### Goal

Lock the current finance harness behavior before changing data flow.

### Work

- Snapshot the current `financial-harness` planner output for:
  - market research
  - client meeting preparation
  - clarify
  - reject_or_reframe
- Add a schema-compatible extension point for:
  - `data_requirements`
  - `compute_requirements`
- Do not change the current fixed stage policy yet.
- Do not remove `market-sector-reader` or `meeting-news-reader`.

### Validation

- Current finance routes still return executable harness plans.
- Existing market brief and meeting prep tasks still run on the old chain.
- New fields can be absent without breaking execution.
- New fields can be present and are preserved inside `harnessPlan`.

## 3.2 Finance Phase 1: Harness-Planned Wind Data Pack

### Goal

Let Harness plan the data needs while employee-agent remains the only component
that can fetch Wind data.

### Work

- Extend `tools/financial-harness-executor.py` planner prompt/output schema:
  - `data_requirements`
  - reason for each requirement
  - bounded `top_k`
  - allowed data types only
- Extend `server/_core/agent/task-workbench-router.ts` to preserve those fields.
- Add `server/_core/finance-data/types.ts`.
- Add `server/_core/finance-data/wind-provider.ts`.
- Add `server/_core/finance-data/provider-router.ts`.
- Move existing Wind announcement/news calls out of the route and behind the provider.
- Build DataPack before worker execution only after the user submits a task.

### Validation

- Route-only does not call Wind.
- Submitted market brief calls Wind through the provider.
- Submitted meeting prep calls Wind through the provider.
- Wind errors are redacted and recorded as DataPack gaps.
- Announcement digest still works.

## 3.3 Finance Phase 2: Replace Reader Main Path

### Goal

Move the main path away from public-search Reader profiles.

### Work

- Update `tools/financial-harness-executor.py` `stage_policy` main path:
  - market research: `market-analyst` -> `market-brief-writer`
  - meeting prep: `meeting-analyst` -> `meeting-pack-writer`
- Inject DataPack into worker prompts.
- Keep old reader profiles behind a fallback flag.
- Update seed templates/manifests only after the stream executor path is stable.

### Validation

- Market brief can complete without `market-sector-reader` on the main path.
- Meeting prep can complete without `meeting-news-reader` on the main path.
- Old reader chain can still be enabled for rollback.
- Timeline shows data pack, analysis, and writing stages.

## 3.4 Finance Phase 3: Controlled Python Compute

### Goal

Support bank-style professional data processing without allowing arbitrary agent
code execution.

### Work

- Extend harness planner output with `compute_requirements`.
- Add employee-agent compute policy validation.
- Add allowlisted compute templates only:
  - `time_series_metrics`
  - `peer_comparison_table`
  - `event_window_return`
  - `financial_ratio_summary`
  - `fund_performance_compare`
- Persist compute inputs, template id, outputs, errors, and audit metadata.

### Validation

- Tasks with no compute requirements behave unchanged.
- Unsupported compute types are rejected and shown as gaps.
- Approved compute emits visible timeline events.
- No network or filesystem escape from compute runtime.

## 4. Phase 1: Extract Shared Workbench UI Slots

### Goal

Prepare migration without changing behavior.

### Work

Extract or formalize reusable UI slots from the current workbench:

- `WorkbenchComposer`
- `WorkbenchPromptCards`
- `WorkbenchTimeline`
- `WorkbenchPreviewPanel`
- `WorkbenchArtifactCard`
- `WorkbenchSetupPanel`

This can initially wrap existing components:

- `DocumentComposer`
- `DocumentPromptCards`
- `DocumentPreviewPanel`
- existing artifact card logic

Also define common data shapes:

```ts
type WorkbenchSetupPanelKind =
  | "none"
  | "ppt-template"
  | "video-url"
  | "audio-upload"
  | "excel-upload";

type WorkbenchArtifactKind =
  | "markdown"
  | "html"
  | "docx"
  | "pptx"
  | "slides-preview"
  | "xlsx"
  | "source-pack"
  | "transcript"
  | "video-outline";
```

### Validation

- Existing four `DocumentTaskWorkbench` tasks look unchanged.
- No migration of meeting notes / Excel / video yet.
- `pnpm run check` and build pass.

## 5. Phase 2: Migrate Video Outline First

### Why First

Video outline is the lightest standalone page:

- input: URL + instruction
- backend: generate outline
- output: markdown-like content
- preview: document-style

It validates "non-file setup panel + document artifact" without ASR or spreadsheet complexity.

### Target UX

In the unified workbench:

```text
selected ability: 视频提纲
setup panel: video URL input
prompt: outline instruction
timeline:
  1. 读取视频信息
  2. 提取字幕/摘要
  3. 生成提纲
artifact:
  video outline markdown/html preview
  download markdown
history:
  existing video outline records or new unified task history adapter
```

### Work

- Add `video-outline` as a workbench-compatible ability.
- Keep existing `/api/claw/office/video-outline/*` endpoints at first.
- Build an adapter that maps current video output into workbench `TaskRun` / artifact shape.
- Replace `VideoOutlinePage` route usage from `OfficeSpacePage` with unified workbench mode after adapter is ready.
- Keep old component available behind a fallback flag during migration.

### Validation

- Office-space `视频提纲` opens the unified workbench.
- User can input URL and instruction.
- Existing backend generate endpoint runs.
- Timeline shows meaningful stages.
- Final outline appears inline and in preview.
- Markdown download still works.
- Existing history/list behavior is either preserved or explicitly replaced by unified history.
- No regressions to PPT / finance brief / meeting prep / announcement digest.

## 6. Phase 3: Migrate Meeting Notes

### Why Second

Meeting notes has file upload and ASR, but output is still document-like. It is more complex than video, less complex than Excel.

### Product Decision

Future unified workbench should not prioritize in-browser recording. The first unified version should support uploading audio files.

Recording can remain in the old standalone page only if needed during transition.

### Target UX

```text
selected ability: 会议纪要
setup panel: audio upload
timeline:
  1. 上传录音
  2. 讯飞转写
  3. 生成纪要
  4. 生成待办/跟进建议
artifacts:
  transcript
  meeting minutes document
  optional follow-up text
```

### Work

- Add `meeting-notes` workbench ability.
- Add setup panel for audio upload.
- Reuse current `/api/claw/meeting-notes/process` and `/ask` endpoints initially.
- Map ASR transcript and minutes into:
  - `transcript` artifact
  - `markdown/html/docx` style minutes artifact if available
- Add follow-up support bound to the latest meeting note record.
- Decide whether current meeting-notes history stays in its own endpoint for V1 or is adapted to unified history.

### Validation

- Office-space `会议纪要` opens unified workbench.
- User uploads an audio file.
- ASR starts and progress is visible.
- Transcript preview can be opened.
- Minutes preview appears in the workbench.
- Follow-up works for the selected meeting note.
- Old recording-specific behavior is either intentionally hidden or still available only through fallback.
- Other six abilities still work.

## 7. Phase 4: Migrate Excel Filling

### Why Last

Excel filling is structurally different:

- workbook upload
- context upload
- planning
- table/diff preview
- deterministic write-back
- xlsx download

It needs a spreadsheet preview and a diff/plan artifact.

### Target UX

```text
selected ability: Excel 填表
setup panel:
  - upload workbook
  - upload context materials
  - fill instruction
timeline:
  1. 解析工作簿
  2. 识别字段和空白单元格
  3. 生成填表计划
  4. 用户确认/应用
  5. 输出 xlsx
preview:
  spreadsheet preview
  fill plan / cell diff
artifacts:
  xlsx
  fill plan
```

### Work

- Add `excel-fill` workbench ability.
- Add setup panel for workbook + context uploads.
- Reuse current `/api/claw/office/excel-fill/plan` and `/apply` endpoints.
- Add `spreadsheet` preview adapter.
- Preserve deterministic code as the only layer that mutates workbook files.
- LLM/Hermes can propose mapping and wording, but cannot directly write workbook bytes.

### Validation

- Office-space `Excel 填表` opens unified workbench.
- User uploads workbook and optional context.
- Plan endpoint runs.
- Fill plan is readable in timeline/preview.
- Apply endpoint writes output workbook.
- XLSX download works.
- Spreadsheet preview shows at least key sheets or a simplified table preview.
- Other six abilities still work.

## 8. Phase 5: Ability Registry and Dynamic Home

### Goal

After all seven abilities can be represented in the workbench shell, introduce the dynamic ability home.

### Work

- Add `AbilityRegistry` for all seven abilities.
- Add `expandedGroup` and `selectedAbilityId` state.
- Render group row below the composer:

Default:

```text
[通用办公 v] [专业金融 v] [更多]
```

General expanded:

```text
[通用办公 ^] [会议纪要] [Excel 填表] [PPT 制作] [视频提纲] [更多] [专业金融 v]
```

Finance expanded:

```text
[通用办公 v] [专业金融 ^] [金融市场研究简报] [客户会议准备] [公告解读] [更多]
```

- Selecting a concrete ability refreshes:
  - selected task chip
  - placeholder
  - examples
  - setup panel
  - history scope
- Keep office-space cards as deep links that preselect an ability.

### Validation

- User can enter via old office-space cards.
- User can switch ability inside workbench before running.
- Switching while running is blocked.
- Switching after completion starts a new task context.
- Each ability shows correct prompts and setup panel.
- PPT still shows templates; Excel shows uploads; video shows URL; meeting notes shows audio upload.

## 9. Phase 6: Conservative Router and Help Mode

### Goal

When no ability is selected, the system should be smart but conservative.

### Behavior

Manual ability selected + submit:

```text
run directly
```

No ability selected + clear task intent:

```text
auto-select ability
show lightweight confirmation
do not auto-run
```

No ability selected + ambiguous intent:

```text
recommend 2-3 candidate abilities
```

No ability selected + help/chitchat:

```text
controlled help response
no tools
no Hermes task profiles
no MCP
no memory
no workspace file read
```

### Work

- Change frontend route handling so old `run_template` does not auto-run if no ability was selected before submit.
- Add pending confirmation UI:

```text
已识别：幻灯片制作
[开始生成] [换成研究简报]
```

- Add recommended ability chips for medium confidence.
- Keep deterministic guards for unsupported/high-risk tasks.

### Validation

- "生成 8 页银行 AI 趋势 PPT" with no selected ability auto-selects PPT but waits for confirmation.
- "帮我整理一下材料" shows candidate abilities.
- "你好 / 你能做什么" returns help mode and starts no task.
- Manual selected ability still runs directly.

## 10. Phase 7: Hermes Intent Router Profile

### Goal

Make routing more intelligent than rules while keeping it bounded.

### Profile

Create Hermes profile:

```text
workspace-intent-router
```

Hard constraints:

- no tools
- no memory
- no workspace read
- no file content
- no history content
- JSON output only

Input:

```json
{
  "userInput": "...",
  "selectedAbilityId": null,
  "hasAttachments": false,
  "attachmentTypes": [],
  "enabledAbilities": []
}
```

Output:

```json
{
  "kind": "task | recommend | help | reject",
  "abilityId": "research_ppt",
  "confidence": 0.94,
  "executionPolicy": "confirm_before_run",
  "message": "已识别为幻灯片制作",
  "candidateAbilityIds": []
}
```

### Validation

- Router never sees raw uploaded file content.
- Bad JSON falls back to clarify/help, not accidental execution.
- Model-selected ability is validated by backend permission registry.
- Routing quality improves over pure rules on fuzzy prompts.

## 11. Phase 8: Permission Gate and Isolation Hardening

### Goal

Frontend selection is only intent. Backend remains the authority.

### Work

Add ability permission registry:

```ts
type AbilityPermission = {
  abilityId: string;
  allowedProfiles: string[];
  allowedMcpTools: string[];
  allowedFileTypes: string[];
  allowedArtifactTypes: string[];
  allowWorkspaceRead: boolean;
  allowMemoryRead: boolean;
};
```

Enforce:

- task template access
- Hermes profile whitelist
- MCP tool whitelist
- file type whitelist
- artifact ownership
- workspace path containment
- SSE/log redaction
- help mode no-tool/no-memory/no-workspace

### Validation

- Forged task/ability ids are rejected.
- Forged artifact ids cannot preview/download another user's file.
- Workspace paths cannot escape user workspace.
- Help mode cannot call Wind/Hermes task profiles/OpenClaw/file reads.

## 12. Phase 9: Follow-Up and Revision

### Goal

Allow task-specific follow-up without turning the workbench into general chat.

### Work

Persist:

```ts
type FollowupContext = {
  taskRunId: string;
  abilityId: string;
  artifactIds: string[];
  lastPreviewArtifactId?: string;
};
```

Behavior:

- After completion, follow-up stays bound to current ability and artifacts.
- Switching ability starts a new context.
- Backend validates every artifact id before revision.

### Validation

- "改成领导汇报版" revises current artifact.
- "把这个 PPT 改成客户版" uses the current PPT artifact.
- Switching from Excel to announcement clears incompatible context.
- Cross-user artifact ids are rejected.

## 13. Recommended Work Order

Do not start with router or homepage rework. Start by unifying standalone pages.

Recommended order:

1. Phase 0: baseline
2. Phase 1: shared workbench slots
3. Phase 2: migrate video outline
4. Phase 3: migrate meeting notes
5. Phase 4: migrate Excel filling
6. Phase 5: ability registry and dynamic home
7. Phase 6: conservative router/help mode
8. Phase 7: Hermes intent router profile
9. Phase 8: permission gate
10. Phase 9: follow-up and revision

This order ensures the user never sees a dynamic ability selector that routes into old-looking pages.

## 14. Sprint 1 Recommendation

Sprint 1 should include:

- Phase 0 baseline
- Phase 1 shared UI slots
- Phase 2 video outline migration

Sprint 1 should not include:

- meeting notes migration
- Excel migration
- dynamic home group chips
- Hermes intent router
- permission gate refactor

Sprint 1 validation:

- Existing seven cards still visible.
- Video outline opens in unified workbench UI.
- Video outline still generates and downloads.
- Existing PPT / finance brief / client meeting / announcement tasks still work.
- Existing meeting notes and Excel pages still work unchanged.

# Document Workbench UI Contract

## 1. Why This Exists

Employee Agent is moving from isolated office tools toward a unified document task workbench.

The target product shape is not "one page per feature". It is one reusable Manus-like workbench that can host many document and workflow generation scenarios:

- financial market research brief
- client meeting preparation
- research-to-PPT
- Wind data reports
- industry weekly reports
- company research notes
- wealth management opportunity analysis
- board / leadership briefing packs
- future domain-specific document tasks

The workbench should make new scenarios cheap to add. A new business scenario should mainly add task template, profile chain, tools/MCP config, output artifact config, and examples. It should not require a new bespoke frontend page.

## 2. Product Principles

### 2.1 Task-First, Not Page-First

The core user object is a task run, not a chat page or personal agent.

```text
user request
  -> task template
  -> execution stages
  -> artifacts
  -> preview / download
  -> follow-up / revision
```

### 2.2 Chat Is the Entry and Control Surface

Chat-style input remains useful, but it is not the product core. It is the entry point for assigning tasks, asking follow-up questions, and revising generated artifacts.

The visible center of the product should be:

- what the user asked
- how the system decomposed it
- what each worker did
- what artifact was produced
- what can be previewed, downloaded, or revised

### 2.3 Artifacts Are the Product Currency

For enterprise users, the output matters more than the agent persona.

The UI must always make artifact state clear:

- draft content
- final document
- PPTX / DOCX / HTML / XLSX / PDF
- evidence package
- data snapshot
- version history
- whether the artifact is derived from a previous artifact

### 2.4 Low-Key Execution Transparency

The execution process should be visible but not noisy.

Use a compact timeline similar to Manus:

- thin vertical line
- small status dot
- stage title
- low-contrast progress chips
- expandable details
- right-side drawer for heavy details

Avoid large cards for every internal step. The process should reassure the user, not compete with the final content.

### 2.5 One Visual Language

All document-generation tasks should share the same visual grammar:

- warm white / light gray background
- centered working column
- bottom composer dock
- right preview panel
- rounded but restrained cards
- small typography
- muted timeline steps
- black/gray action buttons unless a real business accent is needed

Red should not dominate the UI. Use it mainly for selected task highlight, errors, or brand-specific accents.

## 3. UI Layout Contract

### 3.1 Idle State

The idle state is the entry screen before a task starts.

Required regions:

```text
top task header

center title
composer
example prompt cards
optional task-specific input extensions
```

Rules:

- content column max width: around 760px
- title can use a refined serif style where appropriate
- composer max width: around 720-760px
- example prompts are rectangular cards, not heavy marketing cards
- task selection chip can appear inside composer, but only in idle state

### 3.2 Running State

After submission, the workbench becomes a task timeline.

Required regions:

```text
user prompt bubble
orchestrator / task understanding
worker timeline
artifact card / inline preview
bottom composer dock
optional right preview panel
```

Rules:

- timeline starts above the composer dock, not underneath it
- bottom dock must reserve vertical space so output is not hidden
- process steps should be expandable
- only active / completed meaningful stages are shown
- waiting stages are hidden in compact office mode unless needed

### 3.3 Preview State

When a preview is open, the page uses a two-column layout.

```text
left: conversation / timeline
gap: 20px
right: preview panel
```

Rules:

- preview panel must not cover the top nav
- preview panel bottom should visually align with bottom composer area
- left column and composer shrink together
- right panel is a rounded white card, not a hard split-pane
- preview background should match the main workbench background family

### 3.4 Composer Contract

The composer is shared across all document tasks.

Required behavior:

- idle placeholder: "分配一个任务或提问任何问题" or task-specific short placeholder
- running placeholder: blank or very short
- empty state send button: gray disabled
- active state send button: near-black circle
- plus button left side
- voice / mic icons right side
- selected task chip only before first submission
- attachments rendered as small chips

The composer must be implemented once and reused.

## 4. Component Boundaries

The current `TaskWorkbenchLab.tsx` mixes rendering, protocol, state, and task configuration. The target boundary is:

```text
client/src/components/document-workbench/
  types.ts
  taskConfig.ts
  DocumentTaskWorkbench.tsx
  DocumentTaskLayout.tsx
  DocumentComposer.tsx
  DocumentTimeline.tsx
  DocumentStageItem.tsx
  DocumentArtifactCard.tsx
  DocumentPreviewPanel.tsx
  DocumentHistoryDrawer.tsx
  markdown.tsx
```

### 4.1 Keep Logic Thin at First

Phase 1 should extract UI components only.

Do not rewrite:

- routing API
- run-stream API
- remote harness mapping
- artifact storage
- generated artifact preview endpoint
- Hermes profile execution

### 4.2 Move Task-Specific Text to Config

Move this class of data out of `TaskWorkbenchLab.tsx`:

- display names
- placeholders
- quick prompts
- persona labels
- role descriptions
- task icons
- artifact display policy

Target:

```ts
type DocumentTaskConfig = {
  templateId: string;
  displayName: string;
  category: "office" | "finance" | "data" | "presentation";
  icon: string;
  placeholder: string;
  quickPrompts: string[];
  roles: Record<string, DocumentRoleConfig>;
  artifactPolicy: DocumentArtifactPolicy;
};
```

### 4.3 Role Must Be Explicit

Avoid guessing role from profile names like `comps`, `spread`, or `writer`.

Preferred stage metadata:

```json
{
  "stageId": "source_research",
  "role": "reader",
  "profile": "market-sector-reader",
  "displayName": "检索员",
  "outputMode": "evidence"
}
```

Supported role/output modes:

- `reader` -> evidence/search summary
- `analyst` -> analysis summary
- `writer` -> final draft
- `renderer` -> generated artifact
- `reviewer` -> validation report

## 5. Task Run Model

### 5.1 Current Model

Current workbench is close to:

```text
one prompt -> one task run -> one artifact set
```

This is enough for financial brief and meeting prep V1.

### 5.2 Required Follow-Up Model

For interactive financial questions and document revision, the model should become:

```text
thread
  messages[]
  taskRuns[]
  artifactVersions[]
```

Example:

```text
User: 洞察近期金融 AI 应用趋势
Run 1: create brief v1
Artifact: brief.v1.docx

User: 把监管部分展开，加入万得数据
Run 2: revise brief v2 using v1 + Wind data
Artifact: brief.v2.docx
```

The UI should support this without a redesign:

- user follow-up appears as another user bubble
- orchestrator stage appears again
- only changed worker stages are appended
- artifact card shows new version
- previous artifact remains accessible in history/version list

## 6. PPT Direction

### 6.1 New PPT Flow

PPT should join the same document workbench, not remain a separate page forever.

Recommended flow:

```text
OpenClaw research PPT agent
  -> search public/web sources, synthesize evidence and logic, produce Markdown outline + PPT_BLUEPRINT_JSON

ppt-template-renderer
  -> render PPTX using uploaded/default template

ppt-quality-reviewer
  -> validate slide count, title anchors, key messages, citations
```

### 6.2 Runtime Choice

OpenClaw is the default PPT content runtime. Hermes PPT profiles are optional experiments only; they must not be required for the production PPT flow until Hermes web-tool execution is stable.

### 6.3 What Existing PPT Generator Should Do

Existing `PptCreatePage` / `office-ppt-create` capabilities should become the renderer layer:

- template upload
- built-in Huawei light template
- PPTX generation from `PPT_BLUEPRINT_JSON`
- editable/downloadable output

The standalone `PptCreatePage` can remain temporarily, but new PPT task UX should be based on Document Workbench.

## 7. Wind Data Scenarios

Wind-based scenarios should not create bespoke pages.

They should be task templates with MCP/tool configuration.

Examples:

- `wind-industry-weekly`
- `wind-company-brief`
- `wind-market-dashboard-note`
- `wind-wealth-opportunity-brief`
- `wind-research-ppt`

Each template defines:

- required data source / MCP tool
- reader role: fetch structured data
- analyst role: interpret data
- writer role: generate document
- renderer role: optional DOCX/PPTX/XLSX export
- reviewer role: data freshness and source validation

## 8. Implementation Phases

### Phase 0: Stabilize Current UI

Goal: preserve current financial brief and meeting prep behavior.

Tasks:

- keep `TaskWorkbenchLab` as source of truth
- avoid large logic rewrites
- document current compact office mode behavior
- keep health/build checks green

Exit criteria:

- financial market research brief still runs
- meeting prep still runs
- current preview panel and composer behavior unchanged

### Phase 1: Extract Thin UI Components

Goal: create reusable components while preserving behavior.

Extract:

- composer
- idle prompt cards
- task header
- user prompt bubble
- timeline stage item
- artifact card
- preview panel shell

Do not extract:

- run-stream state machine
- routePrompt logic
- generated artifact endpoint logic
- harness response mapping

Exit criteria:

- `TaskWorkbenchLab` uses shared components
- financial brief and meeting prep render the same as before
- no API behavior changes
- `pnpm run check` and build pass

### Phase 2: Rename and Formalize Workbench

Goal: stop treating it as a lab.

Tasks:

- introduce `DocumentTaskWorkbench`
- keep `TaskWorkbenchLab` as compatibility wrapper if needed
- move task display config into `taskConfig.ts`
- define role/output mode mapping explicitly

Exit criteria:

- OfficeSpacePage uses `DocumentTaskWorkbench` for financial brief and meeting prep
- old imports still work or are cleanly migrated

### Phase 3: Add PPT Workbench Flow

Goal: make PPT a document task.

PPT must not remain a standalone "enter a topic and directly emit PPTX" island. It should use the same Manus-like document task shape as financial brief and meeting preparation:

```text
user topic/materials
  -> OpenClaw research PPT agent
  -> ppt-template-renderer
  -> ppt-quality-checker
  -> artifacts: outline.md, blueprint.json, preview.html, deck.pptx, quality-report.md
```

Tasks:

- add task template `research_ppt`
- use OpenClaw for the research/outline stage by default
- connect `ppt-template-renderer` to the existing `server/_core/office-ppt.ts` PPTX generation capability
- add first-pass code validation as `ppt-quality-checker`; a Hermes reviewer can be added later if needed

Role responsibilities:

- OpenClaw research PPT agent: search and collect source-grounded evidence when needed, produce the storyline, key claims, risks, page-level logic, human-readable Markdown outline, and strict `PPT_BLUEPRINT_JSON`. It is the content write holder for the deck plan, not the file generator.
- `ppt-template-renderer`: render `PPT_BLUEPRINT_JSON` into PPTX using selected template/default Huawei template. This should be deterministic backend code, reusing current PPT generation logic.
- `ppt-quality-checker`: verify page count, title alignment, key-message coverage, downloadable artifacts, and obvious blueprint/render mismatches.

The previous PPT chain is legacy:

- `ai_topic_insight_ppt`
- `wenzhou-source-research`
- `task-my-wealth` as PPT analyst
- `task-ppt` as direct PPT writer/generator
- standalone `PptCreatePage`

Do not keep extending this legacy chain. It may remain temporarily during migration, but the product entry should move to `DocumentTaskWorkbench`.

Exit criteria:

- user enters topic
- UI shows search -> analysis -> outline -> PPTX render -> validation
- final artifact includes PPTX and preview
- blueprint and final PPT are compared
- old PPT entry is no longer the default product path

Cleanup criteria after the new PPT path is stable:

- `OfficeSpacePage` PPT entry uses `DocumentTaskWorkbench` with `research_ppt`.
- router no longer maps PPT requests to `ai_topic_insight_ppt`.
- `task-templates.seed.json` no longer exposes `ai_topic_insight_ppt` to the office workbench.
- PPT chain no longer references `wenzhou-source-research`, `task-my-wealth`, or `task-ppt`.
- standalone `PptCreatePage` is removed or explicitly marked legacy/internal.
- `TaskWorkbenchLab` compatibility page and `/task-workbench-lab` route are removed or redirected.
- unused Hermes profiles, ports, endpoint env vars, manifests, and seed references are deleted after confirming no running process depends on them.

### Phase 4: Follow-Up and Revision

Goal: support interactive document refinement.

Tasks:

- introduce task thread model
- persist message list
- support follow-up run with previous artifacts as context
- display artifact versions
- allow user to revise output from composer

Exit criteria:

- user can ask "把监管部分展开"
- system creates v2 artifact without losing v1
- UI timeline appends revision stages instead of replacing everything

### Phase 5: Wind/MCP Scenario Expansion

Goal: add many business scenes without new pages.

Tasks:

- add Wind data task templates
- add MCP capability policy per template/profile
- add data freshness display
- add source/data validation reviewer
- add chart/table artifact rendering rules

Exit criteria:

- new Wind scenario only needs config + backend chain
- no new bespoke frontend page

## 9. Risks and Guardrails

### 9.1 Do Not Over-Abstract Too Early

Extract UI first. Do not rewrite the execution engine and UI at the same time.

### 9.2 Preserve Compact Office Mode

The current compact Manus-like mode is the baseline. Any refactor must screenshot-check:

- idle state
- running state
- preview-open state
- completed artifact state

### 9.3 Keep Preview and Composer Coupled

When preview opens:

- timeline column shrinks
- composer shrinks with the timeline
- preview panel does not cover content
- bottom dock keeps output visible

### 9.4 Avoid Per-Scenario CSS

New tasks should configure text and artifacts, not define their own layout.

### 9.5 Keep Source/Evidence Details in Drawers

Heavy details such as search plans, sources, data rows, and evidence packages should open in right-side drawers. The main timeline should show summaries.

### 9.6 Do Not Leave Long-Term Legacy Entrypoints

Temporary compatibility is acceptable during migration, but every legacy path must have a deletion condition. In particular:

- `TaskWorkbenchLab` is a temporary compatibility name. The durable product component is `DocumentTaskWorkbench`.
- The legacy PPT path must not coexist indefinitely with `research_ppt`.
- Old Hermes profile names should not remain as hidden aliases once the new profiles are deployed and verified.
- Keeping stale routes, pages, and profile refs increases operational risk because future work may accidentally bind to the wrong runtime.

## 10. Engineering Checklist for New Document Task

When adding a new task scenario:

1. Add task template id and display config.
2. Define roles and profiles.
3. Define prompt examples.
4. Define artifact policy.
5. Define preview behavior.
6. Define evidence/data detail drawer schema.
7. Define follow-up behavior if needed.
8. Add smoke prompt.
9. Run type check and build.
10. Verify UI states with screenshots.

## 11. Recommended Next Steps

Immediate next step:

1. Extract UI-only components from `TaskWorkbenchLab`.
2. Keep financial brief and meeting prep behavior unchanged.
3. Rename the extracted shell toward `DocumentTaskWorkbench`.
4. Then build the new PPT flow on top of it.

This order keeps risk low and prevents the PPT rebuild from creating a second nearly identical UI.

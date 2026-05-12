# Agent Task Workbench Product Spec - V1

Date: 2026-05-03
Status: Draft for V1 design review.
Related:
- `AGENT_REGISTRY_AND_CLUSTER_CONTRACT.md`
- `AGENT_REGISTRY_AND_CLUSTER_CONTRACT_TASK_PATCH.md`
- `AGENT_PERSONA_REGISTRY.md`

## 1. Product Positioning

The user-facing product is `任务工作台`, not `智能体集群`.

Users do not come to the page to "run agents". They come to complete business tasks:

- write a presentation,
- research a stock,
- refactor code,
- later: prepare due diligence, compliance review, weekly research reports.

The product promise:

> 选一个任务，灵虾帮你组织 AI 专员协作完成，并把过程、来源、结果和产物保存下来。

## 2. V1 Principle

V1 must be honest.

V1 only exposes capabilities that have passed Agent Cluster Lab validation on the new cluster path. V1 does not fake a multi-agent chain by calling the same agent multiple times under different names.

This means V1 tasks are allowed to be single-stage. The first product goal is to make the task experience, compliance boundary, artifact rendering, and run history feel banking-grade. True multi-stage collaboration is a V1.1 goal after each backing stage has a real validated provider.

## 3. V1 Tasks

| Task | User-facing Goal | Persona | Backing Agent | Stage Count | Status |
|---|---|---|---|---:|---|
| PPT 汇报写作 | Turn a topic or rough material into a structured presentation draft | 简页 (AI) · PPT 制作师 | `task-ppt` | 1 | V1 |
| 股票数据研究 | Explain stock data, indicators, risks, and research material without giving investment advice | 衡岳 (AI) · 股票数据研究员 | `task-stock` | 1 | V1 |
| 程序开发 / 代码改造 | Help analyze code, draft implementation plans, and produce code changes that require human review | 青栈 (AI) · 代码工程师 | `task-code` | 1 | V1 |

### 3.1 V1 Exclusions

These are deliberately out of V1:

- `task-trace` based trend research: current production status is degraded and it has not passed cluster lab validation.
- `task-credit-risk` / `task-claim-ev` / `task-bond`: Hermes tunnel-backed banking-native agents need tunnel HA and cluster lab validation before customer-facing use.
- Multi-stage PPT workflow: V1.1 target, not V1.
- User-generated task chains: V2 target.
- LLM planner auto-selecting agents: V1.5 target, behind `AGENT_PLANNER_ENABLED=false` default.

## 4. V1.1 North Star

The target experience for a real multi-stage task looks like this:

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

This is not a V1 implementation promise. It is the V1.1 design direction after the following are true:

- each persona maps to a real validated backing agent,
- each stage emits normalized progress events,
- citations propagate across stages,
- final artifact rendering can show footnotes and source tracebacks,
- failures can be isolated per stage.

## 5. Page Layout

V1 layout should avoid the current "quick task stuck in bottom-left" feel. The page should be organized around the user's task.

Recommended layout:

```text
┌──────────────────────────────────────────────────────────────┐
│ 任务工作台                                                     │
│ 选一个任务，灵虾帮你组织 AI 专员完成。                         │
├──────────────┬─────────────────────────┬─────────────────────┤
│ 任务模板      │ 当前任务                 │ 结果与产物             │
│              │                         │                     │
│ PPT 汇报写作  │ 简页 (AI) 正在处理...     │ PPT / Markdown 预览    │
│ 股票数据研究  │ 进度、事件、错误、引用      │ 下载 / 保存到工作区     │
│ 代码改造      │                         │                     │
├──────────────┴─────────────────────────┴─────────────────────┤
│ 我的历史记录：时间 / 任务 / 状态 / 产物数量 / 继续查看            │
└──────────────────────────────────────────────────────────────┘
```

### 5.1 Left Panel: Task Templates

The left panel lists tasks, not agents.

Each task card shows:

- task name,
- one-sentence outcome,
- estimated duration,
- output types,
- required disclaimers,
- involved AI specialist names.

Do not show technical terms like `cluster`, `agentDefinitionId`, provider, runtime, or endpoint in the user UI.

### 5.2 Center Panel: Run Process

V1 single-stage tasks still show process state:

- queued,
- running,
- tool activity if available,
- completed,
- failed,
- cancelled.

V1.1 multi-stage tasks show stage-by-stage progress. A stage can be waiting, running, completed, failed, skipped, or retried.

### 5.3 Right Panel: Results And Artifacts

The right panel renders final output by artifact type, not by agent id.

V1 renderers:

- `markdown_report`,
- `ppt_preview`,
- `code_workspace`,
- `file_download`,
- `citation_panel`,
- disclaimer footer.

Do not add `stock_analysis_report`, `tool_trace`, or `citation_summary` as artifact types. Stock research is a markdown report plus metadata. Tool trace is process UI. Citation summary is already covered by summary/citation schema.

### 5.4 History

The workbench must include run history, even if V1 starts simple.

History row fields:

- startedAt,
- taskTemplateName,
- status,
- artifactCount,
- persona list,
- clusterRunId,
- "open result" action.

History is not just convenience. It is the user-facing side of auditability.

## 6. Persona Rules

Each AI specialist must be explicit about being AI:

- display as `简页 (AI) · PPT 制作师`, not just `简页`;
- hover text includes `AI 助手 · 由灵虾提供`;
- no real people, celebrity names, customer employee names, or human face avatars;
- first entry shows the notice: `以下专员均为 AI 助手，输出内容需结合自身判断。`

## 7. Compliance And Disclaimers

Every task includes `ai_generated_label`.

Additional required disclaimers:

| Task | Disclaimers |
|---|---|
| PPT 汇报写作 | `fact_check_required` |
| 股票数据研究 | `investment_advisory`, `fact_check_required` |
| 程序开发 / 代码改造 | `code_review_required` |

Renderer owns disclaimer insertion. Agents cannot remove or rewrite disclaimer language.

For stock and wealth content:

- task name must use `数据研究`, `材料整理`, or `风险说明` language;
- avoid `投资建议`, `选股建议`, `买入推荐`, `卖出推荐`;
- output must not include target price, guaranteed return, position sizing, or direct buy/sell instruction.

## 8. Event Model

V1 should not invent a large new event taxonomy.

Cluster layer events:

- `cluster_run_started`,
- `cluster_agent_started`,
- `cluster_agent_done`,
- `cluster_run_done`.

Agent-internal events should reuse existing normalized OpenClaw/Lingxia events where possible:

- tool call,
- tool result,
- lifecycle,
- final answer,
- artifact created.

The UI can display friendly dynamic messages, but the backend protocol should stay small.

## 9. Memory Boundary

Task workbench runs are stateless by default.

Allowed persistence:

- task input,
- selected task template,
- selected personas,
- normalized run result,
- artifacts,
- citations,
- audit metadata,
- user explicitly saved workspace files.

Not allowed in V1:

- silently saving personal long-term memory from task runs,
- giving every remote agent persistent personal context,
- letting one user's run influence another user's run,
- auto-importing artifacts into the user's main workspace.

If the user wants a durable personal assistant memory, that belongs to the personal assistant / main chat domain, not task workbench execution.

Intra-run cross-stage state propagation via upstream citations and artifact references is required behavior, not memory. The boundary above forbids cross-run state, not within-run stage handoff.

## 10. Acceptance Criteria

V1 is acceptable when:

- task list shows only V1 validated tasks,
- each persona has `(AI)` in the visible label,
- running a task creates a durable run history item,
- result panel renders by artifact type,
- stock task refuses direct buy/sell advice,
- code task includes code review disclaimer,
- PPT task includes fact-check disclaimer,
- response payload and UI do not expose token, endpoint, tunnel, provider secret, or internal migration notes,
- the existing Agent Plaza and main chat behavior remain unchanged unless explicitly switched by feature flag,
- disclaimer text has one explicit legal/compliance sign-off before customer demo,
- latency targets are tracked against template estimates: PPT P95 <= 90s, stock research P95 <= 60s, code work P95 <= 120s, with any breach recorded as a launch-blocking performance review item,
- run audit metadata is retained according to deployment compliance policy; banking deployments default to 7 years for audit metadata, independent of artifact-byte retention.

## 11. Implementation Order

1. Keep the current admin lab UI as validation harness.
2. Implement `task_templates` schema and deterministic runner mapping.
3. Add user-facing task workbench UI with V1 three tasks.
4. Add run history and artifact rendering.
5. Add V1.1 candidate validation for `task-trace`, `task-credit-risk`, and a real reviewer agent.
6. Only after that, introduce multi-stage templates such as AI trend insight PPT writing.

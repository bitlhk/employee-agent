# Task Template Runner Design

Date: 2026-05-03
Status: Draft for V1 implementation.
Related:
- `AGENT_TASK_WORKBENCH_PRODUCT_SPEC_v1.md`
- `TASK_TEMPLATE_SCHEMA.md`
- `AGENT_REGISTRY_AND_CLUSTER_CONTRACT_TASK_PATCH.md`

## 1. Goal

`TaskTemplateRunner` is the deterministic workflow layer for the user-facing task workbench.

It translates a task template into one or more calls to the lower-level `AgentClusterRunner`, then normalizes stage results into task-run history, artifact records, citations, and renderer-ready output.

The design goal is to keep responsibilities clean:

- `AgentClusterRunner` runs selected agent definitions and returns normalized envelopes.
- `TaskTemplateRunner` understands task templates, stage order, input mapping, failure policy, disclaimers, and run history.

Do not push task-template workflow logic into `AgentClusterRunner`.

## 2. Layering

```text
User Task UI
  ↓
TaskTemplateRunner
  - loads active task template
  - validates template version
  - resolves persona → agentDefinitionId
  - builds stage inputs
  - executes stages in deterministic order
  - merges citations
  - writes task run history
  ↓
AgentClusterRunner
  - validates agent visibility
  - resolves provider bindings
  - dispatches agents
  - returns AgentRunResult envelopes
  ↓
ProviderAdapter
  - Hermes / Claude Code / Lingxia local / future A2A
```

## 3. Why Not Put This In AgentClusterRunner

`AgentClusterRunner` already has a clear meaning: execute one selection of agents and return normalized envelopes.

Task templates add a different abstraction:

- stage order,
- stage-level input mapping,
- stage-level retry / failure policy,
- template versioning,
- disclaimer policy,
- artifact whitelist,
- history row,
- user-facing task identity.

Mixing these into `AgentClusterRunner` would make it both a low-level dispatcher and a workflow engine. That is the exact kind of dual-purpose module that becomes hard to reason about during banking audits.

## 4. V1 Execution Model

V1 templates are single-stage. The V1 path still goes through `TaskTemplateRunner` so V1.1 can add multi-stage templates without changing the UI contract.

V1 sequence:

```text
runTaskTemplate(templateId, userInput, viewer)
  1. load active template
  2. assert template has one validated V1 stage
  3. build stage input from original user input
  4. call AgentClusterRunner.runCluster with one agentDefinitionId
  5. validate returned artifacts against template outputPolicy
  6. append required disclaimers
  7. persist task run history
  8. return renderer-ready task result
```

This may look like an extra layer for V1, but it prevents UI and history code from binding directly to low-level agent dispatch.

## 5. V1.1 Multi-Stage Execution

V1.1 deterministic templates can execute stages in a static sequence.

V1.1 sequence:

```text
for each stage in template.stages:
  1. resolve stage input via inputMapping
  2. call AgentClusterRunner.runCluster for stage agent(s)
  3. store stage envelope
  4. merge ownCitations + upstreamCitations
  5. apply onFailure policy
  6. continue or stop
```

Stage composition cannot change at runtime. No stage can dynamically add agents, replace agents, or invoke planner output.

## 6. Interfaces

```ts
type RunTaskTemplateInput = {
  taskTemplateId: string;
  taskTemplateVersion?: number;
  viewerUserId: number;
  adoptId?: string;
  input: string;
};

type TaskTemplateRunResult = {
  ok: true;
  value: {
    taskRunId: string;
    taskTemplateId: string;
    taskTemplateVersion: number;
    status: "completed" | "partial_success" | "failed" | "cancelled" | "timeout";
    stageResults: TaskStageRunResult[];
    artifacts: AgentArtifact[];
    citations: AgentCitation[];
    disclaimers: DisclaimerKind[];
    startedAt: string;
    completedAt?: string;
  };
} | {
  ok: false;
  error: {
    kind:
      | "template_not_found"
      | "template_inactive"
      | "template_validation_failed"
      | "agent_not_visible"
      | "stage_failed"
      | "artifact_rejected"
      | "not_implemented";
    detail: string;
  };
};

type TaskStageRunResult = {
  stageId: string;
  personaId: string;
  agentDefinitionId: string;
  status: "completed" | "failed" | "skipped" | "timeout";
  runResultId?: string;
  output?: string;
  artifacts: AgentArtifact[];
  ownCitations: AgentCitation[];
  upstreamCitations: AgentCitation[];
  startedAt: string;
  completedAt?: string;
};
```

## 7. Input Mapping

`TaskTemplateRunner` owns `inputMapping` resolution.

Supported V1/V1.1 sources:

- original user input,
- prior stage output,
- prior stage artifacts,
- prior stage citations.

Rules:

- V1 uses `{ original: true }` only.
- V1.1 can combine original input with selected upstream stage outputs.
- The runner, not the agent, decides what upstream content is passed.
- The runner must not pass raw binary artifact bytes into LLM prompts.
- The runner may pass artifact metadata, summaries, citations, and signed preview references where allowed by the renderer contract.

## 8. Failure Policy

Stage-level `onFailure` controls deterministic flow:

| Policy | Behavior |
|---|---|
| `stop` | Stop task immediately and mark task failed. |
| `continue` | Continue next stage and mark failed stage in history. |
| `partial_success` | Continue where possible; final task may be partial_success. |
| `retry_once_then_stop` | Retry the failed stage once, then stop if it fails again. |

V1 recommendation:

- PPT: `retry_once_then_stop`
- Stock research: `retry_once_then_stop`
- Code work: `retry_once_then_stop`

Retry must not duplicate user-visible artifacts. A retried stage either replaces the failed attempt result or records the failed attempt as internal diagnostics only.

## 9. Artifact Validation

After each stage, the runner validates artifacts against `outputPolicy.allowedArtifactTypes`.

Rules:

- unknown artifact type -> reject artifact and mark stage failed with `artifact_rejected`;
- missing required downloadUrl -> reject artifact;
- `code_workspace` artifacts must include language / workspace metadata when applicable;
- renderer-only elements such as tool traces are not artifacts;
- no token, provider endpoint, tunnel URL, authRef, or migration note can be serialized into task result payload.

## 10. Disclaimer Handling

`TaskTemplateRunner` normalizes disclaimers before returning renderer-ready output.

Rules:

- `ai_generated_label` is always present;
- task-specific disclaimers come from template output policy;
- agents cannot remove disclaimers;
- renderer receives disclaimers as structured kinds, not free text;
- the final renderer maps each kind to signed-off Chinese copy.

## 11. Citation Handling

The runner is responsible for citation propagation.

Rules:

- each stage result can introduce `ownCitations`;
- runner merges upstream citations from referenced stages;
- duplicate citations are deduped by stable id or URL + excerpt hash;
- final task result exposes the merged citation list;
- excerpts must remain short and should not reproduce long copyrighted text.

For V1 single-stage tasks, `upstreamCitations` may be empty. This is valid.

## 12. History Persistence

V1 should not rely on transient in-memory run state for customer demos.

Minimum persisted task run fields:

- taskRunId,
- userId,
- taskTemplateId,
- taskTemplateVersion,
- taskTemplateName,
- chainHash,
- input,
- status,
- stageSnapshots,
- artifactCount,
- startedAt,
- completedAt,
- errorSummary,
- auditMetadata.

Banking deployments default to 7-year retention for audit metadata. Artifact bytes can follow the artifact retention policy, but the audit row must survive artifact GC.

## 13. Relation To Existing Lab UI

The current admin cluster lab UI remains a validation harness.

It is not the customer-facing task workbench.

Implementation should not keep polishing the lab UI into the product UI. Build the task workbench as a new user-facing page or module that consumes `TaskTemplateRunner` results.

## 14. Implementation Order

1. Add shared task-template types and zod schemas.
2. Add JSON-backed V1 templates for the three validated tasks.
3. Implement `TaskTemplateRunner` with single-stage support.
4. Persist task run history.
5. Normalize artifacts and disclaimers for renderer.
6. Build user-facing task workbench UI.
7. Add V1.1 multi-stage support after candidate agents pass cluster lab validation.

## 15. Non-Goals For V1

- LLM planner selecting agents.
- User-edited task chains.
- N-stage customer-facing templates.
- Auto-saving artifacts to user workspace.
- Persistent personal memory per remote agent.
- Cross-run context carryover.
- Per-agent custom frontend components.
- Replacing Agent Plaza or main chat routing.

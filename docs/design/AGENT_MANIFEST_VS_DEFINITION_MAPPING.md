# Agent Manifest vs Agent Definition Mapping

Date: 2026-05-10
Scope: Lingxia Agent Registry, Task Workbench, and Financial Agent Harness.

## Why This Exists

Lingxia now has two related but different agent contracts:

- `AgentDefinition`: the product-facing capability card users and admins see.
- `AgentManifest`: the runtime-facing execution contract for multi-worker financial harness tasks.

They are intentionally layered, not competing systems.

## Layering

```text
User / Admin UI
  -> AgentDefinition
  -> Task Template
  -> AgentManifest
  -> Runtime Profiles
  -> OpenClaw / Hermes / Claude Code / HTTP provider
```

## AgentDefinition

`AgentDefinition` answers product questions: what capability is visible, who can
use it, whether it is enabled and healthy, which provider it calls, and what UI
card users see.

Examples:

- `task-ppt`
- `task-bond`
- `market-sector-reader`
- `market-note-writer`

Use it for visibility, product configuration, admin enablement, routing,
provider selection, and user-facing metadata.

## AgentManifest

`AgentManifest` answers runtime safety questions: which worker profiles
participate, which worker may read untrusted input, access MCP/search/data tools,
write files, receive Anthropic runtime skills, or validate schemas before
downstream consumption.

Examples:

- `market_researcher`
- `meeting_prep_agent`

Use it for worker orchestration, runtime skill injection, MCP/tool permissions,
trust boundaries, schema validation, and write-holder control.

## Relationship

An `AgentManifest` references `AgentDefinition` ids through:

- `orchestrator.agentDefinitionId`
- `workers[].agentDefinitionId`

So a manifest does not replace definitions. It composes existing definitions
into a controlled multi-worker execution plan.

## Financial Harness Position

Financial Agent Harness is a V1.1 implementation path for multi-stage financial
tasks, not a separate product surface. The current product entry is Task
Workbench Lab. Current pilot manifests are `market_researcher` and
`meeting_prep_agent`.

The old V1 task templates remain valid for simpler workflows. Harness should be
used when a task needs explicit Reader / Analyst / Writer separation, per-worker
tool boundaries, schema validation, and auditable runtime skill injection.

## Rule Of Thumb

Use `AgentDefinition` for "what capability exists?"
Use `TaskTemplate` for "what user workflow should run?"
Use `AgentManifest` for "how specialized runtime workers execute it safely?"
Use runtime profiles for "where does this worker actually run?"

## Non-Goals

`AgentManifest` is not the Lingxia SkillHub contract.

`AgentManifest` is not a user-visible marketplace object.

`AgentManifest` should not contain production credentials, raw API keys, or
customer data.

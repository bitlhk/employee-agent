# SwarmFlow UI Design

SwarmFlow is an execution and orchestration signal from jiuwenswarm. It is not a
permission system. Role-based Skill/MCP authorization remains owned by
`role_asset_grants` and MCP service-side data checks.

## Current State

EA already promotes jiuwenswarm `workflow.updated` payloads into first-class chat
events:

```ts
{
  type: "workflow.updated",
  phase?: string,
  status?: string,
  agentId?: string,
  workflowId?: string,
  runId?: string,
  message?: string,
  data?: Record<string, unknown>
}
```

This means the transport and parser layer is ready. The missing piece is a
dedicated front-end presentation.

## MVP Display

Show SwarmFlow progress inside the current assistant message as a compact
workflow strip:

| Element | Behavior |
|---|---|
| Workflow header | Displays current workflow name or `workflowId`, plus global status |
| Stage list | One row per `phase`; statuses: pending / running / completed / failed |
| Active agent | Shows `agentId` when present, e.g. analyst / researcher / writer |
| Status text | Shows `message` as the latest progress line |
| Collapse | Completed workflow can collapse into a one-line summary |

The UI should not create a new page for MVP. It should live in the chat stream,
near tool cards and reasoning blocks, because the user is watching one answer
being produced.

## Event Handling Rules

- Group events by `runId` first, then `workflowId`.
- If `phase` repeats, update the existing row instead of appending duplicates.
- If `status` is missing, infer `running` when a message arrives.
- Unknown fields stay in `data` for debugging but are not rendered by default.
- Failed phases stay visible and should not be hidden behind a collapsed state.

## Future Enhancements

- Parallel branch view for multi-agent workflows.
- Time spent per phase and per agent.
- Click-through to raw event JSON for admin/debug users.
- Mapping common SwarmFlow templates to business labels, such as research,
  risk review, product matching, draft writing, and final QA.

## JiuwenSwarm Team Mode And EA Collaboration

JiuwenSwarm has a native team mode (`team` / `code.team`) and emits team/workflow
events such as `team.member`, `team.task`, `team.message`, and
`workflow.updated`. This is useful for one user delegating a complex task to a
runtime-managed group of specialist agents.

It should not be treated as a direct replacement for EA collaboration yet:

| Capability | JiuwenSwarm team mode | EA collaboration |
|---|---|---|
| Primary purpose | Multi-agent execution inside one runtime task | Multi-user sharing, permissions, sessions, and workspace collaboration |
| Identity boundary | Runtime agents / team members | Real platform users and adopted child Agents |
| Best first use | Show structured task progress and specialist-agent outputs in chat | Keep existing user-facing sharing and access control |
| Risk if merged too early | Confuses runtime team members with real users | Makes collaboration harder to reason about |

Recommended path:

1. Keep EA collaboration as the user/session permission layer for now.
2. Surface jiuwenswarm team mode as a chat-level execution view: specialists,
   phases, messages, and final result.
3. After this is stable, consider a simplified EA collaboration model where
   users share a conversation/task, while jiuwenswarm team mode handles the
   internal execution graph.

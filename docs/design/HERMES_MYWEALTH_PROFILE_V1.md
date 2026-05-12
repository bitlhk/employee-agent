# Hermes Mywealth Profile v1

## Goal

`task-my-wealth` should be the first Hermes Profile Agent trial in Agent Cluster Lab.

It is not a production-grade financial advisor. It is a governed explanation
assistant for wealth-management concepts, asset allocation education, customer
communication drafts, and document interpretation.

## Positioning

Use this profile to validate whether Hermes can become a reusable enterprise
Profile runtime:

- one Hermes runtime;
- multiple named profiles;
- each profile has its own SOUL / memory policy / allowed skills;
- Lingxia selects the profile through Agent Definition metadata;
- cluster runs remain task-scoped and auditable.

## Current AWS State

- Profile name: `mywealth`
- Path: `/home/ubuntu/.hermes/profiles/mywealth`
- Source: cloned from default profile
- Gateway: stopped
- SOUL / USER / MEMORY: replaced on 2026-05-03 with a conservative
  wealth-explanation profile
- Original files backup:
  `/home/ubuntu/.hermes/profile-backups/mywealth-20260503-075300`

The first one-shot validation with:

```bash
HERMES_HOME=/home/ubuntu/.hermes/profiles/mywealth hermes -z "..."
```

was blocked because the isolated profile has no Codex credential.

Do not copy credentials from the default profile. Authenticate this profile
explicitly if/when we decide to start routing traffic:

```bash
HERMES_HOME=/home/ubuntu/.hermes/profiles/mywealth \
  /home/ubuntu/.local/bin/hermes auth add openai-codex --no-browser

HERMES_HOME=/home/ubuntu/.hermes/profiles/mywealth \
  /home/ubuntu/.local/bin/hermes auth status openai-codex
```

## Hard Product Boundary

Allowed:

- explain asset allocation concepts;
- compare broad asset-class risk/return/liquidity characteristics;
- summarize product or report documents provided by users;
- draft neutral customer education material;
- list questions to ask a qualified advisor;
- explain risk tolerance, time horizon, fees, and diversification;
- produce training / communication outlines.

Not allowed:

- recommend buying/selling/holding specific securities or products;
- provide target prices, stop-loss, position sizes, or guaranteed returns;
- decide product suitability for a named person;
- execute trades or guide transaction execution;
- invent current market/product data;
- store sensitive personal financial information as memory.

## Cluster Memory Rule

For Agent Cluster Lab, `mywealth` must be treated as task-scoped.

It should not rely on hidden long-term memory. Follow-up runs should receive
explicit parent-run summaries, selected artifacts, or user-provided context from
Lingxia.

Long-term memory belongs to the personal assistant layer only, where users can
inspect and manage it.

## Graduation Criteria

Before exposing this profile beyond lab:

1. Profile has its own Codex auth and gateway strategy.
2. One-shot test passes with safe refusal for "should I buy X stock?".
3. Agent Cluster Lab test passes through `task-my-wealth`.
4. 10-question evaluation set passes:
   - 4 normal explanation questions;
   - 2 product-document interpretation questions;
   - 2 unsafe investment-advice questions;
   - 1 missing-data freshness question;
   - 1 personal-data memory boundary question.
5. Output remains concise and does not drift into generic "team knowledge hub"
   identity.

## Decision

Keep `task-my-wealth` in the Agent Cluster MVP set as a Hermes Profile Agent
trial, but do not represent it as a mature professional financial advisor.

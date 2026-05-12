# AI Topic Insight PPT Chain Contract

Date: 2026-05-04
Status: Draft for V1 implementation.

## Goal

Support user requests such as:

- "Sequoia AI Ascent 2026 有哪些值得银行关注的观点？生成汇报 PPT。"
- "Mythos 最新模型对金融机构安全有什么影响？生成 PPT。"
- "Hermes 和 OpenClaw 的区别，做一份内部技术汇报。"

This is a topic-driven insight workflow, not a generic news digest.

## V1 Chain

```text
User topic / links
  -> Wenzhou Source Research Step
  -> Moheng Research Reviewer
  -> Jianye PPT Generator
```

### Stage 1: Wenzhou Source Research Step

Implementation shape: backend service step, not an external Hermes/OpenClaw agent in V1.

Responsibilities:

- Search targeted sources with Tavily + Bocha.
- Use Brave as fallback / broad web search.
- Read user-provided URLs if present.
- Deduplicate URLs.
- Prefer official sources, primary posts, transcripts, company blogs, reputable media, and analyst commentary.
- Return an evidence package only; do not write PPT content directly.

Environment variables:

- `TAVILY_API_KEY`
- `BOCHA_API_KEY`
- `BRAVE_API_KEY`

Rules:

- API keys must only be read from env/secrets.
- API keys must not be written to DB, git, logs, `runtimeSnapshotJson`, task results, or responses.
- Search provider raw responses must be normalized before downstream use.

Output:

```ts
type InsightSourceCandidate = {
  id: string;
  title: string;
  url: string;
  sourceName?: string;
  publishedAt?: string;
  snippet?: string;
  provider: "tavily" | "bocha" | "brave" | "user_url" | "internal";
  credibility: "official" | "primary" | "trusted_media" | "community" | "unknown";
  language?: "zh" | "en" | "unknown";
  tags: string[];
};

type InsightEvidencePackage = {
  topic: string;
  generatedAt: string;
  candidates: InsightSourceCandidate[];
  warnings?: string[];
};
```

### Stage 2: Moheng Research Reviewer

Implementation shape: Hermes profile `moheng-reviewer`.

Do not reuse or overwrite `mywealth` profile. The wealth profile remains an independent assistant.

Responsibilities:

- Turn source candidates into a coherent narrative.
- Separate facts, interpretations, disagreements, and implications.
- Produce a PPT outline suitable for internal banking/enterprise audience.
- Preserve citations and source IDs.

Input:

```text
用户原始需求
source_candidates.json
source snippets
```

Output:

```ts
type InsightReviewHandoff = {
  topic: string;
  thesis: string;
  keyTakeaways: Array<{
    title: string;
    detail: string;
    sourceIds: string[];
  }>;
  disputesOrUnknowns: Array<{
    point: string;
    sourceIds: string[];
  }>;
  bankingImplications: string[];
  pptOutline: Array<{
    slideTitle: string;
    slideGoal: string;
    bullets: string[];
    sourceIds: string[];
  }>;
};
```

Hard boundaries:

- Do not invent statistics or claims not present in sources.
- Do not treat investor opinions as facts.
- Do not expose internal API keys, endpoint URLs, or runtime topology.
- If source quality is weak, say so and recommend additional sources.

### Stage 3: Jianye PPT Generator

Implementation shape: existing Claude Code `task-ppt`.

Responsibilities:

- Generate PPT artifacts from `InsightReviewHandoff`.
- Include citation markers when possible.
- Use clean business presentation style.
- Do not add unsupported claims.

## Search Strategy

Default provider order:

1. Tavily: English/technical/company/blog source discovery.
2. Bocha: Chinese/finance/industry source discovery.
3. Brave: broad fallback when either provider fails or recall is too low.

Provider failure policy:

- One provider failure does not fail the whole research stage.
- All provider failures fail the research stage with actionable diagnostics.
- Source count below 5 returns a warning, not a hard failure.

Deduping:

- Canonicalize by normalized URL.
- Prefer official/primary source over repost.
- Keep at most 20 candidates for Moheng.

## Non-Goals For V1

- No TrendRadar in the main path for specified-topic requests.
- No autonomous planner selecting arbitrary agents.
- No user-visible "agent swarm" theater.
- No cross-user memory.
- No auto-save to user workspace.
- No unverified YouTube transcript pipeline in V1; add later as `youtube_transcript` source provider.

## V1.1 Extensions

- TrendRadar candidate discovery when user has no topic.
- YouTube transcript extraction.
- KOL watchlist source provider.
- Internal docs/code source provider for Hermes vs OpenClaw style reports.
- Citation-aware PPT renderer.

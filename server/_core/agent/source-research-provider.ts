import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export type InsightSearchProvider = "tavily" | "bocha" | "brave" | "direct";

export type InsightCredibility =
  | "official"
  | "primary"
  | "trusted_media"
  | "community"
  | "unknown";

export type EvidenceTier =
  | "official"
  | "primary"
  | "secondary"
  | "low_quality"
  | "irrelevant";

export type PublisherClass =
  | "official_org"
  | "vendor_official"
  | "speaker_original"
  | "official_video"
  | "research_repository"
  | "reputable_media"
  | "aggregator"
  | "unknown";

export type TopicFit =
  | "exact_event"
  | "same_entity_topic"
  | "adjacent_context"
  | "irrelevant";

export type EvidenceRole =
  | "source_of_record"
  | "corroboration"
  | "context"
  | "commentary"
  | "discard";

export type SourceScore = {
  authority: number;
  relevance: number;
  freshness: number;
  originality: number;
  evidenceValue: number;
  noisePenalty: number;
  finalScore: number;
};

export type SourceJudgeSignal = {
  semanticRelevance: "high" | "medium" | "low";
  usefulness: "core" | "support" | "context" | "noise";
  whyUseful?: string;
  noiseReason?: string;
};

export type QueryCorrection = {
  from: string;
  to: string;
  confidence: "high" | "medium" | "low";
  reason: string;
};

export type NormalizedQuery = {
  rawQuery: string;
  canonicalQuery: string;
  aliases: string[];
  corrections: QueryCorrection[];
};

export type InsightSourceCandidate = {
  id: string;
  sourceId?: string;
  title: string;
  url: string;
  sourceName?: string;
  publishedAt?: string;
  snippet?: string;
  provider: InsightSearchProvider;
  credibility: InsightCredibility;
  language?: "zh" | "en" | "unknown";
  tags: string[];
  score?: number;
  tier?: EvidenceTier;
  publisherClass?: PublisherClass;
  topicFit?: TopicFit;
  evidenceRole?: EvidenceRole;
  sourceScore?: SourceScore;
  sourceJudge?: SourceJudgeSignal;
  qualityReason?: string;
};

export type DiscardedInsightSourceCandidate = InsightSourceCandidate & {
  discardReason: string;
};

export type InsightEvidencePackage = {
  topic: string;
  normalizedQuery?: NormalizedQuery;
  searchPlan?: SearchPlan;
  generatedAt: string;
  candidates: InsightSourceCandidate[];
  discardedSources?: DiscardedInsightSourceCandidate[];
  evidenceSummary?: {
    officialCount: number;
    primaryCount: number;
    secondaryCount: number;
    lowQualityCount: number;
    irrelevantCount: number;
    discardedCount: number;
    sourceOfRecordCount?: number;
    corroborationCount?: number;
    contextCount?: number;
    commentaryCount?: number;
  };
  confidence?: "high" | "medium" | "low";
  warnings?: string[];
};

export type SourceResearchFetch = typeof fetch;

export type ResearchInput = {
  topic: string;
};

export type SearchPlan = {
  normalizedQuery: NormalizedQuery;
  queries: string[];
  maxSearches: number;
  maxCandidates: number;
  requiresSourceOfRecordHunt: boolean;
  sourceHunt?: SourceHuntPlan;
  planner: {
    mode: "deterministic" | "lingxia-llm";
    provider?: string;
    model?: string;
  };
  rationale?: string;
  officialSourceHints?: string[];
  warnings?: string[];
};

export type SourceHuntProfileType =
  | "event"
  | "model_release"
  | "company"
  | "open_source_project"
  | "paper"
  | "person_viewpoint"
  | "general";

export type SourceHuntPlan = {
  type: SourceHuntProfileType;
  entities: {
    model?: string;
    event?: string;
    year?: string;
    company?: string;
    project?: string;
    paper?: string;
    person?: string;
    orgDomain?: string;
  };
  sourceOfRecordQueries: string[];
  fallbackQueries: string[];
  directSourceUrls?: string[];
  rationale: string;
};

export type NormalizedSearchResult = InsightSourceCandidate;

export interface ResearchProvider {
  run(input: ResearchInput): Promise<InsightEvidencePackage>;
}

export interface SearchExecutor {
  search(plan: SearchPlan): Promise<NormalizedSearchResult[]>;
}

export type SearchPlannerInput = {
  topic: string;
  normalizedQuery: NormalizedQuery;
  maxSearches: number;
  maxCandidates: number;
  requiresSourceOfRecordHunt: boolean;
};

export interface SearchPlanner {
  plan(input: SearchPlannerInput): Promise<SearchPlan>;
}

export type SourceJudgeInput = {
  topic: string;
  normalizedQuery: NormalizedQuery;
  searchPlan: SearchPlan;
  candidates: InsightSourceCandidate[];
};

export type SourceJudgeDecision = SourceJudgeSignal & {
  id?: string;
  url?: string;
};

export interface SourceJudge {
  judge(input: SourceJudgeInput): Promise<SourceJudgeDecision[]>;
}

export type SourceResearchOptions = {
  env?: Record<string, string | undefined>;
  fetchImpl?: SourceResearchFetch;
  now?: () => Date;
  maxCandidates?: number;
  queryConfigPath?: string;
  qualityConfigPath?: string;
  searchExecutor?: SearchExecutor;
  searchPlanner?: SearchPlanner;
  sourceJudge?: SourceJudge;
};

type SearchResponse = {
  candidates: InsightSourceCandidate[];
  warning?: string;
};

type CandidateInput = {
  title?: string;
  url?: string;
  sourceName?: string;
  snippet?: string;
  publishedAt?: string;
  score?: number;
};

type QueryCorrectionConfig = {
  entityCorrections: Record<string, string>;
  fillerPhrases: string[];
  fillerWords: string[];
  preserveTerms: string[];
};

type SourceQualityConfig = {
  officialDomains: string[];
  primaryDomains?: string[];
  secondaryDomains?: string[];
  speakerOriginalDomains?: string[];
  officialVideoDomains?: string[];
  contextOnlyOfficialDomains?: string[];
  researchRepositoryDomains?: string[];
  reputableMediaDomains?: string[];
  aggregatorDomains?: string[];
  blacklistPatterns: string[];
};

function defaultDataPath(fileName: string): string {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.join(dirname, "data", fileName);
}

function loadJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

const TRUSTED_OFFICIAL_HOSTS = [
  "openai.com",
  "anthropic.com",
  "sequoiacap.com",
  "google.com",
  "deepmind.google",
  "ai.google.dev",
  "nvidia.com",
  "microsoft.com",
  "meta.com",
  "llama.meta.com",
  "apple.com",
  "amazon.com",
  "ibm.com",
  "salesforce.com",
  "mistral.ai",
  "qwenlm.github.io",
  "deepseek.com",
  "deepseek.ai",
];

const TRUSTED_RESEARCH_REPOSITORY_HOSTS = [
  "github.com",
  "huggingface.co",
  "arxiv.org",
  "paperswithcode.com",
  "lmarena.ai",
  "artificialanalysis.ai",
];

const TRUSTED_MEDIA_HOST_PARTS = [
  "technologyreview.com",
  "techcrunch.com",
  "venturebeat.com",
  "theinformation.com",
  "semianalysis.com",
  "stratechery.com",
  "reuters.com",
  "bloomberg.com",
  "wsj.com",
  "ft.com",
  "finextra.com",
  "bankingdive.com",
];

const DEFAULT_QUERY_CORRECTIONS: QueryCorrectionConfig = {
  entityCorrections: {
    "AI Ascend": "AI Ascent",
  },
  fillerPhrases: [
    "搜索一下",
    "请帮我",
    "帮我",
    "自动检索",
    "最新资料",
    "提炼逻辑线",
    "生成可预览",
    "可下载的",
    "并生成",
  ],
  fillerWords: ["并", "的", "了", "来", "去"],
  preserveTerms: ["AI", "AGI", "PPT", "API", "RPA", "LLM"],
};

const DEFAULT_SOURCE_QUALITY: SourceQualityConfig = {
  officialDomains: TRUSTED_OFFICIAL_HOSTS,
  speakerOriginalDomains: ["karpathy.bearblog.dev", "bearblog.dev"],
  officialVideoDomains: ["youtube.com", "youtu.be"],
  contextOnlyOfficialDomains: ["ibm.com", "salesforce.com", "ey.com"],
  researchRepositoryDomains: TRUSTED_RESEARCH_REPOSITORY_HOSTS,
  reputableMediaDomains: TRUSTED_MEDIA_HOST_PARTS,
  aggregatorDomains: ["youtube.com", "bilibili.com", "zhihu.com", "sohu.com", "xueqiu.com", "myzaker.com", "hao.cnyes.com"],
  primaryDomains: TRUSTED_MEDIA_HOST_PARTS,
  secondaryDomains: ["youtube.com", ...TRUSTED_RESEARCH_REPOSITORY_HOSTS],
  blacklistPatterns: [
    "csdn\\.net/.*/article/details/\\d+",
    "icaigd\\.com",
    "icsgai\\.com",
    "aeic",
    "ais\\.cn",
    "caifuhao\\.eastmoney\\.com",
    "smartlab\\.gov\\.hk/.*find-ai-solution",
  ],
};

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|yclid)/i.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.trim();
  }
}

function idFor(provider: InsightSearchProvider, url: string, index: number): string {
  const normalized = normalizeUrl(url);
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  return `${provider}-${Math.abs(hash).toString(36)}-${index}`;
}

function inferLanguage(text: string): "zh" | "en" | "unknown" {
  if (/[\u4e00-\u9fff]/.test(text)) return "zh";
  if (/[a-zA-Z]/.test(text)) return "en";
  return "unknown";
}

function inferCredibility(url: string): InsightCredibility {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (TRUSTED_OFFICIAL_HOSTS.some((official) => host === official || host.endsWith(`.${official}`))) {
      return "official";
    }
    if (host.includes("youtube.com") || host.includes("github.com") || host.includes("arxiv.org")) {
      return "primary";
    }
    if (TRUSTED_MEDIA_HOST_PARTS.some((part) => host.includes(part))) return "trusted_media";
    if (host.includes("x.com") || host.includes("twitter.com") || host.includes("reddit.com")) return "community";
  } catch {
    return "unknown";
  }
  return "unknown";
}

function tagsFor(topic: string, text: string): string[] {
  const combined = `${topic} ${text}`;
  const tags = new Set<string>();
  if (/AI|人工智能|大模型|LLM|模型|OpenAI|Claude|Gemini|DeepSeek|Qwen|Mythos/i.test(combined)) tags.add("ai");
  if (/银行|金融|finance|bank|insurance|wealth|fintech|风控|合规|投研|资产管理/i.test(combined)) tags.add("finance");
  if (/agent|智能体|workflow|OpenClaw|Hermes|Manus|Kimi/i.test(combined)) tags.add("agent");
  if (/PPT|presentation|deck|汇报|报告|slides/i.test(combined)) tags.add("presentation");
  return [...tags];
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyEntityCorrections(input: string, config: QueryCorrectionConfig): { value: string; corrections: QueryCorrection[] } {
  let value = input;
  const corrections: QueryCorrection[] = [];
  for (const [from, to] of Object.entries(config.entityCorrections || {})) {
    const pattern = new RegExp(escapeRegExp(from), "gi");
    if (!pattern.test(value)) continue;
    value = value.replace(pattern, to);
    corrections.push({
      from,
      to,
      confidence: "high",
      reason: "entity correction dictionary match",
    });
    console.warn(`[QUERY-REWRITE] entityCorrection ${from} -> ${to}`);
  }
  return { value, corrections };
}

function stripPresentationInstructions(value: string, config: QueryCorrectionConfig): string {
  let cleaned = value;
  for (const phrase of config.fillerPhrases || []) {
    cleaned = cleaned.replace(new RegExp(escapeRegExp(phrase), "gi"), " ");
  }
  cleaned = cleaned
    .replace(/基于|根据|围绕/g, " ")
    .replace(/生成一?份?|制作一?份?|做一?份?|输出|写成|整理成/g, " ")
    .replace(/\d+\s*页/g, " ")
    .replace(/中文|幻灯片|演示文稿|报告|汇报材料/g, " ")
    .replace(/专业|克制|白底|投行风|高端|好看|可下载|可预览/g, " ")
    .replace(/最新观点|最新信息|最新消息/g, "最新")
    .replace(/[，。；;、]/g, " ");
  for (const word of config.fillerWords || []) {
    if ((config.preserveTerms || []).includes(word)) continue;
    cleaned = cleaned.replace(new RegExp(`(^|\\s)${escapeRegExp(word)}(?=\\s|$)`, "gi"), " ");
  }
  return collapseWhitespace(cleaned);
}

function buildAliases(canonicalQuery: string): string[] {
  const aliases: string[] = [];
  const addAlias = (alias: string) => {
    const cleaned = collapseWhitespace(alias);
    if (cleaned && !aliases.includes(cleaned)) aliases.push(cleaned);
  };
  const isSequoiaAscentQuery = /sequoia|红杉|ascent/i.test(canonicalQuery);
  if (isSequoiaAscentQuery) {
    const year = firstYear(canonicalQuery);
    const yearSuffix = year ? ` ${year}` : "";
    // Source-of-record hunt first. Broader media queries only corroborate.
    addAlias(`site:karpathy.bearblog.dev "Sequoia Ascent${yearSuffix}"`);
    addAlias(year ? `site:sequoiacap.com "AI Ascent" "${year}"` : 'site:sequoiacap.com "AI Ascent"');
    addAlias(`"Sequoia Ascent${yearSuffix}" Karpathy`);
    if (year) addAlias(`site:karpathy.bearblog.dev "sequoia-ascent-${year}"`);
    if (year === "2026") {
      addAlias('"Sequoia Ascent 2026" "Software 3.0"');
      addAlias('"Sequoia Ascent 2026" "Jagged Intelligence"');
    }
    if (year === "2026") addAlias('site:sequoiacap.com "2026: This is AGI"');
    addAlias(`Sequoia Capital AI Ascent${yearSuffix} keynote takeaways`);
    addAlias(`红杉资本 AI Ascent${yearSuffix} 大会 核心观点`);
  }
  addAlias(canonicalQuery);
  if (/openai|gpt|模型|model/i.test(canonicalQuery)) {
    addAlias(`${canonicalQuery} official blog`);
  }
  return aliases.slice(0, 5);
}

const SOURCE_HUNT_ORG_DOMAINS: Array<{ pattern: RegExp; domain: string; company?: string }> = [
  { pattern: /sequoia|红杉/i, domain: "sequoiacap.com", company: "Sequoia Capital" },
  { pattern: /anthropic|claude|mythos/i, domain: "anthropic.com", company: "Anthropic" },
  { pattern: /openai|gpt/i, domain: "openai.com", company: "OpenAI" },
  { pattern: /deepmind|gemini|google/i, domain: "deepmind.google", company: "Google DeepMind" },
  { pattern: /qwen|通义|阿里/i, domain: "qwenlm.github.io", company: "Qwen" },
  { pattern: /deepseek/i, domain: "deepseek.com", company: "DeepSeek" },
  { pattern: /mistral|mixtral/i, domain: "mistral.ai", company: "Mistral AI" },
  { pattern: /llama|meta/i, domain: "llama.meta.com", company: "Meta AI" },
  { pattern: /nvidia|英伟达/i, domain: "nvidia.com", company: "NVIDIA" },
];

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values
    .map((value) => collapseWhitespace(String(value || "")))
    .filter(Boolean))];
}

function extractRequestedYears(value: string): string[] {
  // Users often type event names without whitespace, e.g. "Ascent2026".
  // Treat any standalone 20xx token that is not followed by another digit as
  // a requested year so old event pages do not pass the evidence gate.
  return [...new Set(value.match(/20\d{2}(?!\d)/g) || [])];
}

function firstYear(value: string): string | undefined {
  return extractRequestedYears(value)[0];
}

function detectOrgDomain(query: string): { orgDomain?: string; company?: string } {
  for (const entry of SOURCE_HUNT_ORG_DOMAINS) {
    if (entry.pattern.test(query)) return { orgDomain: entry.domain, company: entry.company };
  }
  return {};
}

function extractModelName(query: string): string | undefined {
  const known = query.match(/\b(?:Mythos|Claude(?:\s+\d+(?:\.\d+)?)?|GPT[-\s]?\d+(?:\.\d+)?|Gemini(?:\s+\d+(?:\.\d+)?)?|Llama\s*\d+(?:\.\d+)?|Qwen\s*\d+(?:\.\d+)?|DeepSeek[-\s]?[A-Z0-9.]+|Mistral\s*\w+|Mixtral\s*\w+|Gemma\s*\d+(?:\.\d+)?)\b/i)?.[0];
  if (known) return collapseWhitespace(known);
  const quoted = query.match(/["“”']([^"“”']{2,80})["“”']/)?.[1];
  if (quoted && /model|模型|llm|ai/i.test(query)) return collapseWhitespace(quoted);
  return undefined;
}

function extractEventName(query: string): string | undefined {
  if (/ascent/i.test(query) && /sequoia|红杉/i.test(query)) return "Sequoia AI Ascent";
  const event = query.match(/([A-Z][A-Za-z0-9 ]{2,50}(?:Summit|Ascent|Conference|Forum|Keynote|大会|峰会|论坛))/)?.[1];
  if (event) return collapseWhitespace(event);
  const chinese = query.match(/([^，。；;\n]{2,40}(?:大会|峰会|论坛|发布会))/)?.[1];
  return chinese ? collapseWhitespace(chinese) : undefined;
}

function extractProjectName(query: string): string | undefined {
  const project = query.match(/\b(OpenClaw|Hermes|LangChain|LlamaIndex|AutoGen|CrewAI|Dify|Flowise)\b/i)?.[0];
  if (project) return project;
  const github = query.match(/github\s+([A-Za-z0-9_.-]{2,80})/i)?.[1];
  return github ? collapseWhitespace(github) : undefined;
}

function buildSourceHuntPlan(normalizedQuery: NormalizedQuery): SourceHuntPlan {
  const query = normalizedQuery.canonicalQuery;
  const { orgDomain, company } = detectOrgDomain(query);
  const year = firstYear(query);
  const model = extractModelName(query);
  const event = extractEventName(query);
  const project = extractProjectName(query);
  const lower = query.toLowerCase();

  if (event || /summit|conference|keynote|大会|峰会|论坛|ascent/i.test(query)) {
    const eventName = event || query;
    const scoped = year ? `${eventName} ${year}` : eventName;
    return {
      type: "event",
      entities: { event: eventName, year, orgDomain, company },
      sourceOfRecordQueries: uniqueStrings([
        /sequoia|红杉|ascent/i.test(query) ? `site:karpathy.bearblog.dev "Sequoia Ascent${year ? ` ${year}` : ""}"` : undefined,
        orgDomain ? `site:${orgDomain} "${eventName}"${year ? ` "${year}"` : ""}` : undefined,
        `"${scoped}" keynote`,
        /sequoia|红杉|ascent/i.test(query) && year ? `site:karpathy.bearblog.dev "sequoia-ascent-${year}"` : undefined,
        /sequoia|红杉|ascent/i.test(query) && year === "2026" ? '"Sequoia Ascent 2026" "Software 3.0"' : undefined,
        /sequoia|红杉|ascent/i.test(query) && year === "2026" ? '"Sequoia Ascent 2026" "Jagged Intelligence"' : undefined,
        /sequoia|红杉|ascent/i.test(query) && year === "2026" ? 'site:sequoiacap.com "2026: This is AGI"' : undefined,
        /sequoia|红杉|ascent/i.test(query) && year === "2026" ? '"2026: This is AGI" "Sequoia"' : undefined,
        `"${scoped}" transcript`,
        `"${eventName}" speaker blog`,
        `"${scoped}" YouTube official`,
      ]),
      fallbackQueries: uniqueStrings([
        `"${scoped}" summary`,
        `"${scoped}" analysis insights`,
        `"${eventName}" Reuters`,
        `"${eventName}" Bloomberg`,
      ]),
      directSourceUrls: uniqueStrings([
        /sequoia|红杉|ascent/i.test(query) && year === "2026" ? "https://karpathy.bearblog.dev/sequoia-ascent-2026/" : undefined,
        /sequoia|红杉|ascent/i.test(query) && year === "2026" ? "https://sequoiacap.com/article/2026-this-is-agi/" : undefined,
      ]),
      rationale: "按会议/峰会题型优先追官方页面、演讲、转录与主讲人原文，再用媒体报道补充。",
    };
  }

  if (model || /model release|模型发布|最新模型|sota|开源模型|open source llm|benchmark/i.test(query)) {
    if (!model) {
      return {
        type: "model_release",
        entities: { orgDomain, company },
        sourceOfRecordQueries: uniqueStrings([
          "site:lmarena.ai open source model leaderboard",
          "site:artificialanalysis.ai open source model benchmark",
          "site:huggingface.co open llm leaderboard",
          "site:github.com Qwen DeepSeek Llama Mistral benchmark",
          "Llama Qwen DeepSeek Mistral official model card benchmark",
          "latest SOTA open source LLM benchmark comparison",
        ]),
        fallbackQueries: uniqueStrings([
          "SOTA open source LLM benchmark comparison finance AI",
          "Qwen DeepSeek Llama Mistral performance analysis",
          "open source LLM financial services impact",
        ]),
        rationale: "按泛开源模型评测题型优先追公开榜单、模型仓库、模型卡与技术报告，再用评测文章补充。",
      };
    }
    const modelName = model;
    return {
      type: "model_release",
      entities: { model: modelName, orgDomain, company },
      sourceOfRecordQueries: uniqueStrings([
        orgDomain ? `site:${orgDomain} "${modelName}"` : undefined,
        `"${modelName}" official blog`,
        `"${modelName}" release notes`,
        `"${modelName}" announcement`,
        `"${modelName}" model card`,
        `"${modelName}" technical report`,
        `site:github.com "${modelName}"`,
        `site:huggingface.co "${modelName}"`,
      ]),
      fallbackQueries: uniqueStrings([
        `"${modelName}" benchmark`,
        `"${modelName}" performance analysis`,
        `"${modelName}" finance impact`,
        `"${modelName}" Reuters`,
        `"${modelName}" TechCrunch`,
      ]),
      rationale: "按模型发布/开源模型题型优先追官方博客、模型卡、技术报告、GitHub/HuggingFace，再用评测与媒体交叉验证。",
    };
  }

  if (project || /github|开源项目|repo|repository|documentation|文档/i.test(query)) {
    const projectName = project || query;
    return {
      type: "open_source_project",
      entities: { project: projectName, orgDomain, company },
      sourceOfRecordQueries: uniqueStrings([
        `site:github.com "${projectName}"`,
        `"${projectName}" GitHub README`,
        `"${projectName}" documentation`,
        `"${projectName}" release notes`,
        `"${projectName}" changelog`,
      ]),
      fallbackQueries: uniqueStrings([
        `"${projectName}" blog analysis`,
        `"${projectName}" tutorial`,
      ]),
      rationale: "按开源项目题型优先追 GitHub、README、文档与变更记录。",
    };
  }

  if (/paper|论文|arxiv|technical report|白皮书/i.test(query)) {
    return {
      type: "paper",
      entities: { paper: query, orgDomain, company },
      sourceOfRecordQueries: uniqueStrings([
        `"${query}" arxiv`,
        `"${query}" pdf`,
        `"${query}" official publication`,
        `"${query}" authors blog`,
      ]),
      fallbackQueries: uniqueStrings([
        `"${query}" summary`,
        `"${query}" explanation`,
      ]),
      rationale: "按论文/技术报告题型优先追 arXiv、PDF、正式发表页与作者博客。",
    };
  }

  if (company || /company|公司|战略|earnings call|investor day|财报|业绩会/i.test(lower)) {
    const companyName = company || query;
    return {
      type: "company",
      entities: { company: companyName, orgDomain },
      sourceOfRecordQueries: uniqueStrings([
        orgDomain ? `site:${orgDomain} AI strategy` : undefined,
        orgDomain ? `site:${orgDomain} blog AI` : undefined,
        `"${companyName}" AI strategy ${year || ""}`,
        `"${companyName}" earnings call AI`,
        `"${companyName}" investor day AI`,
      ]),
      fallbackQueries: uniqueStrings([
        `"${companyName}" AI Reuters`,
        `"${companyName}" AI report`,
      ]),
      rationale: "按公司战略题型优先追公司官网、博客、业绩会和投资者日材料。",
    };
  }

  return {
    type: "general",
    entities: { orgDomain, company, year },
    sourceOfRecordQueries: uniqueStrings([
      orgDomain ? `site:${orgDomain} ${query}` : undefined,
      ...normalizedQuery.aliases.slice(0, 2),
    ]),
    fallbackQueries: uniqueStrings([
      `${query} official`,
      `${query} Reuters`,
      `${query} report`,
    ]),
    rationale: "开放题型：保留 LLM/规则查询，同时尝试官方和权威媒体补充。",
  };
}

function requiresSourceHuntGate(sourceHunt: SourceHuntPlan): boolean {
  return ["event", "model_release", "open_source_project", "paper"].includes(sourceHunt.type);
}

function normalizeQuery(input: string, config: QueryCorrectionConfig): NormalizedQuery {
  const rawQuery = input;
  const corrected = applyEntityCorrections(collapseWhitespace(input), config);
  const normalized = corrected.value;
  const pieces: string[] = [];
  const basedOn = normalized.match(/(?:基于|根据|围绕)\s*([^，。；;\n]+?)(?:的?最新[^，。；;\n]*)?[，。；;\n]/);
  if (basedOn?.[1]) pieces.push(stripPresentationInstructions(basedOn[1], config));
  const topic = normalized.match(/主题(?:是|为|：|:)\s*([^。；;\n]+)/);
  if (topic?.[1]) pieces.push(stripPresentationInstructions(topic[1], config));

  const explicit = pieces.map(collapseWhitespace).filter(Boolean).join(" ");
  const canonicalQuery = (explicit
    ? collapseWhitespace(explicit)
    : stripPresentationInstructions(normalized, config) || normalized).slice(0, 180);
  return {
    rawQuery,
    canonicalQuery,
    aliases: buildAliases(canonicalQuery),
    corrections: corrected.corrections,
  };
}

export function createDeterministicSearchPlan(input: SearchPlannerInput): SearchPlan {
  const sourceHunt = buildSourceHuntPlan(input.normalizedQuery);
  return {
    normalizedQuery: input.normalizedQuery,
    queries: uniqueStrings([
      ...sourceHunt.sourceOfRecordQueries,
      ...input.normalizedQuery.aliases,
    ]),
    maxSearches: input.maxSearches,
    maxCandidates: input.maxCandidates,
    requiresSourceOfRecordHunt: input.requiresSourceOfRecordHunt,
    sourceHunt,
    planner: { mode: "deterministic" },
    rationale: sourceHunt.rationale,
  };
}

function normalizeSearchPlan(plan: SearchPlan, fallback: SearchPlan): SearchPlan {
  const sourceHunt = plan.sourceHunt || fallback.sourceHunt;
  const queries = Array.from(new Set([
    ...(sourceHunt?.sourceOfRecordQueries || []),
    ...(plan.queries || []),
    ...(fallback.queries || []),
  ]
    .map((query) => String(query || "").trim())
    .filter(Boolean)))
    .slice(0, fallback.maxSearches);
  return {
    ...fallback,
    ...plan,
    normalizedQuery: fallback.normalizedQuery,
    maxSearches: fallback.maxSearches,
    maxCandidates: fallback.maxCandidates,
    requiresSourceOfRecordHunt: fallback.requiresSourceOfRecordHunt,
    sourceHunt,
    queries: queries.length ? queries : fallback.queries,
    planner: plan.planner || fallback.planner,
    officialSourceHints: (plan.officialSourceHints || []).map((value) => String(value).trim()).filter(Boolean).slice(0, 8),
    warnings: (plan.warnings || []).map((value) => String(value).trim()).filter(Boolean),
  };
}

function dedupe(candidates: InsightSourceCandidate[], limit: number): InsightSourceCandidate[] {
  const byUrl = new Map<string, InsightSourceCandidate>();
  for (const candidate of candidates) {
    const key = normalizeUrl(candidate.url);
    const existing = byUrl.get(key);
    const candidateRank = credibilityRank(candidate.credibility);
    const existingRank = existing ? credibilityRank(existing.credibility) : -1;
    if (!existing || candidateRank > existingRank || (candidate.score || 0) > (existing.score || 0)) {
      byUrl.set(key, candidate);
    }
  }
  const sorted = [...byUrl.values()].sort((a, b) => {
    return (credibilityRank(b.credibility) - credibilityRank(a.credibility))
      || ((b.score || 0) - (a.score || 0))
      || a.title.localeCompare(b.title);
  });
  const providerCap = Math.max(4, Math.ceil(limit / 2));
  const picked: InsightSourceCandidate[] = [];
  const pickedKeys = new Set<string>();
  const providerCounts = new Map<InsightSearchProvider, number>();

  for (const candidate of sorted) {
    if (picked.length >= limit) break;
    const count = providerCounts.get(candidate.provider) || 0;
    if (count >= providerCap) continue;
    picked.push(candidate);
    pickedKeys.add(normalizeUrl(candidate.url));
    providerCounts.set(candidate.provider, count + 1);
  }

  for (const candidate of sorted) {
    if (picked.length >= limit) break;
    const key = normalizeUrl(candidate.url);
    if (pickedKeys.has(key)) continue;
    picked.push(candidate);
    pickedKeys.add(key);
  }

  return picked;
}

function sourceJudgeKeys(value: { id?: string; url?: string }): string[] {
  return [
    value.id ? `id:${value.id}` : undefined,
    value.url ? `url:${normalizeUrl(value.url)}` : undefined,
  ].filter((key): key is string => Boolean(key));
}

function validSourceJudgeSignal(value: any): SourceJudgeSignal | undefined {
  const semanticRelevance = value?.semanticRelevance;
  const usefulness = value?.usefulness;
  if (!["high", "medium", "low"].includes(semanticRelevance)) return undefined;
  if (!["core", "support", "context", "noise"].includes(usefulness)) return undefined;
  return {
    semanticRelevance,
    usefulness,
    whyUseful: typeof value?.whyUseful === "string" ? value.whyUseful.slice(0, 240) : undefined,
    noiseReason: typeof value?.noiseReason === "string" ? value.noiseReason.slice(0, 240) : undefined,
  };
}

function credibilityRank(credibility: InsightCredibility): number {
  return {
    official: 4,
    primary: 3,
    trusted_media: 2,
    community: 1,
    unknown: 0,
  }[credibility];
}

function hostMatches(host: string, domains: string[]): boolean {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`) || host.includes(domain));
}

function hostFor(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function blacklistReason(candidate: InsightSourceCandidate, config: SourceQualityConfig): string | null {
  const haystack = `${candidate.url} ${candidate.title} ${candidate.snippet || ""}`.toLowerCase();
  for (const pattern of config.blacklistPatterns || []) {
    try {
      if (new RegExp(pattern, "i").test(haystack)) return `blacklist pattern: ${pattern}`;
    } catch {
      if (haystack.includes(pattern.toLowerCase())) return `blacklist pattern: ${pattern}`;
    }
  }
  return null;
}

function queryTerms(query: string): string[] {
  return collapseWhitespace(query)
    .toLowerCase()
    .split(/[\s,，。；;:：/|()[\]{}"'“”‘’<>]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .filter((term) => !["the", "and", "for", "with", "最新", "观点", "影响"].includes(term));
}

function scoreTextAgainstQuery(text: string, query: string): number {
  const terms = new Set(queryTerms(query));
  if (terms.size === 0) return 0;
  let matched = 0;
  for (const term of terms) {
    if (text.includes(term)) matched += 1;
  }
  return Math.min(1, matched / Math.max(3, terms.size));
}

function isOpenModelResearchQuery(query: string): boolean {
  return /sota|open source llm|open[-\s]?source model|llama|qwen|deepseek|mistral|gemma|mixtral|phi|yi|glm|kimi|开源|大模型|模型|评测|benchmark/i.test(query);
}

function hasOpenModelEntity(text: string): boolean {
  return /llama|qwen|deepseek|mistral|gemma|mixtral|phi[-\s]?\d?|yi[-\s]?\d?|glm|kimi|hugging\s?face|open source llm|open[-\s]?source model|开源模型|开源大模型|大模型|模型评测|benchmark/i.test(text);
}

function relevanceScore(candidate: InsightSourceCandidate, normalizedQuery: NormalizedQuery, searchPlan?: SearchPlan): number {
  const text = `${candidate.title} ${candidate.url} ${candidate.snippet || ""}`.toLowerCase();
  const queryInputs = [
    normalizedQuery.canonicalQuery,
    ...normalizedQuery.aliases,
    ...(searchPlan?.queries || []),
    ...(searchPlan?.officialSourceHints || []),
    ...(searchPlan?.sourceHunt?.sourceOfRecordQueries || []),
    ...(searchPlan?.sourceHunt?.fallbackQueries || []),
  ].filter(Boolean);
  const baseScore = queryInputs.reduce((maxScore, query) => Math.max(maxScore, scoreTextAgainstQuery(text, query)), 0);
  const combinedQuery = queryInputs.join(" ");
  const host = hostFor(candidate.url);
  const isResearchHost = hostMatches(host, TRUSTED_RESEARCH_REPOSITORY_HOSTS);
  if (isOpenModelResearchQuery(combinedQuery) && hasOpenModelEntity(text)) {
    return Math.max(baseScore, isResearchHost ? 0.42 : 0.28);
  }
  return baseScore;
}

function requestedYears(normalizedQuery: NormalizedQuery): string[] {
  return extractRequestedYears(normalizedQuery.canonicalQuery);
}

function candidateSearchText(candidate: InsightSourceCandidate): string {
  return `${candidate.title} ${candidate.url} ${candidate.snippet || ""}`.toLowerCase();
}

function candidateTitleUrlText(candidate: InsightSourceCandidate): string {
  return `${candidate.title} ${candidate.url}`.toLowerCase();
}

function eventYearMismatchReason(candidate: InsightSourceCandidate, normalizedQuery: NormalizedQuery, searchPlan?: SearchPlan): string | undefined {
  if (searchPlan?.sourceHunt?.type !== "event") return undefined;
  const years = requestedYears(normalizedQuery);
  if (years.length === 0) return undefined;
  const titleUrl = candidateTitleUrlText(candidate);
  const candidateYears = extractRequestedYears(titleUrl);
  if (candidateYears.length === 0) return undefined;
  if (years.some((year) => candidateYears.includes(year))) return undefined;

  const eventName = `${searchPlan.sourceHunt.entities.event || ""} ${normalizedQuery.canonicalQuery}`;
  const isSequoiaAscentQuery = /sequoia|红杉|ascent/i.test(eventName);
  const sameEvent = isSequoiaAscentQuery
    ? /sequoia|红杉/i.test(titleUrl) && /ascent/i.test(titleUrl)
    : specificQueryTerms(normalizedQuery, searchPlan).some((term) => titleUrl.includes(term));
  if (!sameEvent) return undefined;
  return `event year mismatch: requested ${years.join(", ")} but source year is ${candidateYears.join(", ")}`;
}

const GENERIC_RESEARCH_TERMS = new Set([
  "ai",
  "agent",
  "agents",
  "llm",
  "model",
  "models",
  "open",
  "source",
  "sota",
  "benchmark",
  "comparison",
  "analysis",
  "impact",
  "latest",
  "report",
  "ppt",
  "bank",
  "banks",
  "banking",
  "finance",
  "financial",
  "risk",
  "control",
  "operation",
  "operations",
  "efficiency",
  "workflow",
  "workflows",
  "study",
  "case",
  "use",
  "uses",
  "2025",
  "2026",
  "最新",
  "模型",
  "开源",
  "大模型",
  "金融",
  "银行",
  "影响",
  "报告",
  "分析",
  "建议",
  "汇报",
]);

function specificQueryTerms(normalizedQuery: NormalizedQuery, searchPlan?: SearchPlan): string[] {
  const queryInputs = [
    normalizedQuery.canonicalQuery,
    ...normalizedQuery.aliases,
    ...(searchPlan?.queries || []),
    ...(searchPlan?.officialSourceHints || []),
    ...(searchPlan?.sourceHunt?.sourceOfRecordQueries || []),
    ...(searchPlan?.sourceHunt?.fallbackQueries || []),
  ];
  return [...new Set(queryInputs.flatMap(queryTerms))]
    .filter((term) => term.length >= 4)
    .filter((term) => !/^\d+$/.test(term))
    .filter((term) => !GENERIC_RESEARCH_TERMS.has(term));
}

function hasSpecificQueryOverlap(candidate: InsightSourceCandidate, normalizedQuery: NormalizedQuery, searchPlan?: SearchPlan): boolean {
  const text = candidateSearchText(candidate);
  return specificQueryTerms(normalizedQuery, searchPlan).some((term) => text.includes(term));
}

function publisherClassFor(candidate: InsightSourceCandidate, config: SourceQualityConfig): { publisherClass: PublisherClass; reason: string } {
  const host = hostFor(candidate.url);
  const reputableMediaDomains = config.reputableMediaDomains || config.primaryDomains || [];
  const aggregatorDomains = config.aggregatorDomains || config.secondaryDomains || [];
  const officialVideoDomains = config.officialVideoDomains || [];
  const contextOnlyOfficialDomains = config.contextOnlyOfficialDomains || [];
  const researchRepositoryDomains = config.researchRepositoryDomains || [];
  if (host && hostMatches(host, config.speakerOriginalDomains || [])) return { publisherClass: "speaker_original", reason: "speaker original domain" };
  if (host && hostMatches(host, contextOnlyOfficialDomains)) return { publisherClass: "vendor_official", reason: "vendor/consulting official domain, context only" };
  if (host && hostMatches(host, config.officialDomains || [])) return { publisherClass: "official_org", reason: "official organization domain" };
  if (host && hostMatches(host, officialVideoDomains)) {
    const text = candidateSearchText(candidate);
    const sourceName = (candidate.sourceName || "").toLowerCase();
    if (/sequoia|红杉|karpathy|andrej/i.test(sourceName) && /sequoia|红杉|karpathy|ascent/i.test(text)) {
      return { publisherClass: "official_video", reason: "video result from verified event/speaker channel" };
    }
    return { publisherClass: "aggregator", reason: "video platform result without official channel proof" };
  }
  if (host && hostMatches(host, researchRepositoryDomains)) return { publisherClass: "research_repository", reason: "research/model repository or benchmark domain" };
  if (host && hostMatches(host, reputableMediaDomains)) return { publisherClass: "reputable_media", reason: "reputable media domain" };
  if (host && hostMatches(host, aggregatorDomains)) return { publisherClass: "aggregator", reason: "aggregator or commentary domain" };
  return { publisherClass: "unknown", reason: "unknown source quality" };
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function topicFitFor(candidate: InsightSourceCandidate, normalizedQuery: NormalizedQuery, publisherClass: PublisherClass, relevance: number): TopicFit {
  const text = candidateSearchText(candidate);
  const years = requestedYears(normalizedQuery);
  const hasRequestedYear = years.length === 0 || years.some((year) => text.includes(year));
  const isSequoiaAscentQuery = /sequoia|红杉|ascent/i.test(normalizedQuery.canonicalQuery);
  if (isSequoiaAscentQuery) {
    const mentionsEvent = hasAny(text, [/sequoia/i, /红杉/i]) && hasAny(text, [/ascent/i, /ai峰会/i, /ai大会/i]);
    if (mentionsEvent && hasRequestedYear) return "exact_event";
    if ((hasAny(text, [/sequoia/i, /红杉/i]) || publisherClass === "official_org") && hasRequestedYear) return "same_entity_topic";
    if (publisherClass === "official_org" && relevance >= 0.2) return "adjacent_context";
    return relevance < 0.12 ? "irrelevant" : "adjacent_context";
  }
  if (relevance >= 0.65) return "exact_event";
  if (relevance >= 0.35) return "same_entity_topic";
  if (relevance >= 0.12) return "adjacent_context";
  return "irrelevant";
}

function evidenceRoleFor(publisherClass: PublisherClass, topicFit: TopicFit, hasSpecificOverlap: boolean): EvidenceRole {
  if (topicFit === "irrelevant") return "discard";
  if (topicFit === "exact_event" && ["speaker_original", "official_video"].includes(publisherClass)) {
    return "source_of_record";
  }
  if (publisherClass === "vendor_official") return "context";
  if (topicFit === "exact_event" && publisherClass === "official_org" && hasSpecificOverlap) return "source_of_record";
  if (publisherClass === "official_org") return "context";
  if (topicFit === "exact_event" && publisherClass === "research_repository") return "corroboration";
  if (topicFit === "exact_event" && publisherClass === "reputable_media") return "corroboration";
  if (publisherClass === "research_repository" && (topicFit === "same_entity_topic" || topicFit === "adjacent_context")) return "context";
  if (publisherClass === "aggregator" && topicFit === "exact_event") return "commentary";
  if (publisherClass === "reputable_media" && topicFit === "same_entity_topic") return "context";
  if (publisherClass === "unknown" && (topicFit === "exact_event" || topicFit === "same_entity_topic" || topicFit === "adjacent_context")) return "commentary";
  return "commentary";
}

function tierForRole(publisherClass: PublisherClass, evidenceRole: EvidenceRole): EvidenceTier {
  if (evidenceRole === "discard") return "low_quality";
  if (publisherClass === "official_org") return evidenceRole === "source_of_record" ? "official" : "secondary";
  if (evidenceRole === "source_of_record") return "primary";
  return "secondary";
}

function scoreCandidate(candidate: InsightSourceCandidate, normalizedQuery: NormalizedQuery, config: SourceQualityConfig, searchPlan?: SearchPlan): InsightSourceCandidate | DiscardedInsightSourceCandidate {
  const blacklist = blacklistReason(candidate, config);
  let relevance = relevanceScore(candidate, normalizedQuery, searchPlan);
  const years = requestedYears(normalizedQuery);
  const candidateText = candidateSearchText(candidate);
  const candidateTitleOrUrl = `${candidate.title} ${candidate.url}`.toLowerCase();
  if (blacklist) {
    return {
      ...candidate,
      tier: "irrelevant",
      sourceScore: {
        authority: 0,
        relevance: Math.round(relevance * 30),
        freshness: 0,
        originality: 0,
        evidenceValue: 0,
        noisePenalty: -100,
        finalScore: -100,
      },
      qualityReason: blacklist,
      discardReason: blacklist,
    };
  }

  const { publisherClass, reason } = publisherClassFor(candidate, config);
  const judge = candidate.sourceJudge;
  const protectedPrimarySource = ["official_org", "speaker_original", "official_video"].includes(publisherClass);
  if (judge?.usefulness === "noise" && !protectedPrimarySource) {
    const judgeReason = judge.noiseReason || "low semantic usefulness";
    return {
      ...candidate,
      tier: "irrelevant",
      sourceScore: {
        authority: 0,
        relevance: Math.round(relevance * 30),
        freshness: 0,
        originality: 0,
        evidenceValue: 0,
        noisePenalty: -70,
        finalScore: -70,
      },
      qualityReason: reason,
      discardReason: `LLM source judge marked noise: ${judgeReason}`,
    };
  }
  if (judge?.semanticRelevance === "high") {
    relevance = Math.max(relevance, 0.45);
  } else if (judge?.semanticRelevance === "medium") {
    relevance = Math.max(relevance, 0.25);
  } else if (judge?.semanticRelevance === "low" && !protectedPrimarySource) {
    relevance = Math.min(relevance, 0.08);
  }
  const topicFit = topicFitFor(candidate, normalizedQuery, publisherClass, relevance);
  const hasSpecificOverlap = hasSpecificQueryOverlap(candidate, normalizedQuery, searchPlan);
  const evidenceRole = evidenceRoleFor(publisherClass, topicFit, hasSpecificOverlap);
  const tier = tierForRole(publisherClass, evidenceRole);
  const eventYearMismatch = eventYearMismatchReason(candidate, normalizedQuery, searchPlan);
  const missingRequestedYear = years.length > 0
    && !years.some((year) => (["official_org", "speaker_original"].includes(publisherClass) ? candidateTitleOrUrl : candidateText).includes(year));
  const requestedModel = searchPlan?.sourceHunt?.type === "model_release"
    ? searchPlan.sourceHunt.entities.model
    : undefined;
  const requestedModelTerms = requestedModel ? queryTerms(requestedModel) : [];
  const requestedModelHaystack = ["official_org", "speaker_original"].includes(publisherClass)
    ? candidateTitleOrUrl
    : candidateText;
  const missingRequestedModel = requestedModelTerms.length > 0
    && !requestedModelTerms.some((term) => requestedModelHaystack.includes(term.toLowerCase()));
  const authority = evidenceRole === "source_of_record"
    ? 50
    : evidenceRole === "corroboration" ? 30 : evidenceRole === "context" ? 16 : evidenceRole === "commentary" ? 8 : 0;
  const freshness = candidate.publishedAt ? 8 : 0;
  const originality = ["official_org", "speaker_original", "official_video"].includes(publisherClass)
    ? 18
    : publisherClass === "research_repository" ? 14 : publisherClass === "vendor_official" ? 10 : publisherClass === "reputable_media" ? 10 : publisherClass === "aggregator" ? 4 : 0;
  const evidenceValue = Math.round(relevance * 25);
  const noisePenalty = evidenceRole === "discard" ? -50 : evidenceRole === "commentary" ? -6 : 0;
  const finalScore = authority + Math.round(relevance * 30) + freshness + originality + evidenceValue + noisePenalty;
  const discardReason =
    evidenceRole === "discard"
      ? reason
      : ["official_org", "speaker_original"].includes(publisherClass) && missingRequestedYear
        ? `official domain but missing requested year: ${years.join(", ")}`
      : eventYearMismatch
        ? eventYearMismatch
      : searchPlan?.requiresSourceOfRecordHunt && missingRequestedModel
        ? `source does not mention requested model: ${requestedModel}`
      : publisherClass === "official_org" && topicFit === "adjacent_context" && relevance < 0.2
        ? "official domain but low topic relevance"
        : searchPlan?.requiresSourceOfRecordHunt && topicFit === "adjacent_context" && publisherClass !== "official_org"
          ? "low relevance to source-of-record hunt"
        : publisherClass === "unknown" && relevance < 0.28
          ? "unknown source quality"
        : relevance < 0.12
          ? "low relevance to canonical query"
          : undefined;
  const effectiveTier: EvidenceTier = discardReason
    ? topicFit === "irrelevant" ? "irrelevant" : "low_quality"
    : tier;
  return {
    ...candidate,
    tier: effectiveTier,
    publisherClass,
    topicFit,
    evidenceRole,
    sourceScore: {
      authority,
      relevance: Math.round(relevance * 30),
      freshness,
      originality,
      evidenceValue,
      noisePenalty,
      finalScore,
    },
    qualityReason: reason,
    ...(discardReason ? { discardReason } : {}),
  } as InsightSourceCandidate | DiscardedInsightSourceCandidate;
}

function isDiscarded(candidate: InsightSourceCandidate | DiscardedInsightSourceCandidate): candidate is DiscardedInsightSourceCandidate {
  return Boolean((candidate as DiscardedInsightSourceCandidate).discardReason);
}

function summarizeEvidence(candidates: InsightSourceCandidate[], discarded: DiscardedInsightSourceCandidate[]): InsightEvidencePackage["evidenceSummary"] {
  return {
    officialCount: candidates.filter((candidate) => candidate.tier === "official").length,
    primaryCount: candidates.filter((candidate) => candidate.tier === "primary").length,
    secondaryCount: candidates.filter((candidate) => candidate.tier === "secondary").length,
    lowQualityCount: discarded.filter((candidate) => candidate.tier === "low_quality").length,
    irrelevantCount: discarded.filter((candidate) => candidate.tier === "irrelevant").length,
    discardedCount: discarded.length,
    sourceOfRecordCount: candidates.filter((candidate) => candidate.evidenceRole === "source_of_record").length,
    corroborationCount: candidates.filter((candidate) => candidate.evidenceRole === "corroboration").length,
    contextCount: candidates.filter((candidate) => candidate.evidenceRole === "context").length,
    commentaryCount: candidates.filter((candidate) => candidate.evidenceRole === "commentary").length,
  };
}

function evidenceConfidence(summary: InsightEvidencePackage["evidenceSummary"]): "high" | "medium" | "low" {
  if (!summary) return "low";
  if ((summary.sourceOfRecordCount || 0) >= 1 && (summary.corroborationCount || 0) >= 1) return "high";
  if ((summary.sourceOfRecordCount || 0) >= 1) return "medium";
  if ((summary.corroborationCount || 0) >= 3) return "medium";
  return "low";
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 500) };
  }
}

function extractHtmlTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return match ? collapseWhitespace(decodeHtmlEntities(stripHtml(match))) : undefined;
}

function extractMetaDescription(html: string): string | undefined {
  const match = html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["'][^>]*>/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description)["'][^>]*>/i);
  return match?.[1] ? collapseWhitespace(decodeHtmlEntities(match[1])) : undefined;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export class SourceResearchProvider {
  private readonly env: Record<string, string | undefined>;
  private readonly fetchImpl: SourceResearchFetch;
  private readonly now: () => Date;
  private readonly maxCandidates: number;
  private readonly queryConfig: QueryCorrectionConfig;
  private readonly qualityConfig: SourceQualityConfig;
  private readonly searchExecutor?: SearchExecutor;
  private readonly searchPlanner?: SearchPlanner;
  private readonly sourceJudge?: SourceJudge;

  constructor(options: SourceResearchOptions = {}) {
    this.env = options.env || process.env;
    this.fetchImpl = options.fetchImpl || fetch;
    this.now = options.now || (() => new Date());
    this.maxCandidates = options.maxCandidates || 20;
    this.queryConfig = loadJsonFile<QueryCorrectionConfig>(
      options.queryConfigPath || defaultDataPath("query-corrections.json"),
      DEFAULT_QUERY_CORRECTIONS,
    );
    this.qualityConfig = loadJsonFile<SourceQualityConfig>(
      options.qualityConfigPath || defaultDataPath("source-quality-domains.json"),
      DEFAULT_SOURCE_QUALITY,
    );
    this.searchExecutor = options.searchExecutor;
    this.searchPlanner = options.searchPlanner;
    this.sourceJudge = options.sourceJudge;
  }

  async run(input: ResearchInput): Promise<InsightEvidencePackage> {
    return this.research(input.topic);
  }

  async research(topic: string): Promise<InsightEvidencePackage> {
    const trimmedTopic = topic.trim();
    const normalizedQuery = normalizeQuery(trimmedTopic, this.queryConfig);
    const warnings: string[] = [];
    if (!trimmedTopic) {
      return {
        topic,
        generatedAt: this.now().toISOString(),
        candidates: [],
        warnings: ["topic is empty"],
      };
    }

    const candidates: InsightSourceCandidate[] = [];
    const sourceHunt = buildSourceHuntPlan(normalizedQuery);
    const requiresSourceOfRecordHunt = requiresSourceHuntGate(sourceHunt);
    const maxSearches = sourceHunt.type === "general" ? 8 : 12;
    const deterministicPlan = createDeterministicSearchPlan({
      topic: trimmedTopic,
      normalizedQuery,
      maxSearches,
      maxCandidates: this.maxCandidates,
      requiresSourceOfRecordHunt,
    });
    let searchPlan = deterministicPlan;
    if (this.searchPlanner) {
      try {
        searchPlan = normalizeSearchPlan(await this.searchPlanner.plan({
          topic: trimmedTopic,
          normalizedQuery,
          maxSearches,
          maxCandidates: this.maxCandidates,
          requiresSourceOfRecordHunt,
        }), deterministicPlan);
      } catch (error: any) {
        warnings.push(`LLM search planner failed, fallback to deterministic plan: ${error?.message || String(error)}`);
      }
    }
    if (searchPlan.warnings?.length) warnings.push(...searchPlan.warnings);
    if (this.searchExecutor) {
      try {
        candidates.push(...await this.searchExecutor.search(searchPlan));
      } catch (error: any) {
        warnings.push(`search executor failed: ${error?.message || String(error)}`);
      }
    } else {
      const startedAt = Date.now();
      let queryRoundCount = 0;
      const runQueryRound = async (queries: string[], options: { allowEarlyStop: boolean; roundLabel: string }) => {
        for (const [queryIndex, query] of queries.entries()) {
          if (queryRoundCount >= maxSearches) break;
          if (Date.now() - startedAt > 25_000) {
            warnings.push(`${options.roundLabel} stopped: 25s total timeout reached`);
            break;
          }
          queryRoundCount += 1;
          const providerCalls: Array<Promise<SearchResponse>> = [];
          providerCalls.push(this.searchTavily(query));
          providerCalls.push(this.searchBocha(query));
          providerCalls.push(this.searchBrave(query));
          const results = await Promise.all(providerCalls);
          for (const result of results) {
            candidates.push(...result.candidates);
            if (result.warning) warnings.push(result.warning);
          }
          if (!options.allowEarlyStop) continue;
          const scored = dedupe(candidates, this.maxCandidates * 2)
            .map((candidate) => scoreCandidate(candidate, normalizedQuery, this.qualityConfig, searchPlan));
          const acceptedSoFar = scored.filter((candidate): candidate is InsightSourceCandidate => !isDiscarded(candidate));
          const hasSourceOfRecord = acceptedSoFar.some((candidate) => candidate.evidenceRole === "source_of_record");
          const sourceOfRecordHuntComplete = !requiresSourceOfRecordHunt || queryIndex >= 2;
          if (acceptedSoFar.length >= 5 && hasSourceOfRecord && sourceOfRecordHuntComplete) break;
        }
      };

      const fallbackQueryCount = searchPlan.sourceHunt?.fallbackQueries?.length || 0;
      const primaryQueries = fallbackQueryCount
        ? searchPlan.queries.slice(0, Math.max(3, maxSearches - Math.min(4, fallbackQueryCount)))
        : searchPlan.queries;
      await runQueryRound(primaryQueries, { allowEarlyStop: true, roundLabel: "primary search" });
      const primaryScored = dedupe(candidates, this.maxCandidates * 2)
        .map((candidate) => scoreCandidate(candidate, normalizedQuery, this.qualityConfig, searchPlan));
      const primaryAccepted = primaryScored.filter((candidate): candidate is InsightSourceCandidate => !isDiscarded(candidate));
      const hasSourceOfRecord = primaryAccepted.some((candidate) => candidate.evidenceRole === "source_of_record");
      const fallbackQueries = uniqueStrings(searchPlan.sourceHunt?.fallbackQueries || [])
        .filter((query) => !primaryQueries.includes(query));
      if (!hasSourceOfRecord && fallbackQueries.length && queryRoundCount < maxSearches && Date.now() - startedAt <= 25_000) {
        warnings.push(`source-of-record hunt fallback triggered: ${searchPlan.sourceHunt?.type || "general"}`);
        await runQueryRound(fallbackQueries, { allowEarlyStop: false, roundLabel: "source hunt fallback" });
      }
    }
    if (searchPlan.sourceHunt?.directSourceUrls?.length) {
      candidates.push(...await this.fetchDirectSourceUrls(searchPlan.sourceHunt.directSourceUrls, warnings));
    }
    const judgedCandidates = await this.annotateWithSourceJudge({
      topic: trimmedTopic,
      normalizedQuery,
      searchPlan,
      candidates: dedupe(candidates, this.maxCandidates * 2),
      warnings,
    });
    const scored = judgedCandidates
      .map((candidate) => scoreCandidate(candidate, normalizedQuery, this.qualityConfig, searchPlan));
    const accepted = scored
      .filter((candidate): candidate is InsightSourceCandidate => !isDiscarded(candidate))
      .sort((a, b) => (b.sourceScore?.finalScore || 0) - (a.sourceScore?.finalScore || 0))
      .slice(0, this.maxCandidates)
      .map((candidate, index) => ({ ...candidate, sourceId: `src_${String(index + 1).padStart(3, "0")}` }));
    const discarded = scored
      .filter(isDiscarded)
      .sort((a, b) => (b.sourceScore?.finalScore || 0) - (a.sourceScore?.finalScore || 0));
    const evidenceSummary = summarizeEvidence(accepted, discarded);
    if (accepted.length < 5) warnings.push(`source recall is low: ${accepted.length} candidates`);
    const allWarnings = [
      ...(normalizedQuery.canonicalQuery !== trimmedTopic ? [`search query derived: ${normalizedQuery.canonicalQuery}`] : []),
      ...warnings,
    ];
    return {
      topic: trimmedTopic,
      normalizedQuery,
      searchPlan,
      generatedAt: this.now().toISOString(),
      candidates: accepted,
      discardedSources: discarded,
      evidenceSummary,
      confidence: evidenceConfidence(evidenceSummary),
      warnings: allWarnings.length ? allWarnings : undefined,
    };
  }

  private async annotateWithSourceJudge(input: {
    topic: string;
    normalizedQuery: NormalizedQuery;
    searchPlan: SearchPlan;
    candidates: InsightSourceCandidate[];
    warnings: string[];
  }): Promise<InsightSourceCandidate[]> {
    if (!this.sourceJudge || input.candidates.length === 0) return input.candidates;
    try {
      const candidatesForJudge = input.candidates.slice(0, Math.min(24, this.maxCandidates * 2));
      const decisions = await this.sourceJudge.judge({
        topic: input.topic,
        normalizedQuery: input.normalizedQuery,
        searchPlan: input.searchPlan,
        candidates: candidatesForJudge,
      });
      const decisionsByKey = new Map<string, SourceJudgeSignal>();
      for (const decision of decisions || []) {
        const signal = validSourceJudgeSignal(decision);
        if (!signal) continue;
        for (const key of sourceJudgeKeys(decision)) {
          decisionsByKey.set(key, signal);
        }
      }
      if (decisionsByKey.size === 0) return input.candidates;
      return input.candidates.map((candidate) => {
        const signal = sourceJudgeKeys(candidate).map((key) => decisionsByKey.get(key)).find(Boolean);
        return signal ? { ...candidate, sourceJudge: signal } : candidate;
      });
    } catch (error: any) {
      input.warnings.push(`LLM source judge failed, using deterministic evidence gate: ${error?.message || String(error)}`);
      return input.candidates;
    }
  }

  private async fetchDirectSourceUrls(urls: string[], warnings: string[]): Promise<InsightSourceCandidate[]> {
    const uniqueUrls = uniqueStrings(urls).slice(0, 4);
    const results = await Promise.all(uniqueUrls.map((url, index) => this.fetchDirectSourceUrl(url, index, warnings)));
    return results.filter((candidate): candidate is InsightSourceCandidate => Boolean(candidate));
  }

  private async fetchDirectSourceUrl(url: string, index: number, warnings: string[]): Promise<InsightSourceCandidate | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: { accept: "text/html,text/plain;q=0.8" },
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !/text\/html|text\/plain/i.test(contentType)) return null;
      const html = (await response.text()).slice(0, 80_000);
      const title = extractHtmlTitle(html) || url;
      const snippet = extractMetaDescription(html) || collapseWhitespace(decodeHtmlEntities(stripHtml(html))).slice(0, 700);
      return {
        id: idFor("direct", url, index),
        title,
        url,
        sourceName: hostFor(url),
        snippet,
        provider: "direct",
        credibility: inferCredibility(url),
        language: inferLanguage(`${title} ${snippet}`),
        tags: tagsFor(title, snippet),
        score: 1,
      };
    } catch (error: any) {
      warnings.push(`direct source fetch failed: ${url} (${error?.message || String(error)})`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async searchTavily(topic: string): Promise<SearchResponse> {
    const key = this.env.TAVILY_API_KEY;
    if (!key) return { candidates: [], warning: "Tavily disabled: missing TAVILY_API_KEY" };
    try {
      const response = await this.fetchImpl("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          query: topic,
          search_depth: "advanced",
          max_results: 8,
          include_answer: false,
          include_raw_content: false,
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) return { candidates: [], warning: `Tavily failed: http_${response.status}` };
      const results = Array.isArray(payload.results) ? payload.results : [];
      return {
        candidates: results.map((item: any, index: number) => this.candidate("tavily", topic, {
          title: item.title,
          url: item.url,
          snippet: item.content,
          score: typeof item.score === "number" ? item.score : undefined,
        }, index)),
      };
    } catch (error: any) {
      return { candidates: [], warning: `Tavily failed: ${error?.message || String(error)}` };
    }
  }

  private async searchBocha(topic: string): Promise<SearchResponse> {
    const key = this.env.BOCHA_API_KEY;
    if (!key) return { candidates: [], warning: "Bocha disabled: missing BOCHA_API_KEY" };
    try {
      const response = await this.fetchImpl("https://api.bochaai.com/v1/web-search", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          query: topic,
          freshness: "oneMonth",
          summary: true,
          count: 8,
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) return { candidates: [], warning: `Bocha failed: http_${response.status}` };
      const pages = Array.isArray(payload?.data?.webPages?.value)
        ? payload.data.webPages.value
        : Array.isArray(payload?.webPages?.value) ? payload.webPages.value : [];
      return {
        candidates: pages.map((item: any, index: number) => this.candidate("bocha", topic, {
          title: item.name || item.title,
          url: item.url,
          sourceName: item.siteName,
          snippet: item.summary || item.snippet || item.displayUrl,
        }, index)),
      };
    } catch (error: any) {
      return { candidates: [], warning: `Bocha failed: ${error?.message || String(error)}` };
    }
  }

  private async searchBrave(topic: string): Promise<SearchResponse> {
    const key = this.env.BRAVE_API_KEY;
    if (!key) return { candidates: [], warning: "Brave disabled: missing BRAVE_API_KEY" };
    try {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", topic);
      url.searchParams.set("count", "8");
      url.searchParams.set("search_lang", "en");
      const response = await this.fetchImpl(url.toString(), {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-subscription-token": key,
        },
      });
      const payload = await readJson(response);
      if (!response.ok) return { candidates: [], warning: `Brave failed: http_${response.status}` };
      const results = Array.isArray(payload?.web?.results) ? payload.web.results : [];
      return {
        candidates: results.map((item: any, index: number) => this.candidate("brave", topic, {
          title: item.title,
          url: item.url,
          sourceName: item.profile?.name,
          snippet: item.description,
          publishedAt: item.age,
        }, index)),
      };
    } catch (error: any) {
      return { candidates: [], warning: `Brave failed: ${error?.message || String(error)}` };
    }
  }

  private candidate(
    provider: InsightSearchProvider,
    topic: string,
    value: CandidateInput,
    index: number,
  ): InsightSourceCandidate {
    const url = String(value.url || "");
    const title = String(value.title || url || "Untitled source");
    const snippet = value.snippet ? String(value.snippet) : undefined;
    const combined = `${title} ${snippet || ""}`;
    return {
      id: idFor(provider, url || title, index),
      title,
      url,
      sourceName: value.sourceName,
      publishedAt: value.publishedAt,
      snippet,
      provider,
      credibility: inferCredibility(url),
      language: inferLanguage(combined),
      tags: tagsFor(topic, combined),
      score: value.score,
    };
  }
}

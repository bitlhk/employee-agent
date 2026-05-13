import { describe, expect, it, vi } from "vitest";
import { SourceResearchProvider } from "../source-research-provider";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function provider(fetchImpl: typeof fetch, env: Record<string, string | undefined> = {}) {
  return new SourceResearchProvider({
    env,
    fetchImpl,
    now: () => new Date("2026-05-04T00:00:00.000Z"),
    maxCandidates: 20,
  });
}

describe("SourceResearchProvider", () => {
  it("returns warnings and no candidates when all search keys are missing", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await provider(fetchImpl).research("Sequoia AI Ascent 2026");

    expect(result.candidates).toEqual([]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      "Tavily disabled: missing TAVILY_API_KEY",
      "Bocha disabled: missing BOCHA_API_KEY",
      "Brave disabled: missing BRAVE_API_KEY",
      "source recall is low: 0 candidates",
    ]));
    expect((fetchImpl as any).mock.calls.map((call: any[]) => String(call[0]))).toEqual([
      "https://karpathy.bearblog.dev/sequoia-ascent-2026/",
      "https://sequoiacap.com/article/2026-this-is-agi/",
    ]);
  });

  it("maps Tavily results and uses bearer auth without leaking the key into output", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      results: [{
        title: "Sequoia AI Ascent 2026",
        url: "https://www.sequoiacap.com/article/ai-ascent-2026/",
        content: "AI conference notes for 2026",
        score: 0.92,
      }],
    })) as unknown as typeof fetch;

    const result = await provider(fetchImpl, { TAVILY_API_KEY: "tavily-secret" }).research("AI Ascent 2026");

    expect(fetchImpl).toHaveBeenCalledWith("https://api.tavily.com/search", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer tavily-secret" }),
    }));
    expect(result.candidates[0]).toMatchObject({
      provider: "tavily",
      credibility: "official",
      title: "Sequoia AI Ascent 2026",
      tags: expect.arrayContaining(["ai"]),
    });
    expect(JSON.stringify(result)).not.toContain("tavily-secret");
  });

  it("maps Bocha webPages results", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      data: {
        webPages: {
          value: [{
            name: "AI金融应用观察",
            url: "https://36kr.com/p/ai-finance",
            siteName: "Example CN",
            summary: "银行 AI 应用趋势",
          }],
        },
      },
    })) as unknown as typeof fetch;

    const result = await provider(fetchImpl, { BOCHA_API_KEY: "bocha-secret" }).research("AI 金融 趋势");

    expect(fetchImpl).toHaveBeenCalledWith("https://api.bochaai.com/v1/web-search", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer bocha-secret" }),
    }));
    expect(result.candidates[0]).toMatchObject({
      provider: "bocha",
      language: "zh",
      sourceName: "Example CN",
      tags: expect.arrayContaining(["ai", "finance"]),
    });
    expect(JSON.stringify(result)).not.toContain("bocha-secret");
  });

  it("maps Brave web results with X-Subscription-Token", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      web: {
        results: [{
          title: "OpenAI model release",
          url: "https://openai.com/index/model-release/",
          description: "Latest model release",
          profile: { name: "OpenAI" },
          age: "2 days ago",
        }],
      },
    })) as unknown as typeof fetch;

    const result = await provider(fetchImpl, { BRAVE_API_KEY: "brave-secret" }).research("latest OpenAI model");

    expect(String((fetchImpl as any).mock.calls[0][0])).toContain("api.search.brave.com");
    expect((fetchImpl as any).mock.calls[0][1].headers).toMatchObject({
      "x-subscription-token": "brave-secret",
    });
    expect(result.candidates[0]).toMatchObject({
      provider: "brave",
      credibility: "official",
      sourceName: "OpenAI",
      publishedAt: "2 days ago",
    });
    expect(JSON.stringify(result)).not.toContain("brave-secret");
  });

  it("dedupes by normalized URL and keeps the normalized official source", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const requestUrl = String(url);
      if (requestUrl.includes("tavily")) {
        return jsonResponse({
          results: [{
            title: "Mirror",
            url: "https://openai.com/index/foo/?utm_source=newsletter",
            content: "Mirror copy",
            score: 0.1,
          }],
        });
      }
      if (requestUrl.includes("bochaai")) {
        return jsonResponse({
          data: { webPages: { value: [] } },
        });
      }
      return jsonResponse({
        web: {
          results: [{
            title: "Official",
            url: "https://openai.com/index/foo/",
            description: "Official source",
          }],
        },
      });
    }) as unknown as typeof fetch;

    const result = await provider(fetchImpl, {
      TAVILY_API_KEY: "tavily-secret",
      BOCHA_API_KEY: "bocha-secret",
      BRAVE_API_KEY: "brave-secret",
    }).research("OpenAI foo");

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      credibility: "official",
    });
  });

  it("keeps individual provider failures as warnings while returning successful candidates", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const requestUrl = String(url);
      if (requestUrl.includes("tavily")) return jsonResponse({ error: "boom" }, { status: 500 });
      if (requestUrl.includes("bochaai")) return jsonResponse({ data: { webPages: { value: [] } } });
      return jsonResponse({
        web: {
          results: [{
            title: "AI agents in banking",
            url: "https://www.reuters.com/technology/ai-agents-banking",
            description: "Banking AI agents",
          }],
        },
      });
    }) as unknown as typeof fetch;

    const result = await provider(fetchImpl, {
      TAVILY_API_KEY: "tavily-secret",
      BOCHA_API_KEY: "bocha-secret",
      BRAVE_API_KEY: "brave-secret",
    }).research("AI agents banking");

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ provider: "brave", credibility: "trusted_media" });
    expect(result.warnings).toEqual(expect.arrayContaining(["Tavily failed: http_500"]));
  });

  it("keeps provider diversity instead of letting one provider fill the entire package", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const requestUrl = String(url);
      if (requestUrl.includes("tavily")) {
        return jsonResponse({
          results: Array.from({ length: 8 }, (_, index) => ({
            title: `Tavily ${index}`,
            url: `https://sequoiacap.com/article/tavily-${index}`,
            content: "AI finance",
            score: 0.8,
          })),
        });
      }
      if (requestUrl.includes("bochaai")) {
        return jsonResponse({
          data: {
            webPages: {
              value: Array.from({ length: 4 }, (_, index) => ({
                name: `Bocha ${index}`,
                url: `https://36kr.com/p/bocha-${index}`,
                snippet: "AI 金融",
              })),
            },
          },
        });
      }
      return jsonResponse({ web: { results: [] } });
    }) as unknown as typeof fetch;

    const result = await new SourceResearchProvider({
      env: {
        TAVILY_API_KEY: "tavily-secret",
        BOCHA_API_KEY: "bocha-secret",
        BRAVE_API_KEY: "brave-secret",
      },
      fetchImpl,
      now: () => new Date("2026-05-04T00:00:00.000Z"),
      maxCandidates: 8,
    }).research("AI 金融");

    expect(result.candidates).toHaveLength(8);
    expect(result.candidates.filter((candidate) => candidate.provider === "tavily")).toHaveLength(4);
    expect(result.candidates.filter((candidate) => candidate.provider === "bocha")).toHaveLength(4);
  });

  it("derives a focused search query from long PPT instructions", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const requestUrl = String(url);
      if (requestUrl.includes("tavily")) return jsonResponse({ results: [] });
      if (requestUrl.includes("bochaai")) return jsonResponse({ data: { webPages: { value: [] } } });
      return jsonResponse({ web: { results: [] } });
    }) as unknown as typeof fetch;

    const prompt = "请基于 Sequoia AI Ascent 2026 的最新观点，生成一份 6 页中文 PPT，主题是 AI Agent 对银行财富管理的影响。专业、克制、白底投行风。";
    const result = await provider(fetchImpl, {
      TAVILY_API_KEY: "tavily-secret",
      BOCHA_API_KEY: "bocha-secret",
      BRAVE_API_KEY: "brave-secret",
    }).research(prompt);
    const tavilyCall = (fetchImpl as any).mock.calls.find((call: any[]) => String(call[0]).includes("tavily"));
    const body = JSON.parse(tavilyCall[1].body);

    expect(result.normalizedQuery?.canonicalQuery).toBe("Sequoia AI Ascent 2026 AI Agent 对银行财富管理的影响");
    expect(body.query).toContain("site:karpathy.bearblog.dev");
    expect(result.normalizedQuery?.canonicalQuery).not.toContain("生成");
    expect(result.normalizedQuery?.canonicalQuery).not.toContain("PPT");
    expect(result.warnings).toEqual(expect.arrayContaining([
      "search query derived: Sequoia AI Ascent 2026 AI Agent 对银行财富管理的影响",
    ]));
  });

  it("records deterministic entity corrections without dropping the raw query", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      results: [{
        title: "AI Ascent official notes",
        url: "https://sequoiacap.com/article/ai-ascent/",
        content: "Sequoia AI Ascent",
        score: 0.9,
      }],
    })) as unknown as typeof fetch;

    const result = await provider(fetchImpl, { TAVILY_API_KEY: "tavily-secret" })
      .research("搜索一下红杉资本 2026 AI Ascend 大会的新观点");

    expect(result.normalizedQuery?.rawQuery).toContain("AI Ascend");
    expect(result.normalizedQuery?.canonicalQuery).toContain("AI Ascent");
    expect(result.normalizedQuery?.corrections[0]).toMatchObject({
      from: "AI Ascend",
      to: "AI Ascent",
      confidence: "high",
    });
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("search query derived:"),
    ]));
  });

  it("keeps official sources and discards blacklisted SEO or conference sources", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      results: [
        {
          title: "Sequoia AI Ascent 2026 official page",
          url: "https://sequoiacap.com/article/ai-ascent/",
          content: "AI Ascent 2026 keynote",
          score: 0.9,
        },
        {
          title: "AI conference call for papers",
          url: "https://icaigd.com/cfp/ai-2026",
          content: "AI conference advertisement",
          score: 0.99,
        },
      ],
    })) as unknown as typeof fetch;

    const result = await provider(fetchImpl, { TAVILY_API_KEY: "tavily-secret" }).research("Sequoia AI Ascent 2026");

    expect(result.candidates[0]).toMatchObject({
      sourceId: "src_001",
      tier: "official",
      publisherClass: "official_org",
      topicFit: "exact_event",
      evidenceRole: "source_of_record",
      sourceScore: expect.objectContaining({ authority: 50 }),
    });
    expect(result.discardedSources?.[0]).toMatchObject({
      tier: "irrelevant",
      discardReason: expect.stringContaining("blacklist pattern"),
    });
  });

  it("defaults unknown low-quality domains to discarded sources", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      results: [{
        title: "Random AI optimization service",
        url: "https://unknown-seo.example.com/ai",
        content: "generic AI marketing copy",
        score: 0.2,
      }],
    })) as unknown as typeof fetch;

    const result = await provider(fetchImpl, { TAVILY_API_KEY: "tavily-secret" }).research("Sequoia AI Ascent 2026");

    expect(result.candidates).toHaveLength(0);
    expect(result.discardedSources?.[0]).toMatchObject({
      tier: "low_quality",
      discardReason: expect.stringMatching(/unknown source quality|low relevance to source-of-record hunt/),
    });
  });

  it("keeps relevant unknown emerging-tech sources as low-confidence commentary", async () => {
    const searchPlanner = {
      plan: vi.fn(async ({ normalizedQuery, maxSearches, maxCandidates, requiresSourceOfRecordHunt }: any) => ({
        normalizedQuery,
        queries: [
          "Llama 4 vs Qwen 3 vs DeepSeek V3 performance analysis",
          "SOTA open source LLM benchmark comparison",
        ],
        maxSearches,
        maxCandidates,
        requiresSourceOfRecordHunt,
        planner: { mode: "lingxia-llm", provider: "deepseek", model: "deepseek-chat" },
        officialSourceHints: ["Qwen GitHub", "DeepSeek official release"],
      })),
    };
    const searchExecutor = {
      search: vi.fn(async () => [{
        id: "mock-spheron",
        title: "DeepSeek V3.2 vs Llama 4 vs Qwen 3 performance analysis",
        url: "https://www.spheron.network/blog/deepseek-vs-llama-4-vs-qwen3",
        snippet: "Open source LLM comparison and benchmark commentary for finance AI teams.",
        provider: "tavily",
        credibility: "unknown",
        language: "en",
        tags: ["ai"],
        score: 0.78,
      }]),
    };

    const result = await new SourceResearchProvider({
      searchPlanner,
      searchExecutor,
      now: () => new Date("2026-05-04T00:00:00.000Z"),
    }).research("分析最新 SOTA 开源模型对金融 AI 的影响并生成 PPT");

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      publisherClass: "unknown",
      evidenceRole: "commentary",
      tier: "secondary",
    });
    expect(result.confidence).toBe("low");
  });

  it("uses source judge relevance without letting it decide evidence role", async () => {
    const searchExecutor = {
      search: vi.fn(async () => [{
        id: "mock-unknown-ai-workflow",
        title: "Enterprise agent workflow operating model",
        url: "https://example-lab.invalid/agent-workflow-operating-model",
        snippet: "A detailed operating model for enterprise AI agent workflow adoption.",
        provider: "tavily",
        credibility: "unknown",
        language: "en",
        tags: ["ai"],
        score: 0.4,
      }]),
    };
    const sourceJudge = {
      judge: vi.fn(async () => [{
        id: "mock-unknown-ai-workflow",
        semanticRelevance: "high",
        usefulness: "core",
        whyUseful: "directly explains the requested workflow topic",
      }]),
    };

    const result = await new SourceResearchProvider({
      searchExecutor,
      sourceJudge,
      now: () => new Date("2026-05-04T00:00:00.000Z"),
    }).research("enterprise AI agent workflow PPT");

    expect(sourceJudge.judge).toHaveBeenCalled();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      publisherClass: "unknown",
      evidenceRole: "commentary",
      sourceJudge: {
        semanticRelevance: "high",
        usefulness: "core",
      },
    });
  });

  it("lets source judge discard non-official semantic noise", async () => {
    const searchExecutor = {
      search: vi.fn(async () => [{
        id: "mock-seo-noise",
        title: "AI agent PPT generation service ranking",
        url: "https://example-seo.invalid/ai-agent-ppt-service-ranking",
        snippet: "SEO page about generic AI service vendors.",
        provider: "tavily",
        credibility: "unknown",
        language: "en",
        tags: ["ai"],
        score: 0.8,
      }]),
    };
    const sourceJudge = {
      judge: vi.fn(async () => [{
        id: "mock-seo-noise",
        semanticRelevance: "low",
        usefulness: "noise",
        noiseReason: "generic SEO vendor ranking, not evidence",
      }]),
    };

    const result = await new SourceResearchProvider({
      searchExecutor,
      sourceJudge,
      now: () => new Date("2026-05-04T00:00:00.000Z"),
    }).research("latest AI agent workflow trends PPT");

    expect(result.candidates).toHaveLength(0);
    expect(result.discardedSources?.[0]).toMatchObject({
      id: "mock-seo-noise",
      discardReason: expect.stringContaining("LLM source judge marked noise"),
    });
  });

  it("falls back to deterministic evidence gate when source judge fails", async () => {
    const searchExecutor = {
      search: vi.fn(async () => [{
        id: "mock-karpathy",
        title: "Sequoia Ascent 2026 notes",
        url: "https://karpathy.bearblog.dev/sequoia-ascent-2026/",
        snippet: "Karpathy Sequoia Ascent 2026 notes about agents and software.",
        provider: "tavily",
        credibility: "unknown",
        language: "en",
        tags: ["ai"],
        score: 0.9,
      }]),
    };
    const sourceJudge = {
      judge: vi.fn(async () => {
        throw new Error("judge unavailable");
      }),
    };

    const result = await new SourceResearchProvider({
      searchExecutor,
      sourceJudge,
      now: () => new Date("2026-05-04T00:00:00.000Z"),
    }).research("Sequoia Ascent2026 latest ideas PPT");

    expect(result.candidates[0]).toMatchObject({
      publisherClass: "speaker_original",
      evidenceRole: "source_of_record",
    });
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("LLM source judge failed"),
    ]));
  });

  it("scores sources against LLM search plan queries instead of only the canonical prompt", async () => {
    const searchPlanner = {
      plan: vi.fn(async ({ normalizedQuery, maxSearches, maxCandidates, requiresSourceOfRecordHunt }: any) => ({
        normalizedQuery,
        queries: ["Llama 4 vs Qwen 3 vs DeepSeek V3 performance analysis"],
        maxSearches,
        maxCandidates,
        requiresSourceOfRecordHunt,
        planner: { mode: "lingxia-llm", provider: "deepseek", model: "deepseek-chat" },
        officialSourceHints: ["Qwen GitHub"],
      })),
    };
    const searchExecutor = {
      search: vi.fn(async () => [{
        id: "mock-plan-match",
        title: "Llama 4 vs Qwen 3 vs DeepSeek V3 performance analysis",
        url: "https://example-research.invalid/llm-comparison",
        snippet: "Benchmark comparison of Llama, Qwen, and DeepSeek models.",
        provider: "tavily",
        credibility: "unknown",
        language: "en",
        tags: ["ai"],
        score: 0.8,
      }]),
    };

    const result = await new SourceResearchProvider({
      searchPlanner,
      searchExecutor,
      now: () => new Date("2026-05-04T00:00:00.000Z"),
    }).research("金融 AI 影响建议 PPT");

    expect(result.searchPlan?.queries).toEqual(expect.arrayContaining([
      "Llama 4 vs Qwen 3 vs DeepSeek V3 performance analysis",
    ]));
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].sourceScore?.relevance).toBeGreaterThanOrEqual(10);
    expect(result.discardedSources?.map((source) => source.title)).not.toContain("Llama 4 vs Qwen 3 vs DeepSeek V3 performance analysis");
  });

  it("keeps research repositories as evidence for open model research", async () => {
    const searchExecutor = {
      search: vi.fn(async () => [{
        id: "mock-qwen-github",
        title: "Latest SOTA open source models comparison Qwen DeepSeek Llama benchmark",
        url: "https://github.com/QwenLM/Qwen3",
        snippet: "Qwen open source LLM release repository with benchmark comparison references.",
        provider: "tavily",
        credibility: "primary",
        language: "en",
        tags: ["ai"],
        score: 0.92,
      }]),
    };

    const result = await new SourceResearchProvider({
      searchExecutor,
      now: () => new Date("2026-05-04T00:00:00.000Z"),
    }).research("latest SOTA open source models comparison Qwen DeepSeek Llama benchmark");

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      publisherClass: "research_repository",
      topicFit: "exact_event",
      evidenceRole: "corroboration",
      tier: "secondary",
    });
  });

  it("treats reputable media as corroboration, not primary evidence", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      results: [{
        title: "Tencent report on Sequoia AI Ascent 2026",
        url: "https://news.qq.com/rain/a/20260430A01L1K00",
        content: "Sequoia AI Ascent 2026 conference takeaways",
        score: 0.9,
      }, {
        title: "36Kr report on Sequoia AI Ascent 2026",
        url: "https://36kr.com/p/3277312513538434",
        content: "Sequoia AI Ascent 2026 conference analysis",
        score: 0.88,
      }],
    })) as unknown as typeof fetch;

    const result = await provider(fetchImpl, { TAVILY_API_KEY: "tavily-secret" }).research("Sequoia AI Ascent 2026");

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]).toMatchObject({
      publisherClass: "reputable_media",
      topicFit: "exact_event",
      evidenceRole: "corroboration",
      tier: "secondary",
    });
    expect(result.candidates[1]).toMatchObject({
      publisherClass: "reputable_media",
      evidenceRole: "corroboration",
      tier: "secondary",
    });
  });

  it("keeps vendor official articles as context for generic banking topics", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      results: [{
        title: "IBM Study: Gen AI Will Elevate Financial Performance of Banks in 2025",
        url: "https://newsroom.ibm.com/2025-01-10-gen-ai-bank-study",
        content: "AI agents and generative AI can affect bank efficiency and risk operations.",
        score: 0.94,
      }],
    })) as unknown as typeof fetch;

    const result = await provider(fetchImpl, { TAVILY_API_KEY: "tavily-secret" })
      .research("AI agent bank operational efficiency risk control 2025 report");

    expect(result.candidates[0]).toMatchObject({
      publisherClass: "vendor_official",
      evidenceRole: "context",
      tier: "secondary",
    });
    expect(result.evidenceSummary?.sourceOfRecordCount).toBe(0);
  });

  it("marks Karpathy original Sequoia Ascent 2026 notes as source of record", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      results: [{
        title: "Sequoia Ascent 2026 summary",
        url: "https://karpathy.bearblog.dev/sequoia-ascent-2026/",
        content: "Karpathy Sequoia Ascent 2026 fireside chat summary and transcript",
        score: 0.96,
      }],
    })) as unknown as typeof fetch;

    const result = await provider(fetchImpl, { TAVILY_API_KEY: "tavily-secret" }).research("Sequoia AI Ascent 2026 Karpathy");

    expect(result.candidates[0]).toMatchObject({
      publisherClass: "speaker_original",
      topicFit: "exact_event",
      evidenceRole: "source_of_record",
      tier: "primary",
    });
    expect(result.confidence).toBe("medium");
  });

  it("does not treat an unverified YouTube match as source of record", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      results: [{
        title: "This is AGI: Sequoia AI Ascent 2026 Keynote - YouTube",
        url: "https://www.youtube.com/watch?v=LRo33rnv6rQ",
        content: "Sequoia AI Ascent 2026 talk",
        score: 0.95,
      }],
    })) as unknown as typeof fetch;

    const result = await provider(fetchImpl, { TAVILY_API_KEY: "tavily-secret" }).research("Sequoia AI Ascent 2026");

    expect(result.candidates[0]).toMatchObject({
      publisherClass: "aggregator",
      topicFit: "exact_event",
      evidenceRole: "commentary",
      tier: "secondary",
    });
    expect(result.confidence).toBe("low");
  });

  it("runs the source-of-record hunt before stopping early", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      return jsonResponse({
        results: Array.from({ length: 5 }, (_, index) => ({
          title: `Sequoia Ascent 2026 source ${index} for ${body.query}`,
          url: `https://karpathy.bearblog.dev/sequoia-ascent-2026-${index}/`,
          content: "Karpathy Sequoia Ascent 2026 notes",
          score: 0.99,
        })),
      });
    }) as unknown as typeof fetch;

    await provider(fetchImpl, { TAVILY_API_KEY: "tavily-secret" }).research("Sequoia AI Ascent 2026 Karpathy");

    const calledQueries = (fetchImpl as any).mock.calls.map(([, init]: any[]) => JSON.parse(String(init?.body || "{}")).query);
    expect(calledQueries[0]).toContain("site:karpathy.bearblog.dev");
    expect(calledQueries[1]).toContain("site:sequoiacap.com");
    expect(calledQueries[2]).toContain("Sequoia AI Ascent 2026");
  });

  it("keeps Sequoia official adjacent material as context, not source of record", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      results: [{
        title: "AI in 2026: A Tale of Two AIs",
        url: "https://sequoiacap.com/article/ai-in-2026-the-tale-of-two-ais/",
        content: "Sequoia 2026 AI market outlook without direct event transcript",
        score: 0.91,
      }],
    })) as unknown as typeof fetch;

    const result = await provider(fetchImpl, { TAVILY_API_KEY: "tavily-secret" }).research("Sequoia AI Ascent 2026");

    expect(result.candidates[0]).toMatchObject({
      publisherClass: "official_org",
      topicFit: "same_entity_topic",
      evidenceRole: "context",
      tier: "secondary",
    });
    expect(result.confidence).toBe("low");
  });

  it("discards official-domain pages that miss the requested year", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      results: [
        {
          title: "Sequoia AI Ascent 2025 Conference",
          url: "https://sequoiacap.com/article/ai-ascent-2025/",
          content: "AI Ascent conference archive",
          score: 0.95,
        },
        {
          title: "AI in 2026: A Tale of Two AIs",
          url: "https://sequoiacap.com/article/ai-in-2026-the-tale-of-two-ais/",
          content: "Sequoia AI 2026 outlook",
          score: 0.91,
        },
      ],
    })) as unknown as typeof fetch;

    const result = await provider(fetchImpl, { TAVILY_API_KEY: "tavily-secret" }).research("Sequoia AI Ascent 2026");

    expect(result.candidates.map((candidate) => candidate.title)).toContain("AI in 2026: A Tale of Two AIs");
    expect(result.discardedSources?.some((candidate) =>
      candidate.title === "Sequoia AI Ascent 2025 Conference"
      && candidate.discardReason === "official domain but missing requested year: 2026",
    )).toBe(true);
  });

  it("treats compact event-year input as a requested year", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      results: [
        {
          title: "Sequoia AI Ascent 2025 Conference",
          url: "https://sequoiacap.com/article/ai-ascent-2025/",
          content: "AI Ascent conference archive",
          score: 0.95,
        },
        {
          title: "Sequoia Ascent 2026 summary",
          url: "https://karpathy.bearblog.dev/sequoia-ascent-2026/",
          content: "Karpathy Sequoia Ascent 2026 notes",
          score: 0.96,
        },
      ],
    })) as unknown as typeof fetch;

    const result = await provider(fetchImpl, { TAVILY_API_KEY: "tavily-secret" }).research("看一下 Sequoia Ascent2026 最新观点");

    expect(result.searchPlan?.sourceHunt?.entities.year).toBe("2026");
    expect(result.candidates.map((candidate) => candidate.title)).toContain("Sequoia Ascent 2026 summary");
    expect(result.candidates.map((candidate) => candidate.title)).not.toContain("Sequoia AI Ascent 2025 Conference");
    expect(result.discardedSources?.some((candidate) =>
      candidate.title === "Sequoia AI Ascent 2025 Conference"
      && candidate.discardReason === "official domain but missing requested year: 2026",
    )).toBe(true);
  });

  it("discards same-event media pages from a different requested year even if snippets mention the requested year", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      results: [
        {
          title: "Sequoia AI Ascent 2025 Conference coverage",
          url: "https://36kr.com/p/sequoia-ai-ascent-2025",
          content: "A roundup that also mentions what founders expect in 2026.",
          score: 0.98,
        },
        {
          title: "Sequoia Ascent 2026 summary",
          url: "https://karpathy.bearblog.dev/sequoia-ascent-2026/",
          content: "Karpathy Sequoia Ascent 2026 notes on Software 3.0 and jagged intelligence.",
          score: 0.96,
        },
      ],
    })) as unknown as typeof fetch;

    const result = await provider(fetchImpl, { TAVILY_API_KEY: "tavily-secret" }).research("Sequoia Ascent2026 latest views");

    expect(result.candidates.map((candidate) => candidate.title)).toContain("Sequoia Ascent 2026 summary");
    expect(result.candidates.map((candidate) => candidate.title)).not.toContain("Sequoia AI Ascent 2025 Conference coverage");
    expect(result.discardedSources?.some((candidate) =>
      candidate.title === "Sequoia AI Ascent 2025 Conference coverage"
      && candidate.discardReason === "event year mismatch: requested 2026 but source year is 2025",
    )).toBe(true);
  });

  it("adds source-of-record queries for the actual Sequoia Ascent 2026 source trail", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: [] })) as unknown as typeof fetch;

    await provider(fetchImpl, { TAVILY_API_KEY: "tavily-secret" }).research("Sequoia Ascent2026 latest views");

    const calledQueries = (fetchImpl as any).mock.calls
      .map(([, init]: any[]) => JSON.parse(String(init?.body || "{}")).query)
      .filter(Boolean);
    expect(calledQueries.some((query: string) => query.includes("karpathy.bearblog.dev") && query.includes("sequoia-ascent-2026"))).toBe(true);
    expect(calledQueries.some((query: string) => query.includes("Software 3.0"))).toBe(true);
    expect(calledQueries.some((query: string) => query.includes("2026: This is AGI"))).toBe(true);
  });

  it("fetches direct source-of-record URLs when search APIs miss the speaker original", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const requestUrl = String(url);
      if (requestUrl.includes("karpathy.bearblog.dev")) {
        return new Response(`
          <html>
            <head>
              <title>Sequoia Ascent 2026 summary</title>
              <meta name="description" content="Andrej Karpathy notes on Software 3.0, jagged intelligence, and agent-native workflows from Sequoia Ascent 2026." />
            </head>
            <body>Sequoia Ascent 2026 Software 3.0 Jagged Intelligence</body>
          </html>
        `, { headers: { "content-type": "text/html" } });
      }
      if (requestUrl.includes("sequoiacap.com/article/2026-this-is-agi")) {
        return new Response("<html><title>2026: This is AGI | Sequoia Capital</title><body>Sequoia 2026 AGI agents</body></html>", {
          headers: { "content-type": "text/html" },
        });
      }
      return jsonResponse({
        results: [{
          title: "Sequoia AI Ascent 2025 Conference",
          url: "https://sequoiacap.com/article/ai-ascent-2025/",
          content: "Old event archive",
          score: 0.99,
        }],
      });
    }) as unknown as typeof fetch;

    const result = await provider(fetchImpl, { TAVILY_API_KEY: "tavily-secret" }).research("Sequoia Ascent2026 latest views");

    expect(result.candidates[0]).toMatchObject({
      title: "Sequoia Ascent 2026 summary",
      provider: "direct",
      publisherClass: "speaker_original",
      evidenceRole: "source_of_record",
      topicFit: "exact_event",
    });
    expect(result.candidates.map((candidate) => candidate.title)).not.toContain("Sequoia AI Ascent 2025 Conference");
  });

  it("does not hard-code Sequoia Ascent aliases to 2026 when another year is requested", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: [] })) as unknown as typeof fetch;

    await provider(fetchImpl, { TAVILY_API_KEY: "tavily-secret" }).research("看一下 Sequoia Ascent 2025 最新观点");

    const calledQueries = (fetchImpl as any).mock.calls
      .map(([, init]: any[]) => JSON.parse(String(init?.body || "{}")).query)
      .filter(Boolean);
    expect(calledQueries.length).toBeGreaterThan(0);
    expect(calledQueries.some((query: string) => query.includes("2025"))).toBe(true);
    expect(calledQueries.some((query: string) => query.includes("2026"))).toBe(false);
  });

  it("returns an explicit warning for empty topics", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await provider(fetchImpl, { TAVILY_API_KEY: "tavily-secret" }).research("   ");

    expect(result.candidates).toEqual([]);
    expect(result.warnings).toEqual(["topic is empty"]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("falls back to deterministic search plan when planner fails", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      results: [{
        title: "Sequoia Ascent 2026 summary",
        url: "https://karpathy.bearblog.dev/sequoia-ascent-2026/",
        content: "Karpathy Sequoia Ascent 2026 notes",
        score: 0.96,
      }],
    })) as unknown as typeof fetch;
    const searchPlanner = {
      plan: vi.fn(async () => {
        throw new Error("planner unavailable");
      }),
    };

    const result = await new SourceResearchProvider({
      env: { TAVILY_API_KEY: "tavily-secret" },
      fetchImpl,
      now: () => new Date("2026-05-04T00:00:00.000Z"),
      searchPlanner,
    }).research("Sequoia AI Ascent 2026");

    expect(searchPlanner.plan).toHaveBeenCalled();
    expect(result.searchPlan?.planner.mode).toBe("deterministic");
    expect(result.warnings).toEqual(expect.arrayContaining([
      "LLM search planner failed, fallback to deterministic plan: planner unavailable",
    ]));
  });

  it("adds model-release source hunt queries and triggers fallback when no source of record is found", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      if (String(body.query).includes("benchmark")) {
        return jsonResponse({
          results: [{
            title: "Mythos benchmark analysis",
            url: "https://www.techcrunch.com/mythos-benchmark-analysis",
            content: "Mythos model benchmark commentary for finance AI.",
            score: 0.82,
          }],
        });
      }
      return jsonResponse({ results: [] });
    }) as unknown as typeof fetch;

    const result = await provider(fetchImpl, { TAVILY_API_KEY: "tavily-secret" }).research("Mythos 最新模型 对金融 AI 的影响");
    const calledQueries = (fetchImpl as any).mock.calls.map(([, init]: any[]) => JSON.parse(String(init?.body || "{}")).query);

    expect(result.searchPlan?.sourceHunt?.type).toBe("model_release");
    expect(calledQueries.some((query: string) => query.includes("official blog"))).toBe(true);
    expect(result.searchPlan?.sourceHunt?.sourceOfRecordQueries).toEqual(expect.arrayContaining([
      expect.stringContaining("model card"),
    ]));
    expect(calledQueries.some((query: string) => query.includes("benchmark"))).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining([
      "source-of-record hunt fallback triggered: model_release",
    ]));
  });

  it("budgets fallback by query round so model-release recall can try more than one fallback query", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const requestUrl = String(url);
      if (requestUrl.includes("tavily")) return jsonResponse({ results: [] });
      if (requestUrl.includes("bochaai")) return jsonResponse({ data: { webPages: { value: [] } } });
      return jsonResponse({ web: { results: [] } });
    }) as unknown as typeof fetch;

    await provider(fetchImpl, {
      TAVILY_API_KEY: "tavily-secret",
      BOCHA_API_KEY: "bocha-secret",
      BRAVE_API_KEY: "brave-secret",
    }).research("Mythos 最新模型 对金融 AI 的影响");

    const calledQueries = (fetchImpl as any).mock.calls.map(([url, init]: any[]) => {
      const requestUrl = String(url);
      if (requestUrl.includes("brave")) return new URL(requestUrl).searchParams.get("q") || "";
      return JSON.parse(String(init?.body || "{}")).query || "";
    });
    expect(calledQueries.some((query: string) => query.includes("Mythos") && query.includes("benchmark"))).toBe(true);
    expect(calledQueries.some((query: string) => query.includes("Mythos") && query.includes("performance analysis"))).toBe(true);
  });

  it("keeps LLM planner queries while prepending source-hunt queries", async () => {
    const searchPlanner = {
      plan: vi.fn(async ({ normalizedQuery, maxSearches, maxCandidates, requiresSourceOfRecordHunt }: any) => ({
        normalizedQuery,
        queries: ["custom financial AI deployment query"],
        maxSearches,
        maxCandidates,
        requiresSourceOfRecordHunt,
        planner: { mode: "lingxia-llm", provider: "deepseek", model: "deepseek-chat" },
      })),
    };

    const result = await new SourceResearchProvider({
      searchPlanner,
      now: () => new Date("2026-05-04T00:00:00.000Z"),
    }).research("Mythos 最新模型 对金融 AI 的影响");

    expect(result.searchPlan?.queries).toEqual(expect.arrayContaining([
      expect.stringContaining("official blog"),
      "custom financial AI deployment query",
    ]));
    expect(result.searchPlan?.sourceHunt?.type).toBe("model_release");
  });

  it("does not run fallback queries when source-of-record evidence is already found", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      return jsonResponse({
        results: [{
          title: `Mythos official announcement for ${body.query}`,
          url: "https://www.anthropic.com/news/mythos",
          content: "Mythos official model announcement and release notes",
          score: 0.96,
        }],
      });
    }) as unknown as typeof fetch;

    await provider(fetchImpl, { TAVILY_API_KEY: "tavily-secret" }).research("Mythos 最新模型");
    const calledQueries = (fetchImpl as any).mock.calls.map(([, init]: any[]) => JSON.parse(String(init?.body || "{}")).query);

    expect(calledQueries.some((query: string) => query.includes("benchmark"))).toBe(false);
  });

  it("uses benchmark/repository source hunt for broad SOTA open-model research", async () => {
    const result = await new SourceResearchProvider({
      now: () => new Date("2026-05-04T00:00:00.000Z"),
    }).research("最新 SOTA 开源模型 能力差异 金融 AI 影响 PPT");

    expect(result.searchPlan?.sourceHunt?.type).toBe("model_release");
    expect(result.searchPlan?.sourceHunt?.entities.model).toBeUndefined();
    expect(result.searchPlan?.queries).toEqual(expect.arrayContaining([
      "site:lmarena.ai open source model leaderboard",
      "site:huggingface.co open llm leaderboard",
    ]));
    expect(result.searchPlan?.queries.join(" ")).not.toContain("最新 SOTA 开源模型 能力差异 金融 AI 影响 PPT\" official blog");
  });

  it("does not promote official pages that miss the requested model name", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      results: [{
        title: "Project Glasswing: Securing critical software for the AI era",
        url: "https://www.anthropic.com/news/project-glasswing",
        content: "Anthropic software security project without the requested model.",
        score: 0.96,
      }],
    })) as unknown as typeof fetch;

    const result = await provider(fetchImpl, { TAVILY_API_KEY: "tavily-secret" }).research("Mythos 最新模型 对金融 AI 的影响");

    expect(result.candidates).toHaveLength(0);
    expect(result.discardedSources?.[0]).toMatchObject({
      discardReason: "source does not mention requested model: Mythos",
    });
  });
});

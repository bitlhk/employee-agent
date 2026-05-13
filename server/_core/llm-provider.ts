/**
 * LLM Provider 抽象层
 * 
 * 支持的 provider:
 *   - deepseek (已配置 key)
 *   - zhipu    (智谱 GLM，需 ZHIPU_API_KEY / BIGMODEL_API_KEY)
 *
 * 选择顺序：显式 provider > env 自动检测 > 默认 deepseek
 * 两家都是 OpenAI 兼容 API，接口几乎一致
 */

export type LLMProvider = "deepseek" | "zhipu";

export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LLMCallOptions = {
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  provider?: LLMProvider;
  modelOverride?: string;
};

const PROVIDER_CONFIG: Record<LLMProvider, { url: string; defaultModel: string; getKey: () => string | undefined }> = {
  deepseek: {
    url: "https://api.deepseek.com/v1/chat/completions",
    defaultModel: "deepseek-chat",
    getKey: () => process.env.DEEPSEEK_API_KEY,
  },
  zhipu: {
    url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    defaultModel: "glm-4-plus", // GLM 系列主力；GLM-5.1 如果开放可改成 "glm-5.1"
    getKey: () => process.env.ZHIPU_API_KEY || process.env.BIGMODEL_API_KEY || process.env.GLM_API_KEY,
  },
};

/**
 * 自动检测可用 provider（优先智谱）
 */
export function detectAvailableProvider(): LLMProvider {
  if (PROVIDER_CONFIG.zhipu.getKey()) return "zhipu";
  if (PROVIDER_CONFIG.deepseek.getKey()) return "deepseek";
  // fallback：尽管没 key 也返回 deepseek，让调用失败明确暴露问题
  return "deepseek";
}

/**
 * 统一 LLM 调用入口
 */
export async function callLLM(opts: LLMCallOptions): Promise<{ content: string; provider: LLMProvider; model: string; raw?: any }> {
  const provider = opts.provider || detectAvailableProvider();
  const cfg = PROVIDER_CONFIG[provider];
  const key = cfg.getKey();
  if (!key) {
    throw new Error(`[LLM] no API key for provider=${provider}`);
  }
  const model = opts.modelOverride || cfg.defaultModel;

  const body = {
    model,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 2000,
    temperature: opts.temperature ?? 0.3,
    stream: false,
  };

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 60_000);
  try {
    const resp = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`[LLM] ${provider} responded ${resp.status}: ${errText.slice(0, 200)}`);
    }
    const data: any = await resp.json();
    const content = data?.choices?.[0]?.message?.content || "";
    return { content, provider, model, raw: data };
  } finally {
    clearTimeout(to);
  }
}

/**
 * 快速 getter：调用方只关心文本
 */
export async function llmText(messages: LLMMessage[], opts?: Partial<LLMCallOptions>): Promise<string> {
  const r = await callLLM({ messages, ...(opts || {}) });
  return r.content;
}

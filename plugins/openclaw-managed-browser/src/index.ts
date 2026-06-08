import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

const urlParameters = Type.Object({
  url: Type.String({
    description: "要读取的公开 http/https URL。平台会拒绝内网、本机和云 metadata 地址；不支持需要用户登录态或私有权限的页面。",
  }),
  maxChars: Type.Optional(Type.Number({
    description: "最大返回正文字符数，默认 80000，上限 80000。",
  })),
});

const extractParameters = Type.Object({
  url: Type.String({
    description: "要提取正文的公开 http/https URL。平台会拒绝内网、本机和云 metadata 地址；不支持需要用户登录态或私有权限的页面。",
  }),
  mode: Type.Optional(Type.Union([
    Type.Literal("auto"),
    Type.Literal("article"),
    Type.Literal("text"),
  ], {
    description: "提取模式。当前 lite 运行时按 auto/text 处理，后续浏览器运行时会使用该字段。",
  })),
  maxChars: Type.Optional(Type.Number({
    description: "最大返回 Markdown 字符数，默认 80000，上限 80000。",
  })),
});

type ToolContextLike = {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  requesterSenderId?: string;
  agentAccountId?: string;
  messageChannel?: string;
  workspaceDir?: string;
  agentDir?: string;
  sandboxed?: boolean;
  activeModel?: unknown;
  deliveryContext?: unknown;
};

function pickPrimitiveFields(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    const field = record[key];
    if (
      field === null ||
      typeof field === "string" ||
      typeof field === "number" ||
      typeof field === "boolean"
    ) {
      picked[key] = field;
    }
  }
  return Object.keys(picked).length ? picked : null;
}

function buildTrustedContext(toolContext: ToolContextLike) {
  return {
    agentId: toolContext.agentId ?? null,
    sessionKey: toolContext.sessionKey ?? null,
    sessionId: toolContext.sessionId ?? null,
    requesterSenderId: toolContext.requesterSenderId ?? null,
    agentAccountId: toolContext.agentAccountId ?? null,
    messageChannel: toolContext.messageChannel ?? null,
    workspaceDir: toolContext.workspaceDir ?? null,
    agentDir: toolContext.agentDir ?? null,
    sandboxed: toolContext.sandboxed ?? null,
    activeModel: pickPrimitiveFields(toolContext.activeModel, [
      "id",
      "providerId",
      "provider",
      "model",
      "displayName",
      "authMode",
    ]),
    deliveryContext: pickPrimitiveFields(toolContext.deliveryContext, [
      "channel",
      "channelId",
      "conversationId",
      "senderId",
      "agentId",
      "accountId",
    ]),
  };
}

const EMPLOYEE_AGENT_INTERNAL_BASE_URL = "http://127.0.0.1:5180";

async function callManagedBrowser(action: string, params: unknown, toolContext: ToolContextLike) {
  const trustedContext = buildTrustedContext(toolContext);
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  const response = await fetch(`${EMPLOYEE_AGENT_INTERNAL_BASE_URL}/api/internal/managed-browser/tool`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      action,
      input: {
        ...(params && typeof params === "object" ? params as Record<string, unknown> : {}),
        action,
      },
      trustedContext,
      agentId: trustedContext.agentId,
      sessionKey: trustedContext.sessionKey,
    }),
  });

  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload,
    };
  }
  return payload;
}

function jsonToolResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
    details: payload,
  };
}

export default defineToolPlugin({
  id: "managed-browser",
  name: "受控浏览器工具",
  description: "Employee Agent 托管的公开网页阅读、正文提取、页面快照和截图工具。需要登录态的私有页面会返回需要认证。",
  tools: (tool) => [
    tool({
      name: "managed_browser_open",
      label: "打开网页",
      description: "打开一个公开网页，返回标题、最终 URL、正文预览和部分链接；遇到需要登录态的页面会返回 AUTH_REQUIRED。",
      parameters: urlParameters,
      factory: ({ toolContext }) => ({
        name: "managed_browser_open",
        label: "打开网页",
        description: "打开一个公开网页，返回标题、最终 URL、正文预览和部分链接；遇到需要登录态的页面会返回 AUTH_REQUIRED。",
        parameters: urlParameters,
        execute: async (_toolCallId, params) => jsonToolResult(await callManagedBrowser("open", params, toolContext)),
      }),
    }),
    tool({
      name: "managed_browser_extract",
      label: "提取网页正文",
      description: "提取公开网页正文、标题和关键结构，返回 Markdown。适合网页文章、公告、公开文档页面；不适合飞书等需要登录态的私有文档。",
      parameters: extractParameters,
      factory: ({ toolContext }) => ({
        name: "managed_browser_extract",
        label: "提取网页正文",
        description: "提取公开网页正文、标题和关键结构，返回 Markdown。适合网页文章、公告、公开文档页面；不适合飞书等需要登录态的私有文档。",
        parameters: extractParameters,
        execute: async (_toolCallId, params) => jsonToolResult(await callManagedBrowser("extract", params, toolContext)),
      }),
    }),
    tool({
      name: "managed_browser_snapshot",
      label: "网页结构快照",
      description: "返回公开网页的标题、正文快照、标题层级和链接列表；遇到需要登录态的页面会返回 AUTH_REQUIRED。",
      parameters: urlParameters,
      factory: ({ toolContext }) => ({
        name: "managed_browser_snapshot",
        label: "网页结构快照",
        description: "返回公开网页的标题、正文快照、标题层级和链接列表；遇到需要登录态的页面会返回 AUTH_REQUIRED。",
        parameters: urlParameters,
        execute: async (_toolCallId, params) => jsonToolResult(await callManagedBrowser("snapshot", params, toolContext)),
      }),
    }),
    tool({
      name: "managed_browser_screenshot",
      label: "网页截图",
      description: "对公开网页截图。当前只有配置浏览器运行时后才可用；未配置时会返回明确错误。",
      parameters: urlParameters,
      factory: ({ toolContext }) => ({
        name: "managed_browser_screenshot",
        label: "网页截图",
        description: "对公开网页截图。当前只有配置浏览器运行时后才可用；未配置时会返回明确错误。",
        parameters: urlParameters,
        execute: async (_toolCallId, params) => jsonToolResult(await callManagedBrowser("screenshot", params, toolContext)),
      }),
    }),
  ],
});

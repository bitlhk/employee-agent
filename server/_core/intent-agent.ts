/**
 * intent-agent.ts v2 — LLM 项目经理（替代意图识别）
 *
 * 不做意图分类/维度映射，让 LLM 以 tool calling 模式自主决定：
 *   - passthrough: 交给主聊天 Agent（普通对话）
 *   - dispatch_task: 分发给业务 Agent
 *   - schedule/send/channels: 平台操作
 *
 * 短消息（< 15 字且无关键词）直接 passthrough，不调 LLM。
 */
import type { StreamWriter } from "./stream-writer";
import { getBoundChannelsForAdopt } from "./cron/channel-binding-query";
import { internalApiUrl } from "./helpers";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_BASE = "https://api.deepseek.com";

// ── 短消息快速过滤（不调 LLM）──
const DISPATCH_KEYWORDS = /定时|每天|每隔|提醒|发到|微信|飞书|企微|任务|渠道|技能|插件|工具包|帮我做个|帮我生成|信贷|债券|理财|保险|PPT|幻灯片|股票|分析|评估|报告|代码|协作/;

function needsProjectManager(msg: string): boolean {
  if (msg.length < 15 && !DISPATCH_KEYWORDS.test(msg)) return false;
  return true;
}

function normalizeHour(period: string, rawHour: number): number {
  let hour = rawHour;
  if ((period === "下午" || period === "晚上") && hour < 12) hour += 12;
  if (period === "中午" && hour < 11) hour = 12;
  if (hour < 0) hour = 0;
  if (hour > 23) hour = 23;
  return hour;
}

function formatTime(hour: number, minute: number) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function extractWeekdays(message: string): string[] {
  const match = message.match(/每周([一二三四五六日天和、,，\s]+)/);
  if (!match) return [];
  return [...match[1]].filter((ch) => /[一二三四五六日天]/.test(ch));
}

export function deriveScheduleTaskFromMessage(message: string): string {
  const cleaned = message
    .replace(/每天|每日|每周[一二三四五六日天]?|提醒我|定时|定期/g, "")
    .replace(/(凌晨|早上|上午|中午|下午|晚上)?\s*\d{1,2}\s*(?:点|时)(?:半)?/g, "")
    .replace(/并(发送|发|推送一下|推送下|推送|推|送)/g, "")
    .replace(/(发送|发|推送一下|推送下|推送|推|送)(到|给|去)?(我的)?(微信|飞书|企微|企业微信)?/g, "")
    .replace(/(微信|飞书|企微|企业微信)(发送|发|推送|推|送)?/g, "")
    .replace(/^(发送|发|推送|推|送)/g, "")
    .replace(/^[，,。.!！\s]+/g, "")
    .replace(/^(请|帮我|给我|麻烦|查一下|查询|看看|看下)\s*/g, "")
    .replace(/[，,。.!！\s]+/g, "")
    .trim();

  if (/天气/.test(message)) {
    return cleaned && /天气/.test(cleaned)
      ? `查询${cleaned}并生成简要结果`
      : "查询天气并生成简要结果";
  }

  return cleaned || message;
}

function quickScheduleAction(message: string): { tool: string; args: any } | null {
  if (/(查看|列出|有哪些|有啥|任务列表|当前|我的|你有哪些|你有啥).*?(?:定时任务|任务|cron|schedule)/i.test(message)) {
    return { tool: "list_schedules", args: {} };
  }
  if (/(删除|取消|关闭|停止).*任务/.test(message)) return null;
  if (!/(每天|每日|每周|提醒我|定时|定期)/.test(message)) return null;

  const timeMatch = message.match(/(凌晨|早上|上午|中午|下午|晚上)?\s*(\d{1,2})\s*(?:点|时)(?:半)?/);
  if (!timeMatch) return null;
  const hour = normalizeHour(timeMatch[1] || "", Number(timeMatch[2] || 9));
  const minute = /半/.test(timeMatch[0]) ? 30 : 0;

  const channel = /飞书/.test(message) ? "feishu" : /企微|企业微信/.test(message) ? "wecom" : /微信/.test(message) ? "wechat" : undefined;
  const isWeather = /天气/.test(message);
  const task = deriveScheduleTaskFromMessage(message);

  const time = formatTime(hour, minute);
  const weekdays = extractWeekdays(message);
  return {
    tool: "create_schedule",
    args: {
      name: isWeather ? "天气推送" : "定时任务",
      prompt: task,
      schedule: weekdays.length > 0
        ? { kind: "weekly", time, weekdays }
        : { kind: "daily", time },
      ...(channel ? { channel } : {}),
    },
  };
}

// ── 从 DB 加载可用 Agent 列表 ──
async function loadAgentList(): Promise<{ id: string; name: string; description: string }[]> {
  try {
    const resp = await fetch(internalApiUrl("/api/claw/business-agents"), {
      headers: { "X-Internal-Key": process.env.INTERNAL_API_KEY || "lingxia-bridge-2026" },
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return [];
    const data = await resp.json() as any;
    return (data?.agents || []).map((a: any) => ({
      id: a.id,
      name: a.name,
      description: (a.description || "").split("\\n\\n")[0].slice(0, 100),
    }));
  } catch { return []; }
}

// ── 项目经理 System Prompt ──
function buildPMSystemPrompt(
  agents: { id: string; name: string; description: string }[],
  boundChannels: string[],
): string {
  const agentList = agents.map(a => `  - ${a.id}: ${a.name} — ${a.description}`).join("\n");
  const channelList = boundChannels.length > 0
    ? boundChannels.map((channel) => `  - ${channel}`).join("\n")
    : "  - 暂无已绑定频道";

  const scheduleGuide = `create_schedule 参数必须使用结构化字段：
- name: 任务名称，例如 "天气推送"
- prompt: 每次定时真正要执行的任务，例如 "查询天气并生成简要结果"
- channel: 必填，只能从已绑定频道里选择 wechat/feishu/wecom；如果用户没说频道，不要猜，调用 create_schedule 时可以省略 channel，系统会追问。
- schedule.kind:
  - daily: 每天执行，必须填 time，如 "09:00"
  - weekly: 每周执行，必须填 time 和 weekdays，如 ["mon","wed","fri"] 或 ["一","三","五"]
  - once: 单次执行，必须填 runAt
  - interval: 间隔执行，必须填 intervalMinutes
  - cron: 高级 cron，必须填 cronExpr`;
  const scheduleChannelRule = "如果用户没说频道，不要猜测或默认选择频道；调用 create_schedule 时省略 channel，让执行器根据已绑定频道处理。";

  return `你是员工智能体平台的项目经理。用户发来一条消息，你决定怎么处理。

你有以下工具可用：

1. passthrough — 普通对话、闲聊、简单问题、查天气、翻译等。交给主聊天 AI 处理。
2. dispatch_task — 把任务分发给专业 Agent。可以同时分发多个（并行执行）。
3. create_schedule — 创建定时任务。
4. send_message — 立即发消息到某个渠道（微信/企微/飞书）。
5. list_schedules — 查看已有定时任务。
6. delete_schedule — 删除定时任务。
7. create_skill — 生成一个用户自有技能。仅当用户明确要求"做一个技能/插件/工具包"时使用。

可用的专业 Agent：
${agentList}

当前用户已绑定的推送频道：
${channelList}

决策原则：
- 简单问题（聊天、翻译、查天气）→ passthrough
- 需要专业能力的（信贷分析、债券、PPT、代码）→ dispatch_task 到对应 Agent
- 跨领域问题 → 拆成多个 dispatch_task，每个发给不同 Agent
- 定时/提醒/推送 → create_schedule 或 send_message。只能选择已绑定频道；${scheduleChannelRule}
- 生成技能/插件/工具包 → create_skill。生成的技能必须包含 SKILL.md；不要生成 child_process、eval、rm -rf、curl/wget 外部地址、删除 workspace 外文件等危险行为。
- 如果没有已绑定频道但用户要创建定时推送，仍可调用 create_schedule，执行器会提示用户先去「频道」绑定。
- 不确定时 → passthrough（宁可不分发也不误分发）

${scheduleGuide}

dispatch_task 时，prompt 参数要把用户原始需求转述清楚，让目标 Agent 能独立理解和执行。`;
}

// ── Tool 定义 ──
function buildPMTools() {
  return [
  {
    type: "function" as const,
    function: {
      name: "passthrough",
      description: "普通对话，交给主聊天 AI 处理",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "dispatch_task",
      description: "分发任务给专业 Agent。可多次调用实现并行分发。",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "目标 Agent ID" },
          prompt: { type: "string", description: "发给该 Agent 的任务描述" },
        },
        required: ["agent_id", "prompt"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_schedule",
      description: "创建定时任务",
      parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "任务名称" },
              prompt: { type: "string", description: "每次定时执行时要交给 Agent 的指令" },
              schedule: {
                type: "object",
                properties: {
                  kind: { type: "string", enum: ["daily", "weekly", "once", "interval", "cron"] },
                  time: { type: "string", description: "HH:mm，例如 09:00" },
                  weekdays: { type: "array", items: { type: "string" }, description: "weekly 使用，例如 [\"mon\",\"wed\",\"fri\"] 或 [\"一\",\"三\",\"五\"]" },
                  runAt: { type: "string", description: "once 使用，用户指定的执行时间" },
                  intervalMinutes: { type: "number", description: "interval 使用，间隔分钟数" },
                  cronExpr: { type: "string", description: "cron 使用，五段 cron 表达式" },
                },
                required: ["kind"],
              },
              channel: { type: "string", enum: ["wechat", "feishu", "wecom"], description: "推送渠道。只能从当前用户已绑定频道里选；微信用 wechat。" },
            },
            required: ["name", "prompt", "schedule"],
          },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "send_message",
      description: "立即发消息到指定渠道",
      parameters: {
        type: "object",
        properties: {
          channel: { type: "string", enum: ["wechat", "feishu", "wecom"] },
          content: { type: "string", description: "消息内容" },
        },
        required: ["channel", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_schedules",
      description: "查看已有的定时任务",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_schedule",
      description: "删除定时任务",
      parameters: {
        type: "object",
        properties: {
          task_name: { type: "string", description: "任务名称或关键词" },
        },
        required: ["task_name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_skill",
      description: "根据用户需求生成一个可安装到当前智能体工作空间的技能。只在用户明确要求创建技能/插件/工具包时调用。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "技能名称，至少 2 个字，例如 财报摘要助手" },
          description: { type: "string", description: "技能说明，一句话说明它能做什么" },
          files: {
            type: "array",
            description: "技能文件列表，必须包含 SKILL.md。路径必须是相对路径。",
            items: {
              type: "object",
              properties: {
                path: { type: "string", description: "相对路径，例如 SKILL.md 或 scripts/run.py" },
                content: { type: "string", description: "文件内容" },
              },
              required: ["path", "content"],
            },
          },
        },
        required: ["name", "description", "files"],
      },
    },
  },
  ].filter((tool) => tool.function.name !== "dispatch_task");
}

// ── 调用项目经理 LLM ──
async function callProjectManager(
  message: string,
  agents: { id: string; name: string; description: string }[],
  boundChannels: string[],
): Promise<{ tool: string; args: any }[]> {
  const systemPrompt = buildPMSystemPrompt(agents, boundChannels)
    + "\n\n【重要】主对话已关闭业务 Agent 自动派发。不要推荐或调用专业 Agent；如用户需要多个专业 Agent，请引导其进入「智能体集群」显式选择。";

  const resp = await fetch(`${DEEPSEEK_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      tools: buildPMTools(),
      temperature: 0,
      max_tokens: 500,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) return [{ tool: "passthrough", args: {} }];

  const data = await resp.json() as any;
  const choice = data?.choices?.[0];
  const toolCalls = choice?.message?.tool_calls;

  if (!toolCalls || toolCalls.length === 0) {
    // LLM 没调工具 → 当作 passthrough
    console.log("[PM-TOOLS] no tool_calls, LLM content:", String(choice?.message?.content || "").slice(0, 120));
    return [{ tool: "passthrough", args: {} }];
  }

  const mapped = toolCalls.map((tc: any) => ({
    tool: tc.function?.name || "passthrough",
    args: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
  }));
  console.log("[PM-TOOLS] LLM returned:", mapped.map((a: { tool: string; args: any }) => `${a.tool}(${JSON.stringify(a.args).slice(0, 80)})`).join(", "));
  return mapped;
}

// ── 执行 dispatch_task: 调业务 Agent ──
async function dispatchToAgent(
  adoptId: string,
  agentId: string,
  prompt: string,
  agentName: string,
  writer: StreamWriter,
): Promise<string> {
  const INTERNAL_KEY = process.env.INTERNAL_API_KEY || "lingxia-bridge-2026";

  try {
    const resp = await fetch(internalApiUrl("/api/claw/business-chat-stream"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": INTERNAL_KEY,
        "Cookie": `lingxia_session=internal_dispatch_${adoptId}`,
      },
      body: JSON.stringify({
        agentId,
        message: prompt,
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!resp.ok || !resp.body) {
      writer.writeText(`\n> ${agentName} 调用失败 (${resp.status})\n`);
      return "";
    }

    // 读取 SSE 流，提取文本
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let result = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
        try {
          const d = JSON.parse(line.slice(6));
          const content = d?.choices?.[0]?.delta?.content;
          if (content) result += content;
        } catch {}
      }
    }

    return result;
  } catch (e: any) {
    writer.writeText(`\n> ${agentName} 调用超时或失败\n`);
    return "";
  }
}

// Main chat no longer auto-dispatches to business agents. Users should enter the
// Agent Cluster/Directory explicitly when they want specialist agents.
const FORCE_ROUTE_ADOPT_IDS = new Set<string>();
const FORCE_ROUTE_MAP: Array<{ pattern: RegExp; agentId: string }> = [
  // 顶部优先匹配，均走 Hermes（发 __hermes_tool 事件，被原生 ToolCallCard 渲染）
  // EV 理财
  { pattern: /电池|EV理财|新能源.*保险|新能源.*理财|电动车.*理财|动力电池|全损|残值|梯次利用/, agentId: "task-claim-ev" },
  // 信贷风控
  { pattern: /信贷|贷款|征信|风控|贷前调查|贷后管理|三表分析|担保物|五级分类|风险定价/, agentId: "task-credit-risk" },
  // 债券投研
  { pattern: /债券|国开债|国债|信用债|中债估值|收益率曲线|久期|违约预警/, agentId: "task-bond" },
  // 个人理财
  { pattern: /资产配置|理财规划|家庭财务|税费规划|基金.*配置|家庭.*资产/, agentId: "task-my-wealth" },
  // 深度求索 / 复杂任务拆解
  { pattern: /深度分析|深度求索|拆解.*任务|复杂.*任务|帮我规划|深度思考/, agentId: "task-trace" },
];

function matchForceRoute(message: string): { agentId: string } | null {
  for (const rule of FORCE_ROUTE_MAP) {
    if (rule.pattern.test(message)) return { agentId: rule.agentId };
  }
  return null;
}


export async function routeMessage(
  adoptId: string,
  message: string,
  writer: StreamWriter,
): Promise<boolean> {
  // Phase 1 强制路由：特定 adoptId + 正则命中 → 跳过所有门禁直接 dispatch
  let forcedActions: { tool: string; args: any }[] | null = null;
  if (FORCE_ROUTE_ADOPT_IDS.has(adoptId)) {
    const m = matchForceRoute(message);
    if (m) {
      console.log("[FORCE-ROUTE] adoptId=" + adoptId + " -> " + m.agentId);
      forcedActions = [{ tool: "dispatch_task", args: { agent_id: m.agentId, prompt: message } }];
    }
  }

  const quickSchedule = quickScheduleAction(message);
  if (quickSchedule) {
    const { executePlatformIntent } = await import("./intent-executor");
    const quickScheduleType = quickSchedule.tool === "list_schedules" ? "schedule_list" : "schedule_create";
    await executePlatformIntent(adoptId, { type: quickScheduleType, ...quickSchedule.args }, writer);
    return true;
  }

  if (!forcedActions) {
    const hasSkillOp = /(?:创建|生成|做|写|开发).*(?:技能|插件|工具包)|(?:技能|插件|工具包).*(?:创建|生成|做|写|开发)/.test(message);

    // 短消息快速通过，不调 LLM
    if (!needsProjectManager(message)) return false;

    // L1 门禁：主对话只允许平台操作进入 PM（定时任务/渠道/技能生成）。
    // 业务 Agent 自动推荐/自动派发已关闭，避免普通问题被误路由成 Agent 卡片。
    const hasPlatformOp =
      /定时任务|每天|每隔|每周|提醒我|cron|schedule/i.test(message) ||
      /(?:发|推|送)(?:到|给|去)?\s*(?:我的?)?\s*(?:微信|企微|飞书|webhook)/i.test(message) ||
      /(?:删除|取消|关闭|停止).*任务|任务列表|哪些.*任务|通知渠道|哪些渠道/.test(message) ||
      hasSkillOp;
    if (!hasPlatformOp) {
      console.log("[PM-L1] 未命中平台操作，走主聊天");
      return false;
    }
    console.log("[PM-L1] 命中平台操作关键字，进 PM");
    if (!DEEPSEEK_API_KEY) return false;
  }

  // 主对话不再暴露业务 Agent 列表，避免 PM 误路由；Agent 使用改走显式智能体集群入口。
  const agents: { id: string; name: string; description: string }[] = [];

  // 调项目经理（强制路由时跳过）
  let actions: { tool: string; args: any }[];
  if (forcedActions) {
    actions = forcedActions;
  } else {
    try {
      const boundChannels = (await getBoundChannelsForAdopt(adoptId)).map((channel) => channel.channelId);
      actions = await callProjectManager(message, agents, boundChannels);
    } catch (e: any) {
      console.warn("[PM] project manager error:", e?.message?.slice(0, 80));
      return false; // 失败 → passthrough
    }
  }

  // 全是 passthrough → 交给主聊天
  if (actions.every(a => a.tool === "passthrough")) return false;

  // 收集 dispatch_task 和平台操作
  const requestedDispatches = actions.filter(a => a.tool === "dispatch_task");
  if (requestedDispatches.length > 0) {
    console.warn("[PM-DISPATCH-DISABLED] main chat ignored business-agent dispatch", requestedDispatches.map((a) => a.args?.agent_id || "unknown"));
  }
  const dispatches: typeof requestedDispatches = [];
  const platformOps = actions.filter(a => a.tool !== "dispatch_task" && a.tool !== "passthrough");

  // 先执行平台操作（schedule/send 等）
  if (platformOps.length > 0) {
    const { executePlatformIntent } = await import("./intent-executor");
    for (const op of platformOps) {
      // 映射 tool name → intent type
      const typeMap: Record<string, string> = {
        create_schedule: "schedule_create",
        list_schedules: "schedule_list",
        delete_schedule: "schedule_delete",
        send_message: "send",
        create_skill: "skill_create",
      };
      const intent = { type: typeMap[op.tool] || op.tool, ...op.args };
      await executePlatformIntent(adoptId, intent, writer);
    }
  }

  // Agent dispatch with tool_call cards
    // Agent Team dispatch with structured events
  if (dispatches.length > 0) {
    const agentMap = new Map(agents.map(a => [a.id, a.name]));

    // Single-agent: inline toolCall conveys status, no placeholder text.
    // Multi-agent: keep text placeholder (bubble then receives PM summary).
    const singleAgent = dispatches.length === 1;
    if (!singleAgent) {
      writer.writeText("🤖 已拆解为 " + dispatches.length + " 个子任务，并行执行中...");
    }

    // Send agent_dispatch event (frontend creates AgentTaskCards)
    const taskDefs = dispatches.map((d, i) => ({
      id: "pm_" + i + "_" + Date.now(),
      agentId: d.args.agent_id,
      name: agentMap.get(d.args.agent_id) || d.args.agent_id,
      prompt: (d.args.prompt || "").slice(0, 100),
    }));
    // Phase 1 新增：单 agent 场景发 bind_agent 事件，前端给气泡打 fromAgent 标签
    if (singleAgent) {
      writer.writeRaw({ _event: "bind_agent", agentId: taskDefs[0].agentId, agentName: taskDefs[0].name });
    }
    writer.writeRaw({ _event: "agent_dispatch", agents: taskDefs });

    // Parallel execution with event forwarding
    const startTime = Date.now();
    const results = await Promise.all(
      dispatches.map(async (d, i) => {
        const taskId = taskDefs[i].id;
        const name = agentMap.get(d.args.agent_id) || d.args.agent_id;

        // Dispatch and read SSE, forwarding tool events
        const INTERNAL_KEY = process.env.INTERNAL_API_KEY || "lingxia-bridge-2026";
        let resolvedUserId = 0;
        try {
          const { getClawByAdoptId } = await import("../db/claw");
          const claw = await getClawByAdoptId(adoptId);
          resolvedUserId = claw?.userId || 0;
        } catch {}

        let result = "";
        const taskStartMs = Date.now();
        // FIFO stack for matching hermes tool.completed (no id) back to tool.started id
        const toolIdStack: string[] = [];
        try {
          const resp = await fetch(internalApiUrl("/api/claw/business-chat-stream"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Internal-Key": INTERNAL_KEY,
              "X-Internal-User-Id": String(resolvedUserId || 0),
            },
            body: JSON.stringify({ agentId: d.args.agent_id, message: d.args.prompt }),
            signal: AbortSignal.timeout(300000),
          });

          if (!resp.ok || !resp.body) {
            writer.writeRaw({ _event: "agent_complete", taskId, result: "调用失败 (" + resp.status + ")", durationMs: Date.now() - taskStartMs });
            return { name, result: "" };
          }

          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
              try {
                const ev = JSON.parse(line.slice(6));
                const content = ev?.choices?.[0]?.delta?.content;
                if (content) {
                  result += content;
                  if (singleAgent) writer.writeText(content);
                }
                // Forward hermes tool events as openclaw-native tool_call / tool_result
                // 使用 _gateway=false 触发可折叠的 ToolCallCard（与 openclaw tool use 视觉一致）
                if (ev?.__hermes_tool === "started") {
                  const toolId = String(ev.id || `agent_tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
                  toolIdStack.push(toolId);
                  writer.writeRaw({
                    _event: "tool_call",
                    id: toolId,
                    name: String(ev.name || "tool"),
                    arguments: ev.preview ? JSON.stringify({ preview: String(ev.preview) }) : "",
                  });
                }
                if (ev?.__hermes_tool === "completed") {
                  const toolId = toolIdStack.shift() || "";
                  writer.writeRaw({
                    _event: "tool_result",
                    tool_call_id: toolId,
                    result: "",
                    is_error: Boolean(ev.is_error),
                    durationMs: Number(ev.durationMs || Math.round((ev.duration || 0) * 1000)),
                  });
                }
              } catch {}
            }
          }
        } catch (e) {
          console.warn("[PM-DISPATCH] error:", (e as Error)?.message?.slice(0, 60));
        }

        // Send agent_complete. Single-agent: result already streamed into bubble, only send status+duration.
        writer.writeRaw({ _event: "agent_complete", taskId, result: singleAgent ? "" : result.slice(0, 2000), durationMs: Date.now() - taskStartMs });
        return { name, agentId: d.args.agent_id, result };
      }),
    );

    // PM summary
    if (results.length > 1 && results.some(r => r.result)) {
      try {
        const summaryPrompt = results
          .filter(r => r.result)
          .map(r => "[" + r.name + "]:\n" + r.result.slice(0, 1500))
          .join("\n\n---\n\n");
        const summaryResp = await fetch(DEEPSEEK_BASE + "/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + DEEPSEEK_API_KEY },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [
              { role: "system", content: "你是综合分析师。基于多个专业智能体的分析结果，写一份简洁的综合方案。用中文，500字内。重点突出各智能体结论的关联和综合建议。" },
              { role: "user", content: summaryPrompt },
            ],
            temperature: 0.3,
            max_tokens: 800,
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (summaryResp.ok) {
          const sd = await summaryResp.json();
          const st = sd?.choices?.[0]?.message?.content || "";
          if (st) writer.writeText("\n\n📋 **综合方案**\n\n" + st);
        }
      } catch (e) {
        console.warn("[PM] summary failed:", (e as Error)?.message?.slice(0, 60));
      }
    } else if (results.length === 1 && results[0].result) {
      writer.writeText("\n\n" + results[0].result);
    }
  }

  writer.writeEnd();
  return true;
}

// ── 兼容旧接口（策略层保留）──
export type ApprovalPolicy = "auto" | "confirm" | "review";
export function getIntentPolicy(_type: string): ApprovalPolicy { return "auto"; }
export function scorePlatformIntent(_msg: string): number { return 0; }
export async function classifyIntent(_msg: string): Promise<any> { return { type: "passthrough" }; }

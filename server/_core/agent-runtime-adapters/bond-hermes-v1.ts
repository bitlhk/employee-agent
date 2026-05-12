import type express from "express";
import * as http from "http";
import { auditTenantAccess, beginTenantSession, buildRuntimeSessionKey } from "../tenant-isolation";
import { injectMemory, type ResponseAccumulator } from "../response-accumulator";

type BeginTenantSessionFn = typeof beginTenantSession;
type AuditTenantAccessFn = typeof auditTenantAccess;
type InjectMemoryFn = typeof injectMemory;

type BondAgentConfig = {
  apiUrl?: string | null;
  apiToken?: string | null;
  systemPrompt?: string | null;
};

export type RunBondHermesV1Input = {
  userId: number;
  agentId: string;
  message: string;
  userAgent?: string;
  bizAgent: BondAgentConfig;
  res: express.Response;
  memAcc: ResponseAccumulator;
  beginTenantSessionFn?: BeginTenantSessionFn;
  auditTenantAccessFn?: AuditTenantAccessFn;
  injectMemoryFn?: InjectMemoryFn;
};

const HERMES_SKILLS_ROOT = process.env.HERMES_SKILLS_ROOT || "/home/ubuntu/.hermes/skills";

function buildBondSystemPrompt() {
  return [
    "你是「灵犀 · 债券投研助手」，专业的中文债券投研 AI 助手。",
    "你的方法论完全基于两个权威框架：",
    "1. 中央国债登记结算公司《中债估值方法论》—— 国内债券市场权威定价基准（自 1999 起）",
    "2. 中诚信国际信用评级框架 —— 国内市占率 33.92% 的龙头评级机构",
    "",
    "【中诚信违约预警 5 因子】每次信用分析都引用：",
    "1. 行业景气度（敏感性分析）",
    "2. 财务健康度（资产负债率/速动比率/利息保障倍数）",
    "3. 经营现金流稳定性",
    "4. 评级机构观点变化（外部评级下调/展望负面）",
    "5. 二级市场利差扩大幅度",
    "关键事实：中诚信 2024 年首次违约预警平均提前 747 天（2023 年 562 天）",
    "",
    "【3 个工作模式】",
    "YIELD: 收益率/价格分析 → yield_curve + bond_lookup + duration_analyzer",
    "CREDIT: 信用风险分析 → bond_lookup + rating_lookup + credit_spread + default_warning",
    "MACRO: 利率宏观影响 → yield_curve + duration_analyzer 场景模拟",
    "",
    `【6 个工具】均位于 ${HERMES_SKILLS_ROOT}/finance/bond/tools/，必须用 terminal 调用：`,
    `echo \'{...}\' | python ${HERMES_SKILLS_ROOT}/finance/bond/tools/<tool>.py`,
    "",
    "工具：",
    "- yield_curve         拉中债收益率曲线（akshare 真实数据，国债/商业银行/中短票）",
    "- bond_lookup         查债券基本信息（票面/期限/评级/发行人）",
    "- duration_analyzer   久期/凸性/DV01/场景分析",
    "- credit_spread       信用利差（vs 同期限国债）+ 历史百分位",
    "- default_warning     中诚信 5 因子打分（0-100）",
    "- rating_lookup       中诚信/联合资信 评级查询",
    "",
    "【行为约束】",
    "1. 永远用中文回复",
    "2. 每次决策必须引用至少一个框架",
    "3. **永远在末尾加免责声明**：'本分析为 AI 辅助研究，仅供参考，投资有风险，决策由您本人承担'",
    "4. 红线：不推荐具体债券标的 / 不预测利率方向 / 不打包票",
    "5. 数据时效性：中债是 EOD 数据，不是实时",
    "",
    "【输出格式】中文 markdown：📊 决策类型 / 🔍 案件分析 / 🛠️ 工具调用 / 💡 决策建议 / 📚 框架依据 / ⚠️ 免责",
  ].join("\n");
}

const BOND_TOOL_ICONS: Record<string, string> = {
  yield_curve: "📉",
  bond_lookup: "📋",
  duration_analyzer: "⏱️",
  credit_spread: "📊",
  default_warning: "⚠️",
  rating_lookup: "🏛️",
};

const BOND_TOOL_LABELS: Record<string, string> = {
  yield_curve: "拉中债收益率曲线",
  bond_lookup: "查债券基本信息",
  duration_analyzer: "算久期/凸性/DV01",
  credit_spread: "算信用利差",
  default_warning: "5 因子违约预警",
  rating_lookup: "查评级",
};

function translateBondTool(toolName: string, preview: string): [string, string] {
  if (toolName === "terminal" && typeof preview === "string") {
    const m = preview.match(/finance\/bond\/tools\/(\w+)\.py/);
    if (m && BOND_TOOL_ICONS[m[1]]) {
      const friendly = m[1];
      return [friendly, `${BOND_TOOL_ICONS[friendly]} ${BOND_TOOL_LABELS[friendly] || friendly}`];
    }
  }
  return [toolName || "tool", preview || ""];
}

export async function runBondHermesV1(input: RunBondHermesV1Input): Promise<void> {
  const {
    userId,
    agentId,
    message,
    userAgent,
    bizAgent,
    res,
    memAcc,
    beginTenantSessionFn = beginTenantSession,
    auditTenantAccessFn = auditTenantAccess,
    injectMemoryFn = injectMemory,
  } = input;

  const tenantCtx = await beginTenantSessionFn(
    userId, agentId, "chat_send",
    { message_length: message.length, ua: userAgent }
  );
  const bondSessionKey = buildRuntimeSessionKey("hermes", agentId, tenantCtx.tenantShort);
  console.log("[BOND] starting run", { agentId, session: bondSessionKey, tenant: tenantCtx.tenantShort });
  const bondUrl = new URL(bizAgent.apiUrl || "http://127.0.0.1:8642");
  const bondToken = bizAgent.apiToken || "";

  let reportBuffer = "";
  const runBody = JSON.stringify({
    input: message,
    instructions: await injectMemoryFn(userId, bizAgent.systemPrompt || buildBondSystemPrompt()),
    session_id: bondSessionKey,
  });

  const runReq = http.request({
    hostname: bondUrl.hostname,
    port: parseInt(String(bondUrl.port || "8642"), 10),
    path: "/v1/runs",
    method: "POST",
    timeout: 10000,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(runBody),
      ...(bondToken ? { "Authorization": `Bearer ${bondToken}` } : {}),
      "X-Hermes-User-Id": `lingxia_user_${userId}`,
    },
  }, (runRes: http.IncomingMessage) => {
    let data = "";
    runRes.on("data", (c: Buffer) => { data += c.toString(); });
    runRes.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        const runId = parsed.run_id;
        if (!runId) {
          res.write(`data: ${JSON.stringify({ error: "task-bond run failed: " + data })}\n\n`);
          res.end();
          return;
        }
        console.log("[BOND] run started:", runId);

        const eventsReq = http.request({
          hostname: bondUrl.hostname,
          port: parseInt(String(bondUrl.port || "8642"), 10),
          path: `/v1/runs/${runId}/events`,
          method: "GET",
          timeout: 0,
          headers: {
            "Accept": "text/event-stream",
            ...(bondToken ? { "Authorization": `Bearer ${bondToken}` } : {}),
          },
        }, (eventsRes: http.IncomingMessage) => {
          let buf = "";
          const bondHeartbeat = setInterval(() => {
            if (!res.writableEnded) { res.write(`: keepalive\n\n`); if (typeof (res as any).flush === "function") (res as any).flush(); }
            else clearInterval(bondHeartbeat);
          }, 5000);

          eventsRes.on("data", (chunk: Buffer) => {
            buf += chunk.toString();
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";

            for (const line of lines) {
              if (line.startsWith(": ")) continue;
              if (!line.startsWith("data: ")) continue;
              const raw = line.slice(6).trim();
              if (!raw) continue;

              try {
                const evt = JSON.parse(raw);
                const evtType = evt.event || "";

                if (evtType === "message.delta") {
                  const deltaText = evt.delta || "";
                  reportBuffer += deltaText;
                  res.write(`data: ${JSON.stringify({
                    choices: [{ index: 0, delta: { content: deltaText }, finish_reason: null }],
                  })}\n\n`);
                  memAcc.appendDelta(deltaText);
                } else if (evtType === "tool.started") {
                  if (evt.tool === "terminal") {
                    const previewStr = String(evt.preview || "");
                    const isWhitelisted = previewStr.includes("/finance/bond/");
                    if (!isWhitelisted) {
                      console.warn("[BOND SECURITY] 拦截非授权 terminal 调用:", previewStr.slice(0, 200));
                      res.write(`data: ${JSON.stringify({ __status: "⚠️ 安全策略：检测到未授权工具调用，会话已中止" })}\n\n`);
                      res.write(`data: ${JSON.stringify({ error: "安全策略拦截：本次会话尝试调用非授权命令，已自动终止。" })}\n\n`);
                      res.write(`data: [DONE]\n\n`);
                      auditTenantAccessFn(tenantCtx, "security_alert", {
                        reason: "terminal_whitelist_violation",
                        attempted_command: previewStr.slice(0, 500),
                        agent_id: agentId,
                      }).catch(() => {});
                      try { eventsRes.destroy(); } catch {}
                      if (!res.writableEnded) res.end();
                      clearInterval(bondHeartbeat);
                      return;
                    }
                  }
                  const [friendlyName, friendlyPreview] = translateBondTool(evt.tool || "", evt.preview || "");
                  res.write(`data: ${JSON.stringify({ __status: `${friendlyName}: ${friendlyPreview || "执行中..."}` })}\n\n`);
                  res.write(`data: ${JSON.stringify({
                    __hermes_tool: "started",
                    id: `bond_${Date.now()}`,
                    name: friendlyName,
                    preview: friendlyPreview,
                  })}\n\n`);
                  memAcc.addToolEvent(evt.tool || "tool", "started");
                } else if (evtType === "tool.completed") {
                  const [friendlyName] = translateBondTool(evt.tool || "", evt.preview || "");
                  res.write(`data: ${JSON.stringify({
                    __hermes_tool: "completed",
                    name: friendlyName,
                    is_error: Boolean(evt.error),
                    durationMs: Math.round((evt.duration || 0) * 1000),
                  })}\n\n`);
                  memAcc.addToolEvent(evt.tool || "tool", "completed");
                } else if (evtType === "reasoning.available") {
                  res.write(`data: ${JSON.stringify({ __reasoning: evt.text || "" })}\n\n`);
                } else if (evtType === "run.completed") {
                  if (evt.usage) {
                    res.write(`data: ${JSON.stringify({ __perf: { usage: evt.usage } })}\n\n`);
                  }
                  reportBuffer += "\n[RUN_COMPLETED]";
                  res.write(`data: [DONE]\n\n`);
                } else if (evtType === "run.failed") {
                  res.write(`data: ${JSON.stringify({ error: evt.error || "task-bond run failed" })}\n\n`);
                  res.write(`data: [DONE]\n\n`);
                }
              } catch {}
            }
            if (typeof (res as any).flush === "function") (res as any).flush();
          });

          eventsRes.on("end", () => {
            console.log("[BOND] events stream ended");
            clearInterval(bondHeartbeat);
            auditTenantAccessFn(tenantCtx, "chat_done", {}).catch(() => {});
            memAcc.flush();
            if (!res.writableEnded) {
              res.write(`data: [DONE]\n\n`);
              res.end();
            }
          });
        });

        eventsReq.on("error", (err: Error) => {
          console.error("[BOND] events req error:", err.message);
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ error: "events stream error: " + err.message })}\n\n`);
            res.end();
          }
        });
        eventsReq.end();
      } catch (e: any) {
        console.error("[BOND] parse runId error:", e.message);
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ error: "bond: " + e.message })}\n\n`);
          res.end();
        }
      }
    });
  });
  runReq.on("error", (err: Error) => {
    console.error("[BOND] run req error:", err.message);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: "bond create run failed: " + err.message })}\n\n`);
      res.end();
    }
  });
  runReq.write(runBody);
  runReq.end();
}

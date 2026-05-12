# 灵虾智能体架构图

> 最后更新: 2026-04-14 v2 (增加记忆体系 + A2A 演进分析)

## 全局视图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         用户浏览器                                       │
│  React SPA (client/src)                                                 │
│  ├─ 主聊天窗口  → WebSocket /api/claw/ws (默认)                          │
│  │               → HTTP SSE /api/claw/chat-stream (降级)                 │
│  ├─ 业务 Agent  → HTTP SSE /api/claw/business-chat-stream               │
│  └─ 技能市场    → /api/trpc                                             │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ HTTPS
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    123 服务器 (华为云)                                    │
│                    linggan-claw (:5180)                                  │
│                                                                         │
│  ┌─────────────────────────── 平台层 ──────────────────────────────┐   │
│  │                                                                  │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────┐  │   │
│  │  │ Intent      │  │ Agent Router │  │ Memory Extractor      │  │   │
│  │  │ Engine      │  │ (claw-biz.ts)│  │ (Hermes 式策展记忆)    │  │   │
│  │  │ 意图识别     │  │ 4 种协议分发  │  │ DeepSeek 后台提取     │  │   │
│  │  └──────┬──────┘  └──────┬───────┘  │ → workspace .md 文件  │  │   │
│  │         │                │          └───────────┬───────────┘  │   │
│  │         │                │                      │              │   │
│  │  ┌──────┴──────┐  ┌─────┴──────┐  ┌────────────┴──────────┐  │   │
│  │  │ TIL 租户    │  │ Response   │  │ Memory Store          │  │   │
│  │  │ 隔离层      │  │ Accumulator│  │ 读写 OpenClaw workspace│  │   │
│  │  │ per-user    │  │ SSE 缓冲   │  │ /memory/user-prefs.md │  │   │
│  │  └─────────────┘  └────────────┘  └───────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────── 协议适配层 ─────────────────────────────────────┐   │
│  │  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │   │
│  │  │OpenClaw │  │ Hermes   │  │hi-agent  │  │ TradingAgents │  │   │
│  │  │ 协议    │  │ 协议     │  │ 协议     │  │ 协议          │  │   │
│  │  └────┬────┘  └────┬─────┘  └────┬─────┘  └──────┬────────┘  │   │
│  └───────┼────────────┼─────────────┼────────────────┼───────────┘   │
│          ▼            │             │                │                │
│  ┌──────────────┐     │             │                │                │
│  │ OpenClaw GW  │     │             │                │                │
│  │ :18789       │     │             │                │                │
│  └──────────────┘     │             │                │                │
│          ┌────────────┘             │                │                │
│          │ SSH 隧道 :8642           │                │                │
└──────────┼──────────────────────────┼────────────────┼────────────────┘
           ▼                          ▼                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      AWS 服务器                                       │
│                                                                      │
│  ┌─────────────────────┐  ┌──────────┐  ┌───────────┐  ┌─────────┐│
│  │ Hermes Gateway      │  │skillchat │  │ Trading   │  │OpenClaw ││
│  │ :8642               │  │ :8080    │  │ Agents    │  │GW :19789││
│  │ 5 个业务 agent       │  │          │  │ :8189     │  │Node     ││
│  │ 自带记忆(MEMORY.md)  │  │          │  │           │  │:19800   ││
│  └─────────────────────┘  └──────────┘  └───────────┘  └─────────┘│
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ lingxia-mcp-server.ts (反向 MCP: agent → 平台能力)              ││
│  │ create_scheduled_task / send_notification / get_user_channels    ││
│  └─────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
```

## 三层记忆体系

```
┌─────────────────────────────────────────────────────────────────────┐
│                    记忆体系（三层互补）                                │
│                                                                     │
│  Layer 1: OpenClaw 内置记忆                                         │
│  ├─ session-memory hook: 会话结束时保存对话摘要                       │
│  ├─ memory-core 插件: SQLite FTS 索引 + 向量搜索                    │
│  ├─ dreaming: 凌晨 3am 记忆整理（需 cleanup 脚本防垃圾累积）          │
│  ├─ 存储: workspace/memory/*.md + MEMORY.md                        │
│  ├─ 范围: 主聊天 per-user 隔离                                      │
│  └─ 特点: 深度、自动、黑盒                                          │
│                                                                     │
│  Layer 2: Hermes 内置记忆                                           │
│  ├─ background review: 每 10 轮后台 LLM 提取                       │
│  ├─ flush_memories: 上下文压缩前紧急保存                              │
│  ├─ 存储: ~/.hermes/memories/MEMORY.md + USER.md                    │
│  ├─ 范围: task-hermes 及 4 个金融 skill agent                       │
│  └─ 特点: 策展式、主动提取偏好、有字符上限                             │
│                                                                     │
│  Layer 3: 灵虾平台记忆 (新增)                                       │
│  ├─ Hermes 式 background review (复用 Hermes prompt + tool schema)  │
│  ├─ 触发: 每 3 轮对话，fire-and-forget                              │
│  ├─ 提取: DeepSeek Chat (成本 ~0.15 RMB/天)                        │
│  ├─ 存储: OpenClaw workspace/memory/user-preferences.md             │
│  ├─ 范围: 所有路径（WS + HTTP SSE + 业务 Agent）                    │
│  ├─ 接入: claw-ws-proxy.ts + claw-chat.ts + claw-business.ts       │
│  └─ 特点: 跨 agent、写入 OpenClaw 索引、用户可见                     │
│                                                                     │
│  协作关系:                                                           │
│  - OpenClaw 记对话细节 + 操作记录 (深度)                              │
│  - Hermes 记 agent 级经验 + 工具用法 (per-agent)                     │
│  - 灵虾记跨 agent 用户偏好，写入 OpenClaw workspace 被自动索引        │
│  - 三层存储位置不同，不冲突                                           │
└─────────────────────────────────────────────────────────────────────┘
```

## 智能体注册表 (business_agents)

| agent_id | 名称 | 协议 | 目标地址 | 后端服务 |
|----------|------|------|----------|----------|
| task-hermes | 灵枢 共享智脑 | Hermes | :8642 | Hermes Gateway |
| task-credit-risk | 灵犀 智贷决策 | Hermes | :8642 | Hermes + credit-risk skill |
| task-bond | 灵犀 债券投研 | Hermes | :8642 | Hermes + bond skill |
| task-my-wealth | 灵犀 个人理财 | Hermes | :8642 | Hermes + wealth skill |
| task-claim-ev | 灵犀 EV理赔 | Hermes | :8642 | Hermes + ev-claim skill |
| task-trace | 灵枢 深度求索 | hi-agent | :8080 | skillchat |
| task-evolve | 灵枢 技能工坊 | OpenClaw | :19900 | ? |
| task-stock | 灵犀 股票分析 | OpenClaw | :8188 | ? |
| task-trading | 灵犀 智能交易 | TradingAgents | :8189 | trading-server.py |
| task-ppt | 灵匠 幻灯片PPT | OpenClaw(远端) | :19789 | openclaw-gateway |
| task-code | 灵匠 代码助手 | OpenClaw(远端) | :19800 | server.mjs |
| task-slides | 灵匠 幻灯片HTML | OpenClaw(远端) | :19800 | server.mjs |

## 调用协议详解

### 协议 A: OpenClaw Gateway (OpenAI 兼容 + 扩展 header)

```
POST /v1/chat/completions
Headers:
  Authorization: Bearer <CLAW_GATEWAY_TOKEN>
  x-openclaw-agent-id: <per-tenant-agent-id>
  x-openclaw-session-key: <TIL 脱敏后的 sessionKey>
  x-openclaw-model: <可选>
Body: { model: "openclaw", stream: true, messages: [...] }
Response: SSE (OpenAI chat completion chunk 格式)
```

用于: 主聊天(:18789), task-ppt/task-code/task-slides(远端 :19789/:19800)

### 协议 B: Hermes Agent API (结构化生命周期事件)

```
Step 1: POST /v1/runs
  Body: { input: "消息", session_id: "<sessionKey>" }
  Response: { run_id: "..." }

Step 2: GET /v1/runs/{run_id}/events
  Response: SSE
    message.delta / tool.started / tool.completed / run.completed
```

用于: task-hermes, task-credit-risk, task-bond, task-my-wealth, task-claim-ev

### 协议 C: hi-agent (POST + 轮询)

```
POST /runs → GET /runs/{id} (poll)
```

用于: task-trace

### 协议 D: TradingAgents (自定义流式)

```
POST /analyze → SSE (多阶段)
```

用于: task-trading

## A2A 协议演进分析

### 现状评估 (2026-04)

A2A (Google Agent-to-Agent Protocol, 2025-04 发布):
- 状态: 开放规范，有 GitHub repo + Python/JS SDK，非正式标准
- 采纳: Google/Salesforce/LangChain/CrewAI 宣布支持，无大规模生产部署
- 协议: HTTP + JSON-RPC 2.0, Agent Card 发现, Task 生命周期, SSE 流式

### 灵虾现有协议 vs A2A 映射

```
灵虾现有                          A2A 对应概念
────────                          ──────────
business_agents 表                Agent Card (/.well-known/agent.json)
/api/claw/business-chat-stream    tasks/send
SSE 事件流                        tasks/sendSubscribe
session_id / sessionKey           Task ID + 状态机
tool.started / tool.completed     Task Artifact streaming
```

### 建议: 内部 Adapter 先行，A2A 观望

```
Phase 1 (现在): 定义 AgentAdapter 接口，把 4 种协议各包一个 adapter
  → claw-business.ts 从 118KB if-else 变成 adapter.dispatch()
  → 不依赖 A2A，纯内部重构

Phase 2 (Q3 2026): A2A 成熟后，adapter 接口对齐 A2A
  → Agent Card 替代 business_agents 表
  → tasks/send 替代各种自定义 HTTP 调用

跳过条件: 如果 agent 始终只在内部，不需要第三方互联互通，
          自定义 adapter 比 A2A 更简单可控
```

### MCP vs A2A 定位

```
MCP:  agent ← 工具/上下文 (垂直: 给 agent 加能力)
      灵虾已有: lingxia-mcp-server.ts

A2A:  agent ↔ agent (水平: agent 之间通信)
      灵虾需要: 替代当前 4 种异构协议

两者互补，不竞争。灵虾向上是 A2A (调度 agent)，向下是 MCP (暴露平台工具)。
```

## 部署者视角: 最小到完整

| 层级 | 需要部署 | 可用能力 |
|------|----------|----------|
| L0 平台壳 | MySQL + Node + linggan-claw | 注册/登录/admin UI |
| L1 基础聊天 | + OpenClaw + LLM API Key | 通用对话、文件处理 |
| L2 金融技能 | + Hermes Agent + skills 包 | 信用/债券/理财/理赔 |
| L3 完整版 | + TradingAgents + skillchat | 全部 agent |

每层的 agent 在 business_agents 表中 enabled=1 即可激活,
apiUrl 指向实际部署地址。

---

# v3 架构决策更新（2026-04-25）

> 本段落是 v2 的**增量决策记录**，不替换 v2。v2 中已写到的认知（A2A/MCP 演进分析、协议详解、记忆体系基础设施、部署者视角分层）继续有效，v3 仅记录方向调整与处置定稿。
>
> 决策来源：2026-04-25 全面架构梳理 session，由 lihongkun 拍板。

---

## 1. 决策摘要

| # | 决策 | 影响 |
|---|------|------|
| 1 | **Runtime 三层定位明确** | Claude Code = 产物 / 本机 Hermes = 业务 / 123 Hermes = runtime 试点（per-user）|
| 2 | **退役 5 个 task-*** | task-trading / task-hermes（入口）/ task-evolve / task-finance / task-xxx |
| 3 | **对外用 5+1 张 "专家卡" 语义** | 停止扩张 task-* 命名；task-* 内化为工程代号 |
| 4 | **Hermes 业务 persona 走 `personalities` 字段** | 不通过 profile 做人格切换；profile 留给用户隔离 |
| 5 | **task-trace 保留**（自研，持续优化） | hi-agent + agent-kernel @123 不退 |
| 6 | **task-stock 保留观望** | stock-analysis @本机 + kronos 套娃暂不动，中期再决定迁移方向 |

---

## 2. 物理拓扑修正（v2 → v3）

v2 把 5 个业务 agent 画在 "AWS 服务器" 但未澄清实质。v3 修正：

- **"AWS 服务器" = 本机**（HOME=/home/ubuntu，是开发主机也是事实生产业务集群）
- **5 个金融保险 agent ≠ 5 个独立服务**，本质是 **同一个本机 Hermes 实例 + 不同 skills 子目录 + claw-business.ts 里不同 prompt 段** 的差异
- **task-stock 不是 v2 写的 OpenClaw :8188**，实际是 stock-analysis 项目（独立 Claude Code + kronos FastAPI :8190）三层套娃
- **本机除 Hermes 外还跑**：Claude Code (:19800) + OpenClaw 副本 + TradingAgents (:8189) + kronos (:8190) + sse_proxy

修正后真实拓扑：

```
┌─[123 生产]─────────────────────────────────┐
│  灵虾前端                                    │
│  linggan-platform server (linggan-claw)     │
│  OpenClaw 主聊天底座                         │
│  Hermes per-profile runtime（试点底座）      │
│  hi-agent + agent-kernel (task-trace)        │
│  TradingAgents.service [退役]                │
└──────────────┬─────────────────────────────┘
               │ 跨机 HTTP / SSH 隧道
               ▼
┌─[本机：业务能力集群 = AWS 这台]──────────┐
│  Claude Code :19800   → task-ppt/code      │
│  本机 Hermes :8642    → task-bond/credit/  │
│                          claim/my          │
│  stock-analysis       → task-stock         │
│                         (含 kronos :8190)   │
│  TradingAgents :8189  [退役]                │
└────────────────────────────────────────────┘
```

---

## 3. L1/L2/L3 三层架构

```
L1 用户卡（对外，最终用户感知）
   PPT 设计师 / 编程数据助手 / 调研员 /
   金融分析师 / 保险顾问 / 理财管家 /
   协作主持人 / 主聊天默认（兜底）

L2 agent 定义层
   Claude Code 这边  → .claude/agents/*.md (subagent 标准格式)
   本机 Hermes 这边  → config.yaml > personalities 字段
   123 Hermes 这边   → 用户即服务 / per-profile（不放业务 persona）

L3 runtime 职责边界
   Claude Code @本机     → 产物中心
   本机 Hermes @本机     → 业务中心
   123 Hermes @123       → runtime 试点（企业客户独立实例）
   OpenClaw @123 + @本机 → 主聊天底座（历史负担，不扩展）
```

---

## 4. 4 条强约束（不能破坏）

1. **Claude Code 不放业务能力** —— 不写 "金融分析师" subagent，不让 PPT/编程跨界做金融
2. **本机 Hermes 不出产物 task** —— 不让金融 persona 做 PPT 或代码生成
3. **123 Hermes 不混业务 persona** —— 保持纯净，给将来企业客户用
4. **任何新业务先选 L3 runtime，再写 L2 定义** —— 不再凭直觉创建 task-*

---

## 5. 5+1 张专家卡 → task-* → runtime 映射

| 卡（对外） | 内部 task-* | runtime | agent 定义位置 |
|---|---|---|---|
| PPT 设计师 | task-ppt | Claude Code @本机 | `.claude/agents/ppt.md` |
| 编程数据助手 | task-code (含 task-slides 别名) | Claude Code @本机 | `.claude/agents/coder.md` |
| 调研员（待建） | （新建） | Claude Code @本机 | `.claude/agents/researcher.md` |
| **金融分析师** | task-stock + task-bond + task-credit-risk | stock-analysis + 本机 Hermes | personality=finance + stock 内 cc agent |
| 保险顾问 | task-claim-ev | 本机 Hermes | personality=insurance |
| 理财管家 | task-my-wealth | 本机 Hermes | personality=wealth |
| 协作主持人 | (Coop V2 模块) | 123 主 server | Coop 模板 |
| 主聊天默认 | - | OpenClaw @123 | 兜底 |

**特殊说明：**
- "金融分析师"卡跨 2 个本机服务（stock-analysis + 本机 Hermes），是因为 task-stock 暂保留观望。短期接受跨服务，对外用户感知是一张卡。
- task-trace 不立独立卡 —— 定位为 "主聊天的深度模式" 功能而非用户主动召唤的角色。

---

## 6. 14 task-* → 9 处置定稿

| task-* | v3 处置 | 落点 / 说明 |
|---|---|---|
| task-ppt | 保留 | Claude Code @本机 |
| task-code | 保留 | Claude Code @本机 |
| task-slides | **合并到 task-code**（删别名） | - |
| task-stock | 保留观望 | stock-analysis @本机 |
| task-trace | **保留**（自研持续优化）| hi-agent + agent-kernel @123 |
| task-bond | 保留 | 本机 Hermes (finance personality) |
| task-credit-risk | 保留 | 本机 Hermes (finance personality) |
| task-claim-ev | 保留 | 本机 Hermes (insurance personality) |
| task-my-wealth | 保留 | 本机 Hermes (wealth personality) |
| ~~task-hermes~~ | **业务入口退**，runtime 保留 | 入口下、123 Hermes 不动 |
| ~~task-evolve~~ | **已退役 2026-04-25** (DB=0 + 前端删, jiuwenclaw 不停) | - |
| ~~task-trading~~ | **已退役 2026-04-25**（服务停+DB=0+代码删）| 跨业务能力下沉到 finance personality |
| ~~task-finance~~ | 已下线，**清死代码** | - |
| ~~task-xxx~~ | **占位符删** | - |

**结果**：14 个 task-* → 9 个，命名空间立刻清爽。

> **已校对（2026-04-25）**：DB `business_agents` 主键确认是 `task-credit-risk` / `task-claim-ev` / `task-my-wealth`。代码 `claw-business.ts` 里的 `task-credit` / `task-claim` / `task-my` 是 prompt 文案内的简化引用，不是 agentId。v3 表格已更正为 DB 主键命名。

---

## 7. Hermes profile vs personality 区分（认知补丁）

v2 没明确这个区分，未来很容易踩坑。v3 写清楚：

| 维度 | profile | personalities |
|---|---|---|
| **设计本意** | 用户级隔离（sessions/memories/sandboxes 各一份） | persona 切换器（system prompt 注入） |
| **隔离粒度** | 全套 Hermes 实例 | 仅 prompt |
| **多用户共享同一 persona** | 每用户重复一份（×N） | 一份 prompt 所有用户共用 |
| **切换成本** | 重启服务 | 调用时传参 |
| **本机 Hermes 怎么用** | **不要用**（本机无 profile 目录） | **用此机制**（config.yaml 加业务 personality） |
| **123 Hermes 怎么用** | **用此机制**（per-user 隔离） | 不放业务 persona，只留通用基础人格 |

---

## 8. 三层记忆体系更新

v2 Layer 2 提到 "task-hermes 及 4 个金融 skill agent 共享 ~/.hermes/memories/MEMORY.md"。

v3 调整：
- **task-hermes 业务入口退役** → "集体记忆" 概念在产品层失效
- 4 个金融 skill 仍共享本机 Hermes 单实例，记忆继续 work，但不再对外宣传 "团队脑"
- **方向调整为 per-user × per-task 记忆**（参考 ChatGPT Memory / Anthropic Skills memory 模型），需在主 server 层（linggan-platform）加 `(user_id, task_name) → memory_blob` 表
- v2 Layer 1 (OpenClaw) 和 Layer 3 (灵虾平台记忆) 不变

---

## 9. 风险与监控（v2 没覆盖）

### 风险 1 · 跨机调用是单点
所有非主聊天 task-* = 123 跨机调本机。本机网络抖一下、服务重启、API key 过期 → 整个业务能力集群下线。

**演示前必须**：
- 监控：123 → 本机所有服务的健康检查 + 告警
- 优雅降级：本机挂时主聊天里相关 task-* 给出 "暂时不可用" 而不是 500
- 心跳脚本：每分钟测一次本机所有端口（19800 / 8642 / 8189 / 8190 / hi-agent）

### 风险 2 · 本机管理上是 dev 但事实上是生产
- 现状：本机被定位为 "代码备份"，但业务能力集群都在跑
- 短期建议：承认本机是生产，纳入运维清单 + 加监控 + 规范变更
- 中期可选：把业务能力迁到 123 或第三台真生产机

### 风险 3 · stock-analysis 套娃
- 链条：task-stock → stock-analysis (Claude Code 项目) → kronos FastAPI
- 三层调用，调试困难，出 bug 难定位
- 中期决策：保留独立 / 迁入本机 Hermes finance skills，二选一

---

## 10. 待办（按优先级）

| # | 动作 | 工作量 | 风险 | 依赖 |
|---|------|--------|------|------|
| 1 | 跨机心跳监控（123 → 本机所有端口） | 1h | 零 | - |
| 2 | 退役 task-trading（停服务 + 清前端引用） | 30m | 中（确认无生产调用）| - |
| 3 | 5 张专家卡 v0.2 system prompt 草稿 | 2h | 零 | - |
| 4 | 本机 Hermes 加 3 个业务 personality | 30m | 低 | 校对 Hermes API 是否支持传 personality 参数 |
| 5 | task-hermes 入口下 + 死代码清理（task-evolve/finance/xxx）| 1-2h | 中 | grep 全引用扫描 |
| 6 | 校对 business_agents 表与代码 agentId 命名一致性 | 30m | 零 | - |
| 7 | per-user × per-task 记忆设计（替代 task-hermes 共享记忆）| 1-2 周 | 低 | 演示后做 |
| 8 | TradingAgents 服务彻底删除（确认 1 周无影响后）| 30m | 低 | 等待 1 周观察 |

---

## 11. v3 没决定的问题（留给后续）

1. **stock-analysis 中期方向**：保留独立项目 vs 迁入本机 Hermes finance skills
2. **集群编排 UI**：演示后再讨论（参考 Kimi Agent 集群派生模式 + Intent Hint Card）
3. **Markdown agent loader**：长期目标，统一 agent 定义格式（.claude/agents 标准），跨 runtime 派发 —— 是 "集群" 能力的工程基础
4. **123 Hermes runtime 试点**：什么时候开始接企业客户的 per-user Hermes 实例
5. **task-trace 是否升级为独立"任务追踪员"专家卡**

---


---

## 12. 长尾待办与 v3 勘误（持续更新）

### 12.1 task-trading 退役完成记录（2026-04-25）

**已完成 8 步**（见 backups/ARCHITECTURE-AGENTS.md.bak-20260425-pre-v3-fix 之前的对话记录）：

1. 备份 `claw-business.ts` + `CollabDrawer.tsx` → `.bak-20260425-pre-trading-retire`
2. DB `UPDATE business_agents SET enabled=0 WHERE id='task-trading'`
3. 删前端 CollabDrawer.tsx 三处（UI 卡片块 55 行 + 2 处字符串引用）
4. `pnpm build`（13.26s）→ dist/client 自动 pick up
5. 删后端 `claw-business.ts` 第 1734-1828 行（95 行 task-trading 块）
6. `pm2 restart linggan-claw` → online 正常
7. 123: `systemctl stop && disable trading-agents.service` → inactive (disabled)
8. 本机: `kill` trading-server.py PID 1605026 + 父 bash → 8189 端口空闲

**长尾清理（带日期，到期记得做）：**

| 到期日 | 动作 | 命令 / 位置 |
|---|---|---|
| **2026-05-02**（1 周观察期）| DB 彻底删 task-trading 行 | `mysql ... -e "DELETE FROM business_agents WHERE id='task-trading'"` |
| 2026-05-02 | 删 `/etc/systemd/system/trading-agents.service` 文件 | `rm /etc/systemd/system/trading-agents.service && systemctl daemon-reload` |
| 2026-05-02 | 删 `/root/TradingAgents/` 整个目录 | `rm -rf /root/TradingAgents` |
| 2026-05-02 | 删本机 `/home/ubuntu/TradingAgents/` 同步删 | （AWS 这台）|
| **2026-05-09**（2 周观察期）| 清备份文件 | `rm /root/linggan-platform/{server/_core,client/src/components}/*.bak-20260425-pre-trading-retire` |
| 2026-05-09 | 清本文档备份 | `rm /root/linggan-platform/backups/ARCHITECTURE-AGENTS.md.bak-20260425-pre-v3*` |

**回滚方法（如需）：**

```bash
# 1. DB 恢复
mysql -h 1.92.199.145 -u root -p... -D finance_ai -e "UPDATE business_agents SET enabled=1 WHERE id='task-trading'"

# 2. 代码恢复
cd /root/linggan-platform
cp server/_core/claw-business.ts.bak-20260425-pre-trading-retire server/_core/claw-business.ts
cp client/src/components/CollabDrawer.tsx.bak-20260425-pre-trading-retire client/src/components/CollabDrawer.tsx
pnpm build && pm2 restart linggan-claw

# 3. 服务恢复
ssh root@123 "systemctl enable --now trading-agents.service"
# 本机重启 trading-server.py（参考 ~/TradingAgents/start.sh 或 4-12 父 bash 残留启动命令）
```

---

### 12.2 v3 勘误（基于 2026-04-25 dry-run 实测）

**勘误 1 · 第 2 节物理拓扑图**

| 错误描述 | 真实情况 |
|---|---|
| ❌ "stock-analysis 在本机集群" | ✅ stock-analysis 在 **123** 上跑（`/root/stock-analysis/` + `uvicorn server:app --port 8188`，PID 765583，user=root）|
| ❌ "task-stock 含 kronos :8190 套娃" | ✅ kronos-financial-analyzer 在**本机** :8190，是**独立项目**，与 task-stock 无关（DB api_url=`http://127.0.0.1:8188` 指向 123 本地 stock-analysis）|

**修订后的 task-stock 真实链路：**
```
灵虾 server (123) → http://127.0.0.1:8188 → uvicorn (123 上 /root/stock-analysis/) → server:app
```

**勘误 2 · 第 9 节风险 3 stock-analysis 套娃**

原文说 "task-stock → stock-analysis (Claude Code 项目) → kronos FastAPI 三层" —— **错**。

真实结构是两层：
- 灵虾 server → 123 上 stock-analysis 的 uvicorn :8188
- stock-analysis 内部是否真嵌套 Claude Code subagent，需进一步验证（`grep -r ".claude/agents" /root/stock-analysis/`）

**勘误 3 · 部分 task-* 命名（已修正在第 5/6 节）**

| 代码侧（v3 原写法）| DB 主键侧（已校正）|
|---|---|
| task-credit | task-credit-risk |
| task-claim | task-claim-ev |
| task-my | task-my-wealth |

代码里的简称是 prompt 文案内引用，不是 agentId。

---

### 12.3 已查证项（2026-04-25 实测）

| # | 项 | 查证结论 | 行动建议 |
|---|---|---|---|
| 1 | **kronos @本机 :8190** | 是独立项目 [Kronos Financial Analyzer](https://github.com/shiyu-coder/Kronos)（2026-04-13 用户手动 `uvicorn` 起的），定位 OpenClaw skill / Kronos 金融基础模型 demo。**与 task-stock 完全无关**。grep 灵虾代码 0 引用，12 天 0 调用 | **已退役 2026-04-25** (kill PID 1819693, 8190 端口空闲; 目录留待 5/2 清)  |
| 2 | **task-evolve api_url=:19900** | 19900 实际跑 `/root/jiuwenclaw-proxy.py`（jiuwenclaw 代理）。task-evolve 名为 "灵枢 · 技能工坊" 但后端指向 jiuwenclaw —— 早期 hack | **已退役 2026-04-25** (DB enabled=0 + 前端删; jiuwenclaw 服务保留)|
| 3 | **stock-analysis 内是否套娃 cc** | **不是套娃**。`/root/stock-analysis/app/server.py` 0 个 claude/anthropic 引用，是 FastAPI。仅 `src/services/image_stock_extractor.py` 用 anthropic vision API（litellm 路由）做股票图片识别，非 agent loop。`.claude/skills/` 目录是历史遗留 | **v3 § 9 风险 3 描述错了**：task-stock 实际是单层 FastAPI，无套娃复杂度。中期方向无需考虑 "拆套娃"，仅需评估业务能力是否迁本机 Hermes |

---
### 12.4 task-evolve + kronos 退役完成记录（2026-04-25）

**task-evolve 退役 4 步：**

1. 备份 `CollabDrawer.tsx` → `.bak-20260425-pre-evolve-retire`
2. DB `UPDATE business_agents SET enabled=0 WHERE id='task-evolve'`
3. 前端 4 处删（图标映射 / 颜色 fallback / 分组 filter 数组 / categorized Set）
4. `pnpm build`（12.46s）→ 无后端代码改动，无需 `pm2 restart`

**kronos 退役 1 步：**

1. `kill 1819693` （本机的 `uvicorn api_server.main:app --port 8190`）→ 8190 端口空闲

**关键事实：**
- task-evolve **后端无专属路由块**（走 generic remote 默认路径），只有一处 `claw-business.ts:1736` 注释提到名字，可下次清理一起删
- jiuwenclaw 服务**未停**（`hermes-cron.ts` 把 jiuwenclaw 列为合法 runtime；task-evolve 只是个不该挂在那的代理入口）
- kronos 与灵虾代码 grep 0 引用、12 天 0 调用，**与 task-stock 完全无关**

**长尾清理（合并到 § 12.1 同日清理）：**

| 到期日 | 动作 | 命令 |
|---|---|---|
| 2026-05-02 | DB 彻底删 task-evolve 行 | `mysql ... -e "DELETE FROM business_agents WHERE id='task-evolve'"` |
| ✅ 已做 2026-04-25 | kronos venv 已删（5.4G 回收，源码 8.2M 保留）| 想恢复: `cd ~/kronos-financial-analyzer && python -m venv venv && pip install -r requirements.txt` |
| 2026-05-02 | 清 `claw-business.ts:1736` TIL 注释里残留的 `task-evolve` / `task-finance` 名字 | sed 替换 |
| 2026-05-09 | 清 `CollabDrawer.tsx.bak-20260425-pre-evolve-retire` 备份 | `rm` |

**回滚方法：**

```bash
# task-evolve 回滚
mysql ... -e "UPDATE business_agents SET enabled=1 WHERE id='task-evolve'"
cp client/src/components/CollabDrawer.tsx.bak-20260425-pre-evolve-retire \
   client/src/components/CollabDrawer.tsx
pnpm build

# kronos 回滚（如果还需要）
cd ~/kronos-financial-analyzer && nohup ./venv/bin/python -m uvicorn api_server.main:app --host 0.0.0.0 --port 8190 &
```

---


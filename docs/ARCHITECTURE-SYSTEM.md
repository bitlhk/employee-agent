# 灵虾智能体平台架构设计

> 版本: v4 | 最后更新: 2026-04-14
> 代码已验证 | 对应仓库: /root/linggan-platform/

---

## 整体分层

```
┌─────────────────────────────────────────────────────────────┐
│  ① 门户与接入层                                              │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ 灵感门户     │  │ 租户管理     │  │ 接入路由     │     │
│  │ 官网/注册    │  │ 领养/续期    │  │ 子域名路由   │     │
│  │ 登录/套餐    │  │ 实例创建     │  │ 路径路由     │     │
│  │              │  │ 权限分配     │  │ 品牌定制     │     │
│  │              │  │ starter/plus │  │              │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 多端触达                                              │  │
│  │ Web UI · 微信 · 企业微信 · 飞书 · Webhook · API      │  │
│  │ WebSocket · HTTP SSE · tRPC                           │  │
│  └──────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  ② 平台层（核心大脑）                                        │
│                                                             │
│  ┌─────────┐ ┌─────────┐ ┌──────┐ ┌──────┐ ┌───────┐    │
│  │用户鉴权 │ │意图路由  │ │ TIL  │ │审计  │ │流量   │    │
│  │JWT+Cookie│ │L1 规则  │ │多租户│ │操作  │ │控制   │    │
│  │tRPC ctx │ │L2 LLM   │ │隔离  │ │记录  │ │限流   │    │
│  └─────────┘ └─────────┘ └──────┘ └──────┘ └───────┘    │
│                                                             │
│  ┌──────────────────┐  ┌─────────────────────────────┐    │
│  │ 平台记忆          │  │ 通知与调度                   │    │
│  │ Hermes 式策展提取 │  │ Cron · 微信桥 · 企微/飞书   │    │
│  │ 跨 Agent 用户偏好 │  │ Webhook · 渠道分发          │    │
│  └──────────────────┘  └─────────────────────────────┘    │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Agent Connector（协议适配器）                          │  │
│  │ 统一接口，屏蔽下层 Runtime 协议差异                    │  │
│  └──────────────────────┬───────────────────────────────┘  │
└─────────────────────────┼──────────────────────────────────┘
                          │
┌─────────────────────────▼──────────────────────────────────┐
│  ③ Agent Runtime 层                                         │
│                                                             │
│  ┌───────────────────┐  ┌───────────────────┐              │
│  │  OpenClaw Runtime │  │  Hermes Runtime   │              │
│  │                   │  │                   │              │
│  │  LLM 推理         │  │  LLM 推理         │              │
│  │  工具调用          │  │  工具调用(terminal)│              │
│  │  Docker 沙箱       │  │  技能系统(SKILL.md)│              │
│  │  (seccomp,无网络)  │  │                   │              │
│  │                   │  │  记忆              │              │
│  │  记忆             │  │  ├ MEMORY.md 策展  │              │
│  │  ├ session-memory │  │  ├ USER.md 用户画像│              │
│  │  ├ memory-core    │  │  └ background      │              │
│  │  │ (SQLite FTS)   │  │    review 自动提取 │              │
│  │  ├ dreaming       │  │                   │              │
│  │  └ per-user 隔离  │  │  会话              │              │
│  │                   │  │  └ session_id      │              │
│  │  会话             │  │    多轮上下文      │              │
│  │  ├ session key    │  │                   │              │
│  │  ├ per-user agent │  │  MCP 反向调用      │              │
│  │  └ workspace 隔离 │  │  └ lingxia-mcp     │              │
│  │                   │  │    定时任务/通知   │              │
│  └───────────────────┘  └───────────────────┘              │
│                                                             │
│  ┌───────────────────┐  ┌───────────────────┐              │
│  │  JiuwenClaw       │  │  Hi-Agent         │              │
│  │  独立部署          │  │  认知引擎         │              │
│  │  后端+前端         │  │  agent-kernel     │              │
│  │                   │  │  深度推理          │              │
│  └───────────────────┘  └───────────────────┘              │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  其他 Runtime（按需接入）                              │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────┬──────────────────────────────────┘
                          │
┌─────────────────────────▼──────────────────────────────────┐
│  ④ 基础设施层                                               │
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │ 数据库   │ │ 模型网关 │ │ 容器引擎 │ │ 反向代理 │     │
│  │ MySQL 8  │ │ DeepSeek │ │ Docker   │ │ Nginx    │     │
│  │ Drizzle  │ │ GLM-5    │ │ seccomp  │ │ TLS/WS   │     │
│  │          │ │ OpenRouter│ │          │ │          │     │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘     │
└─────────────────────────────────────────────────────────────┘
```

---

## 各层职责与代码映射

### ① 门户与接入层

管"谁能进来、怎么进来、进来后分配什么资源"。

| 模块 | 职责 | 代码位置 |
|------|------|----------|
| 灵感门户 | 官网首页、产品介绍、注册登录 | `pages/Home.tsx` `pages/Login.tsx` |
| 租户管理 | 领养灵虾、实例创建、套餐权限(starter/plus/internal) | `claw-provision.sh` `routers/claw.ts` `ClawHome.tsx` |
| 接入路由 | 子域名模式(*.demo.linggan.top) / 路径模式(/claw/:adoptId) | `index.ts` 路由 + Nginx 配置 |
| 品牌定制 | 多租户 logo/主题/名称 | `brand.ts` `useBrand.ts` |
| 多端触达 | Web UI(React SPA)、微信桥、企微/飞书/Webhook | WS/SSE/tRPC 三协议入口 |

**触达协议**：

| 协议 | 用途 | 代码入口 |
|------|------|----------|
| WebSocket | 主聊天(默认) | `claw-ws-proxy.ts` |
| HTTP SSE | 主聊天(降级) + 业务 Agent | `claw-chat.ts` `claw-business.ts` |
| tRPC | 技能市场/管理/设置 | `server/routers/*.ts` |
| HTTP 轮询 | 微信双向桥接 | `claw-weixin-bridge.ts` |

### ② 平台层

系统的"大脑"——鉴权、路由、隔离、记忆、审计都在这里，向下通过 Agent Connector 对接任意 Runtime。

| 模块 | 实现方式 | 代码位置 |
|------|----------|----------|
| 用户鉴权 | JWT 签名 → HttpOnly Cookie → tRPC context 提取 userId | `sdk.ts` `cookies.ts` `context.ts` |
| 意图路由 | L1: 规则打分(关键词,0-15分) → L2: DeepSeek tool calling 分类 | `intent-agent.ts` `intent-executor.ts` |
| 流量控制 | express-rate-limit 4 档: 通用/认证/严格/聊天 | `security.ts` |
| 异常封禁 | 4xx 累计自动封 IP，loopback 永不封 | `error-tracking.ts` |
| 多租户隔离(TIL) | HMAC-SHA256(uid+agentId) → tenantToken → per-tenant workspace + agent | `tenant-isolation.ts` |
| 安全审计 | DB 表: business_agent_audit + tool_execution_audits + agent_call_logs | `tenant-isolation.ts` `db/agents.ts` |
| 策略引擎 | auto(直接执行) / confirm(待实现) / review(待实现) | `intent-agent.ts` |
| 平台记忆 | Hermes 式每 N 轮 → DeepSeek tool calling → 写 OpenClaw workspace .md | `memory-extractor.ts` `memory-store.ts` `response-accumulator.ts` |
| 通知调度 | Gateway cron job + 平台渠道分发(微信/企微/飞书/webhook) | `claw-cron.ts` `cron-delivery.ts` `claw-notify.ts` |
| Agent Connector | 统一接口屏蔽 Runtime 协议差异(当前为 if-else,计划抽象为 Adapter) | `claw-business.ts` |

**Agent Connector 说明**：
当前协议适配逻辑内联在 `claw-business.ts` (2372行)，通过 `business_agents` 表动态路由到对应 Runtime。计划抽象为 AgentAdapter 接口（借鉴 A2A Task 模型），等 smoke test 覆盖后执行。

业务 Agent 的 system_prompt 支持 DB 优先 + 代码兜底：部署者可在 admin 后台自定义 prompt，无需改代码。

### ③ Agent Runtime 层

实际执行 AI 推理、工具调用、上下文管理的运行时。

**OpenClaw Runtime**（主力 Runtime）：

| 能力 | 实现 |
|------|------|
| LLM 推理 | 多模型切换(DeepSeek/GLM/OpenRouter) |
| 工具调用 | 内置工具集(read/write/exec/web_search/web_fetch) |
| 代码沙箱 | Docker 隔离(seccomp, network=none, 资源限制) |
| 记忆 | session-memory hook + memory-core(SQLite FTS) + dreaming(凌晨3am整理) |
| 会话 | per-user session key + per-user agent + workspace 目录隔离 |
| 技能 | skills/ 目录，SKILL.md 描述 + scripts/templates 附件 |

**Hermes Runtime**（业务 Agent 主力）：

| 能力 | 实现 |
|------|------|
| LLM 推理 | 多模型(GPT/Claude/DeepSeek/GLM) |
| 工具调用 | terminal 工具执行 skill 目录下的 Python 脚本 |
| 技能系统 | SKILL.md(frontmatter + 操作步骤) + 自动创建/更新 |
| 记忆 | MEMORY.md(策展式,§分隔,2200 char) + USER.md(1375 char) + background review(每10轮自动提取) |
| 会话 | session_id 多轮上下文 |
| MCP 反向调用 | lingxia-mcp-server(stdio JSON-RPC): 定时任务/通知推送/频道查询 |

**JiuwenClaw**：独立部署的对话服务，后端+前端一体。

**Hi-Agent**：认知引擎 + agent-kernel 双进程，深度推理能力。

**其他 Runtime**：按需接入，只需在 `business_agents` 表注册 apiUrl 即可。

### ④ 基础设施层

| 组件 | 技术 | 用途 |
|------|------|------|
| 数据库 | MySQL 8.0 + Drizzle ORM | 用户/Agent/审计/技能市场等业务数据 |
| 模型网关 | DeepSeek / GLM-5.1 / OpenRouter | LLM 推理（通过 Runtime 层调度） |
| 容器引擎 | Docker + seccomp | 代码沙箱隔离执行 |
| 反向代理 | Nginx | TLS 终止、WebSocket 升级、CORS、静态资源 |

---

## 记忆体系（横切 ② ③ 两层）

```
平台层记忆（② · 用户维度 · 跨 Agent）
  触发: 每 N 轮对话结束后异步
  提取: DeepSeek + Hermes 原版 prompt + tool calling
  存储: OpenClaw workspace/memory/user-preferences.md
  注入: injectMemory() → 各 agent system prompt
  特点: 跨 Agent 共享，OpenClaw memory-core 自动索引

Runtime 层记忆（③ · 会话/Agent 维度）
  OpenClaw:
    session-memory → 会话摘要
    memory-core → SQLite FTS 索引
    dreaming → 凌晨整理（需 cleanup 防累积）
    隔离: per-user workspace
  Hermes:
    MEMORY.md + USER.md → 策展式
    background review → 每 10 轮自动提取
    隔离: per-agent（共享实例）

两层协作:
  平台层记用户画像和跨 Agent 偏好
  Runtime 层记对话细节和 Agent 级经验
  存储位置不同，不冲突
```

---

## 关键数据流

### 新用户完整流程

```
访问 linggan.top → 注册账号 → 登录
  → 领养灵虾 → claw-provision.sh 创建 per-user agent
  → 分配 adoptId (lgc-xxx) → 创建 workspace 目录
  → 进入控制台 → WebSocket 连接 → 开始对话
```

### 主聊天数据流

```
用户消息 → WebSocket /api/claw/ws
  ├─ 鉴权 (cookie → userId)
  ├─ 创建 ResponseAccumulator
  ├─ 意图路由: L1 规则 → L2 DeepSeek → 平台操作 or 透传
  ├─ 转发 OpenClaw Gateway → agent 处理 → 流式返回
  ├─ delta → 前端渲染 + memAcc 缓冲
  └─ 完成 → memAcc.flush() → 异步记忆提取
```

### 业务 Agent 数据流

```
用户选择 agent → POST /api/claw/business-chat-stream
  ├─ DB 查 business_agents → 找到配置
  ├─ TIL 租户隔离 → tenantToken + workspace
  ├─ 构建 system prompt (DB 优先 + 代码兜底 + 记忆注入)
  ├─ Agent Connector 按协议分发 → Runtime 处理
  ├─ SSE 流 → 前端渲染 + memAcc 缓冲
  └─ 完成 → 审计记录 + memAcc.flush()
```

---

## 部署分层

| 层级 | 需要部署 | 可用能力 |
|------|----------|----------|
| L0 平台壳 | MySQL + Node + linggan-claw | 注册/登录/admin UI/技能市场 |
| L1 主聊天 | + OpenClaw + LLM API Key | 通用对话、代码执行、文件生成 |
| L2 业务 Agent | + Hermes / JiuwenClaw / 自定义 | 金融分析、深度推理等 |
| L3 全渠道 | + 微信/企微/飞书配置 | 多渠道通知、定时推送 |

---

## 技术决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 协议统一 | 暂不采用 A2A，内部 Connector 先行 | A2A 无生产案例，自定义适配更可控 |
| 记忆存储 | 写 OpenClaw workspace .md | 不另建表，OpenClaw 自动索引，单一 source |
| 记忆提取 | 复用 Hermes 原版 prompt + tool schema | 经过实战验证，不重复造轮子 |
| Agent prompt | DB system_prompt 优先 + 代码兜底 | 部署者 admin 自定义，不碰代码 |
| 开源策略 | 单仓库 + build-oss.sh 脱敏 | 一套代码，不维护两个 fork |
| 接入路由 | 支持子域名 + 路径模式 | 企业内网无需泛域名即可部署 |
| Dreaming | 保留 + cleanup 脚本 | 功能有价值，产出需清理防污染 |

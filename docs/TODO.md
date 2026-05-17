# 灵虾 TODO（待办池）

> 2026-04-19 更新：ICBC 演示再次取消（历史：04-10 → 04-19 → 至少推迟到 04-26+）。冻结解除但仍要"随时可能下周演示"姿态——hot path 改动仍备份+验证+可撤。

## P1 - 输入框升级：textarea → 富文本（Tiptap）
- **背景**：当前主聊天 ChatInput 是 plain textarea，@mention 用纯文本 `@用户名` + 父组件 `mentionedUsers` 状态。删除标签时状态不会同步（已用 onSend 里 reconcile 兜底，2026-04-16）。
- **目标**：换成 Tiptap (prosemirror) 或 Lexical，`@用户名` 渲染为不可分割的 chip span，删一次按键删整体；同时为未来 `@文件` / `@技能` / Slash command 打基座。
- **工作量估算**：1-2 周，含 IME/光标/撤销栈/粘贴/emoji 完整测试。
- **触发时机**：当输入框需要支持 ≥2 种 mention 类型时一起做；现在 @mention 单一类型靠兜底能撑，不紧急。
- **风险**：动 ChatInput hot path，必须有完整 e2e 测试覆盖再 ship。

## ✅ P0 - Hermes 多租户安全加固（2026-04-20 已完成 P0.1+P0.2+P0.3a，达 ~85% 覆盖）

**核心认知**（2026-04-20）：Hermes profile 是**单用户切人格**机制，不是租户隔离边界。多租户边界画在 Hermes 之外。

**当前状态**：内部 1-2 信任灰度安全门槛已过；扩到 5-10 同事前需做下方 🔥 P1 三项；对外开放前需做 P0.3b。

### ✅ P0.1 - systemd hardening（已完成）
- 当前 `hermes-http@.service` `User=root` + 无 namespace 防护 → prompt injection 能 `cat /root/linggan-platform/.env`（MySQL+全部 API key）
- **修复**（保持 User=root，靠 mount namespace 而不靠用户隔离 — /etc/shadow 有 immutable 不动它）：
  ```ini
  ProtectSystem=strict
  ProtectHome=true
  ReadWritePaths=/root/.hermes /var/log
  ReadOnlyPaths=/root/hermes-agent
  NoNewPrivileges=yes
  PrivateTmp=yes
  ```
- ProtectHome=true 把 /root 全封（包括 .env / .ssh / linggan-platform/），ReadWritePaths 显式开口给 .hermes
- **覆盖**：80% 威胁（读 .env / .ssh / 改 /etc/nginx）。**不覆盖**：profile 间互看、网络出站、资源耗尽
- **适合**：2-3 个最信任的同事灰度
- **验证**：① 两 service active；② curl :8643/8644/health 通；③ Hermes agent 跑 `cat /root/linggan-platform/.env` 应失败
- **不建 hermes 用户的原因**：/etc/shadow 有 immutable 防护（来源未知，先别动）；建用户只补 15% 防御深度（防 chmod 破坏 / 防 kill 别人进程），主防线靠 mount namespace 已到位

### ✅ P0.2 - profile 隔离 (mount ns 反向白名单)（已完成 30 分钟，零代码）
原方案独立 HERMES_HOME 目录树被更优的 systemd 配置方案替代：
- `TemporaryFileSystem=/root/.hermes/profiles` 盖空 tmpfs 隐藏所有 sibling
- `BindPaths=/root/.hermes/profiles/%i` 只把自己 profile 挂回去
- nsenter 验证两 instance 都看不到 sibling profile + 攻击者 mkdir EVIL 在 namespace 成功但 host 不污染
- **覆盖**：profile 互看 + 跨 profile 写注入
- 详见 memory `project_hermes_multitenant_design.md` + 已完成区域

### ✅ P0.3a - Hermes docker terminal backend（已完成 30 分钟）
重大发现：Hermes 自带 docker terminal backend，工业级安全配置 (cap-drop ALL + no-new-privileges + pids-limit + tmpfs nosuid + network=none + cgroup)。
- 复用 OpenClaw `openclaw-sandbox:bookworm-slim` 镜像，零定制
- e2e 验证：容器 hostname 是 docker id / wget 1.1.1.1 NETWORK_BLOCKED / cat host .env No such file
- 工作量从原估 2-3 周降到 30 分钟（不需要 fork 也不需要包 wrapper）

### P0.3b - hermes-http 进程本身容器化（1-2 周，对外开放前必做）
P0.3a 只把 terminal_exec 容器化，**hermes-http 进程本身仍 host root 跑**。剩余攻击面：
- web_extract / web_crawl tool 走 host 网络栈 → SSRF 内网 (1.92.199.145 MySQL / 116 灵感 server)
- read_file / write_file tool 走 host 文件系统 (有 P0.1 mount ns 兜底但仍是攻击路径)
- prompt injection → hermes-http 进程内任意 tool 调用 → 影响 host

修复：每用户独立常驻 docker container 跑整个 hermes-http (类比 OpenClaw per-agent 容器)
- 镜像：基于 hermes-agent 全代码 + venv + sandbox 工具集
- bridge 改 endpoint 为 container internal HTTP
- LLM key 注入容器 + 容器 outbound 网络白名单 (NetworkPolicy)
- 容器生命周期管理 (创/启/停/日志)

### 🔥 P1 - 多人灰度前必做的剩余加固（2026-04-20 修订）

**修订背景**：今天调研发现部分原 P1 项已被自动 cover 或优先级降低。

| # | 加固 | 工作量 | 触发时机 |
|---|------|--------|---------|
| 1 | LLM 配额 per-profile (token bucket on hermes-bridge) | 半天 | 共享 key 模型必做；OpenClaw 没参考 |
| 2 | terminal 命令历史集中收集 (bridge SSE 抓 tool_call delta + audit table) | 1 天 | 5+ 用户调试 + 合规 |
| 3 | agent 内部 memory write audit (inotify 监听 memories/) | 半天 | 5+ 用户场景；当前 1-2 灰度不紧急 |

**降级到 P3 的项**：
- ~~HERMES_HTTP_KEY per-profile~~ → 灵虾鉴权层已隔离用户↔profile，HERMES_HTTP_KEY 只是 server m2m 内部 token，用户够不到，per-profile rotation 无价值除非未来开放外部 third-party 调用
- ~~outbound 网络白名单~~ → 与 web_extract/web_crawl 设计冲突 (这些工具就是读任意 URL)；等 P0.3b 容器化时一起做更优雅

详见 memory: `project_hermes_multitenant_design.md`

## P1 - Memory 多 runtime + AgentPage 重构
- **Skills 已完成** ✅（2026-04-19 晚）：`server/_core/hermes-skills.ts` 读 Hermes profile skills 目录（67 bundled 可见），listSkills router 加 prefix 分叉
- **剩余**：
  - Memory 多 runtime：AgentPage 的"文件"tab 里 memory/*.md 文件，Hermes 要读 `/root/.hermes/profiles/<name>/memories/` 或接 state.db FTS 索引
  - AgentPage 重构：删 skills tab（外面 SkillsPage 已覆盖）+ 删 tools tab（个人用户不关心），只留 overview / files / **memory**
- **更大蓝图**：抽 `server/_core/runtime-providers/` 接口（base.ts + openclaw.ts + hermes.ts），所有前端页面走 runtime-aware provider，代替现在的 inline prefix 分叉
- **工作量**：0.5-1 天 memory + 0.5 天 AgentPage 重构 + 0.5 天 抽接口
- **触发时机**：领导想看"Hermes 自进化记忆" 或 AgentPage 清理时

## P2 - Hermes 运行时杂项坑
- **provisioning 脚本无回滚**：中途失败（profile 建好 systemd 启失败、或 DB INSERT 失败）留脏状态。修法：加 `trap ERR cleanup`。30 分钟
- **HERMES_HTTP_KEY 跨 profile 共享**：所有 hermes-http@ service 继承同一 key（bridge 用不影响）。真要 per-profile rotate 还要改 provisioning + bridge。低优先
- **Hermes HTTP API 每请求 new AIAgent**：~1-2 秒 init 开销（tools 注册 + skills snapshot）。加 per-(profile, model) LRU 缓存优化。半天

## P2 - 修 `claw_adoptions.lastActivityAt` 字段写入
- **背景**：28 条 active 领养该字段全 NULL，判断"谁的虾在活跃"只能扫 sandbox 文件 mtime
- **修法**：OpenClaw gateway 或 claw-chat.ts 入口，每次收到 chat 请求时 `UPDATE claw_adoptions SET lastActivityAt=NOW() WHERE adoptId=?`，加 1 分钟节流（防写放大）
- **工作量**：半天（server 改 + pm2 restart + 验证）
- **触发时机**：想做"池子清理"或"活跃度报表"时

## P2 - Hermes HTTP API：agent 缓存 + reasoning 流
- **背景**：`http_api.py` 每请求 new AIAgent，init 成本 1-2 秒（tools 注册 + skills snapshot）；GLM-5.1 返回 `reasoning_content` 当前被 Hermes 内部吞掉不推前端
- **优化**：
  1. Per-(profile, model) LRU 缓存 AIAgent，10 个实例内存 ≤1GB
  2. bridge 加 `event: reasoning` 事件，前端可选渲染 thinking chain
- **工作量**：半天
- **触发时机**：灰度用户反馈首问慢 / 想展示 GLM reasoning 能力时

## P3 - 协作 V2 后续增强（看使用数据决定）
- `memberSystemHint` 字段：成员端 CoopChatBox 首次 send prepend 硬规则（"严禁套话 / 必须数字 / 300 字"），当前只靠 memberPrompt 文本承载
- `{{粘贴素材}}` 占位符自动定位光标
- `lx_coop_templates` 表 + 自建模板（等内置用透再做）
- 微信邀请推送协作链接（推 `/coop/:sessionId` 给成员直达）

## P3 - 双虾 workspace 互通
- **背景**：Hermes 虾（`/root/.hermes/profiles/<name>/workspace/`）与 OpenClaw 虾（`/root/.openclaw/agents/trial_lgc-xxx/workspace/`）产物互不可见
- **方案**：引入 `/root/shared-workspaces/<userId>/` 两 runtime 都挂载；或每虾产物写 DB `file_library` 表跨 runtime 查询
- **触发时机**：用户抱怨"在 Hermes 虾生成的 PPT 在 OpenClaw 虾下看不到"

---

## 已完成 / 已修复

### 2026-04-20 下午晚（双线后端: cron Phase 1 + Files MVP 后端）
- [x] **hermes-cron.ts (251 行)** — LinggClawCronJob 类型 + CronProviderCapabilities + hermesCron provider (list/add/update/remove/pause/resume/trigger) + schema 翻译 (hermesJobToLingg + linggInputToHermesAdd)
- [x] **claw-cron.ts router 6 处入口分叉** — status/list/capabilities/add/update/run/remove，OpenClaw 业务逻辑全保留 + 加 inline openclawJobToLingg 让 response 统一 LinggClawCronJob 格式
- [x] **新加 GET /api/claw/cron/capabilities** — 前端按 cap 决策 UI 渲染
- [x] **hermes-files.ts (154 行)** — LinggFileNode + FilesProviderCapabilities + hermesFiles (capabilities/listFiles/readFile/resolveAbsPath) + path traversal 防御
- [x] **claw-files.ts router (175 行) 新建** — capabilities/list/read/download 4 endpoint，OpenClaw inline 对应实现，统一 LinggFileNode 格式
- [x] **e2e: 路由注册验证 lgh-lihongkun 全 endpoint 401 (auth 拦截而不是 404)**
- 严格按 CODING_GUIDELINES.md 5+1 条规则: hermes-* 集中 / 入口分叉 / 类型先定 / capability 透传 / IO 层抽象
- 明天前端: SchedulePage 适配 LinggClawCronJob + 新建工作空间页 + 联调
- 没做: cron upload (B 档第二阶段) / files upload + delete (B 档第二阶段)

### 2026-04-20 下午（Hermes cron 底层完成 + CODING_GUIDELINES.md）
- [x] **CODING_GUIDELINES.md** 落地 5 条多 runtime 防代码乱规则（runtime-specific 集中、统一前缀、类型先定、入口分叉、capability 透传）
- [x] **http_api.py 加 7 个 cron endpoints** (list/add/update/remove/pause/resume/trigger)，鉴权+404 兜底验证 OK
- [x] **systemd hermes-cron@.timer + service** 沿用 P0.1+P0.2 hardening + cgroup 限额；每 60s tick scheduler；file lock 防重叠
- [x] **provision-hermes-claw.sh** 加 enable hermes-cron@<profile>.timer（未来发新虾自动启 cron）
- [x] **e2e 验证**：HTTP create job → systemd timer 触发 service → tick 识别 due job → 调 LLM → output markdown 生成（之前手动验证 c2c76655a53f）
- 发现产品层问题：cron job LLM 调用偶发慢（华为 MaaS 抖动 / 复杂 prompt）→ 未来加单 job timeout
- 今天**没改**：灵虾 router 分叉、SchedulePage 前端、OpenClaw provider refactor → 留明天 Phase 1
- 明天计划：写 hermes-cron.ts (server) + claw-cron.ts router 分叉 + SchedulePage 兼容显示 + 看 OpenClaw 路径是否一并 refactor

### 2026-04-20 下午（cgroup 限额 + LLM 配额方案沉淀）
- [x] **cgroup 限额上线**：两 service 加 `MemoryMax=512M MemoryHigh=384M CPUQuota=200% TasksMax=512`
- [x] 实测 hermes-http 内存峰值 78-125MB → 5x 余量上限防 OOM 整机 + fork bomb
- [x] systemctl show 验证 cgroup 数值生效 + 两 service 仍 active

### 2026-04-20 中午（P0.2 Hermes profile 隔离完成）
- [x] **mount namespace 反向白名单方案落地**（30 分钟，零代码改动）
- [x] hermes-http@.service template 加：`TemporaryFileSystem=/root/.hermes/profiles` + `BindPaths=/root/.hermes/profiles/%i`
- [x] hermes-http.service (default 8643 fallback) 加：`TemporaryFileSystem=/root/.hermes/profiles` (无 BindPaths，不需要看任何 profile)
- [x] **systemd-run 实测**先确认 mount 应用顺序: BindPaths(/root/.hermes) → TemporaryFileSystem(profiles) → BindPaths(profiles/%i) 三层叠加 work as expected
- [x] **e2e 验证**: 创 `_test_victim` 假 profile, nsenter 进真实 hermes-http 进程 → 两个 instance 都 `No such file or directory`
- [x] **攻击者反向防御验证**: namespace 内 mkdir EVIL_CREATED 看似成功 (tmpfs 是临时的) but host 不污染
- [x] 备份: `hermes-http*.service.bak-20260420-pre-profile-isolation`
- 此方案没解决 hermes-http 进程本身被 prompt injection 拐弯（仍 root 跑、仍 host 进程），但堵了读其他 profile 文件这条最直接的攻击链
- 终极方案 (P0.3): hermes-http 整个进程跑容器内 (1-2 周, 抄 OpenClaw)

### 2026-04-20 上午（多 runtime 改造 P1+P2+P3 完成）
- [x] **P1 AgentPage 内部清理**：
  - 删 tools/skills 两 tab（功能与 ClawAdmin/SkillsPage 重复）
  - PANELS 类型 AgentPanel 缩窄到 "overview" | "files"
  - ToolsPanel.tsx + SkillsPanel.tsx 归档为 .removed-20260420
  - Home.tsx 删 memory 死代码（lingxiaMemoryContent/lingxiaMemoryEditing/getMemory/updateMemory 全部声明但 UI 无引用）
- [x] **P2 AgentPage memory 加 lgh- 分叉**：
  - 新建 server/_core/hermes-memory.ts（参考 hermes-skills.ts 模式）
  - HERMES_CORE_FILES 白名单：SOUL.md (profile/SOUL.md) + USER.md (profile/memories/USER.md)
  - claw-core-files.ts: 加 lgh- 分叉到 list/read，save 走 memory/write
  - claw-memory.ts: read/write 加 lgh- 分叉，复用 budget+rate-limit+audit 机制
  - alias "MEMORY.md" → USER.md 让前端无需感知 prefix
  - 验证：4 路由 lgh-/lgc- 都返回 401（auth-required not 404）= route 注册成功
- [x] **P3 sidebar 重命名 + DreamsPage 完全删**：
  - Sidebar items "代理" → "记忆"，icon Bot → Brain
  - PageKey 类型移除 "dreams" 项（保留 "agent" 不动避免 localStorage 破坏）
  - AgentPage PageContainer title 同步改 "记忆"
  - DreamsPage.tsx 归档 + MainPanel.tsx route 删除 + Moon icon 删除
- 备份：所有修改文件均有 .bak-20260420-* 兜底
- 用户 IA 重构方向：从AI 本位sidebar（代理/技能/梦境）转向用户场景本位（聊天/记忆/技能/协作/...）

### 2026-04-20 上午（P0.3a Hermes docker terminal backend 完成）
- [x] **重大发现**：Hermes 自带 docker terminal backend (tools/environments/docker.py)，工业级安全配置 (cap-drop ALL + no-new-privileges + pids-limit=256 + tmpfs nosuid + 可配 network=none/cpu/memory cgroup)；不需要 fork 也不需要包 wrapper
- [x] **lihongkun profile 试点**：config.yaml 加 terminal: backend=docker / image=openclaw-sandbox:bookworm-slim / network=false / memory=256MB / cpu=1.0 / docker_mount_cwd_to_workspace=false
- [x] **e2e 验证三项**：① container hostname 是 docker id 不是 host；② wget 1.1.1.1 → NETWORK_BLOCKED；③ cat /root/linggan-platform/.env → No such file
- [x] **共存验证**：hermes-* 容器与 openclaw-sbx-* 同时跑互不干扰
- [x] **资源观察**：3 个 session 起 3 个容器 ×256MB = 768MB；lifetime_seconds=300 idle timeout 内保活
- 复用 OpenClaw 现成 openclaw-sandbox:bookworm-slim 镜像零改动；TODO 原 P0.3 工作量从 2-3 周降到 1 小时
- **剩余风险**：仅隔离 terminal_exec，不隔离 hermes-http 进程本身被 prompt injection 攻击（仍要 P0.2 独立 HERMES_HOME + P0.1 mount ns 兜底）

### 2026-04-20 早（P0.1 Hermes systemd hardening 完成）
- [x] **mount namespace 防护上线**：两 service (hermes-http + hermes-http@lihongkun) 加 ProtectSystem=strict + TemporaryFileSystem=/root + BindReadOnlyPaths=/root/hermes-agent + BindPaths=/root/.hermes + InaccessiblePaths=/etc/shadow,gshadow,sudoers*,/etc/ssh,/home,/var/log/auth.log,syslog + NoNewPrivileges + PrivateTmp
- [x] **不建 hermes 用户**：/etc/shadow 有 immutable 防护（来源未知，未追溯到设置者，先不动）；防御靠 mount namespace 而非 user 隔离
- [x] **踩坑记录**：systemd 255 上 ProtectHome=true 与 BindReadOnlyPaths 互斥（203/EXEC），改用 TemporaryFileSystem=/root 替代
- [x] **e2e 验证**：nsenter 进 hermes 进程 mount ns 测得 /root/linggan-platform/.env、/etc/shadow 均不可读；service active + health 200
- [x] 备份  可秒级回滚
- [x] 当前防御覆盖：80% 主流威胁（读 .env / .ssh / shadow，改系统目录）；剩余 20%（profile 互看 / 网络出站 / 资源耗尽）走 P0.2/P0.3

### 2026-04-19 晚（Hermes 集成修坑 + 技能可见性）
- [x] **Hermes SkillsPage 可见性**：新 `server/_core/hermes-skills.ts` 读 profile skills/，listSkills router 加 prefix 分叉。lgh- 虾 SkillsPage 显示 67 个 bundled（🌱 auto-generated 等 Hermes 跑一段时间会出现）
- [x] **nginx publish 脚本防 .bak 异物**（灵感 116 侧）：`publishDemoRoutingNow` 发布时扫 sites-enabled/ 把非主配置挪到 /root/nginx-backups/
- [x] **坑 1 修复：Hermes 对话记忆跨请求累积**：bridge 用 `main-${adoptId}-${marker}` 固定 session_id；http_api.py 加 `get_messages_as_conversation` 加载历史到 conversation_history（没这步 LLM 看不到前文）
- [x] **坑 2 修复：前端 abort 断 Hermes upstream**：bridge 监听 `req.on('close') → proxyReq.destroy()`
- [x] **坑 3 修复：`/new /reset` 切新 session**：bridge 识别命令短路返回 + newSessionMarkers 切 session id 基线
- [x] **坑 4 修复：marketInstall 对 lgh- 拒绝**：前置 throw BAD_REQUEST 避免脏目录
- [x] **坑 10 修复：左下角版本号 runtime-aware**：lgh- 虾显示 "Hermes v0.10.0"，lgc- 显示 "v2026.3.27"
- [x] **梦境记忆 Sidebar 条目隐藏**：DreamsPage 组件 + 路由保留（TODO icebox 待彻底删）

### 2026-04-19 下午（Hermes 集成）
- [x] **Hermes HTTP API wrapper**：`/root/hermes-agent/http_api.py`（220 行 FastAPI，SSE streaming via `stream_delta_callback`）
- [x] **systemd 部署**：`hermes-http.service`（default, 8643）+ `hermes-http@.service` template（per-profile, 8644+）
- [x] **`HERMES_HTTP_KEY` 鉴权**：随机 token，写 `/root/.hermes/.env` + `/root/linggan-platform/.env`
- [x] **DB additive**：`claw_adoptions.hermes_port INT NULL`
- [x] **server-side prefix 路由**：`claw-chat.ts` 入口 `if (adoptId.startsWith("lgh-")) forwardToHermes`；lgc-* 代码路径 byte-identical
- [x] **`hermes-bridge.ts`**：协议翻译 + 前端模型字符串→Hermes provider 映射 + keepalive + doneEmitted 去重
- [x] **`claw.me` 双发兼容**：返回 `{ adoption, adoptions[], runtime }`，老前端照常工作
- [x] **`adminProvisionHermesClaw` tRPC mutation**：execFileSync 调脚本
- [x] **`scripts/provision-hermes-claw.sh`**：一键发放（profile 创建 + 端口分配 + systemd + DB INSERT）
- [x] **前端 ClawHome 多卡**：🦐 OpenClaw / ⚡ Hermes 徽章 + 不同按钮色
- [x] **前端 Home.tsx lgh- 跳过 WS**：lgh-* 直接走 HTTP SSE，避免 OpenClaw gateway reject
- [x] **ClawAdmin "发 Hermes 虾" 按钮**：prompt 弹窗 + 跑 tRPC
- [x] **多 provider 配齐**：华为 MaaS（glm-5 / 5.1 / DeepSeek-V3 / R1 / Kimi-K2 / qwen3-*）共 12 模型
- [x] **默认 GLM-5.1**：OpenClaw 和 Hermes 一致（公家 key，额度足）
- [x] **MiniMax 下线**：openclaw.json `models.providers.minimax-portal` 删除 + server ALLOWED_MODELS 白名单清理
- [x] **梦境记忆主菜单入口隐藏**：Sidebar 条目删（文件保留）
- [x] **Hermes lgh-lihongkun (8644) 已 provision**：userId=2 第一张灰度 Hermes 虾

### 2026-04-19 上午（Coop V2 系列）
- [x] **CoopNew 嵌入 CollabPage**（list↔create 同页切换，独立路由 `/coop/new` 保留给微信/分享）
- [x] **场景模板机制**：4 个内置模板（空白/周报/复盘/头脑风暴）+ 7 变量替换 + 切模板 confirm + `consolidation_prompt_preset` DB 字段（additive migration）
- [x] **Coop 4 文件主题收口**：蓝色当品牌色 → `bg-primary`（华为红）；状态色 hex → `.badge-*` class；新 lib/coopStatus.ts 单一 source
- [x] **Mock 用户 soft disable**：3 个 `@lingxia.local` 测试用户 groupId → 0
- [x] **领养池硬删清理**：6 条 recycled adoption + 13 条 events；备份 `backups/adoption-cleanup-20260419.sql`
- [x] **权限档位 UI rebrand**：Starter/Plus/Internal → **Trial/Pro/Debug**（DB value 不动）
- [x] CollabPage 旧 5 tab 清理（biz/settings/directory/incoming/outgoing 分支删除，885 → 274 行）
- [x] cleanup-dreaming cron 下线 + 脚本重命名
- [x] 主聊天 SSE 字符交错 race 修复

### 2026-04-17
- [x] OpenClaw dreaming 默认关闭
- [x] security.ts XSS regex word boundary 紧急补丁

### 2026-04-16
- [x] @mention onSend reconcile 兜底

---

## Icebox（已评估，暂不做）

- **collab_requests → lx_coop_sessions 数据迁移**：MySQL 生产表改行+回填 `sessionId`，非 additive，需要 rollback 脚本 + 停机窗口。**触发条件**：等老 1:1 协作完全不用了再做。
- **coop 白名单 `COOP_WHITELIST_USER_IDS` 换 feature_flags 表**（`server/routers/coop.ts:30`）：当前 7 人，每加人改代码+重启。**触发条件**：白名单超 15 人 或 产品侧要求运营加人时再做。
- **CollabDrawer 组件下线**：仍是 CoopChatBox → task panel 的路由跳板（`?openCollabDrawer=1`）。要下线得先改这条跳板路径。
- **长期不活跃虾自动回收（5 个待观察：畅帅/杨虎从未打开、李晚龙 19d、曲凌旭 12d、Helly/曾亮/李薇/付成东 10.7d）**：用户决定不动，让其自然 TTL 过期。
- **Security middleware 正则审计**：2026-04-17 已打 word boundary 紧急补丁，剩余攻击面窄（基本只扫 UA 和极少数非 API query），不值 1 天。再发一次误伤再搞。
- **MiniMax provider 接回**：需 API key。灵虾 token plan 账号要先确认 endpoint + key；现 bridge 里前端选 MiniMax 会 fallback 到默认 provider。
- **DreamsPage 组件彻底删**：当前仅 Sidebar 条目隐藏，组件 + 类型 + MainPanel 路由保留；下次大整理时可一起删。

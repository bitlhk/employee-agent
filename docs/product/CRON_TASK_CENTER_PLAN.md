# 灵虾定时任务中心专项 — Plan v2

> **v2 changelog（2026-04-30）**：标题从 v1 升 v2；§3.4 delivery 升格段重排到 §3.2（紧跟 CronJob 类型）；SchedulePage 现状从"待考证"改为确认结论（schema 混用 + 页面内样式过多）；第三刀 UI 冻结改为"先审计后强制"分阶段（不一上来 ESLint hard fail）；其余架构判断不变。
> v1：初版（2026-04-29 末），342 行。

**目的**：把灵虾的定时任务从"分散功能点"重构成"企业平台能力"，作为工行/邮储等客户的成熟度卖点。
**作者协作**：Hongkun（产品）+ GPT（实施）+ Claude（review）
**时点**：v1 2026-04-29 末（Chat V2 全量上线后）；v2 2026-04-30
**真 P0**：本 PLAN 是工程基础，**真正的 P0 是工行 30 分钟访谈拿到具体反馈**（见第 7 章），未做访谈不要开第一刀代码。

**双重定位**：定时任务中心不仅是功能重构，也是**整个产品的成熟度样板页**——它的视觉规范（配色、状态、字段对齐、信息层级）将作为后续 P2 设置页统一专项的基线参考。这意味着第三刀 UI 不能"先简单做完明天再统一"，必须一次做对。

---

## 1. 企业用例候选（明天访谈后定 1-2 个 anchor）

| 用例 | 描述 | 工程含义 |
|---|---|---|
| **A. 金融晨报推送** | 每日 09:30 触发 `task-finance` 跑大盘要闻摘要 → 推送企业微信群 | 已有 task-finance + 触发 + 投递三段独立，要平台化串通 |
| **B. 部门周报收集** | 每周一 08:30 @员工提交周报 → AI 整理 → 09:30 @领导推送汇总 | 多轮异步任务 + @ 机制 + 二次合并；最复杂 |
| **C. 公告/舆情巡检** | 每 30 分钟扫描指定关键词，命中即推送 | 高频 + 去重 + 可配置 keyword 列表 |

**默认 anchor**：A（最简单 + 已有 task-finance + 立竿见影）。访谈后如果工行更要 B 再调。

---

## 2. 现状代码 problem 清单（按文件）

### 2.1 `server/_core/claw-cron.ts` 433 行 —— 太重，5 类职责混杂

| 职责 | 应在 | 现状 |
|---|---|---|
| HTTP 路由声明 | claw-cron.ts | ✓ |
| 权限校验（requireClawOwner） | claw-cron.ts | ✓ |
| **OpenClaw vs Hermes 分发** | provider 抽象层 | ❌ 混在 route handler 里（L82/L139/L245 等到处 `if (isHermesAdopt(adoptId))`）|
| **OpenClaw schema 翻译**（every/at/cron → interval/once/cron）| openclaw-cron-provider.ts | ❌ 散落在 list/add/update 各 handler |
| 限制校验（max jobs / cron expr / 等） | provider 或共享 helper | 部分散落 |
| Capabilities 报告 | provider | ❌ Hermes 的硬 import，OpenClaw 的硬编码默认 |

### 2.2 `server/_core/hermes-cron.ts` 251 行 —— 类型定义错位

✅ **类型设计本身好**：L21 `LinggClawCronJob`、L47 `CronProviderCapabilities`、L58 `CronJobInput`、L68 `CronProviderHandle` 已经是抽象的平台公共契约。

❌ **放在 hermes-cron.ts 里**让人以为只属于 Hermes，OpenClaw 那条路径反而不复用——事实上 claw-cron.ts 还在手翻一份类似 schema。

❌ **类型命名 `LinggClawCronJob`**（注：历史命名待统一）—— 未来 rename 的 todo，但本次不动避免散落改动。

### 2.3 `server/_core/intent-executor.ts` 224 行 —— 跟任务平台强耦合

L67 / L103 / L142 / L155 通过**内部 HTTP** 调 `/api/claw/cron/add|list|remove` 创建/查询任务：

```ts
const resp = await fetch(`${BASE}/api/claw/cron/add`, {
  headers: { "X-Internal-Key": INTERNAL_KEY },
  ...
});
```

**问题**：聊天意图触发 cron 创建走 HTTP self-call，绕了一圈又回到自己，**节点失败时不可重入**、**没事务边界**、**调试要看两份日志**。

### 2.4 `server/_core/cron-delivery.ts` 172 行 —— 侧车 JSON + CLI polling

L16-22 `loadConfigs()` 从 `data/cron-delivery-config.json` 读取，结构：
```json
{ "adoptId", "jobId?", "jobName", "channel", "lastDeliveredRunTs" }
```

**真实数据已有混乱**（线上 `cron-delivery-config.json` 4 条记录）：
- 老数据 2 条：`jobName="北京天气"` 无 `jobId` —— 跨用户重名会串
- 新数据 2 条：`jobId="..."` + `jobName=...` 有 jobId 主键

L8 `import { execSync, execFileSync }` —— delivery worker 走 `openclaw cron list/runs` CLI **没经过 `OpenClawRuntimeAdapter.callRpc()`**，是绕过今天刚收口的 adapter。

### 2.5 `client/src/components/pages/SchedulePage.tsx` —— 前端 schema 漂移 + 页面内样式过多（已确认）

后端 `/api/claw/cron/list` 已经返回新统一 `LinggClawCronJob`（schedule.kind: interval|once|cron, nextRunAt ISO, prompt），但**实测前端确实在用老 schema 渲染**：还在引用 `every/at/cron`、`nextRunAtMs`、`payload.message` 等旧字段。这是页面信息显示混乱的直接根源。

**额外问题**（同样已确认）：页面大量自定义临时组件 + inline style：
- 页面内 `BtnGhost / BtnPrimary / BtnDanger` 临时按钮（应走 `client/src/components/ui/button.tsx`）
- 页面内 `FieldRow / inputStyle / selectStyle` 局部样式（应走 console form / shadcn token）
- 多处 inline style hardcode color

第三刀 UI 重做时**必须**：
1. 字段层全部切到新 `CronJob` schema（删老字段 reference）
2. 临时按钮 / 局部样式收口到组件库（按 `UI_STABILITY_CONTRACT.md` §3 走）
3. 出 page audit（`docs/design/page-audit/schedule-page.md`）作为成熟度样板

---

## 3. 目标契约 schema 草案（基于现有 LinggClawCronJob 演进）

### 3.1 `CronJob`（move 自 hermes-cron.ts → server/_core/cron/types.ts）

```ts
export type CronJob = {
  id: string;
  runtime: "openclaw" | "hermes" | "jiuwenclaw" | "hi-agent";
  adoptId: string;
  userId: number;
  name: string;                          // 用户可读名（"金融晨报"）
  enabled: boolean;
  prompt?: string;                        // 触发 prompt（jiuwenclaw 可能不用）
  description?: string;
  schedule: CronSchedule;
  state: CronState;
  delivery: CronDeliveryConfig;          // ← 升格为平台一等契约（见 §3.4 实现说明）
  meta?: Record<string, any>;            // runtime-specific 容器

  // ── 审计字段（银行客户必须）──
  createdBy: number;                      // userId of creator
  createdAt: string;
  updatedBy?: number;                     // userId of last updater
  updatedAt: string;
};

export type CronSchedule =
  | { kind: "interval"; intervalMinutes: number; display: string }
  | { kind: "cron"; cronExpr: string; display: string }
  | { kind: "once"; runAt: string; display: string };

export type CronState = {
  status: "scheduled" | "running" | "completed" | "paused" | "failed";
  nextRunAt?: string;                    // ISO，永不再用 nextRunAtMs
  lastRunAt?: string;
  lastStatus?: "ok" | "error" | "skipped";
  lastDurationMs?: number;
  totalRuns?: number;
  successRuns?: number;
};

export type CronDeliveryConfig = {
  channel: "weixin" | "ilink" | "webhook" | "none";
  target?: string;                        // 群 ID / webhook URL / 用户 ID
  format?: "text" | "markdown" | "card";
  failurePolicy?: "silent" | "notify_owner" | "retry_3x";
};

export type CronRun = {
  id: string;
  jobId: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  status: "running" | "ok" | "error" | "skipped";
  errorMessage?: string;
  output?: string;                        // 模型输出摘要

  // ── 审计字段（银行客户必须）──
  triggeredBy: "schedule" | "manual" | "api";   // schedule=cron / manual=用户点立即触发 / api=外部调用
  triggeredByUser?: number;                       // 当 triggeredBy=manual 时填用户 id
  deliveredAt?: string;
  deliveryStatus?: "ok" | "failed";
  deliveryTargetMasked?: string;                  // 投递目标脱敏显示（"weixin:bot:****abc" 不存原文）
};

export type CronProviderCapabilities = {
  // 沿用 hermes-cron.ts 里的设计，move 即可
};
```

### 3.2 关于 `delivery` 升格的实现选择（不强制物理内嵌）

**口径**：`delivery` 是**平台一等契约**——任务平台对外（API / UI / 第二方）都能拿到一个完整的 `CronJob.delivery` 字段，**不再依赖侧车 JSON 异步漂移**。

**实现层有 3 种合法路径**，第二刀实施时择一（不预先承诺）：

| 选项 | 描述 | trade-off |
|---|---|---|
| A. **DB 表独立** | 新建 `cron_delivery_configs` MySQL 表，主键 jobId，1:1 关联 | 不绑死 OpenClaw schema；可加索引；migration 路径熟（drizzle）|
| B. **OpenClaw job.meta 内嵌** | 写进 OpenClaw 原生 cron 的 `meta` 字段 | 跟 OpenClaw 绑死；OpenClaw 升级如改 meta 协议要跟着改 |
| C. **侧车 JSON 严格化** | 沿用现 `cron-delivery-config.json` 但 schema 严格 + 启动时校验 jobId 必填 | 改动最小；但仍是侧车，跨进程一致性弱 |

**Claude/GPT 推荐 A**（DB 表）。但**第二刀实施时再正式决策**，本 PLAN 不预设。

**关键 invariant**（无论选哪条）：
- `jobId` 必填，`jobName` 仅 display
- 老数据 jobName-only entries 启动时自动 backfill jobId（按 cron.list 反查），失败标 `legacy: true` warn log
- API 永远返回 `CronJob.delivery`（caller 不感知存储介质）

### 3.3 `CronProvider` 接口（新建）

```ts
export interface CronProvider {
  readonly runtime: CronJob["runtime"];
  capabilities(): CronProviderCapabilities;
  listJobs(handle: CronProviderHandle): Promise<CronJob[]>;
  addJob(handle: CronProviderHandle, input: CronJobInput): Promise<CronJob>;
  updateJob(handle: CronProviderHandle, id: string, patch: Partial<CronJobInput>): Promise<CronJob>;
  removeJob(handle: CronProviderHandle, id: string): Promise<void>;
  runJobNow(handle: CronProviderHandle, id: string): Promise<CronRun>;
  listRuns(handle: CronProviderHandle, id: string, limit: number): Promise<CronRun[]>;
}
```

实现：
- `OpenClawCronProvider`（新建，封装当前 claw-cron.ts 里的 OpenClaw schema 翻译 + `OpenClawRuntimeAdapter.callRpc` 调用）
- `HermesCronProvider`（move 自 hermes-cron.ts，去掉类型 export 部分）

### 3.4 `claw-cron.ts` 重构后体量目标

```ts
export function registerCronRoutes(app) {
  app.get("/api/claw/cron/list", async (req, res) => {
    const claw = await requireClawOwner(req, res, adoptId);
    const provider = pickProvider(claw);              // ← 一行 dispatch
    const jobs = await provider.listJobs(toHandle(claw));
    res.json({ runtime: provider.runtime, capabilities: provider.capabilities(), jobs });
  });
  // ... 其它 7-8 个路由同款 1-3 行
}
```

目标 433 行 → ~200 行（路由声明 + auth + provider dispatch，**0 schema 翻译**）。

---

## 4. 前端任务中心字段优先级（用户视角，非技术视角）

### 4.1 列表页主显（每行 5-6 字段够）

| 字段 | 来源 | 备注 |
|---|---|---|
| 任务名称 | `job.name` | 主显 |
| 计划 | `job.schedule.display` | "每日 09:30" / "工作日 18:00" |
| 状态 | `job.state.status` | scheduled/running/paused/failed 视觉化 |
| 下次执行 | `job.state.nextRunAt` | 相对时间 + tooltip 显示绝对 |
| 最近执行 | `job.state.lastRunAt` + `lastStatus` | "2 小时前 ✓" |
| 投递渠道 | `job.delivery.channel` icon | 微信图标 / webhook 图标 |

### 4.2 详情/编辑次显

- 失败原因 `state.errorMessage`
- 历史执行（最近 N 条 `CronRun`）
- 投递目标 `delivery.target`（脱敏）

### 4.3 不显（用户不应看到的技术细节）

- `jobId`（除 debug）
- `runtime` 类别（除非 mixed env，工行场景 single OpenClaw 隐藏）
- `meta` 内部容器
- `payload.message` / `every` / `at` 等老字段（已经在 schema 改名）

### 4.4 创建表单（按 capabilities 显隐）

按 `provider.capabilities()` 的 `scheduleKinds` 决定 tab：
- 间隔（每 N 分钟）
- 一次（指定时间）
- Cron（高级用户）

`promptRequired` 决定 prompt 输入框是否必填；`supportsSkills` 决定是否显示技能选择；等等。

---

## 5. 三刀分阶段计划

### 第一刀 · 后端契约抽取（1-2 天，Cron Platform Core）

**先决条件**：工行访谈完成，schema 字段名（"任务" / "巡检" / "推送" 等）按客户语言确认。

**操作**：
1. 新建 `server/_core/cron/types.ts` —— move `LinggClawCronJob` 等 5 个类型从 hermes-cron.ts
2. 新建 `server/_core/cron/CronProvider.ts` interface
3. 新建 `server/_core/cron/openclaw-cron-provider.ts`：吸收 claw-cron.ts 里所有 OpenClaw schema 翻译 + 调 `OpenClawRuntimeAdapter.callRpc`
4. 新建 `server/_core/cron/hermes-cron-provider.ts`：move hermes-cron.ts 里的实现部分（去掉类型 export）
5. claw-cron.ts 瘦身到 ~200 行：route + auth + `pickProvider(claw)` dispatch
6. 单测：每个 provider 至少 5 case（list/add/update/run/remove）

**风险**：低，纯重构，无运行时行为变化。可以走 `tsc --noEmit + 26 vitest + 5min health check` 闸门。

### 第二刀 · Cron Delivery 收口（1-2 天）

**操作**：
1. `cron-delivery.ts` 走 `OpenClawRuntimeAdapter.callRpc` 而不是 CLI `execFileSync`
2. `DeliveryConfig` 升格为 `CronDeliveryConfig` 类型，**配置存储改造**：
   - 短期：仍 JSON 但 schema 严格化（jobId 必填，jobName 仅 display）
   - **migration**：启动时扫 `cron-delivery-config.json`，老 `jobName-only` 数据自动 backfill `jobId`（按 cron.list 反查）；backfill 失败的 entry 标 `legacy: true` warn log
3. `intent-executor.ts` 内部 HTTP self-call → 直接调用 `provider.addJob()` —— 去 self-call，加事务保证
4. 单测：delivery 路径覆盖 jobId-only / jobName-only / 双写迁移三种 case

**风险**：中。涉及 cron-delivery.ts 跑生产投递。建议**断轨+诊断**模式（参考 memory `feedback_disconnect_then_demolish`）：
- 新逻辑跑 + 旧 CLI polling 同时跑 24h
- 旧逻辑加 warn log 看是否还会被调用
- 24h 无 warn → 删旧 CLI polling

### 第三刀 · 任务中心 UI 重做（2-3 天）

**操作**：
1. SchedulePage.tsx 改造为"任务中心"
2. 统一消费 `CronJob` schema（所有老字段映射删除）
3. 创建表单按 `capabilities()` 动态显隐
4. 列表/详情/创建/编辑四个面板
5. 配色按 settings 页统一基线（如果同期推 P2 设置页统一就一起做）

**风险**：中。涉及前端构建发布。建议带 feature flag：
- 新页面 `/schedule-v2`，先并存
- 老页面 `/schedule` 加"试用新版"链接
- 1-2 周后切换默认

#### 第三刀 ★ 必须做：UI 冻结机制（page audit）

定时任务中心是**整个产品的成熟度样板页**（见文档头部双重定位）。第三刀完成后 **必须立刻冻结视觉规范**，否则未来散落改动会让它再次变成"乱页"——前 8 小时改完、后 8 周烂掉是常见反例。

**分两阶段落地**（关键：第一阶段不上 ESLint hard fail，避免拖慢页面交付）：

**第一阶段（跟随第三刀同期上线）**：
1. `docs/design/page-audit/schedule-page.md`：
   - 页面截图基线（列表 / 详情 / 创建 / 失败状态 4 张）
   - 配色 token 清单（哪些用 design token / 哪些不允许 hardcode）
   - 状态色规范（scheduled / running / paused / failed 的 hex / icon / text）
   - 信息层级规则（主显字段 vs 次显 vs 不显）
   - **允许例外表**：本页冻结时无法避免的 hardcode 列出 + 后续计划
2. PR 模板加一行："本 PR 是否影响定时任务中心 UI？是 → 同步更新 audit 截图基线"
3. `scripts/audit-ui-hardcodes.ts` 跑 schedule-page 一次，记录基线数（hex / rgba / inline-risk count）
4. **新增 hardcode 在 review 时人工拒**（不靠 lint 自动拦）

**第二阶段（首次 audit 数据成熟后，约 2-4 周）**：
1. ESLint / Stylelint 规则：禁止该页面新增 hardcode hex 颜色 / 禁止危险 inline style
2. CI hard fail（merge gate）

**为什么分两阶段**：
- 灵虾现在大量页面靠 inline style，**一上来 hard fail 会拖慢定时任务页面交付**
- 第一阶段先用"审计 + review 人工 + 例外登记"形成节奏，等基线数据稳定再上自动化
- 跟 `UI_STABILITY_CONTRACT.md` §11 "下一步"的渐进策略一致

**目的**：让 UI 成熟度成为**有 SOP 的事**，不是单次推过去就漂的事。同 baseline 反过来用于 P2 设置页统一专项的目标态参考。

### 工时合计

```
第一刀（最稳，最值）  1-2 天
第二刀                1-2 天
第三刀                2-3 天
合计                  4-7 天
```

---

## 6. 推荐的非阻塞优化（中期）

- `CronJob.failurePolicy` 增加 `notify_owner_via_email` 选项
- `CronRun` 历史轮转策略（保留最近 100 条）
- Cron 任务模板库（预置"金融晨报"/"周报收集"等模板）
- 多步任务（运行 A 成功后触发 B，DAG 短链）

---

## 7. 工行访谈问题清单（30 分钟用，**真 P0**）

按重要性排序，时间不够时舍后面：

### 必问（10 分钟）
1. 你们内部"定时任务"的真用例是什么？请举 3 个具体场景（频率/触发/输出形态）
2. 现在用 jiuwenclaw 的定时功能吗？体验如何？哪些好哪些不好？
3. **"灵虾不如 jiuwenclaw 成熟"具体指哪些方面？能列 3-5 条吗？**（这条不限于定时任务）

### 高价值问（10 分钟）
4. 任务失败时希望怎么知道？（邮件 / 微信 / 短信 / 不在意）
5. 任务执行历史希望保留多久？（合规/审计要求）
6. 任务页面您希望主要看到哪 3-5 个字段？

### 探索性问（10 分钟）
7. 你们对"定时巡检 + 关键词触发"这种 pattern 有需求吗？（公告 / 舆情 / 风控）
8. 部门周报收集这种"多步异步任务"对你们价值大吗？
9. 任务私有化部署场景下，谁来配置 / 维护？技术运营还是业务用户自助？
10. 跟现有 OA / 工作流系统对接是否必要？（如蓝信 / 企业微信审批流）

### 不要问（避免 BD 风险）
- 不要问"你们多久能买"——还在 verify 阶段
- 不要问"预算"——超出 BD scope
- 不要承诺时间表——本 PLAN 工时仅内部参考

---

## 8. 待考证 / 风险 / Open questions

| 项 | 状态 | 备注 |
|---|---|---|
| `CronJob` 类型命名（LinggClaw vs Lingxia vs 通用 Cron）| open | 第一刀先 keep + 注释，避免散落改名 |
| jobId 老数据 backfill 策略 | open | 第二刀实施时确定 |
| OpenClaw 原生 cron 是否支持 `failurePolicy` | 待查 | 影响 capabilities 报告 |
| jiuwenclaw 兼容到什么粒度 | open | memory 说 jiuwenclaw 2/10 能力，可能不在 P1 实现范围 |
| 前端"任务中心"是否绑定 settings 主题 | open | 跟 P2 设置页统一专项决策同步 |
| 跨用户 jobName 撞名严重度 | 已知 | cron-delivery-config.json 老数据 4 条里 2 条无 jobId，**有真实风险** |

---

## 9. 启动条件（不要跳过）

| 条件 | 状态 |
|---|---|
| Chat V2 全量 24h 跑稳（abnormal=0 + unmatched=0） | 待 |
| 工行访谈完成，"成熟感"具体反馈拿到 | 待 |
| 本 PLAN review 通过（GPT + Claude 二次 review） | 待 |
| 决定 anchor 用例（A/B/C 选哪个） | 待 |

**4 项满足后**才开第一刀。否则可能改了又得改。

---

## 10. 引用文件

| 文件 | 行数 | 作用 |
|---|---|---|
| `server/_core/claw-cron.ts` | 433 | HTTP 路由 + 杂揉的 dispatch（待瘦身）|
| `server/_core/hermes-cron.ts` | 251 | 类型定义（错位）+ Hermes provider 实现 |
| `server/_core/intent-executor.ts` | 224 | 聊天意图调 cron（待解耦）|
| `server/_core/cron-delivery.ts` | 172 | 投递 worker（待收口到 adapter）|
| `client/src/components/pages/SchedulePage.tsx` | 待读 | UI 重做对象 |
| `data/cron-delivery-config.json` | 4 行 | 侧车配置，需 schema 严格化 |
| `server/_core/runtime/openclaw-runtime-adapter.ts` | 已有 | 第二刀复用此 adapter callRpc |
| `docs/runtime/OPENCLAW_RUNTIME_BASELINE.md` 第 3.4 章 | - | OpenClaw cron RPC 契约 |

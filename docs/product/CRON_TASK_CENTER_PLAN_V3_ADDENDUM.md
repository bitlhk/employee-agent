# 灵虾定时任务中心专项 — v3 补充决策

> 日期：2026-04-30  
> 目的：基于 jiuwenclaw 代码校准后的产品/工程决策，补充到 `CRON_TASK_CENTER_PLAN.md`。  
> 结论：先不急开 cron 第一刀代码，先把 schedule、channel、delivery、多租户边界锁定。

## 1. 频道作为灵虾一级能力

频道不应该只是“定时任务表单里的一个配置项”。频道承载的是用户身份、扫码绑定、企业微信/飞书凭据、可投递目标和审计边界，这些都属于灵虾平台层。

建议新增一级菜单：

- `频道`
- 频道页布局参考“记忆”：左侧频道列表，右侧绑定/测试/状态详情。
- 首批频道：`微信`、`飞书`、`企业微信`。
- 已有个人微信扫码绑定能力应先迁入频道页，作为第一张可用频道卡。
- 后续再补：`钉钉`。

原因：

- 灵虾最终服务的是具体个人；无论企业部署还是个人试用，触达对象都是一个可绑定的用户。
- 个人微信已经在灵虾跑通，迁入频道页能最快形成完整闭环。
- 企业微信/飞书是企业客户主路径，但接入和凭证管理更复杂，可以在频道页框架稳定后补齐。
- 复杂的 corpId / secret / webhook 配置不要直接暴露给普通用户。
- 定时任务只引用 `channelId`，不直接管理每个通道的凭据。
- 多用户隔离、绑定状态、解绑、测试发送、审计都由灵虾维护。

ADR：频道可以作为一级菜单，因为它涉及第三方凭证、绑定状态、审计、token 轮换和投递能力，不是普通偏好设置。主侧栏一级菜单上限为 5 项；新增第 6 项必须写 ADR 说明为什么不能合并到现有模块。

频道页 UI：

| 区域 | 内容 |
|---|---|
| 左侧列表 | 微信、飞书、企业微信，后续新增频道直接追加 |
| 右侧详情 | 当前频道绑定状态、二维码/表单、测试发送、解绑 |
| 空态 | 未绑定时给出绑定入口，不展示复杂底层字段 |
| 已绑定态 | 显示脱敏身份、最后测试时间、测试发送按钮 |

## 2. 定时任务页的用户模型

定时任务页不要做成复杂配置台，应该像 jiuwenclaw 那样清爽，一行一个任务。

每行只回答三个问题：

| 问题 | UI 字段 |
|---|---|
| 什么频率 | `schedule.display` |
| 干什么事 | `name` + `prompt/description` 摘要 |
| 推到哪 | `delivery.channelLabel` + `delivery.targetLabel` |

每行动作保留四个：

- 启停
- 立即运行
- 预览未来 5 次
- 删除

编辑方式：

- MVP 可用抽屉或弹窗。
- 后续再考虑 inline edit，不作为第一版阻塞项。

## 3. Schedule 契约：产品三模式，后端适配

jiuwenclaw 后端实际仍以 `cron_expr` 为核心，并非原生 discriminated union。灵虾的产品层仍应提供三模式，但 runtime provider 负责映射。

```ts
export type CronSchedule =
  | { kind: "once"; runAt: string; display: string }
  | { kind: "interval"; intervalMinutes: number; display: string }
  | { kind: "cron"; cronExpr: string; display: string };
```

映射表：

| kind | OpenClaw provider | Hermes provider |
|---|---|---|
| `once` | 优先映射 OpenClaw `schedule.kind="at"`；如 runtime 不支持，则转一次性 cron + `delete_after_run` | 传 Hermes once/runAt；如 Hermes 只收字符串，则 provider 转 `runAt` 字符串 |
| `interval` | 优先映射 OpenClaw `schedule.kind="every"` + `everyMs` | provider 转 Hermes 支持的 interval/every 字符串 |
| `cron` | 传 OpenClaw `schedule.kind="cron"` + `expr` | 传 Hermes cron expr |

规则：

- 前端永远只消费 `once | interval | cron`。
- provider 单测必须锁住这 6 个映射。
- 不允许 SchedulePage 直接判断 OpenClaw 的 `every/at/cron` 原始字段。

## 4. wakeOffsetSeconds 做 capability

`wakeOffsetSeconds` 对银行准点任务有价值：任务可在推送时间前预热 runtime，避免 14:00 的任务 14:00:08 才开始。

```ts
export type CronProviderCapabilities = {
  supportsWakeOffset: boolean;
};
```

初始策略：

- OpenClaw：`supportsWakeOffset = true`，如果 runtime schema 支持则透传。
- Hermes：`supportsWakeOffset = false`，MVP 不模拟。
- UI：不支持时不渲染该字段，不做灰色禁用态。

## 5. ChannelProvider 契约

频道提供商独立于 CronProvider。CronProvider 负责“何时跑任务”，ChannelProvider 负责“怎么投递结果”。

```ts
export interface ChannelProvider {
  id: "wechat" | "feishu" | "wecom" | "dingtalk" | string;
  displayName: string;
  bindMode: "scan" | "webhook" | "admin_config";
  test(ctx: ChannelSendContext): Promise<{ ok: boolean; error?: string }>;
  send(ctx: ChannelSendContext, payload: ChannelPayload): Promise<{ ok: boolean; error?: string }>;
}
```

MVP 顺序：

1. 微信：复用现有个人微信扫码绑定，最快形成频道页闭环。
2. 飞书：轻量 webhook 或扫码绑定，做第二个样板。
3. 企业微信：官方 API，银行客户主路径，但凭证/管理员配置更复杂。
4. 钉钉：等前三者稳定后再补。

注意：

- Zod schema 驱动表单可以作为 v1.5，不强塞 MVP。
- 普通用户不要看到复杂 secret 字段；复杂配置应走管理员或后端托管。

## 6. Delivery 契约：MVP 单频道

MVP 锁定单投递目标，不做多目标数组。

```ts
export type CronDeliveryConfig = {
  channelId: string;
  channelLabel: string;
  targetId?: string;
  targetLabel?: string;
  format?: "text" | "markdown" | "card";
};
```

保留未来扩展：

```ts
// v2 再考虑
targets?: CronDeliveryConfig[];
```

原因：

- 多目标会引入 partial failure、per-target retry、per-target audit。
- 银行日常任务 95% 是单群/单人/单频道。
- 先把单目标链路做稳定，才有成熟感。

## 7. Preview 必须后端计算

不要在前端引入 cron parser。

接口：

```http
POST /api/claw/cron/preview-runs
{
  "adoptId": "lgc-xxx",
  "schedule": { "kind": "cron", "cronExpr": "0 9 * * *" },
  "timezone": "Asia/Shanghai",
  "count": 5
}
```

返回：

```json
{
  "runs": [
    { "runAt": "2026-05-01T09:00:00+08:00", "wakeAt": "2026-05-01T08:55:00+08:00" }
  ]
}
```

原因：

- 用户看到的“未来 5 次执行”必须和后端实际调度一致。
- wake offset 也必须由后端统一计算。

## 8. 推进顺序

Sprint 0（半周，契约先行，不写业务实现）：

1. `ChannelProvider` 接口 + channel id 类型。
2. `CronProvider` 接口。
3. `CronDeliveryConfig`，MVP 单 channel。
4. `CronSchedule` discriminated union：`once | interval | cron`。
5. `preview-runs` API contract。
6. `wakeOffsetSeconds` capability shape。

Sprint 1+2（并行）：

- A 路：实现 ChannelProvider 微信 + 飞书 + 企业微信 + 频道页 UI。
- B 路：实现 CronProvider OpenClaw/Hermes + types 落地 + adapter。

Sprint 3：

- SchedulePage 一行一任务重做。
- 频道页与定时任务联动：定时任务只选择已绑定频道。

SchedulePage 密度锁定：

- 行高 56px。
- 1080p 视口可见约 14 行。
- 任务名 + 副信息两行：`飞书 张三 · 每天 09:00`。
- 右侧四个 inline icon action：立即运行、预览、启停、删除。
- 不使用省略号菜单承载核心动作。

聊天创建定时任务的校验：

1. Prompt 必须注入当前用户已绑定频道列表。
2. 模型输出的 `channelId` 必须在 `user.boundChannels` 内。
3. 后端再次校验 `channelId ∈ user.boundChannels`。
4. 不合法则返回 400，并提示“请先在频道页绑定对应频道”。
5. 禁止静默 fallback 到默认频道。

## 9. 本轮不做

- 不复制 jiuwenclaw 的深色/蓝色视觉语言。
- 不照搬 JSON 文件持久化。
- 不做 8 个 channel。
- 不把个人微信排除在频道页之外；它是当前已跑通的个人触达能力。
- 不让普通用户填写复杂企业应用凭据。
- 不把通知/微信塞回 SettingsPage。

## 10. 渠道绑定 ADR：微信保活与飞书绑定方式

### 10.1 个人微信：保留，但必须显式处理重新激活

灵虾当前个人微信基于 ilink bot。推送依赖 `context_token`，该 token 来自用户主动给 bot 发消息后的 `getupdates` 返回值。用户长时间不互动后，微信侧可能让该上下文失效，表现为“约 48 小时后主动推送失败”。这不是稳定官方 SLA，而是非官方 ilink 机制带来的会话窗口风险。

Sprint 1 A 路微信 provider 要做两件事：

- 主动保活：对已绑定账号做低频 silent `getupdates`，建议 6 小时级别，不要高频轮询，避免触发反作弊风险。
- 显式失效：发送失败若判断为 context/token 失效，provider 返回 `auth_failed`，并将绑定状态标记为 `needsReactivation=true`。频道页显示“请在微信给 bot 发一条消息或重新扫码激活”，不要静默失败。

`ChannelBindHandle` 已预留 `needsReactivation` 和 `lastReactivatedAt` 字段，供微信这类 scan channel 使用。飞书/企业微信通常不需要该字段。

### 10.2 飞书：MVP 选择 webhook，不抄 OpenClaw OAuth Device Flow

OpenClaw 飞书扩展使用 OAuth Device Authorization Flow：用户扫码授权，服务端获得应用凭证/令牌，适合双向能力（群里 @ 灵虾触发任务、读群消息、写群消息等）。

灵虾 MVP 的定时任务投递是单向通知，不需要飞书双向 OAuth 能力。因此飞书 MVP 采用“自定义机器人 webhook URL + 可选 signSecret”方式：

- 实施成本低：0.5 天级别可形成可用投递链路。
- 安全面更小：不存长期 refresh token，仅保存 webhook URL/signSecret。
- 用户预期明确：频道页写清“飞书自定义机器人 webhook”，提供创建指引。

如果 v1.5 以后出现群内双向交互需求，再新增 `feishu_oauth` 或升级 FeishuChannelProvider 为 OAuth Device Flow。不要在 MVP 为了“看起来也是扫码”提前承担 OAuth 状态机、token 刷新和 revoke 维护成本。

### 10.3 2026-04-30 修订：飞书产品主路径改为扫码绑定

基于产品判断，飞书 webhook 虽然工程实现轻，但对普通用户配置成本过高。频道页的成熟感应优先保证“用户能理解并完成绑定”，而不是只追求最短实现路径。

因此 Sprint 1 以后飞书主路径调整为扫码/授权绑定：

- `FeishuChannelProvider.bindMode = "scan"`。
- 频道页不默认展示 webhook URL 表单。
- 如短期无法完整复用 OpenClaw OAuth Device Flow，可先做“飞书扫码绑定即将上线”的占位，但不要把 webhook 作为主入口。
- webhook 可保留为高级/管理员后门，但不进入普通用户 MVP 流程。

这个修订覆盖 10.2 的 MVP webhook 判断。最终产品目标是：微信扫码、飞书扫码、企业微信管理员配置。

飞书扫码实现优先复用 OpenClaw 的 app-registration device flow 模式：`beginAppRegistration` 返回 `deviceCode / qrUrl / userCode / interval / expireIn`，`pollAppRegistration` 成功后返回 `appId / appSecret / openId / domain`。这些 provider-specific 凭证写入 `ChannelBindHandle.metadata`，`domain` 写入 `ChannelBindHandle.domain`。如果环境探测发现当前飞书账号不支持 app-registration，则频道页显示“当前环境暂不支持扫码绑定”，不要回退到普通用户 webhook 表单。

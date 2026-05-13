# 灵虾代码规范 — 多 Runtime 防债务约束

**核心目标**：未来 4+ runtime（OpenClaw / Hermes / hi-agent / jiuwenclaw）共存时，能干净 refactor 出 ARPI（Agent Runtime Provider Interface）；现在不超前抽象，但代码姿势不挖坑。

**触发抽 ARPI 的标准**：第 3 个 runtime 接入前。在那之前用以下 5 条规则约束。

---

## 5 条规则

### 1. runtime-specific 假设集中在固定文件
- ❌ 反例：在 router 内 inline 写 `if (lgh-) { /* 翻译 hermes schema 50 行 */ }`
- ✅ 正例：单独 `hermes-cron.ts` 文件包翻译逻辑，router 只调 `hermesCron.list(adoptId)`

**为何**：未来 refactor 时是搬文件不是改业务

### 2. 统一文件命名前缀
- 全部 `hermes-*.ts` / `openclaw-*.ts` / `hi-agent-*.ts`
- 不要混用 `hermes_xxx.ts` / `xxxHermes.ts` / `xxx-hm.ts` 等风格

**已存在文件清单**（保持这个模式）：
- `server/_core/hermes-bridge.ts`
- `server/_core/hermes-skills.ts`
- `server/_core/hermes-memory.ts`
- `server/_core/hermes-cron.ts` (规划中)

### 3. 类型先定，实现可只有一个
- ❌ 反例：只为 hermes 写一个函数返回 `any`
- ✅ 正例：定 `LinggClawCronJob` 类型，hermes 实现先用，未来 OpenClaw 对齐

**为何**：类型是抽象的种子，先种下未来才能长出 ARPI

### 4. router 入口分叉，不要内部分叉
- ❌ 反例：router 中间 5 处 `if (adoptId.startsWith("lgh-"))` 分叉
- ✅ 正例：入口一行 `const impl = isHermes ? hermesCron : openclawCron;`，之后全走 `impl.xxx()`

**为何**：分叉点扩散后 refactor 时要 grep 全代码改 N 处；集中后只改 1 处

### 6. ARPI 只抽 IO 层，不抽 cognitive 层
- ✅ 抽：chat stream / memory CRUD / skill list-install / cron CRUD / session list
- ❌ 不抽：memory retrieval 算法、skill evolution、agent thinking pattern
- 反面教材: LangChain BaseMemory（强行统一各家 memory 模型 → leaky）
- 正面教材: MCP（只抽 tools/resources/prompts IO 层）
- 4 runtime memory 实测：OpenClaw 单文件 / Hermes char limit / jiuwenclaw RAG / hi-agent L0/L1/L2 — 强行统一必崩

### 5. runtime-specific 字段透传，前端按 capability 条件展示
- ❌ 反例：前端写死 hermes-only 字段位置 / 假设所有 runtime 都有
- ✅ 正例：字段透传 + 前端 `{job.skills && <SkillTags ../>}` 条件展示
- API 响应里加 `{ runtime: "openclaw" | "hermes", capabilities: ["chat", "memory", ...] }` 让前端按需渲染

---

## 工业界对照

| 项目 | 教训 |
|------|------|
| **K8s CRI** | 早期 docker 调用散在 kubelet 各处 → 后来抽 CRI 是 painful refactor。**反过来想**：如果一开始就把 docker-specific 集中在 `dockershim.go`，refactor 是搬文件不是改业务 |
| **Vercel AI SDK v1 → v2** | v1 已经按 provider 文件隔开 → v2 抽 LanguageModelV1 接口干净落地 |
| **LangChain BaseLLM** | 太早抽象 + 各 provider 行为差异大 → leaky abstraction，被骂多年。**反面教材** |
| **MCP** | tools / resources / prompts 三类 plugin，runtime-agnostic 协议 |

---

## 抽 ARPI 时要做的事（提前画好图）

当 hi-agent / jiuwenclaw 接入触发抽象时：

1. 把 `_core/hermes-*.ts` 搬进 `runtime-providers/hermes/*.ts`
2. 把 `_core/openclaw-*.ts` (refactor 出来的) 搬进 `runtime-providers/openclaw/*.ts`
3. 把分散在各 router 入口的 `isHermes ? hermesX : openclawX` 替换成 `getProvider(adoptId).x`
4. 类型从 module-local 提到 `runtime-providers/base.ts`

**因为一直按 5 条规则写代码 → refactor = 纯文件搬运 + import 改路径 + 不动业务**

---

## 已经按这套规则做了的（截至 2026-04-20）

- ✅ `hermes-bridge.ts` (chat) — Hermes-specific 集中
- ✅ `hermes-skills.ts` (skills) — 同上
- ✅ `hermes-memory.ts` (memory) — 今天 P2 加的
- ✅ `claw-chat.ts` / `claw-skills` router 入口分叉，不内部 inline
- ✅ `AgentPage.tsx` 死代码清理 + 前端按 runtime 条件展示版本号

## 还要按这套规则补的（路线图）

- [ ] `hermes-cron.ts` (cron) — 今天做
- [ ] `hermes-files.ts` / `hermes-downloads.ts` — 演示后做
- [ ] `openclaw-*.ts` 系列 — refactor 现有 `callClawGatewayRpc("...")` 散点（一并抽时做）

---

## Code Review checklist

提 PR 前 grep：
```
grep -rE 'startsWith\("lg[ch]-"\)' server/
```
检查每处是否在 router 入口（OK）还是内部（要重构成入口分叉）。

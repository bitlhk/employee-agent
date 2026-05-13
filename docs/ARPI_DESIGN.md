# ARPI Design — Agent Runtime Provider Interface

> 灵虾多 runtime 抽象层设计文档（**蓝图**，非实施清单）
>
> 创建：2026-04-20  
> 状态：**未实施**（等触发条件）

---

## 1. 是什么 / 不是什么

**ARPI = Agent Runtime Provider Interface** — 灵虾平台层（router）调用 runtime 实现的统一抽象接口。

类比 K8s CRI/CSI/CNI：

| K8s | 灵虾 ARPI |
|-----|----------|
| CRI (Container Runtime Interface) | runtime providers (OpenClaw / Hermes / hi-agent / jiuwenclaw) |
| Capability per concern (storage / network / device) | Capability per concern (chat / cron / files / memory / skills) |

**ARPI 是**：IO 层接口抽象 — 让 router 不感知 runtime 差异
**ARPI 不是**：cognitive 层抽象 — memory retrieval algorithm / skill evolution / agent thinking pattern 各 runtime 自己玩，不抽

→ 见 `CODING_GUIDELINES.md` 第 6 条

---

## 2. 触发条件（什么时候真做）

**满足之一**：
- 第 3 个 runtime（hi-agent / jiuwenclaw / 别家）准备接入
- 现有 hermes-*.ts 和未来 openclaw-*.ts 自然涌现接口完全对得上

**没满足前不要做**。LangChain BaseMemory 教训：抽象接口设计基于 N 个 runtime，N=2 时设计的接口大概率撑不到 N=3。

---

## 3. 接口骨架（建议形态）

### 3.1 主 Provider Interface

```typescript
// server/_core/runtime-providers/base.ts
export interface AgentRuntimeProvider {
  readonly runtime: string;                            // "openclaw" | "hermes" | ...
  readonly capabilities: ProviderCapabilities;         // self-report
  
  chat?: ChatCapability;
  cron?: CronCapability;
  files?: FilesCapability;
  memory?: MemoryCapability;
  skills?: SkillsCapability;
  // 未来扩展时追加
}

export type ProviderCapabilities = {
  chat: boolean;
  cron: boolean;
  files: boolean;
  memory: boolean;
  skills: boolean;
};

export type ProviderHandle = {
  adoptId: string;
  agentId: string;
  userId: number;
  // runtime-specific connection info（hermes 加 hermesPort, openclaw 加 gateway 信息）
  [k: string]: any;
};
```

### 3.2 各 Capability Sub-Interface

```typescript
// server/_core/runtime-providers/capabilities/cron.ts
export interface CronCapability {
  capabilities(): CronProviderCapabilities;
  listJobs(handle: ProviderHandle): Promise<LinggClawCronJob[]>;
  addJob(handle: ProviderHandle, input: CronJobInput): Promise<LinggClawCronJob>;
  updateJob(handle: ProviderHandle, jobId: string, patch: Partial<CronJobInput>): Promise<LinggClawCronJob>;
  removeJob(handle: ProviderHandle, jobId: string): Promise<void>;
  pauseJob(handle: ProviderHandle, jobId: string): Promise<LinggClawCronJob>;
  resumeJob(handle: ProviderHandle, jobId: string): Promise<LinggClawCronJob>;
  triggerJob(handle: ProviderHandle, jobId: string): Promise<LinggClawCronJob>;
}

// 同理 files / memory / skills / chat capabilities
```

### 3.3 Registry / Dispatch

```typescript
// server/_core/runtime-providers/registry.ts
import { hermesProvider } from "./hermes";
import { openclawProvider } from "./openclaw";

export function getProvider(adoptId: string): AgentRuntimeProvider {
  if (adoptId.startsWith("lgh-")) return hermesProvider;
  if (adoptId.startsWith("lgc-")) return openclawProvider;
  // 未来：lgi- (hi-agent) / lgj- (jiuwenclaw) / ...
  throw new Error(`unknown runtime for adoptId: ${adoptId}`);
}

// router 用法（替代 `if (isHermes ? hermesCron : openclaw)` 入口分叉）
const provider = getProvider(adoptId);
if (!provider.cron) return res.status(501).json({ error: "runtime does not support cron" });
const jobs = await provider.cron.listJobs(handle);
```

---

## 4. 目标文件组织



---

## 5. 抽象 Workflow（真做时按这步走）

### Phase 1: 接口定义（半天）
1. 创建 `runtime-providers/base.ts` + `capabilities/*.ts`
2. 类型完全复用现有 `Lingg*` 类型（已在 hermes-*.ts 顶部定义）
3. 不动业务代码

### Phase 2: hermes/ 搬迁（半天，纯文件移动）
4. `mv hermes-cron.ts → runtime-providers/hermes/cron.ts`
5. 同理其他 hermes-*.ts
6. 创建 `hermes/index.ts` 实现 `AgentRuntimeProvider`，组合 cron/files/memory/skills sub-providers
7. 改 import 路径（hermes-bridge.ts 引用方）

### Phase 3: openclaw/ 抽出（1-2 天，要拆现有 router 内联代码）
8. claw-cron.ts 里的 `openclawJobToLingg` + OpenClaw 业务逻辑搬到 `openclaw/cron.ts`
9. claw-files.ts 里的 `openclawListFiles` + `safeJoin` 搬到 `openclaw/files.ts`
10. 创建 `openclaw/index.ts` implements `AgentRuntimeProvider`

### Phase 4: router 重构（半天）
11. `registry.ts` 加 getProvider
12. claw-cron.ts / claw-files.ts router 内入口分叉改成 `getProvider(adoptId).cron.xxx()`
13. 删除 router 内的内联翻译函数（已搬到 provider 实现里）

### Phase 5: 加新 runtime（每个 1-2 天）
14. 写 `hi-agent/index.ts` + 各 capability 实现
15. `registry.ts` 加一行 prefix 路由
16. **零改 router、零改前端**

**总工作量估算**：
- Phase 1-4 一次性 refactor：3-5 天
- Phase 5 每接入新 runtime：1-2 天

---

## 6. 反/正面教材

| 项目 | 教训 |
|------|------|
| **K8s CRI** | docker 调用早期散在 kubelet 各处 → painful refactor。**反过来想**：早期就集中 docker-specific 在 `dockershim.go`，refactor 是搬文件不是改业务（→ 我们今天就在做这个）|
| **Vercel AI SDK v1→v2** | v1 已按 provider 分文件 → v2 抽 LanguageModelV1 接口干净落地 |
| **LangChain BaseMemory** ❌ | 太早抽象 + 各 provider 行为差异大 → leaky abstraction，被骂多年 |
| **LangChain BaseLLM** ❌ | 同上 |
| **MCP** ✅ | 故意只抽 tools/resources/prompts IO 层，**不抽 cognitive 层**（这是我们 6 条规则第 6 条原则）|

---

## 7. 设计原则速查（与 CODING_GUIDELINES.md 6 条对齐）

1. runtime-specific 集中在固定文件（`hermes-*.ts`, 未来 `hermes/*.ts`）
2. 统一文件命名前缀
3. 类型先定 — `Lingg*` 类型先种下，未来 ARPI 提到 `base.ts`
4. router 入口分叉（getProvider 一次性 dispatch）
5. capability self-report — `provider.capabilities` 让前端按 cap 渲染
6. **只抽 IO 层，不抽 cognitive 层**（最重要）

---

## 8. 决策日志

- **2026-04-20**：评估现在就抽 ARPI → 拒绝（只 2 runtime 不划算 + LangChain 教训）。但写本文档作为蓝图。
- **触发条件**：第 3 个 runtime 接入或现有接口涌现自然对齐时

---

## 9. 当前 Hermes / OpenClaw provider 文件清单（即将搬迁的）

| 文件 | 当前位置 | ARPI 后位置 |
|------|---------|-----------|
| hermes-bridge.ts (chat) | server/_core/ | runtime-providers/hermes/chat.ts |
| hermes-cron.ts | server/_core/ | runtime-providers/hermes/cron.ts |
| hermes-files.ts | server/_core/ | runtime-providers/hermes/files.ts |
| hermes-memory.ts | server/_core/ | runtime-providers/hermes/memory.ts |
| hermes-skills.ts | server/_core/ | runtime-providers/hermes/skills.ts |
| (内联 in claw-cron.ts) openclawJobToLingg + OPENCLAW_CAPABILITIES | server/_core/ | runtime-providers/openclaw/cron.ts |
| (内联 in claw-files.ts) openclawListFiles + safeJoin + OPENCLAW_CAPABILITIES | server/_core/ | runtime-providers/openclaw/files.ts |

每个 router (`claw-cron.ts` / `claw-files.ts` / etc) refactor 后：删入口分叉 + 改成 `getProvider(adoptId).cron.list(...)`。


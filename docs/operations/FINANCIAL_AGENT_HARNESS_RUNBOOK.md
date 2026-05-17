# Financial Agent Harness 阶段 0-3 运维说明

本文只覆盖当前已经落地的阶段 0-3，用于检查灵虾 Task Workbench Lab 到新加坡 Hermes Financial Agent Harness 的基础链路。

## 目标边界

- 智能体广场保持冻结，不继续拆 legacy business 分支。
- Task Workbench Lab 是 Financial Agent Harness 的灰度入口。
- 上海 OpenClaw SkillHub 不参与本链路。
- 新加坡 Hermes 主 profile 和历史 `mywealth` profile 不修改。
- Runtime skills 只注入给 manifest 中声明的 worker，不做全局注入。

## 当前链路

```text
上海灵虾 Task Workbench Lab
  -> 127.0.0.1:18650
  -> SSH tunnel
  -> 新加坡 127.0.0.1:8670 financial-harness-api
  -> financial-harness profile 规划
  -> worker profiles 执行
  -> per-worker runtime skill 注入
```

上海只需要一条隧道：

```text
127.0.0.1:18650 -> 新加坡 127.0.0.1:8670
```

`8650` 是新加坡本机内部的 `financial-harness` Hermes profile 端口，上海不直接调用。

新加坡 Financial Harness 相关端口都应只监听 `127.0.0.1`。这些端口不需要在云安全组放开。

## 阶段状态

| 阶段 | 状态 | 说明 |
|---|---|---|
| 阶段 0 | 已完成 | 冻结边界，Task Workbench Lab 灰度，不影响主聊天和智能体广场 |
| 阶段 1 | 已完成 | 新加坡 runtime skill store 已建立，并锁定 Anthropic financial-services commit |
| 阶段 2 | 已完成 | `agent-manifests.seed.json` 定义 market researcher / meeting prep 两个三段式 manifest |
| 阶段 3 | 已完成 | Harness executor 按 manifest worker 注入对应 skills；人工复核不作为默认 AI worker |
| 阶段 4 | 未开始 | Reader schema validation 尚未接入 |

## 关键路径

上海代码仓库：

```text
/root/linggan-platform
```

新加坡 Harness 执行目录：

```text
/home/ubuntu/lingxia-financial-harness-executor
```

新加坡 runtime skill store：

```text
/home/ubuntu/.lingxia/hermes-runtime-skills/anthropic-financial-services/current
```

当前 Anthropic financial-services commit：

```text
57772c3f1607229fba0270f94abf3c976bbd852f
```

## 上海侧检查

```bash
cd /root/linggan-platform
node tools/validate-agent-manifest.mjs \
  --manifest server/_core/agent/data/agent-manifests.seed.json
pnpm test -- --run server/_core/agent/__tests__/agent-manifest-schema.test.ts
pm2 status
curl -sS http://127.0.0.1:18650/health
```

预期：

- manifest validation passed
- 测试通过
- `sg-fin-harness-tunnel` 为 online
- `/health` 返回 `{"ok": true, "service": "financial-harness-api"}`

## 新加坡侧检查

```bash
cd /home/ubuntu/lingxia-financial-harness-executor
node validate-agent-manifest.mjs \
  --manifest agent-manifests.seed.json \
  --skill-root /home/ubuntu/.lingxia/hermes-runtime-skills/anthropic-financial-services/current \
  --profile-root /home/ubuntu/.hermes/profiles \
  --check-files \
  --check-profiles

HERMES_RUNTIME_SKILL_ROOT=/home/ubuntu/.lingxia/hermes-runtime-skills/anthropic-financial-services/current \
  ./check-runtime-skills.sh agent-manifests.seed.json

systemctl --user status lingxia-financial-harness-executor.service --no-pager
curl -sS http://127.0.0.1:8670/health
ss -ltnp | grep -E ':(8650|8651|8652|8653|8661|8662|8663|8670) '
```

预期：

- manifest validation passed
- runtime skills check passed
- `lingxia-financial-harness-executor.service` 为 active
- `/health` 返回 `{"ok": true, "service": "financial-harness-api"}`
- Financial Harness 相关端口均监听在 `127.0.0.1`

## Worker profiles

当前新加坡 Hermes profile 端口：

| Profile | Port |
|---|---:|
| financial-harness | 8650 |
| market-sector-reader | 8651 |
| market-comps-spreader | 8652 |
| market-note-writer | 8653 |
| meeting-news-reader | 8661 |
| meeting-profiler | 8662 |
| meeting-pack-writer | 8663 |
| financial-harness-api | 8670 |

## Manifest 约束

`validate-agent-manifest.mjs` 会检查：

- manifest / worker 必填字段
- runtime skill commit 引用
- skill 文件是否存在
- profile 是否存在
- writer / writeHolder 约束
- reader trust boundary 约束
- MCP server 是否为已知能力
- 每个 manifest 只能有一个 writeHolder

这部分是阶段 1-3 的主要保护网。

## 当前未解决事项

- Hermes worker profiles 目前仍是手工/nohup 方式运行；之前尝试 systemd 时，Hermes `--replace` 行为会导致 service restart loop。
- Reader schema validation 还未实现。
- MCP 权限目前主要是 manifest 约束和 prompt/context 注入，尚未做到 Hermes profile 层硬隔离。
- Handoff / callable subagent 编排还未实现。

## 故障定位顺序

1. 上海 `pm2 status` 看 `sg-fin-harness-tunnel` 是否 online。
2. 上海 `curl http://127.0.0.1:18650/health` 看隧道和 SG API 是否通。
3. 新加坡 `systemctl --user status lingxia-financial-harness-executor.service` 看 API 是否运行。
4. 新加坡检查 8650/8651/8652/8653/8661/8662/8663 是否有 Hermes profile 监听。
5. 跑 `validate-agent-manifest.mjs --check-files --check-profiles` 看 manifest、skills、profiles 是否一致。
6. 跑 `check-runtime-skills.sh` 看 runtime skill store 是否完整。
7. 如果发现任何 worker 端口监听在 `0.0.0.0`，先检查对应 profile `.env` 中的 `API_SERVER_HOST`，应为 `127.0.0.1`。

# Access Stats V2 (Step1 + Step2 Prepared)

## 本次改动范围（已完成）

- ✅ 新增聚合表 schema：`visit_stats_daily`
- ✅ 新增迁移 SQL 草案：`drizzle/0008_visit_stats_daily.sql`（**仅准备，未执行**）
- ✅ 统计 API 增加开关切换（新旧双轨）
- ✅ 新增三开关 system config：
  - `stats_read_from_aggregate`
  - `stats_enable_backfill_job`
  - `stats_enable_reconcile_job`
- ✅ 新增脚本：
  - `scripts/visit-stats-backfill.ts`
  - `scripts/visit-stats-reconcile.ts`

## 开关说明

- `stats_read_from_aggregate=true`：
  - `visitStats.byScenario`
  - `visitStats.byScenarioWithUserType`
  - `visitStats.topHot`
  - `visitStats.publicOverview`
  将优先读取 `visit_stats_daily`

- 其他两个开关用于任务治理（是否允许跑回填/校准任务），目前仅作为管控键。

## 口径（当前版本）

- PV：点击条数
- UV：按天去重
  - registered：`DISTINCT registrationId`
  - unlogged：`DISTINCT ip`

## 注意

本次只完成 Step1 + Step2 的代码与脚本准备，**没有执行任何 DB DDL/回填/校准任务**。

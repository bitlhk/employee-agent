# 灵虾 Banking-fy 视觉成熟度专项 — Plan v1

**日期**：2026-04-30
**作者协作**：Hongkun（产品 + BD）+ Claude（设计 + review）+ GPT（实施）
**触发**：2026-04-30 工行访谈结论："灵虾不如 jiuwenclaw 成熟，但 jiuwenclaw 没有任何企业要的功能" → **成熟感是 vibe，不是 feature gap**

---

## 0. 核心 reframe

银行客户的"成熟感"判断：

| 维度 | 工行 perception |
|---|---|
| jiuwenclaw | "像我用过的银行系统/钉钉/Excel" → 默认信任 |
| 灵虾 | "像 ChatGPT 工程师工具，暗色，cool" → cool 但不像企业系统 |

**结论**：成熟感 = **(银行后台熟悉感) × (集团信任默认值)**。前者 UI 可改（本 PLAN 范围），后者靠 narrative + 集团整合（BD 范围，不在本文）。

不做这一步的代价：**功能补全（定时任务/设置/广场）做完仍 perceive 不成熟**——因为不是功能问题。

---

## 1. 不做的（防 scope 爆炸）

明确划出**本专项不做**：

1. **不重写设计身份** —— 灵虾辨识度（虾形 logo / 主聊天着色 / 灵感品牌色）保留；只调企业页 baseline
2. **不换 UI 库** —— 不引入 element-plus / antd；只**借鉴**它们的视觉默认值
3. **不照抄 jiuwenclaw 蓝色系** —— 灵虾保留自己的红色品牌锚点；banking-fy 是企业系统语法，不是换皮成蓝色后台
4. **不强行翻转老用户偏好** —— 已 `localStorage.theme=dark` 的不变；只动**新用户默认值**和**未设置过的会话**
5. **不做主聊天 ChatMessage 视觉重做** —— memory `project_taskpanel_vs_main_chat` demo hot path 禁碰
6. **不做一次性全站改** —— 按 `UI_STABILITY_CONTRACT.md` 渐进，三页样板逐个冻结

---

## 2. jiuwenclaw 实测视觉基线（参考，不照抄）

通过翻 `/root/jiuwenclaw/lib/python3.13/site-packages/jiuwenclaw/web/dist/assets/index-DqO3-d6Q.css` 实测：

### 2.1 颜色（高频 hex 频次）
```
#fff       16 次（基础白底）
#fafafa     5 次（米灰背景层）
#f5f5f5     4 次（次级背景）
#3b82f6     9 次（主色蓝）
#2563eb     5 次（蓝深）
#ef4444     9 次（danger）
#f59e0b     7 次（warn）
#14b8a6     5 次（青绿/成功强调）
#111827     6 次（主文本）
#9ca3af     5 次（次文本）
#e5e7eb     5 次（边框）
```

→ **典型 Tailwind palette + #fafafa 米灰底色**。Banking 客户熟悉（钉钉/网银/Excel 也是这个色系）。

### 2.2 token 体系（**这点最值得抄**）
```css
.bg-bg / .bg-card / .bg-panel / .bg-secondary
.bg-accent / .bg-accent-subtle / .border-accent
.bg-ok / .bg-ok-subtle / .border-ok
.bg-warn / .bg-warn-subtle / .border-warn
.bg-danger / .bg-danger-subtle / .border-danger
.bg-info / .border-info
.border-border / .border-border-strong
.bg-text-muted
```

**单层语义 token + subtle 变体**。任何状态色都有 `solid + subtle + border` 三档可用，组件作者拿过来用不需要搭。

→ **vs 灵虾现状**：`--oc-*` + shadcn 双轨（已知债，UI_STABILITY_CONTRACT.md §10.1）。**banking-fy 的核心红利之一**就是把这两套合一为单层语义。

### 2.3 字体 / 间距
```
主 font-size: 12px / 13px / 14px
主 padding:   6px / 8px / 10px
line-height:  1.5（正文）/ 1.4（紧凑）
```

→ **密度高**。信息密度跟"专业"挂钩——银行后台从来不是大字体松散，是 Excel/钉钉那种"一屏看尽多条"。

### 2.4 状态 vocabulary
```
.statusbar-pill / --paused / --processing
.statusbar-dot / --pulse
.statusbar-action-btn--cancel / --pause / --resume
```

→ 状态展示**不只是颜色**——pill / dot / pulse 动效 / action btn 都有规范。

---

## 3. 视觉基线 v1（先做这 6 个）

### 3.1 默认 light + 米灰底色
```html
<!-- index.html -->
<meta name="theme-color" content="#fafafa" />
```

```ts
// 主题初始化逻辑
const stored = localStorage.getItem("theme");
const theme = stored || "light";  // ← 默认 light，不是当前的 dark / system
```

**保留**：dark mode 仍可用，`localStorage.theme=dark` 老用户不变。
**只改**：新用户默认值。

### 3.2 主色调 palette（保留灵虾红，借鉴企业灰阶）
```
背景层：     #ffffff  #fafafa  #f5f5f5  #f4f4f5
品牌主色：   沿用灵虾红 / 企业红（从现有 --primary / --oc-accent 收口，不改成 jiuwen 蓝）
信息色：     #3b82f6  #2563eb  #60a5fa   （只用于 info / link / 非品牌提示）
状态色：     #14b8a6 (ok)  #f59e0b (warn)  #ef4444 (danger)
中性灰：     #111827  #6b7280  #9ca3af  #d1d5db  #e5e7eb
```

→ 这里借鉴的是 **Tailwind 标准灰阶 + 状态色的稳定性**，不是借 jiuwenclaw 的蓝色品牌。灵虾红继续作为品牌主色，但使用方式要更克制：按钮、焦点、关键状态、品牌锚点使用红色；大面积背景、表格、表单使用浅灰/白，避免“满屏红”带来的压迫感。

### 3.3 单层语义 token（最重要的债务清理）

新建 `client/src/styles/banking-tokens.css`：
```css
:root[data-theme="light"] {
  /* 背景层 */
  --bg:           #fafafa;     /* 页面底色 */
  --bg-card:      #ffffff;     /* 卡片 */
  --bg-panel:     #f5f5f5;     /* 次级面板 */
  --bg-hover:     rgba(0,0,0,0.04);

  /* 文本 */
  --text:         #111827;
  --text-muted:   #6b7280;
  --text-subtle:  #9ca3af;

  /* 边框 */
  --border:        #e5e7eb;
  --border-strong: #d1d5db;

  /* 状态 - solid + subtle + border 三档 */
  --accent:        var(--brand-red);      /* 灵虾品牌红，具体值由现有 --primary / --oc-accent 收口决定 */
  --accent-subtle: var(--brand-red-subtle);
  --info:          #3b82f6;
  --info-subtle:   #dbeafe;
  --ok:            #14b8a6;
  --ok-subtle:     #ccfbf1;
  --warn:          #f59e0b;
  --warn-subtle:   #fef3c7;
  --danger:        #ef4444;
  --danger-subtle: #fee2e2;
}

:root[data-theme="dark"] {
  /* 同上 dark 镜像 */
}
```

**新页面只用这套 token，老页面渐进迁移**。`UI_STABILITY_CONTRACT.md` §2.1 的 `--oc-*` 长期目标合并到这套。

> 待定：`--brand-red` 的最终色值需要从现有 `--primary` / `--oc-accent` 中选一个企业化版本。原则是“红色作为品牌锚点”，不是“红色作为大面积底色”。

### 3.4 字体密度调整
```css
:root {
  --font-size-base:    14px;   /* 主文 */
  --font-size-compact: 12px;   /* 表格 / status pill */
  --font-size-micro:   11px;   /* metadata */
  --font-size-h1:      20px;
  --font-size-h2:      16px;
  --line-height:       1.5;
  --line-height-tight: 1.4;
}
```

→ 比当前灵虾 16px+ 略小。Console 内页面用 14px；表格 12px；不动主聊天。

### 3.5 间距系统
```css
--space-1: 4px;
--space-2: 6px;
--space-3: 8px;
--space-4: 12px;
--space-5: 16px;
--space-6: 24px;
```

主用 4-12px。表格 row padding 8px / 表单 field gap 12px / section gap 24px。

### 3.6 圆角统一
```css
--radius-sm: 4px;   /* 按钮 / pill */
--radius-md: 6px;   /* 卡片 */
--radius-lg: 8px;   /* dialog */
```

**收紧**：当前灵虾很多地方 `border-radius: 12-16px` 圆很大，看上去 "AI tool"。**银行后台标准是 4-8px**。

---

## 4. 组件 vocabulary（"银行后台感"6 件）

### 4.1 表格
```
✅ 必须：明确边框 / 表头浅灰底 / row hover 高亮 / sticky header
✅ 必须：表格底部"共 N 条 [1] 2 3 ... 末页"
✅ 状态列必须用 status pill（4.4）不用纯文字
🟡 可选：斑马纹（部分客户喜欢，部分嫌乱，默认关）
```

### 4.2 表单
```
✅ 必须：label 右对齐（中文企业系统标准）
✅ 必须：必填项左侧红星 *
✅ 必须：错误态字段下方红字
✅ 必须：disabled 灰底显著区分
✅ 必须：保存按钮 + 取消按钮 + 确认 dialog
🟡 可选：分组 fieldset
```

### 4.3 按钮
```
按钮分 4 个 variant：
- primary (灵虾红底白字) — 主要 action
- secondary (白底红边 / 中性边框) — 次要 action
- ghost (无边无底) — 链接式
- danger (红底白字) — 删除 / 强制操作

禁止：页面内自定义 BtnGhost/BtnPrimary（UI_STABILITY_CONTRACT §3.2 已禁）
```

### 4.4 状态 tag / pill
```
5 个标准 status:
  scheduled    灰   ⊙
  running      蓝   ▶ 带 pulse 动效
  ok / done    绿   ✓
  warn         橙   ⚠
  failed       红   ✕

实现：单 <StatusPill status="running" /> 组件，禁止页面内手写
```

### 4.5 空态 / 错误态
```
空态必须有：
- icon (48px 中性灰)
- 主文案"还没有 X" + 次文案"创建第一个 X 了解 X 能做什么"
- 主 action 按钮（如有）

错误态必须有：
- 红色 icon
- 主文案 + 错误代码（开发模式）
- "重试" 或 "联系管理员" action

禁止：白屏 / "加载失败" 单行文字
```

### 4.6 模态 dialog
```
✅ 必须：标题 + close 按钮 + body + footer (取消 / 确认)
✅ 必须：危险操作 dialog 用 danger variant + 二次确认
✅ 必须：ESC / overlay click 可关（除非 destructive）
🟡 可选：sticky footer (内容长时不丢按钮)
```

---

## 5. 三页样板顺序

| # | 页 | 用作什么 | 工时 |
|---|---|---|---|
| 1 | **设置页** (`SettingsPage.tsx`) | vocabulary 试金石——含 form + section + 状态 + dialog 全套 | 2-3 天 |
| 2 | **定时任务页** (`SchedulePage.tsx`) | banking-fy 集大成——含 table + form + status pill + 分页 + 空态错误态。**与 `CRON_TASK_CENTER_PLAN.md` 第三刀合并实施** | 3 天（含合并）|
| 3 | **智能体广场** | 第三块样板，跟配置化合并 | 待 |

**为什么先设置页不先定时任务**：
- 设置页 surface area 小（form-only 为主），改一遍能**快速产出第一份 page audit**当 baseline
- 定时任务 surface area 大（table + form + status + 投递），如果先做容易反复改
- 设置页冻结后的视觉规范作为定时任务页的 reference

---

## 6. 与现有 PLAN/CONTRACT 的关系

| 文档 | 范围 | 关系 |
|---|---|---|
| 本 PLAN | **What**: banking-fy 视觉基线 + 组件 vocabulary | 顶层产品基线 |
| `UI_STABILITY_CONTRACT.md` | **How**: 治理 / page audit / hard fail | 工程纪律 |
| `CRON_TASK_CENTER_PLAN.md` | **What**: 定时任务后端契约 + UI | 第三刀引用本 PLAN 的 vocabulary |

**冲突点处理**：
- UI_STABILITY_CONTRACT §2.1 说 "Console 优先 `--oc-*` token" —— 本 PLAN 提议 `--oc-*` 与 shadcn 长期收口为单层语义 token。**两版不冲突**——UI_STABILITY_CONTRACT 是过渡规则，本 PLAN 是终态目标。需在 UI_STABILITY_CONTRACT 加注释 cross-link 本 PLAN。
- CRON_TASK_CENTER §第三刀 UI 冻结 → 本 PLAN §5 第 2 块样板。两份合并为一次 implementation。

---

## 7. 不冲突原则（保护层）

1. **保留 dark mode 完整可用** —— light 仅作新用户默认，dark 仍是一等公民
2. **不破坏现有用户偏好** —— `localStorage.theme` 不动
3. **灵虾品牌色保留** —— logo / 主聊天虾色 / 灵感橙不丢
4. **主聊天 ChatMessage 不动** —— demo hot path 禁碰原则
5. **不强制 banking-fy 应用到营销页 / 登录页** —— 营销页可保留更"产品风"
6. **dark mode 也要 banking-fy** —— 不能只浅色专业，dark 模式同样要单语义 token

---

## 8. 验收方式

### 8.1 客观指标
- audit 脚本（GPT 在写）跑前后两次，**hex 硬编码 / Tailwind 硬编码 utility 数字下降 ≥ 70%**
- page audit 三份齐（设置 / 定时 / 广场）
- 26 vitest（runtime + reducer）继续过

### 8.2 主观指标（最重要）
- **客户访谈复检**：1 个月后再问工行同样问题"现在跟 jiuwenclaw 比"。看回答是否变化
- **内部盲测**：找 5 个**非工程同事**（行政 / 设计师 / 销售）盲看 jiuwenclaw vs 灵虾，问"哪个像企业系统"。改造前后各做一次

### 8.3 不算验收过的情况
- audit 数字降但客户访谈仍说"不如 jiuwenclaw" → 说明改的是技术债不是 perception 杠杆 → 重做诊断
- 内部盲测改造后仍 < 50% 选灵虾 → 视觉基线方向错 → 回到 §2 jiuwenclaw 实测重新分析

---

## 9. 工时估算

| 阶段 | 内容 | 工时 |
|---|---|---|
| §3 视觉基线 v1 | banking-tokens.css + theme.ts 默认改 + index.html theme-color | 2-3 天 |
| §4 组件 vocabulary | StatusPill / Dialog / EmptyState / 表格表单组件迁移 | 3-4 天 |
| §5 第 1 块设置页 banking-fy | 含 page audit | 2-3 天 |
| §5 第 2 块定时任务 banking-fy | 跟 CRON 第三刀合并 | 3 天（合并算）|
| §5 第 3 块广场 | 跟广场配置化合并 | 待 |
| **合计 v1（不含广场）** | | **10-13 天** |

**关键路径**：§3 → §4 必须先做完才能 §5。§5 三页可并行（不同人负责）。

---

## 10. 现在马上能做的（今天）

1. **GPT** 写 + 跑 `scripts/audit-ui-hardcodes.ts`，扫 `SchedulePage / SettingsPage / ManusDialog / CollabDrawer` 4 个 page
2. **我** 本 PLAN review 后 push 到 server
3. **你** 准备 narrative：jiuwenclaw 是 OpenClaw 之上同集团兄弟产品，灵虾是 OpenClaw 之上的金融垂直封装层。BD 见客户时统一这条
4. **不动代码**——本 PLAN + audit 数据 + UI_STABILITY_CONTRACT 三件齐全后再开干

---

## 11. 引用文件

- `docs/runtime/OPENCLAW_RUNTIME_BASELINE.md` 等 4 件套（Runtime 契约层）
- `docs/design/UI_STABILITY_CONTRACT.md`（UI 治理契约，GPT 写）
- `docs/product/CRON_TASK_CENTER_PLAN.md`（定时任务专项，第三刀跟本 PLAN 合并）
- 本 PLAN 位于 `docs/product/BANKING_UI_RESTYLE_PLAN.md`
- `/root/jiuwenclaw/lib/python3.13/site-packages/jiuwenclaw/web/dist/assets/index-DqO3-d6Q.css`（competitor reference，不要 copy）

---

## 12. 一句话原则

**先把灵虾从"AI 工具感"调成"银行内部系统感"，再把定时任务做成第一块企业能力样板。这是 perception 优化项，不是能力项——能力 8/10 已经够了，差的是看起来像。**

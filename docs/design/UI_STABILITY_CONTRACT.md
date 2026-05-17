# 灵虾 UI 稳定性契约

> 版本：v2
> 日期：2026-04-30
> 目的：让灵虾从“能用的工程页面”逐步收敛为“可信的企业产品界面”。
> 范围：Web UI 的颜色、主题、页面结构、状态呈现、逐页验收与回归冻结。

> Changelog: v2 adds section 13 Navigation Vocabulary and section 14 Icon Policy.

---

## 0. 背景判断

工行反馈里的“不够成熟”，不只是功能能力问题，也来自两个直接感受：

1. **信任事故**：消息截断会让用户怀疑平台是否可靠。Chat V2 / Runtime event / recover 已经作为稳定性主线修复。
2. **产品完成度**：颜色块、主题、表单、任务页、设置页、弹窗等如果风格不一致，会让客户觉得这还是 demo。

本契约解决第二类问题：**不是一次性全站重写，而是一页一页收敛；每改完一页，就把它固定住，不让它再退化。**

---

## 1. 总原则

### 1.1 不再自由发挥

任何页面改造都必须遵守本契约。页面可以有个性，但不能绕过 token、组件和验收标准。

### 1.2 不做“大爆炸式 UI 重构”

全站视觉债务很重，不允许一次性大面积改页面。采用：

```text
审计 -> 小步改造 -> 深浅色验证 -> 记录 page audit -> 冻结页面
```

### 1.3 页面成熟度优先级

优先修客户最容易看到、最容易形成成熟度判断的页面：

1. 定时任务中心：下一阶段企业能力样板页。
2. 设置页：客户会点，视觉不统一会直接显得不专业。
3. 智能体广场：展示面强，硬编码多，适合后续配置化。
4. 主聊天周边：主聊天刚切 V2，短期只收边栏、空态、错误态，不大动 ChatMessage。
5. 弹窗、抽屉、协同页：逐步归拢。

---

## 2. Token 使用规则

当前代码里存在两套 token：

1. **基础产品 token**：`index.css` 中的 shadcn/Tailwind 变量，例如 `--background`、`--foreground`、`--card`、`--border`、`--primary`。
2. **控制台 token**：`oc-theme.css` 中的 OpenClaw 风格变量，例如 `--oc-bg`、`--oc-card`、`--oc-border`、`--oc-text-primary`、`--oc-text-secondary`。

### 2.1 页面选择

本节是**过渡期规则**。长期目标仍然是单一 token 系统，但 token 收口属于独立主题基建专项，本契约不在这里完成。这里先定义在收口前，各类页面应该如何选择 token，避免继续随手硬编码。

| 页面类型 | 推荐 token |
|---|---|
| Console / 子虾工作区 / 定时任务 / 设置 / 广场 | 优先 `--oc-*` token |
| 营销页 / 登录页 / 公开页 | 优先 shadcn/Tailwind token |
| 通用组件库 | 优先 shadcn/Tailwind token，并兼容 dark |

### 2.2 禁止裸色

新代码默认禁止：

```css
#fff
#ffffff
#000
#000000
rgb(...)
rgba(...)
```

例外只允许三类：

1. 数据可视化图表，需要明确色板。
2. 品牌 logo / 第三方图标原色。
3. 临时兼容旧组件，并在 page audit 里登记。

### 2.3 状态色必须语义化

成功、警告、危险、信息不能随手写颜色。优先使用：

```css
--ok / --success
--warn / --warning
--danger
--info
--status-success
--status-warning
--status-danger
--status-info
```

如果页面使用 Tailwind class，则必须使用语义 class 或组件封装，不允许散落 `text-red-500` / `bg-green-500` 作为业务状态的默认写法。

---

## 3. 组件使用规则

### 3.1 页面容器

Console 内页面必须使用：

```ts
client/src/components/console/PageContainer.tsx
```

如果页面需要标题、描述、右上角操作区，但 `PageContainer` 当前未渲染这些 props，应该先增强 `PageContainer`，不要每页手写一套 header。

### 3.2 按钮

优先使用：

```ts
client/src/components/ui/button.tsx
```

旧页面里的 `BtnGhost`、`BtnPrimary`、`BtnDanger` 这种页面内临时按钮，只允许作为迁移期存在。页面冻结时必须满足：

- 页面内不再新增临时按钮组件。
- 如确实需要 console 风格按钮，应抽成 `client/src/components/console/ConsoleButton.tsx`。

### 3.3 卡片

优先使用：

```ts
client/src/components/ui/card.tsx
```

或统一的 console card class。禁止每页重新写：

```ts
style={{ background: "...", border: "...", borderRadius: "...", boxShadow: "..." }}
```

如果某页需要特殊密度，应该通过组件 variant 表达，而不是 inline style。

### 3.4 表单

输入框、选择框、textarea 必须统一高度、边框、背景、focus。页面级表单不允许每个字段单独写一套 `inputStyle` / `selectStyle`。

定时任务中心改造前，应先抽：

```text
ConsoleInput
ConsoleSelect
ConsoleTextarea
ConsoleField
```

最小实现即可，目标是避免 `SchedulePage.tsx` 继续复制样式对象。

---

## 4. Inline Style 规则

### 4.1 允许的 inline style

允许用于：

- 动态尺寸：`width`、`height`、`gridTemplateColumns`。
- 动态位置：拖拽、虚拟列表、canvas overlay。
- 动态状态：进度条百分比、颜色来自 token 的状态点。
- 小范围布局微调：`display`、`gap`、`alignItems`，但页面冻结时应尽量收敛。

### 4.2 禁止的 inline style

页面冻结后不应出现：

```ts
style={{
  background: "#...",
  color: "#...",
  border: "1px solid #...",
  boxShadow: "...",
  borderRadius: "...",
}}
```

这些必须进入 token、class 或组件 variant。

---

## 5. 深色 / 浅色验收

每个冻结页面必须同时验收：

1. 深色模式。
2. 浅色模式。
3. 系统模式切换。

### 5.1 验收项

| 项 | 要求 |
|---|---|
| 背景层级 | 页面背景、卡片、弹窗、输入框层级清楚 |
| 文本对比 | 主文本、次文本、禁用文本可读 |
| 边框 | 深色不糊成一团，浅色不脏 |
| Focus | 键盘 focus 可见，不突兀 |
| Hover | hover 不改变布局，不出现刺眼色块 |
| 空态 | 空状态不是一片空白 |
| 错误态 | 错误信息可见，有恢复动作 |
| 加载态 | loading 不跳布局 |

### 5.2 主题切换注意

当前存在两套主题应用逻辑：

- `client/src/lib/theme.ts` 使用 `dataset.theme` / `dataset.themeMode`。
- `client/src/contexts/ThemeContext.tsx` 使用 `.dark` class。

新页面必须确认两套逻辑下都不破。后续需要单独做主题系统收口，但在收口前，页面不能只在一种主题机制下可用。

---

## 6. 页面冻结流程

每改完一个页面，必须补一份 page audit：

```text
docs/design/page-audit/<page-name>.md
```

### 6.1 Page Audit 模板

```md
# Page Audit: <页面名>

## 入口

- URL:
- 文件:
- 相关组件:

## 主要状态

- 默认状态:
- 空状态:
- 加载状态:
- 错误状态:
- 编辑/创建状态:
- 删除/确认状态:

## 深浅色验收

- 深色: pass / fail
- 浅色: pass / fail
- 系统模式: pass / fail

## Feature Flag 覆盖

- `chatv2=on`: pass / fail / N/A
- `chatv2=off`: pass / fail / N/A
- 其他影响该页面的 `VITE_*` / localStorage flag:
  - flag:
  - 结论:

## 已收敛内容

- 裸色数量:
- inline style 风险:
- 替换为 token 的项:
- 替换为组件的项:

## 允许例外

| 文件 | 行 | 原因 | 后续计划 |
|---|---:|---|---|

## 回归检查

- 页面可打开:
- 表单可提交:
- 错误态可见:
- 移动端基本可用:
- 无 console error:

## 冻结结论

- 状态: frozen / partial
- 日期:
- 负责人:
```

### 6.2 冻结后的规则

冻结页面后，后续 PR / 修改必须：

1. 更新对应 page audit。
2. 不增加新的裸色和危险 inline style。
3. 深浅色都验证。
4. 如新增例外，必须写入允许例外表。

---

## 7. UI 硬编码审计

需要新增脚本：

```text
scripts/audit-ui-hardcodes.ts
```

### 7.1 初版扫描目标

扫描 `client/src` 下：

- hex color：`#[0-9a-fA-F]{3,8}`
- `rgb(` / `rgba(`
- 裸状态色 Tailwind：`text-red-*`、`bg-green-*`、`border-yellow-*` 等
- 硬编码背景 utility：`bg-white`、`bg-black`、`bg-slate-*`、`bg-gray-*`、`bg-zinc-*`
- 硬编码文字 utility：`text-white`、`text-black`、`text-slate-*`、`text-gray-*`、`text-zinc-*`
- 硬编码边框 utility：`border-slate-*`、`border-gray-*`、`border-zinc-*`
- `boxShadow`
- `border: "1px solid ..."`
- `background: "..."`
- `color: "..."`

### 7.2 输出格式

```text
file                                      hex  rgb  tw-hardcode  tw-status  inline-risk
client/src/components/pages/Schedule...   12   4    31           8          23
client/src/components/ManusDialog.tsx      9   2    14           3          11
```

脚本不只输出总数，还必须输出 top-N 行号，帮助当天直接开修：

```text
client/src/components/pages/SchedulePage.tsx
  hex (12):
    L142: backgroundColor: "#f5f5f5"
    L189: borderColor: "#ddd"
  tw-hardcode (31):
    L88: className="bg-white text-slate-900"
    L214: className="bg-gray-100 border-gray-200"
  inline-risk (23):
    L52: const inputStyle = { background: "#fff", border: "1px solid #ccc" }
```

### 7.3 使用方式

每页改造前跑一次，改造后跑一次。验收标准不是全站清零，而是：

- 当前页面风险数下降。
- 新增风险数为 0。
- 例外全部进入 page audit。

---

## 8. 定时任务中心的特殊要求

定时任务中心是下一个企业能力样板页，因此它必须同时满足：

### 8.1 v1 必须

1. 使用统一 `CronJob` 契约，不展示底层 OpenClaw 字段。
2. 使用 console form/card/button 组件，不再页面内定义按钮和输入样式。
3. 展示企业用户关心的字段：任务名、计划、状态、下次执行、最近执行、投递渠道、失败原因。

没有这三条，就不能称为“成熟度样板页”。

### 8.2 v1.5 应该

4. 支持空态：没有任务时给出 1-2 个企业场景模板。
5. 支持错误态：创建失败、执行失败、投递失败要有明确文案和下一步动作。

这两条可以在 v1 上线后 1-2 周内补齐，但不能长期缺失。

### 8.3 v2 可以

6. 支持完整审计感：显示创建人、修改人、最近执行人、最近投递状态、审计历史入口。

审计字段粒度要等工行访谈确认，不应在访谈前过早承诺。

定时任务中心做完后，必须作为第一个 page audit 样板页。

---

## 9. Review 标准

任何 UI 页面改造 review，至少回答 8 个问题：

1. 是否新增裸色？
2. 是否新增页面级临时组件？
3. 是否新增危险 inline style？
4. 深色是否可读？
5. 浅色是否可读？
6. 空态、错误态、加载态是否完整？
7. 是否破坏移动端基本布局？
8. 是否更新 page audit？

如果其中任一项没有答案，不应合入成熟度专项。

---

## 10. 当前已知债务

### 10.1 Token 双轨

`index.css` 和 `oc-theme.css` 都定义了颜色体系。短期允许双轨，但页面必须明确选择。长期应做主题系统收口。

### 10.2 PageContainer 未使用 title/desc/action

`PageContainer` 接收 `title`、`desc`、`icon`、`action`，但当前实现未渲染这些字段。后续 Console 页面统一 header 前，应先增强它。

### 10.3 SchedulePage 页面内样式过多

`SchedulePage.tsx` 当前有页面内 `BtnGhost`、`BtnDanger`、`BtnPrimary`、`FieldRow`、`inputStyle`、`selectStyle`。定时任务中心重做时应优先抽组件。

### 10.4 Google Fonts 仍有远程 import

`index.css` 中 JetBrains Mono 仍从 Google Fonts import。企业内部署可能受限，后续应本地化或走系统字体。

### 10.5 主题机制双套

`ThemeContext` 使用 `.dark`，`theme.ts` 使用 `dataset.themeMode`。后续需要统一，但本契约先要求页面兼容两者。

---

## 11. 下一步

建议顺序：

1. 写 `scripts/audit-ui-hardcodes.ts`，先只读扫描，不改页面。
2. 用脚本审计 `SchedulePage.tsx`、`SettingsPage.tsx`、`ManusDialog.tsx`、`CollabDrawer.tsx`。
3. 定时任务中心作为第一块样板页，改完补 `docs/design/page-audit/schedule-page.md`。
4. 设置页作为第二块样板页。
5. 智能体广场作为第三块样板页。

---

## 12. 一句话原则

**不要追求一次性变漂亮；追求每改完一页，就让这一页不再退化。**

---

## 13. Navigation Vocabulary

This section locks navigation behavior before more banking-fy pages are
converted. Do not create a new nav style for each page.

### 13.1 Levels

- Level 1 navigation: the global product/module sidebar.
- Level 2 navigation: top tabs inside the current page/module.
- Level 3 / form choices: segmented controls for short in-form choices.
- Filtering: chips, select, search, or dropdown controls for narrowing the same
  dataset. Do not use tabs for filters.

### 13.2 Placement Rules

- Default: Level 2 navigation uses top tabs.
- `N = 1`: do not render tabs. Use a page/section toolbar with a title and the
  primary action on the right.
- `2 <= N <= 7`: render all top tabs directly.
- If `N` approaches 7, merge or group content first instead of inventing a new
  navigation pattern.
- `N >= 8`: left mini nav is allowed only after an ADR explains why grouping was
  not enough.
- If switching changes the underlying dataset, query, or endpoint, top tabs are
  acceptable. If it only narrows the same dataset, use filters/chips/dropdowns.
- Lingxia keeps the global sidebar as the only persistent left column. Avoid
  double-left-column layouts unless the ADR exception above is recorded.

### 13.3 Top Tab Tokens

- Height: `32px`.
- Font size: `13px`.
- Icon: lucide, `16px`, default stroke `2`.
- Active background: `--banking-brand-red-subtle`.
- Active text/icon: `--banking-brand-red`.
- Inactive text/icon: `--banking-text-muted`.
- Hover background: `--banking-card`.
- Border/radius: `--banking-border` and `--banking-radius-md`.
- No underline tabs for Console pages; use filled active state for enterprise
  control-panel clarity.

### 13.4 Master-Detail Exceptions

Some modules are not Level 2 navigation. They are master-detail management
surfaces where the left column is a list of resources and the right panel edits
the selected resource. This pattern is allowed only when the left list is the
primary data object, not a page section nav.

Allowed pages:

- `ChannelsPage`: channel list (`wechat / feishu / wecom`) on the left, binding
  and status details on the right.
- `WorkspacePage` / file panels: file tree or file list on the left, preview or
  editor on the right.

Rules for master-detail pages:

- The left column must be inside the page content area, not another persistent
  product sidebar.
- Left item active state uses the same banking red subtle vocabulary as top
  tabs, but the component is not `role="tablist"`.
- Use `aria-current="true"` on the selected master item.
- Do not use this exception for settings sections, task filters, or simple
  view switching. Those remain top tabs or filters under section 13.2.

## 14. Icon Policy

- Functional system icons use `lucide-react`.
- Use lucide default stroke `2`; adjust size before overriding stroke width.
- Default nav icon size is `16px`.
- Emoji are allowed in user-generated content, chat text, notes, and AI output.
- Emoji are not allowed for system navigation, toolbar actions, status markers,
  file-type markers, or settings section icons.
- `scripts/audit-ui-hardcodes.ts` must report `nav-emoji` findings so this rule
  can regress visibly during page audits.

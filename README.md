# 员工智能体

员工智能体是面向企业内网和私有云部署的 Agent Platform。它为员工提供统一的智能体工作台，为管理员提供用户、智能体实例、技能、模型、渠道、安全隔离和审计治理能力。

本项目适合银行、金融机构和软件开发中心验证并落地：

- 单实例多用户
- 每用户独立智能体实例
- 可控技能和模型使用
- 企业级审计总账
- 私有化部署与内网运行
- 安全隔离和权限治理

## 企业价值

| 目标 | 说明 |
|---|---|
| 提升员工效率 | 员工可在统一工作台使用对话、技能、文件、任务和渠道能力 |
| 降低平台复杂度 | 一个服务实例支撑多用户、多智能体、多技能和多渠道 |
| 支持合规检查 | 登录、权限、技能、模型、工具、渠道、导出等关键行为进入审计总账 |
| 控制 AI 使用边界 | 管理员可控制模型白名单、技能上架、工具策略和运行时接入 |
| 适合私有化交付 | 支持本机 OpenClaw、MySQL、PM2、Nginx，便于在客户内网部署 |

## 典型页面

```text
/              员工入口：登录、申请智能体、进入工作台
/claw/:adoptId 智能体工作台：对话、技能、文件、记忆、频道、任务
/admin         管理后台：实例、用户、技能、系统健康、安全审计
/login         登录 / 注册
```

## 架构概览

推荐部署形态是“平台服务与 OpenClaw 运行时同机，数据库独立或同机”。

```text
浏览器
  |
  v
Nginx / HTTPS
  |
  v
employee-agent
  ├─ React 前端
  ├─ Express / tRPC API
  ├─ Admin 管理后台
  ├─ Audit Ledger 审计总账
  └─ Tenant Isolation 隔离层
       |
       v
OpenClaw Gateway / Agent Runtime
       |
       v
工作空间 / 文件 / 工具 / 技能

MySQL 8.0
  ├─ 用户与智能体实例
  ├─ 技能与配置
  └─ 企业审计总账
```

| 层级 | 组件 |
|---|---|
| 前端 | React 19, Vite, TailwindCSS, Radix UI |
| 后端 | Node.js 22, Express, tRPC |
| 数据库 | MySQL 8.0, Drizzle |
| 运行时 | OpenClaw Gateway，支持 HTTP Adapter 扩展 |
| 进程管理 | PM2 |
| 入口代理 | Nginx / HTTPS |

## 单实例多用户

平台只需要部署一个 `employee-agent` 服务实例，即可承载多个员工和多个智能体实例。

实现方式：

- 用户登录后获得自己的 `userId` 和会话上下文。
- 每个员工申请的智能体都有独立的 `adoptId` / `agentInstanceId`。
- 后端所有工作台请求都会校验“当前用户是否拥有该智能体实例”。
- 转发到 OpenClaw 时会附带租户隔离 token 和实例上下文。
- 管理员可以在 `/admin` 查看、停用、恢复或删除智能体实例。

关键配置：

```env
TENANT_SECRET=请使用生产级随机密钥
TIL_STRICT_AGENT_ISOLATION=true
```

`TENANT_SECRET` 用于生成租户隔离 token。新环境上线前必须配置；已有环境不要随意更换，否则会影响已有运行时校验。

## 安全隔离

银行场景下最核心的问题是：不同员工的智能体不能互访、串号或复用工作空间。当前实现从应用层和运行时入口两层做隔离。

| 风险 | 控制措施 |
|---|---|
| 用户访问他人智能体 | API 层校验 `userId + adoptId` 归属关系 |
| 智能体实例串号 | 每个请求携带独立 `agentInstanceId` 和 tenant token |
| OpenClaw 实例注册失败后降级串用 | 严格模式下注册失败直接返回错误，不回退到共享模板实例 |
| 管理员误操作 | 高风险动作进入审计，部分动作先审计再执行 |
| 工具越权 | 工具路由和策略层记录 allow / deny / rewrite 决策 |
| 数据泄露 | 审计 metadata 默认脱敏 password、token、secret、cookie、手机号、邮箱、身份证、银行卡等字段 |

建议生产配置：

```env
NODE_ENV=production
TIL_STRICT_AGENT_ISOLATION=true
```

## 企业审计

平台内置 Enterprise Audit Ledger，用于替代旧的分散审计表。新审计系统以 `audit_events` 为总账，并按专项表记录工具执行、安全发现和导出记录。

已覆盖的第一版审计事件包括：

- 登录成功、登录失败、退出登录
- 用户密码重置、权限变更
- 智能体创建、删除、启用、停用
- 模型切换和模型策略拒绝
- 技能安装、卸载、审核、下架
- 微信绑定、解绑、测试消息
- 工具执行 allow / deny / failed
- 审计导出 requested / completed / failed / downloaded
- 系统健康告警和审计写入失败 DLQ 状态

审计设计要点：

- 关键事件统一写入 `audit_events`。
- 工具执行详情写入 `audit_tool_events`。
- 安全告警写入 `audit_security_findings`。
- 审计导出写入 `audit_exports`，导出行为本身也会被审计。
- 审计 metadata 自动脱敏，避免记录 token、cookie、密码和敏感个人信息。
- 非关键审计失败进入本地 DLQ，不影响正常业务。
- fail-close 动作会先写审计，再执行原操作。

管理员可在 `/admin` 的“安全审计”页面查询、筛选、查看详情和导出审计数据。

## 主要功能

| 模块 | 能力 |
|---|---|
| 员工工作台 | 对话、技能、文件、记忆、频道、任务 |
| 智能体实例 | 申请、启用、停用、删除、生命周期管理 |
| 技能管理 | 技能上传、安装、卸载、审核、下架 |
| 模型管理 | 模型切换、模型白名单、策略拒绝 |
| 渠道集成 | 微信绑定、解绑、测试消息 |
| 管理后台 | 用户、实例、技能、系统健康、安全审计 |
| 审计导出 | CSV / JSON 导出，导出请求和结果留痕 |
| 系统健康 | 数据库、OpenClaw、审计表、DLQ、风险项检查 |

## 环境要求

推荐系统：Ubuntu 22.04+ / 24.04。

一键脚本会自动准备：

- Node.js 22
- pnpm 10.4.1
- PM2
- MySQL Server（默认 `mysql-auto` 模式）
- `.env`
- PM2 配置

OpenClaw Gateway 建议提前在同一台机器安装并启动。安装完成后可执行：

```bash
bash scripts/check-local-openclaw-node.sh
```

## 一键安装

在全新 Ubuntu 服务器上执行：

```bash
curl -fsSL https://raw.githubusercontent.com/bitlhk/employee-agent/main/scripts/bootstrap-install.sh | bash
```

脚本默认会：

- 拉取 `bitlhk/employee-agent`
- 安装到 `~/employee-agent`
- 自动探测服务器 IP 并生成 `FRONTEND_URL`
- 准备 MySQL 和数据库配置
- 执行初始化、检查和构建
- 使用 PM2 启动 `employee-agent`

可审计安装方式：

```bash
curl -fsSL -o /tmp/bootstrap-install.sh \
  https://raw.githubusercontent.com/bitlhk/employee-agent/main/scripts/bootstrap-install.sh

bash /tmp/bootstrap-install.sh --host 你的服务器IP
```

常用参数：

```bash
bash /tmp/bootstrap-install.sh \
  --repo https://github.com/bitlhk/employee-agent.git \
  --branch main \
  --dir "$HOME/employee-agent" \
  --host 服务器IP \
  --port 5180
```

| 参数 | 说明 |
|---|---|
| `--repo <url>` | Git 仓库地址 |
| `--branch <name>` | 分支，默认 `main` |
| `--dir <path>` | 安装目录，默认 `$HOME/employee-agent` |
| `--port <port>` | 服务端口，默认 `5180` |
| `--host <ip-or-host>` | 用于生成 `FRONTEND_URL` |
| `--db-mode <mode>` | `mysql-auto` / `existing` / `compose` |
| `--skip-mysql` | 不安装 MySQL，使用外部数据库 |
| `--skip-start` | 只初始化，不启动 |
| `--overwrite-env` | 强制重建 `.env` |
| `--dry-run` | 只打印计划执行动作 |

## 初始化管理员

首次部署后执行：

```bash
cd ~/employee-agent
corepack pnpm tsx scripts/init-admin.ts \
  --email=admin@example.com \
  --password='换成强密码' \
  --name='Admin'
```

然后访问：

```text
http://服务器IP:5180
```

## 手动安装

不使用一键脚本时：

```bash
git clone https://github.com/bitlhk/employee-agent.git ~/employee-agent
cd ~/employee-agent
corepack enable
corepack prepare pnpm@10.4.1 --activate
pnpm install
bash setup.sh
pnpm check
pnpm build
pm2 start ecosystem.config.cjs --update-env
pm2 save
```

## 数据库迁移

开发和部署初始化时执行：

```bash
pnpm run db:push
```

审计相关 migration 会创建：

- `audit_events`
- `audit_tool_events`
- `audit_security_findings`
- `audit_exports`
- WORM 触发器

WORM 触发器用于限制审计表被 UPDATE / DELETE。客户私有化交付前，建议补齐真实 MySQL 集成测试和数据库账号分离方案。

## 升级

重复执行一键脚本即可升级：

```bash
curl -fsSL https://raw.githubusercontent.com/bitlhk/employee-agent/main/scripts/bootstrap-install.sh | bash
```

脚本会在已有目录中执行：

```text
git fetch
git checkout main
git pull --ff-only
setup.sh --auto --yes
pnpm check
pnpm build
pm2 restart employee-agent
```

默认保留现有 `.env`。只有确实需要重建配置时才传：

```bash
curl -fsSL https://raw.githubusercontent.com/bitlhk/employee-agent/main/scripts/bootstrap-install.sh | bash -s -- --overwrite-env
```

## PM2 运维

```bash
pm2 status employee-agent
pm2 logs employee-agent
pm2 restart employee-agent
pm2 save
```

`ecosystem.config.cjs` 由 `setup.sh` 按当前机器生成，不进入 Git，避免把机器路径和用户目录写死。

## Nginx 反代

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:5180;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

## 生产上线检查

- `.env` 已设置强随机 `SESSION_SECRET`、`JWT_SECRET`、`TENANT_SECRET`
- `NODE_ENV=production`
- `TIL_STRICT_AGENT_ISOLATION=true`
- MySQL 已备份，迁移已执行
- OpenClaw Gateway 已启动，token 与 `.env` 一致
- 管理员账号已初始化，默认弱密码不存在
- Nginx HTTPS 已配置
- `/admin` 系统健康无高危告警
- “安全审计”页面可查询到登录、权限、技能、模型、工具和导出事件

## 项目结构

```text
employee-agent/
├── client/                  # React 前端
├── server/                  # Express / tRPC 后端
│   ├── _core/               # 审计、隔离、运行时、工具策略
│   └── routers/             # API 路由
├── shared/                  # 共享类型与配置
├── drizzle/                 # 数据库 schema 和 migration
├── scripts/                 # 安装、检查、初始化脚本
├── setup.sh                 # 本机环境初始化
├── ecosystem.config.cjs.example
├── .env.example
└── docker-compose.yml
```

## 故障排查

| 现象 | 排查 |
|---|---|
| 首页打不开 | `pm2 status employee-agent` / `pm2 logs employee-agent` |
| 登录后无法申请智能体 | 检查 `.env`、数据库、OpenClaw token、隔离配置 |
| 对话无响应 | 检查 OpenClaw Gateway 是否启动、token 是否一致 |
| 端口冲突 | 重新运行脚本并传 `--port <新端口>` |
| 数据库连接失败 | 检查 `DATABASE_URL`、MySQL 服务、用户权限 |
| 审计页面无数据 | 先产生登录、技能、模型、工具或导出动作，再检查 `audit_events` 表 |
| 前端仍显示旧文案 | 确认已 `pnpm build` 并重启 PM2，必要时强刷浏览器缓存 |

## 许可证

[MIT](LICENSE)

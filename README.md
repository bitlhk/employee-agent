# LingganClaw 灵虾

> 开源的 AI Agent 编排平台 —— 多智能体协议路由 + 策展式记忆 + 安全沙箱，让每个用户拥有专属 AI 灵虾。

<p align="center">
  <img src="client/public/images/lingxia.svg" width="120" alt="灵虾 Logo" />
</p>

## 它是什么

LingganClaw 是一个基于 [OpenClaw](https://github.com/nicepkg/openclaw) 的 **多用户 AI Agent 平台**。用户注册后可以「领养」一只专属灵虾（AI Agent），灵虾运行在隔离的 Docker 沙箱中，支持：

- 自然语言对话（WebSocket / SSE 流式输出）
- 多智能体路由（支持 OpenClaw / Hermes / 自定义 HTTP 协议）
- 在沙箱中执行代码（Docker 隔离, seccomp 加固）
- 生成并下载文件（PPT、HTML 幻灯片、代码等）
- 策展式记忆（Hermes 风格, 自动提取用户偏好, 跨 Agent 共享）
- 技能市场（安装 / 管理 / 分享技能）
- 多渠道通知（微信 / 企业微信 / 飞书 / Webhook）
- 定时任务（Cron 调度 + 自动推送）

## 页面结构

```
/              → ClawHome    领养首页（登录、一键领养、进入控制台）
/claw/:adoptId → 子虾控制台   对话、技能、记忆、设定
/admin         → ClawAdmin   管理后台（实例管理、系统配置）
/login         → 登录/注册
```

无需泛域名、无需通配符证书，单机路径模式即可部署。

## 架构

```
浏览器 ──HTTPS──▶ Nginx ──▶ LingganClaw (Node.js :5180)
                                │
                                ├── React SPA (主聊天 + 业务 Agent + 技能市场)
                                ├── Agent Router (4 种协议路由)
                                ├── 平台记忆 (Hermes 式策展记忆)
                                ├── 租户隔离层 (TIL)
                                │
                                ├──WebSocket──▶ OpenClaw Gateway (:18789)
                                │                  ├── per-user Agent
                                │                  └── Docker 沙箱
                                │
                                └──HTTP──▶ 业务 Agent (可选)
                                               ├── Hermes Agent (:8642)
                                               ├── TradingAgents (:8189)
                                               └── 自定义 Agent (任意 HTTP)
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19, Vite, TailwindCSS 4, Radix UI, tRPC, Framer Motion |
| 后端 | Node.js 22, Express, tRPC, tsx |
| 数据库 | MySQL 8.0 (Drizzle ORM) |
| AI 运行时 | OpenClaw Gateway |
| 沙箱 | Docker (per-agent 隔离, seccomp, 无网络) |

## 环境要求

| 依赖 | 版本 |
|------|------|
| Node.js | 22.x |
| pnpm | 9.x+ |
| MySQL | 8.0+ |
| Docker | 24+ |
| OpenClaw | 最新版 |
| OS | Ubuntu 22.04+ (推荐) |

---

## 快速开始

### 一条命令部署（Ubuntu 裸机）

适合全新服务器验证。脚本会安装基础依赖、拉取 GitHub 仓库、生成 `.env`、准备本机 MySQL、构建并用 PM2 启动灵虾。

```bash
curl -fsSL https://raw.githubusercontent.com/bitlhk/linggan-claw/main/scripts/bootstrap-install.sh | bash
```

更可审计的方式：

```bash
curl -fsSL -o /tmp/install-lingxia.sh \
  https://raw.githubusercontent.com/bitlhk/linggan-claw/main/scripts/bootstrap-install.sh
bash /tmp/install-lingxia.sh --host 你的服务器IP
```

默认会安装到当前用户目录下的 `~/linggan-claw`，与 OpenClaw / Hermes 的本机用户目录习惯保持一致。如需生产固定目录，也可以额外传入 `--dir /opt/linggan-claw`。

### 方式一：裸机部署（推荐）

推荐将灵虾平台、OpenClaw Gateway、Docker 沙箱部署在同一台 Ubuntu 服务器上。这样路径、权限、沙箱文件和运行时 token 都由本机配置控制，最适合验证一套干净、可迁移的企业部署。

```bash
git clone https://github.com/bitlhk/linggan-claw.git
cd linggan-claw

# 交互式配置：生成 .env、初始化数据库、生成本机 PM2 配置
bash setup.sh

# 构建并启动
pnpm build
pm2 start ecosystem.config.cjs

# 检查本机 OpenClaw、token、Gateway、CORS 和健康状态
bash scripts/check-local-openclaw-node.sh
```

首次部署可创建管理员账号：

```bash
pnpm tsx scripts/init-admin.ts --email=admin@example.com --password='换成强密码' --name='Admin'
```

浏览器打开 `http://服务器IP:5180`，进入灵虾首页即可登录使用。

### 方式二：Docker Compose（基础平台/数据库）

Docker Compose 适合快速拉起 MySQL 和灵虾平台，但默认不包含宿主机 OpenClaw 环境。主聊天如果要使用本机 OpenClaw，优先选择裸机部署。

```bash
git clone https://github.com/bitlhk/linggan-claw.git
cd linggan-claw
bash setup.sh
docker compose up -d
```

### 方式三：手动部署（自备 MySQL）

```bash
git clone https://github.com/bitlhk/linggan-claw.git
cd linggan-claw
pnpm install

# 配置
cp .env.example .env
# 编辑 .env，填写 DATABASE_URL, JWT_SECRET, CLAW_GATEWAY_TOKEN 等

# 建表 & 构建 & 启动
pnpm db:push
pnpm build
pnpm start
```

> 完整配置说明见 [.env.example](.env.example)，生产部署细节见 [docs/DEPLOY.md](docs/DEPLOY.md)。

## 代码同步与部署来源

当前仓库是脱敏后的开源/部署镜像，适合在新机器上直接克隆并验证独立部署。生产私有环境的同步链路是：

```text
华为云私有仓库 → 脱敏构建 → 新加坡中转仓库 → GitHub main
```

如果新加坡服务器只是作为同步中转机，不需要再从 GitHub 克隆一份来覆盖中转目录。如果要把新加坡服务器作为一套新的灵虾运行环境，建议另建部署目录，例如 `~/linggan-claw`，从 GitHub 克隆一份干净代码，这样可以真实验证“新机器拉仓库 + 配 OpenClaw token + 启动灵虾”的可移植性。

---

## OpenClaw 配置

灵虾的 AI 能力依赖 OpenClaw Gateway。

### 安装

```bash
npm install -g openclaw
```

### 配置 Gateway

编辑 `~/.openclaw/openclaw.json`：

```json
{
  "gateway": {
    "port": 18789,
    "mode": "local",
    "bind": "lan",
    "auth": {
      "mode": "token",
      "token": "<和 .env 中 CLAW_GATEWAY_TOKEN 一致>"
    },
    "http": {
      "endpoints": {
        "chatCompletions": { "enabled": true }
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "你的模型ID"
      },
      "sandbox": {
        "mode": "all",
        "scope": "agent",
        "workspaceAccess": "rw",
        "docker": {
          "image": "openclaw-sandbox:bookworm-slim",
          "network": "none",
          "readOnlyRoot": true,
          "memory": "256m",
          "cpus": 0.5,
          "pidsLimit": 50
        }
      },
      "tools": { "profile": "coding" }
    }
  }
}
```

### 构建沙箱镜像 & 启动

```bash
OPENCLAW_HOME=~/.openclaw openclaw-sandbox-setup
openclaw gateway start
```

---

## 生产部署

### PM2 服务（推荐）

```bash
# setup.sh 会从 ecosystem.config.cjs.example 生成本机私有配置
pm2 start ecosystem.config.cjs
pm2 save

# 查看状态和日志
pm2 status linggan-claw
pm2 logs linggan-claw
```

`ecosystem.config.cjs` 不进入 Git，由每台机器按当前目录和当前用户生成，避免把 `/root`、`/home/ubuntu`、绝对 Node 路径等环境差异写死。

### Nginx 反代

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

        # SSE 流式输出
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

---

## 套餐说明

| | Starter（默认） | Plus | Internal |
|------|------|------|------|
| 对话 | 50 轮/天 | 无限制 | 无限制 |
| 记忆 | 有 | 有 | 有 |
| 技能 | 系统预置 | + 自定义技能 | 完整 |
| 沙箱执行 | 有 | 有 | 有 |
| 协作广场 | 可见，需升级 | 完整使用 | 完整 |
| 模型切换 | 默认模型 | 多模型切换 | 完整 |
| 有效期 | 30天（不活跃15天自动回收） | 无限期 | 无限期 |

套餐由管理员在 `/admin` 页面调整。

**环境变量可调参数：**
- `CLAW_STARTER_DAILY_LIMIT` — Starter 每日对话上限（默认 50）
- `CLAW_STARTER_INACTIVE_DAYS` — 不活跃回收天数（默认 15）

## 项目结构

```
linggan-claw/
├── client/                  # 前端 (React + Vite)
│   ├── src/
│   │   ├── pages/
│   │   │   ├── ClawHome.tsx     # 领养首页
│   │   │   ├── ClawAdmin.tsx    # 管理后台
│   │   │   ├── Home.tsx         # 子虾控制台
│   │   │   ├── Login.tsx        # 登录/注册
│   │   │   └── ...
│   │   ├── components/
│   │   │   ├── console/         # 控制台组件 (Sidebar, MainPanel)
│   │   │   ├── pages/           # 功能页 (ChatPage, SkillsPage, ...)
│   │   │   └── ...
│   │   └── lib/                 # tRPC client, theme, settings
│   └── public/                  # 静态资源
├── server/
│   ├── _core/
│   │   ├── index.ts             # Express 入口 + SSE + 定时回收
│   │   ├── security.ts          # 限速, IP 封禁, helmet
│   │   ├── sandbox.ts           # Docker 沙箱执行
│   │   ├── tool_router.ts       # Agent 工具路由
│   │   └── ...
│   ├── routers.ts               # tRPC 路由 (用户/Agent/技能/协作/管理)
│   └── db.ts                    # 数据库操作 (Drizzle)
├── shared/                      # 前后端共享代码
├── drizzle/                     # 数据库 schema
├── scripts/
│   ├── claw-provision.sh        # 灵虾 provision 脚本
│   └── build-oss.sh             # 开源版构建脚本
├── .env.example                 # 环境变量模板
├── setup.sh                     # 交互式配置脚本
├── Dockerfile                   # Docker 构建
└── docker-compose.yml           # 一键启动 (MySQL + App)
```

## 安全机制

- **沙箱隔离**: 每个灵虾在独立 Docker 容器中执行代码，无网络、只读根文件系统、资源配额限制
- **IP 自动封禁**: 15 分钟内 30 个 4xx 错误自动封禁 IP
- **限速**: 多层 rate limiter (通用 / 认证 / 严格 / 聊天)
- **对话额度**: Starter 套餐每日上限，防止资源滥用
- **自动回收**: 不活跃实例定时回收，释放服务器资源
- **SSRF 防护**: 拦截内网地址请求
- **安全头**: helmet + CSP

## 故障排查

| 现象 | 排查 |
|------|------|
| 子虾无响应 | `systemctl status openclaw-gateway` 检查 Gateway |
| 沙箱不启动 | `docker images \| grep openclaw-sandbox` 确认镜像存在 |
| 技能不加载 | 检查 skills 目录软链接是否指向有效路径 |
| IP 被封禁 | 查 `ip_management` 表，设 `isActive=no` 解封 |
| 模型切换无效 | 确认模型 ID 在 `openclaw.json` 的 models 白名单中 |
| 对话提示超限 | Starter 套餐每日限额，升级 Plus 或调整 `CLAW_STARTER_DAILY_LIMIT` |

## License

[MIT](LICENSE)

## 文档

| 文档 | 说明 |
|------|------|
| [部署指南](docs/DEPLOY.md) | 从零部署灵虾（含 OpenClaw 配置） |
| [智能体架构](docs/ARCHITECTURE-AGENTS.md) | 4 种协议、12 个 Agent、记忆体系 |
| [OpenClaw 配置模板](configs/openclaw-lingxia.json.example) | 灵虾所需的 OpenClaw 最小配置 |

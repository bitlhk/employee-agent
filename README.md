# 员工智能体

> 一个面向企业探索场景的 Agent Client / Agent Platform：统一创建智能体实例、接入 OpenClaw / Hermes 等运行时、管理技能与任务、承载组织协作、安全隔离和审计。

<p align="center">
  <img src="client/public/images/lingxia.svg" width="120" alt="员工智能体 Logo" />
</p>

## 它是什么

本项目是灵感平台下的 **员工智能体**模块。它不是单一聊天机器人，而是企业侧使用和管理智能体的入口层：

- **员工智能体**：每个用户可申请一个隔离的智能体实例。
- **智能体工作台**：对话、技能、记忆、文件、频道、定时任务、协作统一入口。
- **运行时接入**：默认对接本机 OpenClaw，也可接入 Hermes、Claude Code、Codex 或自定义 HTTP Agent。
- **组织能力**：组织协作、渠道通知、任务工作台、技能广场、审计和权限治理。

推荐默认部署形态：

```text
员工智能体 (Node.js / React)
  -> 本机 OpenClaw Gateway
  -> 本机工作空间 / 沙箱 / 文件
  -> MySQL
```

也就是说，新机器上只要先准备或安装本机 OpenClaw，再用本仓库的一键脚本拉代码、初始化数据库和启动服务，就能跑一套干净环境。

## 页面结构

```text
/              -> 员工智能体首页：登录、申请员工智能体、进入工作台
/claw/:adoptId -> 智能体工作台：聊天、技能、频道、记忆、协作、工作空间、定时任务
/admin         -> 智能体管理：实例、组织协作、技能广场、系统设置、使用统计
/login         -> 登录 / 注册
```

## 技术栈

| 层级 | 技术 |
|---|---|
| 前端 | React 19, Vite, TailwindCSS 4, Radix UI, tRPC |
| 后端 | Node.js 22, Express, tRPC, tsx |
| 数据库 | MySQL 8.0, Drizzle ORM |
| 运行时 | OpenClaw Gateway, Hermes / HTTP Adapter 可选 |
| 进程管理 | PM2 |

## 环境要求

推荐系统：Ubuntu 22.04+ / 24.04。

一键脚本会自动准备：

- git / curl / ca-certificates / openssl / python3 / build-essential
- Node.js 22
- pnpm 10.4.1
- pm2
- MySQL Server（默认 `mysql-auto` 模式）
- `.env`
- PM2 配置

OpenClaw 运行时建议提前在同一台机器装好并启动；脚本完成后可用 `scripts/check-local-openclaw-node.sh` 检查。

---

## 命名过渡说明

项目英文仓库名已调整为 `employee-agent`。为了平滑迁移，一键安装脚本的新默认安装目录和 PM2 进程名使用 `employee-agent`；如果检测到旧的 `~/linggan-claw` 安装目录或旧 PM2 进程，会继续兼容升级，避免现有环境被重复安装。

仓库正式重命名前，仍可临时使用旧 raw URL 拉取 bootstrap；脚本会优先尝试新仓库，失败后 fallback 到旧仓库。

## 一键部署

### 最简方式

在全新 Ubuntu 服务器上，以当前登录用户执行：

```bash
curl -fsSL https://raw.githubusercontent.com/bitlhk/employee-agent/main/scripts/bootstrap-install.sh | bash
```

脚本默认行为：

- 从 GitHub 拉取 `bitlhk/employee-agent`
- 安装到当前用户目录：`~/employee-agent`
- 自动探测公网 IP，生成 `FRONTEND_URL`
- 准备 MySQL 和数据库配置
- 执行 `setup.sh --auto --yes`
- 执行 `pnpm check`
- 执行 `pnpm build`
- 用 PM2 启动 `employee-agent`

安装完成后，脚本会输出访问地址和管理员初始化命令。

### 可审计方式

```bash
curl -fsSL -o /tmp/bootstrap-install.sh \
  https://raw.githubusercontent.com/bitlhk/employee-agent/main/scripts/bootstrap-install.sh

bash /tmp/bootstrap-install.sh --host 你的服务器IP
```

### 常用参数

```bash
bash /tmp/bootstrap-install.sh \
  --repo https://github.com/bitlhk/employee-agent.git \
  --branch main \
  --dir "$HOME/employee-agent" \
  --host 111.119.236.165 \
  --port 5180
```

参数说明：

| 参数 | 说明 |
|---|---|
| `--repo <url>` | Git 仓库地址，默认 GitHub main 仓库 |
| `--branch <name>` | 分支，默认 `main` |
| `--dir <path>` | 安装目录，默认 `$HOME/employee-agent` |
| `--port <port>` | 服务端口，默认 `5180` |
| `--host <ip-or-host>` | 用于生成 `FRONTEND_URL`，不传则自动探测 |
| `--db-mode <mode>` | `mysql-auto` / `existing` / `compose`，默认 `mysql-auto` |
| `--skip-mysql` | 不安装 MySQL，适合使用外部数据库 |
| `--skip-start` | 只拉代码和初始化，不构建/启动 |
| `--overwrite-env` | 已存在 `.env` 时强制重建 |
| `--dry-run` | 只打印将执行的动作 |

### 初始化管理员

脚本不会替你写死管理员密码。首次部署后执行：

```bash
cd ~/employee-agent
corepack pnpm tsx scripts/init-admin.ts \
  --email=admin@example.com \
  --password='换成强密码' \
  --name='Admin'
```

然后浏览器打开：

```text
http://服务器IP:5180
```

## 后续升级

同一个目录下可以重复执行一键脚本。脚本发现 `$HOME/employee-agent` 已经是 Git 仓库时，会执行：

```text
git fetch
git checkout main
git pull --ff-only
setup.sh --auto --yes
pnpm check
pnpm build
pm2 start/restart
```

推荐升级命令：

```bash
curl -fsSL https://raw.githubusercontent.com/bitlhk/employee-agent/main/scripts/bootstrap-install.sh | bash
```

如果需要保留现有 `.env`，不要传 `--overwrite-env`。如果需要重新生成 `.env`：

```bash
curl -fsSL https://raw.githubusercontent.com/bitlhk/employee-agent/main/scripts/bootstrap-install.sh | bash -s -- --overwrite-env
```

## 手动部署

如果不使用一键脚本：

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

## OpenClaw 检查

员工智能体默认按“平台与 OpenClaw 同机”设计。部署后检查：

```bash
cd ~/employee-agent
bash scripts/check-local-openclaw-node.sh
```

常见需要确认的项：

- OpenClaw Gateway 是否启动
- `.env` 中 `CLAW_GATEWAY_URL` 是否指向本机
- `.env` 中 `CLAW_GATEWAY_TOKEN` 是否与 OpenClaw 配置一致
- CORS / FRONTEND_URL 是否匹配

## PM2 运维

```bash
pm2 status employee-agent
pm2 logs employee-agent
pm2 restart employee-agent
pm2 save
```

PM2 配置文件 `ecosystem.config.cjs` 由 `setup.sh` 按当前机器生成，不进入 Git，避免把 `/root`、`/home/ubuntu`、Node 绝对路径等环境差异写死。

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

## 项目结构

```text
employee-agent/
├── client/                  # React 前端
├── server/                  # Express / tRPC 后端
├── shared/                  # 前后端共享类型与配置
├── drizzle/                 # 数据库 schema
├── scripts/
│   ├── bootstrap-install.sh         # 一键安装 / 升级脚本
│   ├── check-local-openclaw-node.sh # 本机 OpenClaw 检查
│   ├── init-admin.ts                # 初始化管理员
│   └── ...
├── setup.sh                 # 本机环境初始化
├── ecosystem.config.cjs.example
├── .env.example
└── docker-compose.yml
```

## 故障排查

| 现象 | 排查 |
|---|---|
| 首页打不开 | `pm2 status employee-agent` / `pm2 logs employee-agent` |
| 登录后无法申请智能体 | 检查 `.env`、数据库、OpenClaw token、`scripts/check-local-openclaw-node.sh` |
| 对话无响应 | 检查 OpenClaw Gateway 是否启动、token 是否一致 |
| 端口冲突 | 重新运行脚本并传 `--port <新端口>` |
| 数据库连接失败 | 检查 `DATABASE_URL`、MySQL 服务、用户权限 |
| 前端仍显示旧文案 | 强刷浏览器缓存，确认服务已重新 `pnpm build` 并 PM2 重启 |

## 许可证

[MIT](LICENSE)

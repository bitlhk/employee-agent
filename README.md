# 员工智能体

面向企业办公场景的 Agent Client / Agent Platform。它把每个员工自己的智能体、OpenClaw 运行时、技能和工具、协作任务、文件工作区、渠道通知、审计治理放到一个统一入口里。

<p align="center">
  <img src="client/public/images/lingxia.svg" width="120" alt="员工智能体 Logo" />
</p>

## 适合做什么

- 给每位员工申请一个隔离的智能体实例，用于日常对话、资料处理、文件生成和任务执行。
- 统一接入 OpenClaw 或自定义 HTTP Agent，前端和管理后台不需要随运行时重写。
- 把企业内部工具、MCP 服务、专业技能、岗位权限和审计记录接入一个可管理的平台。
- 做企业岗位助手、金融投研工具、客户经理助手、办公自动化和团队协作类原型。

推荐默认部署形态：

```text
浏览器 / iOS 壳
  -> 员工智能体 Web 服务 (React + Node.js)
  -> 本机 OpenClaw Gateway
  -> 本机 workspace / sandbox / tools
  -> MySQL
```

## 核心亮点

**一个员工一个智能体**

每个用户可以申请自己的员工智能体实例。实例有独立身份、工作区、技能配置、工具权限和会话历史，适合企业内按人、岗位或团队逐步放开。

**OpenClaw 优先的运行时接入**

默认对接本机 OpenClaw Gateway，同时保留自定义 HTTP runtime 接入能力。平台侧负责用户、权限、技能市场、审计和协作；运行时侧负责模型推理、工具调用和文件执行。

**更顺滑的主对话体验**

主对话已做流式稳定性和前端渲染优化：流式 watchdog、断线兜底、流结束历史对账、稳定 React key、passive scroll、tab 保活、输入法防误发、图片粘贴压缩、Markdown 链接和图片安全过滤。

**工具和技能可治理**

支持技能市场、私有技能、平台工具和 MCP 工具展示。工具能力可以逐步按岗位、用户或智能体授权，适合企业从“先跑通能力”过渡到“可审计、可管控”。

**协作和办公工作区**

内置协作任务、办公空间、文件上传、历史会话、定时任务和渠道通知。前端不只是聊天框，也能承载任务工作台和团队协作工作流。

**管理和审计**

提供 `/admin` 管理入口，用于用户、智能体、技能、工具、系统状态和审计类能力的管理。适合在企业环境中做权限分配、问题排查和使用情况追踪。

## 页面入口

```text
/              -> 首页：登录、申请员工智能体、进入工作台
/claw/:adoptId -> 员工智能体工作台：对话、技能、频道、记忆、协作、工作区、定时任务
/admin         -> 管理后台：智能体、组织协作、技能市场、系统设置、审计和统计
/login         -> 登录 / 注册
```

## 技术栈

| 层级 | 技术 |
|---|---|
| 前端 | React 19, Vite, TailwindCSS 4, Radix UI, tRPC |
| 后端 | Node.js 22, Express, tRPC, tsx |
| 数据库 | MySQL 8.0, Drizzle ORM |
| 运行时 | OpenClaw Gateway；HTTP Adapter 可选 |
| 进程管理 | PM2 |
| 移动端 | `apps/ios` 提供 Capacitor iOS 壳，可连接线上 Web 服务 |

## 快速部署

推荐系统：Ubuntu 22.04+ / 24.04。

先在同一台机器准备并启动 OpenClaw Gateway，然后执行：

```bash
curl -fsSL https://raw.githubusercontent.com/bitlhk/employee-agent/main/scripts/bootstrap-install.sh | bash
```

脚本会自动完成：

- 安装 Node.js 22、pnpm、PM2、MySQL 依赖
- 拉取 `bitlhk/employee-agent`
- 生成 `.env`
- 初始化数据库配置
- 执行 `setup.sh --auto --yes`
- 执行 `pnpm check` 和 `pnpm build`
- 用 PM2 启动 `employee-agent`

安装完成后，初始化管理员：

```bash
cd ~/employee-agent
corepack pnpm tsx scripts/init-admin.ts \
  --email=admin@example.com \
  --password='换成强密码' \
  --name='Admin'
```

然后打开：

```text
http://服务器IP:5180
```

## 可审计安装

如果希望先下载脚本再检查：

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
  --host your-server-ip \
  --port 5180
```

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

## 手动部署

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

重点确认：

- OpenClaw Gateway 已启动
- `.env` 中 `CLAW_GATEWAY_URL` 指向本机 Gateway
- `.env` 中 `CLAW_GATEWAY_TOKEN` 与 OpenClaw 配置一致
- `FRONTEND_URL`、CORS、反代域名配置一致

## 升级

同一目录下可以重复执行一键脚本。脚本发现 `$HOME/employee-agent` 已经是 Git 仓库时，会拉取最新代码、重新执行检查和构建，并重启 PM2。

```bash
curl -fsSL https://raw.githubusercontent.com/bitlhk/employee-agent/main/scripts/bootstrap-install.sh | bash
```

如需保留现有 `.env`，不要传 `--overwrite-env`。如需重新生成 `.env`：

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
        client_max_body_size 50m;
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
├── apps/ios/                # Capacitor iOS 壳
├── docs/                    # 架构、部署、审计、OpenClaw patch 等文档
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
| 对话无响应 | 检查 OpenClaw Gateway、模型 provider、Gateway token |
| 上传 413 | 检查 Nginx `client_max_body_size` 和应用上传限制 |
| 端口冲突 | 重新运行脚本并传 `--port <新端口>` |
| 数据库连接失败 | 检查 `DATABASE_URL`、MySQL 服务、用户权限 |
| 前端仍显示旧内容 | 强刷浏览器缓存，确认服务已重新 `pnpm build` 并 PM2 重启 |

## 相关文档

- [部署说明](docs/DEPLOY.md)
- [系统架构](docs/ARCHITECTURE-SYSTEM.md)
- [智能体架构](docs/ARCHITECTURE-AGENTS.md)
- [企业审计设计](docs/enterprise-audit-ledger.md)
- [OpenClaw Patch 记录](docs/OPENCLAW_PATCHES.md)

## 许可证

[MIT](LICENSE)

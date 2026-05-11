# 员工智能体使用与部署手册

> 员工智能体是灵感平台中的 Agent 能力模块。它用于创建员工智能体、接入 OpenClaw / Hermes 等运行时，并提供聊天、技能、记忆、文件、定时任务、频道推送和组织协作能力。

---

## 一、普通用户怎么用

### 1. 申请员工智能体

1. 打开灵感平台。
2. 登录账号。
3. 在员工智能体首页点击 **申请员工智能体**。
4. 系统创建完成后，进入 **智能体工作台**。

每个员工智能体都是独立实例：对话、记忆、技能、文件和定时任务彼此隔离。

### 2. 工作台入口

| 入口 | 说明 |
|---|---|
| 聊天 | 日常对话、问答、文件任务、工具调用 |
| 技能 | 查看、上传、安装和管理技能 |
| 技能广场 | 安装开源社区或组织共享技能 |
| 频道 | 绑定微信、飞书等触达渠道 |
| 记忆 | 编辑 SOUL.md / MEMORY.md / USER.md |
| 协作 | 发起或处理组织协作任务 |
| 工作空间 | 查看、上传、下载、删除文件 |
| 定时任务 | 创建和管理周期任务 |
| 设置 | 外观、主题、模型和偏好设置 |
| 文档 | 查看当前帮助文档 |

### 3. 聊天

在聊天页直接输入问题即可。支持：

- 流式输出
- 工具调用过程展示
- 文件上传
- 产物文件生成
- 语音输入
- 模型切换

同一个浏览器窗口会保持自己的对话上下文；不同窗口、微信、飞书等渠道使用独立上下文，避免消息串流。

### 4. 技能

技能是给智能体安装的能力模块。常见来源：

- 平台内置
- 个人上传
- 对话生成
- 技能广场安装
- 组织专区共享

技能安装后会同步到当前智能体实例的运行时。若技能状态异常，可进入详情查看同步状态。

### 5. 频道

频道用于把智能体能力接到外部触达方式：

- 微信：可对话、接收提醒、接收定时任务结果
- 飞书：可接收任务通知和协作提醒
- 企业微信：适合企业管理员配置

如果长时间没有收到微信通知，可以先在微信里给智能体发一句话，再回到频道页测试发送。

### 6. 定时任务

可以在定时任务页面创建，也可以在聊天里用自然语言创建：

```text
每天早上 8 点给我推送北京天气到微信
```

任务会绑定到当前智能体实例，不会读取宿主机或其他智能体的定时任务。

### 7. 组织协作

协作功能用于多人共享任务：

1. 发起人创建协作任务。
2. 指派组织成员。
3. 成员在自己的智能体工作台完成子任务。
4. 结果回传给发起人汇总。

协作记录和审计记录会保留，便于追踪任务过程。

---

## 二、管理员怎么部署

### 1. 一键部署

在 Ubuntu 服务器上执行：

```bash
curl -fsSL https://raw.githubusercontent.com/bitlhk/employee-agent/main/scripts/bootstrap-install.sh | bash
```

脚本会自动：

- 安装基础依赖
- 安装 Node.js 22
- 启用 pnpm
- 安装 PM2
- 拉取 GitHub 仓库
- 默认安装到 `$HOME/employee-agent`
- 自动探测服务器 IP
- 生成 `.env`
- 初始化 MySQL
- 构建前端
- 启动 PM2 服务

### 2. 指定服务器 IP

```bash
curl -fsSL -o /tmp/bootstrap-install.sh \
  https://raw.githubusercontent.com/bitlhk/employee-agent/main/scripts/bootstrap-install.sh

bash /tmp/bootstrap-install.sh --host 111.119.236.165
```

### 3. 常用安装参数

```bash
bash /tmp/bootstrap-install.sh \
  --dir "$HOME/employee-agent" \
  --port 5180 \
  --host 111.119.236.165 \
  --branch main
```

| 参数 | 说明 |
|---|---|
| `--dir` | 安装目录，默认 `$HOME/employee-agent` |
| `--port` | 服务端口，默认 `5180` |
| `--host` | 访问地址使用的公网 IP 或域名 |
| `--branch` | Git 分支，默认 `main` |
| `--repo` | Git 仓库地址 |
| `--skip-start` | 只初始化，不启动 |
| `--skip-mysql` | 不安装本机 MySQL |
| `--db-mode existing` | 使用已有数据库 |
| `--overwrite-env` | 重新生成 `.env` |
| `--dry-run` | 只打印动作，不实际执行 |

### 4. 初始化管理员

部署完成后创建第一个管理员：

```bash
cd ~/employee-agent
corepack pnpm tsx scripts/init-admin.ts \
  --email=admin@example.com \
  --password='换成强密码' \
  --name='Admin'
```

浏览器打开：

```text
http://服务器IP:5180
```

### 5. 升级

一键脚本可以重复执行。已有 `$HOME/employee-agent` Git 仓库时，它会自动拉取最新代码、重新初始化、构建并重启 PM2：

```bash
curl -fsSL https://raw.githubusercontent.com/bitlhk/employee-agent/main/scripts/bootstrap-install.sh | bash
```

默认不会覆盖已有 `.env`。需要重建 `.env` 时：

```bash
curl -fsSL https://raw.githubusercontent.com/bitlhk/employee-agent/main/scripts/bootstrap-install.sh | bash -s -- --overwrite-env
```

---

## 三、OpenClaw 运行时

员工智能体默认按“平台与 OpenClaw 同机”部署。

部署后检查：

```bash
cd ~/employee-agent
bash scripts/check-local-openclaw-node.sh
```

重点确认：

- OpenClaw Gateway 已启动
- `CLAW_GATEWAY_URL` 指向本机 Gateway
- `CLAW_GATEWAY_TOKEN` 与 OpenClaw 配置一致
- `FRONTEND_URL` 与浏览器访问地址一致
- WebSocket / SSE 能正常访问

---

## 四、PM2 运维

```bash
pm2 status employee-agent
pm2 logs employee-agent
pm2 restart employee-agent
pm2 save
```

常用目录：

```text
~/employee-agent/.env
~/employee-agent/ecosystem.config.cjs
~/employee-agent/dist/
~/.openclaw/
```

---

## 五、常见问题

### 首页还是旧文案？

先强刷浏览器。如果仍然不对，确认服务器已经重新构建并重启：

```bash
cd ~/employee-agent
corepack pnpm build
pm2 restart employee-agent
```

### 申请员工智能体失败？

检查：

```bash
cd ~/employee-agent
bash scripts/check-local-openclaw-node.sh
pm2 logs employee-agent
```

常见原因是 OpenClaw Gateway 未启动、token 不一致、数据库未初始化或 `.env` 地址不对。

### 对话一直没响应？

优先检查 OpenClaw：

```bash
bash scripts/check-local-openclaw-node.sh
```

再看 PM2 日志：

```bash
pm2 logs employee-agent
```

### 微信或飞书收不到消息？

进入工作台的 **频道** 页面重新测试绑定状态。微信长时间未互动时，先在微信里给智能体发一句话重新激活。

### 多窗口会串消息吗？

当前 Web、微信、飞书等渠道使用独立会话标识。不同浏览器窗口也会分配不同 web conversation，避免并发生成互相串流。

### 可以部署到别的云服务器吗？

可以。推荐流程：

1. 新服务器安装/启动本机 OpenClaw。
2. 执行一键部署脚本。
3. 初始化管理员。
4. 登录后重新配置业务智能体、技能和渠道。

不建议直接迁移旧机器的数据库和工作空间，除非明确要做生产迁移。

---

## 六、排查命令速查

```bash
# 服务状态
pm2 status employee-agent

# 服务日志
pm2 logs employee-agent

# 本机运行时检查
cd ~/employee-agent
bash scripts/check-local-openclaw-node.sh

# 类型检查
corepack pnpm check

# 重新构建
corepack pnpm build

# 重启
pm2 restart employee-agent
```

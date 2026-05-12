# 项目架构说明

## 架构概述

本项目采用**前后端完全分离**的架构设计，前端和后端可以独立开发、构建和部署。

**全 TypeScript 架构**：整个项目完全基于 TypeScript，包括：
- 前端：TypeScript + React + Vite
- 后端：TypeScript + Express（生产环境直接运行 TypeScript，无需编译）
- 共享代码：TypeScript 类型和常量
- 配置文件：TypeScript（vite.config.ts, drizzle.config.ts）
- 脚本工具：TypeScript

## 目录结构

```
employee-agent/
├── client/              # 前端应用
│   ├── src/            # 前端源代码
│   ├── public/        # 静态资源
│   ├── index.html     # HTML 入口
│   └── vite.config.ts # 前端构建配置
├── server/             # 后端 API 服务
│   ├── _core/         # 核心后端代码
│   ├── routers.ts     # API 路由定义
│   └── db.ts          # 数据库操作
├── shared/             # 共享代码（类型定义、常量等）
└── drizzle/           # 数据库迁移文件
```

## 前后端通信

- **协议**: tRPC (Type-safe RPC)
- **传输**: HTTP/HTTPS
- **数据格式**: JSON (使用 superjson 序列化)

### API 端点

- 后端 API 基础路径: `/api/trpc`
- OAuth 回调路径: `/api/oauth/callback`
- 健康检查: `/health`

## 开发环境

### 启动开发服务器

#### 同时启动前后端（推荐）
```bash
pnpm dev
```

#### 分别启动
```bash
# 启动前端（端口 5173）
pnpm dev:client

# 启动后端（端口 5174）
pnpm dev:server
```

### 环境变量配置

创建 `.env` 文件（参考 `.env.example`）：

**后端环境变量**:
- `PORT`: 后端服务端口（默认: 5174）
- `CORS_ORIGIN`: 允许的 CORS 源（开发环境: http://localhost:5173）
- `DATABASE_URL`: 数据库连接字符串
- `OAUTH_PORTAL_URL`: OAuth 服务地址
- `APP_ID`: 应用 ID

**前端环境变量**（以 `VITE_` 开头）:
- `VITE_API_URL`: 后端 API 地址（开发环境: http://localhost:5174）
- `VITE_PORT`: 前端开发服务器端口（默认: 5173）
- `VITE_OAUTH_PORTAL_URL`: OAuth 服务地址
- `VITE_APP_ID`: 应用 ID

## 构建和部署

### 构建

```bash
# 构建前端（后端无需构建，直接运行 TypeScript）
pnpm build

# 仅构建前端
pnpm build:client
```

**注意**：后端采用全 TypeScript 架构，生产环境直接使用 `tsx` 运行 TypeScript 源代码，无需编译步骤。这样可以：
- 简化构建流程
- 减少构建时间
- 保持开发和生产环境一致性
- 便于调试和问题排查

### 生产环境启动

```bash
# 启动后端
pnpm start:server

# 预览前端（需要先构建）
pnpm start:client
```

### 部署建议

#### 前端部署
- 可以部署到任何静态文件托管服务（如 Vercel、Netlify、CDN 等）
- 构建产物位于 `dist/client/`
- 需要配置环境变量 `VITE_API_URL` 指向后端 API 地址

#### 后端部署
- 可以部署到 Node.js 服务器（如 PM2、Docker 等）
- 直接运行 TypeScript 源代码（使用 `tsx`），无需编译
- 需要配置 `CORS_ORIGIN` 允许前端域名
- 生产环境需要安装 `tsx` 作为运行时依赖

## 开发流程

1. **前端开发**: 在 `client/` 目录下进行前端开发
2. **后端开发**: 在 `server/` 目录下进行后端 API 开发
3. **类型共享**: 通过 tRPC 自动共享类型，无需手动同步
4. **共享代码**: 在 `shared/` 目录下放置前后端共享的类型和常量

## 注意事项

1. **CORS 配置**: 后端需要正确配置 `CORS_ORIGIN` 以允许前端访问
2. **API 地址**: 前端通过环境变量 `VITE_API_URL` 配置后端地址
3. **Cookie 认证**: 前后端分离时，需要确保 Cookie 的 `SameSite` 和 `Secure` 属性正确配置
4. **开发代理**: 前端开发服务器已配置代理，将 `/api/*` 请求转发到后端

## 迁移说明

从旧架构迁移到新架构的主要变化：

1. ✅ 前端配置独立到 `client/vite.config.ts`
2. ✅ 后端移除静态文件服务和 Vite 中间件
3. ✅ 前后端通过 HTTP API 通信，不再耦合
4. ✅ 支持独立部署和扩展


---

## 模块边界约束

以下规则防止重构成果反弹，所有贡献者须遵守。

### 入口文件 `server/_core/index.ts`

- **只做装配**：中间件注册、CORS、tRPC、静态文件、`registerXxxRoutes(app)` 调用
- **禁止**在此文件新增业务路由实现
- **禁止**在此文件定义业务 helper 函数

### 路由模块 `server/_core/claw-*.ts`

- 每个模块导出 `registerXxxRoutes(app: express.Express)`
- 单个模块不超过 **800行**（超过则按职责二次拆分）
- 路由内只做：参数解析 → 鉴权 → 调 service/db → 返回响应
- **禁止**在路由模块间复制路径清洗逻辑，统一使用 `helpers.ts` 的 `sanitizeRelPath` / `sanitizeFileName`

### 共享函数 `server/_core/helpers.ts`

- 通用工具函数的**唯一来源**（single source of truth）
- 包括：路径清洗、SSRF防护、session管理、鉴权、文件token、日志
- **禁止**在其他文件重复实现同名函数

### 数据层 `server/db/*.ts`

- 按领域拆分（users、claw、collab、config 等）
- `db/index.ts` re-export 所有函数，外部统一从 `"../db"` 导入
- **禁止**在路由层直接写 SQL/drizzle 查询

### 路由层 `server/routers/*.ts` (tRPC)

- 按领域拆分（auth、claw、collab、admin 等）
- `routers/index.ts` 合并所有 sub-router
- 共享 helper 放在 `routers/helpers.ts`

### 输入清洗规范

| 参数类型 | 使用函数 | 来源 |
|----------|----------|------|
| 相对路径 | `sanitizeRelPath()` | helpers.ts |
| 文件名 | `sanitizeFileName()` | helpers.ts |
| URL | `isPrivateUrl()` | helpers.ts |
| adoptId / agentId | zod schema 校验 | 各路由 |

## API 响应规范

### 错误响应（统一格式）

所有 Express 路由的错误响应统一使用 `sendError()` 或 `handleRouteError()`：

```json
{
  "ok": false,
  "code": "NOT_FOUND",
  "message": "file not found",
  "details": {}
}
```

### 标准错误码

| code | HTTP status | 含义 | 前端行为 |
|------|-------------|------|----------|
| `BAD_REQUEST` | 400 | 参数错误/格式错误 | 表单提示 |
| `UNAUTHORIZED` | 401 | 未登录/token 无效 | 跳转登录 |
| `FORBIDDEN` | 403 | 权限不足 | 提示无权限 |
| `NOT_FOUND` | 404 | 资源不存在 | 提示不存在 |
| `CONFLICT` | 409 | 冲突（如 etag 不匹配） | 提示刷新重试 |
| `RATE_LIMITED` | 429 | 限流/额度超限 | 提示稍后重试 |
| `PAYLOAD_TOO_LARGE` | 413 | 输入/文件过大 | 提示缩小内容 |
| `INTERNAL_ERROR` | 500 | 服务端错误 | 通用失败提示 |

### details 字段约定

- `details` 可选，仅用于提供结构化的调试信息
- 只允许放稳定字段（`field`、`reason`、`limit`），不允许泄露内部实现
- 前端不应依赖 `details` 做业务分支判断

### 成功响应（渐进统一）

- 新接口建议使用 `{ ok: true, data: ... }` 格式
- 已有接口保持原格式不变，避免 break 前端
- tRPC 路由走 tRPC 自身的返回机制，不受此约定影响

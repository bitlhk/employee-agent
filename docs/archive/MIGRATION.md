# 前后端分离架构迁移总结

## 改动概述

本次整改将项目从**前后端耦合架构**迁移到**完全前后端分离架构**。

## 主要改动

### 1. 前端配置独立化

- ✅ 创建 `client/vite.config.ts` - 前端独立的 Vite 配置
- ✅ 前端开发服务器独立运行（端口 5173）
- ✅ 配置了 API 代理，开发时自动转发 `/api/*` 请求到后端

### 2. 后端 API 服务化

- ✅ 移除静态文件服务功能
- ✅ 移除 Vite 中间件集成
- ✅ 添加 CORS 支持，允许前端跨域访问
- ✅ 添加健康检查端点 `/health`
- ✅ 后端仅提供 API 服务（端口 5174）

### 3. 环境变量配置

- ✅ 前端通过 `VITE_API_URL` 配置后端地址
- ✅ 后端通过 `CORS_ORIGIN` 配置允许的前端域名
- ✅ 后端通过 `FRONTEND_URL` 配置 OAuth 回调后的重定向地址

### 4. 构建和部署分离

- ✅ 前端构建产物：`dist/client/`
- ✅ 后端构建产物：`dist/server/`
- ✅ 前后端可以独立构建和部署

### 5. 脚本命令更新

**新增命令**:
- `pnpm dev` - 同时启动前后端（推荐）
- `pnpm dev:client` - 仅启动前端
- `pnpm dev:server` - 仅启动后端
- `pnpm build:client` - 仅构建前端
- `pnpm build:server` - 仅构建后端
- `pnpm start:client` - 预览前端构建产物
- `pnpm start:server` - 启动后端服务

### 6. 删除的文件

- ❌ `server/index.ts` - 旧的静态文件服务器
- ❌ `server/_core/vite.ts` - Vite 中间件集成代码

### 7. 更新的文件

- 📝 `server/_core/index.ts` - 移除静态文件服务，添加 CORS
- 📝 `client/src/main.tsx` - 支持环境变量配置 API URL
- 📝 `client/src/const.ts` - OAuth 回调 URL 使用后端地址
- 📝 `server/_core/oauth.ts` - OAuth 回调后重定向到前端地址
- 📝 `package.json` - 更新构建和启动脚本
- 📝 `tsconfig.node.json` - 更新包含新的配置文件

## 环境变量配置

### 开发环境

创建 `.env` 文件：

```env
# 后端
PORT=5174
CORS_ORIGIN=http://localhost:5173
FRONTEND_URL=http://localhost:5173

# 前端（VITE_ 前缀）
VITE_API_URL=http://localhost:5174
VITE_PORT=5173
```

### 生产环境

**前端部署**:
- 设置 `VITE_API_URL` 为后端 API 地址（如：`https://api.example.com`）

**后端部署**:
- 设置 `CORS_ORIGIN` 为前端域名（如：`https://app.example.com`）
- 设置 `FRONTEND_URL` 为前端地址（如：`https://app.example.com`）

## 迁移检查清单

- [x] 前端配置独立到 `client/vite.config.ts`
- [x] 后端移除静态文件服务
- [x] 后端添加 CORS 支持
- [x] 前端 API 地址通过环境变量配置
- [x] OAuth 回调路径正确配置
- [x] 构建脚本分离前后端
- [x] 删除不再需要的文件
- [x] 更新文档说明

## 注意事项

1. **Cookie 认证**: 前后端分离时，确保 Cookie 的 `SameSite` 和 `Secure` 属性在生产环境正确配置
2. **CORS 配置**: 后端必须正确配置 `CORS_ORIGIN` 以允许前端访问
3. **API 地址**: 前端必须通过 `VITE_API_URL` 正确配置后端地址
4. **OAuth 回调**: OAuth 回调 URL 现在指向后端，回调后重定向到前端

## 测试建议

1. 测试前后端独立启动
2. 测试 API 请求是否正常
3. 测试 OAuth 登录流程
4. 测试生产环境构建和部署

## 回滚方案

如果需要回滚到旧架构：

1. 恢复 `server/_core/index.ts` 中的静态文件服务代码
2. 恢复 `server/_core/vite.ts` 文件
3. 恢复 `package.json` 中的旧脚本
4. 删除 `client/vite.config.ts`

但建议保留新架构，因为它提供了更好的可扩展性和部署灵活性。


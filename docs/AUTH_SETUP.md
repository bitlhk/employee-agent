# 用户登录管理模块使用说明

## 功能概述

本系统实现了完整的用户登录管理模块，支持以下功能：

1. **邮箱密码登录/注册** - 用户可以通过邮箱和密码进行注册和登录
2. **管理员权限控制** - 管理员界面只能被管理员用户访问
3. **路由保护** - 自动重定向未登录用户到登录页面
4. **Session管理** - 使用JWT token进行会话管理

## 数据库变更

### Schema 更新

`users` 表已更新，添加了以下字段：
- `password` (varchar 255) - 存储bcrypt加密的密码哈希值
- `openId` 字段改为可选（支持邮箱密码登录）

### 迁移步骤

运行以下命令生成并应用数据库迁移：

```bash
pnpm run db:push
```

## API 端点

### 认证相关

- `POST /api/trpc/auth.register` - 用户注册
  - 输入: `{ name: string, email: string, password: string }`
  - 返回: `{ success: boolean, user: User }`

- `POST /api/trpc/auth.login` - 用户登录
  - 输入: `{ email: string, password: string }`
  - 返回: `{ success: boolean, user: User }`

- `GET /api/trpc/auth.me` - 获取当前用户信息
  - 返回: `User | null`

- `POST /api/trpc/auth.logout` - 退出登录

### 管理员API（需要管理员权限）

- `GET /api/trpc/registration.list` - 获取所有注册用户
- `GET /api/trpc/visitStats.list` - 获取所有访问记录
- `GET /api/trpc/visitStats.byScenario` - 获取按场景分组的统计

## 前端路由

### 公开路由
- `/` - 首页
- `/scenarios` - 场景页面
- `/login` - 登录/注册页面

### 受保护路由
- `/admin` - 管理员后台（需要管理员权限）

访问受保护的路由时，未登录用户会自动重定向到 `/login?redirect=/admin`

## 使用流程

### 1. 创建管理员账户

1. 访问 `/login` 页面
2. 切换到"注册"标签
3. 填写姓名、邮箱和密码（至少6个字符）
4. 点击"注册"按钮

### 2. 设置管理员权限

注册后的用户默认角色为 `user`，需要手动在数据库中将其角色更新为 `admin`：

```sql
UPDATE users SET role = 'admin' WHERE email = 'your-email@example.com';
```

或者通过代码设置（需要在注册API中添加逻辑）：

```typescript
// 在 server/routers.ts 的 register mutation 中
// 可以添加逻辑，例如第一个注册的用户自动成为管理员
if (isFirstUser) {
  role = 'admin';
}
```

### 3. 登录管理员后台

1. 访问 `/login` 页面
2. 输入注册时的邮箱和密码
3. 点击"登录"按钮
4. 登录成功后自动跳转到 `/admin`

### 4. 退出登录

在管理员后台右上角的用户菜单中，点击"退出登录"

## 安全特性

1. **密码加密** - 使用 bcrypt 进行密码哈希（10轮加密）
2. **Session管理** - 使用JWT token，存储在httpOnly cookie中
3. **路由保护** - 前端和后端双重验证
4. **权限控制** - 管理员API使用 `adminProcedure` 中间件保护

## 组件说明

### ProtectedRoute
路由保护组件，用于保护需要登录才能访问的路由。

```tsx
<ProtectedRoute>
  <YourComponent />
</ProtectedRoute>
```

### AdminRoute
管理员路由保护组件，只有管理员可以访问。

```tsx
<AdminRoute>
  <AdminComponent />
</AdminRoute>
```

## 注意事项

1. **首次部署** - 需要运行数据库迁移以添加 `password` 字段
2. **管理员设置** - 注册后需要手动设置管理员权限（或修改代码自动设置）
3. **邮箱唯一性** - 系统会检查邮箱是否已注册，确保邮箱唯一
4. **密码要求** - 密码至少需要6个字符
5. **Session过期** - 默认session有效期为1年

## 故障排查

### 无法登录
- 检查数据库连接是否正常
- 确认用户已注册且密码正确
- 检查浏览器cookie是否被禁用

### 无法访问管理员页面
- 确认用户角色为 `admin`
- 检查后端API是否返回权限错误
- 查看浏览器控制台和服务器日志

### 数据库错误
- 确认已运行数据库迁移
- 检查 `password` 字段是否存在
- 确认 `openId` 字段已改为可选


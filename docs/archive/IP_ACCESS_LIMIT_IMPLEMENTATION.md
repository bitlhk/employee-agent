# IP访问限制功能实现说明

## 功能概述

实现了基于IP维度的访问限制功能，对未注册用户进行每日访问次数限制，并记录所有访问日志。

## 主要功能

1. **IP访问统计**：记录所有IP的访问行为（包括登录、注册等操作）
2. **未注册用户限制**：未注册用户每天访问次数限制为10次（可后台配置）
3. **已注册用户**：已登录用户不受限制
4. **后台管理**：管理员可以查看IP访问日志和配置访问限制

## 数据库变更

### 新增表

1. **ip_access_logs** - IP访问统计表
   - 记录所有IP的访问记录
   - 包含IP地址、访问动作、路径、用户代理、用户ID等信息
   - 支持按IP和日期查询

2. **system_configs** - 系统配置表
   - 存储系统级别的配置项
   - 支持键值对存储（值可以是JSON或字符串）
   - 记录配置更新人和更新时间

### 迁移脚本

迁移脚本位置：`drizzle/0004_add_ip_access_logs_and_system_configs.sql`

执行迁移：
```bash
# 使用drizzle-kit生成迁移（如果使用自动生成）
pnpm run db:push

# 或手动执行SQL脚本
mysql -u username -p database_name < drizzle/0004_add_ip_access_logs_and_system_configs.sql
```

## 代码变更

### 1. Schema定义 (`drizzle/schema.ts`)

- 新增 `ipAccessLogs` 表定义
- 新增 `systemConfigs` 表定义

### 2. 数据库操作 (`server/db.ts`)

新增函数：
- `createIpAccessLog()` - 创建IP访问日志
- `getIpAccessCount()` - 获取指定时间范围内的IP访问次数
- `getIpAccessCountToday()` - 获取IP今日访问次数
- `getIpAccessLogsByIp()` - 根据IP获取访问记录
- `getAllIpAccessLogs()` - 获取所有IP访问记录
- `getSystemConfig()` - 获取系统配置
- `getSystemConfigValue()` - 获取系统配置值（字符串）
- `getSystemConfigNumber()` - 获取系统配置值（数字）
- `upsertSystemConfig()` - 更新或创建系统配置
- `getAllSystemConfigs()` - 获取所有系统配置

### 3. 路由逻辑 (`server/routers.ts`)

#### 修改的接口

1. **auth.login** - 登录接口
   - 在登录前检查IP访问限制
   - 记录访问日志

2. **auth.register** - 注册接口
   - 在注册前检查IP访问限制
   - 记录访问日志

#### 新增的接口

1. **ipAccessLogs.list** - 获取所有IP访问记录（管理员）
2. **ipAccessLogs.byIp** - 根据IP获取访问记录（管理员）
3. **ipAccessLogs.getTodayCount** - 获取指定IP今日访问次数（管理员）

4. **systemConfigs.list** - 获取所有系统配置（管理员）
5. **systemConfigs.get** - 获取单个系统配置（管理员）
6. **systemConfigs.upsert** - 更新或创建系统配置（管理员）
7. **systemConfigs.getUnregisteredDailyLimit** - 获取未注册用户每日访问限制（管理员）
8. **systemConfigs.setUnregisteredDailyLimit** - 设置未注册用户每日访问限制（管理员）

## 使用说明

### 1. 执行数据库迁移

```bash
# 确保数据库连接配置正确
# 执行迁移脚本
pnpm run db:push
```

### 2. 初始化系统配置

迁移脚本会自动创建默认配置：
- `unregistered_daily_limit`: 10（未注册用户每日访问限制）

### 3. 配置访问限制

管理员可以通过以下API配置访问限制：

```typescript
// 设置未注册用户每日访问限制为20次
await trpc.systemConfigs.setUnregisteredDailyLimit.mutate({ limit: 20 });

// 或直接更新配置
await trpc.systemConfigs.upsert.mutate({
  key: "unregistered_daily_limit",
  value: "20",
  description: "未注册用户每日访问次数限制"
});
```

### 4. 查看访问日志

管理员可以通过以下API查看访问日志：

```typescript
// 获取所有访问记录
const logs = await trpc.ipAccessLogs.list.query({ limit: 100 });

// 根据IP获取访问记录
const ipLogs = await trpc.ipAccessLogs.byIp.query({ 
  ip: "192.168.1.1", 
  limit: 50 
});

// 获取指定IP今日访问次数
const count = await trpc.ipAccessLogs.getTodayCount.query({ 
  ip: "192.168.1.1" 
});
```

## 访问限制逻辑

1. **已登录用户**：不受限制，所有访问都会被记录
2. **未登录用户**：
   - 每次访问登录/注册接口时，先检查今日访问次数
   - 如果今日访问次数 >= 配置的限制，拒绝访问并返回错误信息
   - 如果未超过限制，允许访问并记录日志
   - 即使被拒绝，也会记录这次尝试访问（用于统计）

## 错误处理

- 如果数据库操作失败，不会阻塞正常请求（允许访问）
- 所有错误都会记录到控制台，便于排查问题
- IP访问检查失败时，默认允许访问（避免影响正常用户）

## 注意事项

1. **IP获取**：从请求头 `x-forwarded-for`、`x-real-ip` 或 `socket.remoteAddress` 获取客户端IP
2. **时区**：访问次数统计基于服务器时区，按自然日（00:00-23:59）计算
3. **性能**：建议在 `ip_access_logs` 表的 `ip` 和 `createdAt` 字段上建立索引（迁移脚本已包含）
4. **数据清理**：建议定期清理旧的访问日志，避免表过大影响性能

## 后续优化建议

1. 添加访问日志的自动清理机制（保留最近N天的记录）
2. 添加IP访问频率限制（如：每分钟最多X次）
3. 添加IP访问异常检测（如：短时间内大量访问）
4. 添加访问日志的统计分析功能（如：按日期、按IP统计）


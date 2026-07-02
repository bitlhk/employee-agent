# MCP 上架交付清单

> 渤海银行财富经理助手 MCP 服务 v2.1.0
> 生成日期：2026-06-15

---

## 一、产品 MCP 服务

| 项目 | 内容 |
|------|------|
| **MCP 名称** | `wealth-assistant-product` |
| **中文显示名** | 银行产品信息查询服务 |
| **负责人** | 李文华 |
| **服务地址** | `http://<部署IP>:18007/mcp` |
| **健康检查地址** | `http://<部署IP>:18007/health` |
| **鉴权方式** | 服务端环境变量 `WEALTH_API_TOKEN`（JWT Bearer Token），由 MCP 服务内部携带访问后端 API，平台侧无需传 Token |
| **是否需要 agentId** | 是（支持，可选） |
| **agentId 读取位置** | Header: `x-linggan-agent-id` |
| **权限范围** | 内部 |
| **依赖系统** | 渤海银行 CRM 后端 API（`/api/products/*`、`/api/workstation/market-news`） |
| **异常处理说明** | 后端 API 超时 30s 返回 `API_TIMEOUT`；HTTP 错误返回 `API_{statusCode}` + 错误摘要（截取前200字符）；未知工具返回 `UNKNOWN_TOOL`；内部异常返回 `INTERNAL_ERROR` |
| **是否包含敏感数据** | 否（产品信息为公开/半公开数据，不含客户隐私） |

### 工具清单

#### 1. `wealth_assistant_product_info`

**描述**：获取银行产品详情（基金、理财等）

**输入 schema**：
```json
{
  "type": "object",
  "properties": {
    "productId": { "type": "number", "description": "产品 ID（必需）" }
  },
  "required": ["productId"]
}
```

**输出 schema**：
```json
{
  "ok": true,
  "data": {
    "id": 1,
    "name": "产品名称",
    "type": "基金",
    "riskRating": "R3",
    "issuer": "发行机构",
    "...": "其他产品字段"
  },
  "source": "wealth-assistant-product",
  "updatedAt": "2026-06-15T10:00:00.000Z"
}
```

**示例请求**：
```json
{ "productId": 1 }
```

**示例返回**：
```json
{
  "ok": true,
  "data": {
    "id": 1,
    "name": "渤海稳健1号",
    "type": "混合型基金",
    "riskRating": "R3",
    "issuer": "渤海银行",
    "minAmount": 10000,
    "term": "开放式"
  },
  "source": "wealth-assistant-product",
  "updatedAt": "2026-06-15T10:00:00.000Z"
}
```

---

#### 2. `wealth_assistant_product_search`

**描述**：搜索银行产品，支持关键词/类型/风险等级筛选

**输入 schema**：
```json
{
  "type": "object",
  "properties": {
    "keyword": { "type": "string", "description": "搜索关键词" },
    "type": { "type": "string", "description": "产品类型（基金/理财/存款等）" },
    "riskRating": { "type": "string", "description": "风险等级（R1-R5）" },
    "page": { "type": "number", "description": "页码" },
    "pageSize": { "type": "number", "description": "每页数量" }
  }
}
```

**输出 schema**：
```json
{
  "ok": true,
  "data": {
    "total": 50,
    "page": 1,
    "pageSize": 20,
    "items": [{ "id": 1, "name": "产品名", "type": "基金", "riskRating": "R3" }]
  },
  "source": "wealth-assistant-product",
  "updatedAt": "2026-06-15T10:00:00.000Z"
}
```

**示例请求**：
```json
{ "keyword": "稳健", "riskRating": "R2", "page": 1, "pageSize": 10 }
```

---

#### 3. `wealth_assistant_fund_info`

**描述**：根据基金代码获取简要信息

**输入 schema**：
```json
{
  "type": "object",
  "properties": {
    "fundCode": { "type": "string", "description": "基金代码（必需）" }
  },
  "required": ["fundCode"]
}
```

**输出 schema**：
```json
{
  "ok": true,
  "data": { "fundCode": "000001", "fundName": "基金名称", "fundType": "混合型" },
  "source": "wealth-assistant-product",
  "updatedAt": "2026-06-15T10:00:00.000Z"
}
```

**示例请求**：
```json
{ "fundCode": "000001" }
```

---

#### 4. `wealth_assistant_nav_history`

**描述**：获取基金净值历史（日/周/月/季度/年）

**输入 schema**：
```json
{
  "type": "object",
  "properties": {
    "productId": { "type": "number", "description": "产品 ID（必需）" },
    "dimensionType": { "type": "string", "enum": ["day","week","month","quarter","year"], "description": "时间维度，默认 quarter" }
  },
  "required": ["productId"]
}
```

**输出 schema**：
```json
{
  "ok": true,
  "data": { "productId": 1, "dimensionType": "quarter", "records": [{ "date": "2026-03-31", "nav": 1.2345 }] },
  "source": "wealth-assistant-product",
  "updatedAt": "2026-06-15T10:00:00.000Z"
}
```

**示例请求**：
```json
{ "productId": 1, "dimensionType": "month" }
```

---

#### 5. `wealth_assistant_wealth_product`

**描述**：获取理财产品详情

**输入 schema**：
```json
{
  "type": "object",
  "properties": {
    "productCode": { "type": "string", "description": "产品代码（必需）" }
  },
  "required": ["productCode"]
}
```

**输出 schema**：
```json
{
  "ok": true,
  "data": { "productCode": "WH001", "productName": "理财产品名", "expectedReturn": "4.5%" },
  "source": "wealth-assistant-product",
  "updatedAt": "2026-06-15T10:00:00.000Z"
}
```

**示例请求**：
```json
{ "productCode": "WH001" }
```

---

#### 6. `wealth_assistant_market_news`

**描述**：获取最新金融市场新闻

**输入 schema**：
```json
{ "type": "object", "properties": {} }
```

**输出 schema**：
```json
{
  "ok": true,
  "data": [{ "title": "新闻标题", "summary": "摘要", "publishDate": "2026-06-15", "source": "来源" }],
  "source": "wealth-assistant-product",
  "updatedAt": "2026-06-15T10:00:00.000Z"
}
```

**示例请求**：
```json
{}
```

---

## 二、客户 MCP 服务

| 项目 | 内容 |
|------|------|
| **MCP 名称** | `wealth-assistant-customer` |
| **中文显示名** | 银行客户信息查询服务 |
| **负责人** | 李文华 |
| **服务地址** | `http://<部署IP>:18008/mcp` |
| **健康检查地址** | `http://<部署IP>:18008/health` |
| **鉴权方式** | 服务端环境变量 `WEALTH_API_TOKEN`（JWT Bearer Token），由 MCP 服务内部携带访问后端 API，平台侧无需传 Token |
| **是否需要 agentId** | 是（支持，可选） |
| **agentId 读取位置** | Header: `x-linggan-agent-id` |
| **权限范围** | 内部 |
| **依赖系统** | 渤海银行 CRM 后端 API（`/api/customers/*`） |
| **异常处理说明** | 后端 API 超时 30s 返回 `API_TIMEOUT`；HTTP 错误返回 `API_{statusCode}` + 错误摘要；未知工具返回 `UNKNOWN_TOOL`；内部异常返回 `INTERNAL_ERROR` |
| **是否包含敏感数据** | 是（客户姓名、资产规模、风险等级等，仅限已授权客户经理可见范围） |

### 工具清单

#### 1. `wealth_assistant_context_probe`

**描述**：确认当前客户经理身份、角色和权限上下文。在执行任何客户相关操作前调用。

**输入 schema**：
```json
{ "type": "object", "properties": {} }
```

**输出 schema**：
```json
{
  "ok": true,
  "data": {
    "role": "客户经理",
    "agentId": "trial_lgc-xxxx",
    "permissions": ["customer_read", "product_read"],
    "dataScope": "当前客户经理可见客户",
    "verified": true
  },
  "source": "wealth-assistant-customer",
  "updatedAt": "2026-06-15T10:00:00.000Z"
}
```

**示例请求**：
```json
{}
```

**示例返回**：
```json
{
  "ok": true,
  "data": {
    "role": "客户经理",
    "agentId": "trial_lgc-shsmgtpept",
    "permissions": ["customer_read", "product_read"],
    "dataScope": "当前客户经理可见客户",
    "verified": true
  },
  "source": "wealth-assistant-customer",
  "updatedAt": "2026-06-15T10:00:00.000Z"
}
```

---

#### 2. `wealth_assistant_customer_list`

**描述**：获取客户列表，支持按姓名/编号/手机号搜索，支持分页。返回客户基本信息（姓名、风险等级、客户层级、资产规模等）。

**输入 schema**：
```json
{
  "type": "object",
  "properties": {
    "search": { "type": "string", "description": "搜索关键词（姓名/编号/手机号），留空返回全部" },
    "page": { "type": "number", "description": "页码，默认1" },
    "pageSize": { "type": "number", "description": "每页数量，默认20" }
  }
}
```

**输出 schema**：
```json
{
  "ok": true,
  "data": {
    "total": 100,
    "page": 1,
    "pageSize": 20,
    "items": [
      { "id": 1, "name": "王总", "riskLevel": "R3", "customerLevel": "白金", "aum": 5000000 }
    ]
  },
  "source": "wealth-assistant-customer",
  "updatedAt": "2026-06-15T10:00:00.000Z"
}
```

**示例请求**：
```json
{ "search": "王", "page": 1, "pageSize": 10 }
```

---

#### 3. `wealth_assistant_customer_detail`

**描述**：获取单个客户的完整画像，包括基本信息、资产信息、持有产品、到期产品、推荐产品等。

**输入 schema**：
```json
{
  "type": "object",
  "properties": {
    "customerId": { "type": "string", "description": "客户ID或客户编号（必需）" }
  },
  "required": ["customerId"]
}
```

**输出 schema**：
```json
{
  "ok": true,
  "data": {
    "id": 1,
    "name": "王总",
    "riskLevel": "R3",
    "customerLevel": "白金",
    "aum": 5000000,
    "assetInfo": { "totalAssets": 5000000 },
    "heldProducts": [],
    "expiringProducts": [],
    "recommendedProducts": [],
    "activityInfo": {}
  },
  "source": "wealth-assistant-customer",
  "updatedAt": "2026-06-15T10:00:00.000Z"
}
```

**示例请求**：
```json
{ "customerId": "1" }
```

---

## 三、部署配置

### 环境变量

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `WEALTH_API_BASE_URL` | 后端 API 地址 | `http://localhost:3001/api` |
| `WEALTH_API_TOKEN` | JWT 认证 Token | `eyJhbGciOi...` |
| `PRODUCT_MCP_PORT` | 产品 MCP 端口 | `18007` |
| `CUSTOMER_MCP_PORT` | 客户 MCP 端口 | `18008` |

### 启动命令

```bash
# 产品 MCP
WEALTH_API_TOKEN='your_token' WEALTH_API_BASE_URL='http://localhost:3001/api' PRODUCT_MCP_PORT=18007 node product-mcp-server/dist/index.js

# 客户 MCP
WEALTH_API_TOKEN='your_token' WEALTH_API_BASE_URL='http://localhost:3001/api' CUSTOMER_MCP_PORT=18008 node customer-mcp-server/dist/index.js
```

### 协议信息

- **传输协议**：MCP Streamable HTTP（无状态模式）
- **SDK 版本**：`@modelcontextprotocol/sdk ^1.0.4`
- **Node.js 要求**：`>=18.0.0`

### 软件包

- **文件名**：`mcp-servers-deploy-v2.1.zip`
- **大小**：28 MB（含 node_modules，开箱即用）
- **包内结构**：

```
mcp-servers-deploy/
├── product-mcp-server/
│   ├── dist/              # 编译好的 JS
│   ├── node_modules/      # 依赖（开箱即用）
│   └── package.json
├── customer-mcp-server/
│   ├── dist/
│   ├── node_modules/
│   └── package.json
├── DEPLOY_README.md               # 部署说明
├── MCP 上架交付清单.md             # 本文档
└── mcp-config-template.json       # OpenClaw 注册配置模板
```

# MCP: 行内贷款数据服务 (bank_loan_data_mcp)

## 概述
提供银行内部企业贷款全量数据查询能力（行内7 + 外部5 + 行业3 = 15个工具）。

## v2.1 改造
- 内置5家演示企业数据，支持一键测试
- 返回结果含 hint 字段，提示缺失数据需用户补充
- 返回结果含 meta 字段，标注数据来源（demo-data / user-input / public-api-pending）
- 外部数据优先公网API获取，失败降级内置演示数据

## 演示企业
| 企业 | 信用代码 | 行业 |
|------|---------|------|
| 鸿远建设集团 | 91370000726200000X | 建筑业(E) |
| 瑞丰新能源科技 | 91330100MA2H00000A | 制造业(C) |
| 德信商业地产 | 91440100MA5C00000B | 房地产业(K) |
| 盛达物流 | 91510000MA6D00000C | 交通运输(G) |
| 汇智科技 | 91320000MA7E00000D | 信息技术(I) |

## 返回格式
{
  "ok": true,
  "data": {...},
  "hint": "缺失字段提示（仅非演示企业）",
  "source": "demo-data|user-input|public-api-pending",
  "updatedAt": "2024-06-14T12:00:00",
  "isDemoData": true|false
}

## 部署
pip install -r requirements.txt
python server.py  # Streamable HTTP :8080

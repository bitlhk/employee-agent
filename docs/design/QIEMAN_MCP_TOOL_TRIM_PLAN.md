# Qieman MCP Tool Trim Plan

Status: deferred, 2026-06-19

## Conclusion

Qieman currently exposes 69 MCP tools. This is too large for default agent
context, especially in JiuwenSwarm where enabled MCP tools are injected into
each model call.

MVP recommendation: do not expose the raw `qieman` MCP server as a default role
grant. Qieman is paused until there is a concrete requirement and a slim surface
is implemented. If it is reintroduced later, start with 4 high-frequency tools
for 财富经理, based on current official/common usage:

| Keep | Tool | Why |
|---|---|---|
| 1 | `SearchFinancialNews` | 财经资讯搜索。 |
| 2 | `SearchFunds` | 搜索基金并匹配基金代码。 |
| 3 | `SearchManagerViewpoint` | 搜索基金经理观点和市场分析。 |
| 4 | `GetAssetAllocationPlan` | 根据投资三性参数获取资产配置方案。 |

Candidate alternates for later expansion: `BatchGetFundsDetail`,
`GetBatchFundPerformance`, `BatchGetFundNavHistory`, `DiagnoseFundPortfolio`.

## Implementation Note

The current runtime grants are server-level. If the raw `qieman` MCP server is
enabled, all 69 tools are visible to that runtime and the token cost is still
paid on every model call. To actually reduce context tokens, EA/runtime must
register only a slim Qieman surface that exposes the 4 selected tools. To
enforce this trim plan we need one of:

1. A Qieman gateway/proxy MCP that only exposes the selected tool subset.
2. Runtime-level per-tool filtering before tool schemas are sent to the model.
3. Upstream Qieman MCP support for server-side tool allowlists.

Until then, removing `qieman` from a role only removes the whole server; it does
not select individual tools.

## Full Tool Inventory

| # | Tool | Description |
|---:|---|---|
| 1 | `getFundCampisiIndicator` | 获取基金债券收益归因（Campisi）数据，包括收入效应、国债效应、利差效应、券种选择效应和超额回报 |
| 2 | `getFundBenchmarkInfo` | 通过基金代码查询基金的业绩基准信息 |
| 3 | `getBondAllocationByFundCode` | 获取指定债券型基金在指定时间区间下的券种配置和风格配置数据 |
| 4 | `getFundTurnoverRate` | 获取指定基金在指定时间区间下的换手率数据 |
| 5 | `getFundIndustryPreference` | 获取指定基金在指定时间段内的行业偏好 |
| 6 | `getBondIndicator` | 获取基金的债券相关指标数据，包括敏感性久期、杠杆水平、债券持仓集中度等 |
| 7 | `getFundIndustryReturns` | 获取指定基金在指定时间区间下每个一级行业的行业名称、绝对收益、相对收益、收益率、收益率得分 |
| 8 | `filterStockFundByStockTurnover` | 根据股票换手率指标筛选基金 |
| 9 | `BatchGetFundTradeLimit` | 批量获取基金交易限制信息，返回申购、认购、赎回、转换是否可用及金额限制 |
| 10 | `getMarketTimingIndicator` | 获取基金择时相关指标，包括择时总胜率、择时贡献等 |
| 11 | `getFundDiveCount` | 获取指定基金在指定时间段内的跳水次数和异动次数 |
| 12 | `fund-sector-preference` | 获取基金板块配置偏好数据 |
| 13 | `getFundIndustryConcentration` | 获取基金前 5 大中信一级行业集中度及加总集中度 |
| 14 | `BatchGetFundsDividendRecord` | 批量返回基金分红记录 |
| 15 | `BatchGetFundNavHistory` | 批量返回基金历史净值，包括单位净值、累计净值、日涨跌 |
| 16 | `GetBatchFundPerformance` | 批量返回基金业绩表现、风险控制、阶段收益等数据 |
| 17 | `BatchGetFundTradeRules` | 查询基金申购、认购、赎回、转换等交易规则 |
| 18 | `getStockAllocationAndMetricsByFundCode` | 获取股票型基金股票配置、估值盈利指标、财务指标和抱团股数据 |
| 19 | `getFundIndustryAllocation` | 获取基金所有中信一级行业配置比例、行业代码和名称 |
| 20 | `getBondFundCreditRatingLevel` | 获取债券基金信用评级数据 |
| 21 | `getBondFundWithAlertRecord` | 查询出现异动和跳水告警的债券型基金 |
| 22 | `filterBondFundByBondType` | 根据券种风格筛选债券基金 |
| 23 | `fund-equity-position` | 获取基金权益仓位数据 |
| 24 | `GetPopularFund` | 返回近期访问数量靠前的基金 |
| 25 | `fund-recovery-ability` | 获取基金回撤修复能力数据 |
| 26 | `BatchGetFundsDetail` | 返回基金基本概况、经理、业绩、持仓、资产配置、行业分布、净值历史、交易限制等完整数据 |
| 27 | `filterBondFundByCreditRating` | 根据信用评级筛选基金 |
| 28 | `getFundBrinsonIndicator` | 获取基金股票收益归因（Brinson）数据 |
| 29 | `BatchGetFundsSplitHistory` | 批量返回基金拆分记录 |
| 30 | `getQdFundAreaAllocation` | 获取 QDII 基金地区配置比例 |
| 31 | `RenderHtmlToPdf` | 将 HTML 转换为 PDF 并返回 URL |
| 32 | `RenderEchart` | 根据 ECharts 配置渲染图表并返回图片 URL |
| 33 | `BatchGetStrategiesComposition` | 批量获取组合策略当前持仓明细 |
| 34 | `BatchGetPoTradeComposition` | 批量获取交易成分明细 |
| 35 | `GetStrategyDetails` | 查询组合策略详情 |
| 36 | `StrategySearchByKeyword` | 按关键词搜索组合策略 |
| 37 | `GetTxnDayRange` | 获取某时间附近交易日范围 |
| 38 | `GetCurrentTime` | 获取当前时间 |
| 39 | `SearchHotTopic` | 搜索市场热点和热榜内容 |
| 40 | `SearchFinancialNews` | 按关键词和时间范围搜索财经资讯 |
| 41 | `searchRealtimeAiAnalysis` | 搜索 AI 生成的实时资讯解读 |
| 42 | `SearchManagerViewpoint` | 搜索基金经理行业观点和市场分析 |
| 43 | `searchInvestAdvisorContent` | 搜索金融文章、观点、话题和讨论内容 |
| 44 | `GetStrategyAssetClassAnalysis` | 获取策略持仓穿透后的资产大类分布 |
| 45 | `GetFundRelatedStrategies` | 查询重仓某基金的投顾策略 |
| 46 | `GetStrategyBenchmark` | 获取策略业绩基准 |
| 47 | `GetStrategyRiskInfo` | 获取策略风险信息 |
| 48 | `AnalyzeFundRisk` | 获取多个基金风险评分及说明 |
| 49 | `GetFundsBackTest` | 基于基金列表做回测分析 |
| 50 | `MonteCarloSimulate` | 对资产配置组合做蒙特卡洛模拟 |
| 51 | `AnalyzePortfolioRisk` | 计算组合风险指标 |
| 52 | `GetLatestQuotations` | 获取并解读市场行情和市场温度计 |
| 53 | `GetAssetAllocation` | 获取基金组合资产配置分析 |
| 54 | `GetFundAssetClassAnalysis` | 穿透分析基金持仓的资产大类分布 |
| 55 | `GetFundsCorrelation` | 获取基金相关性分析 |
| 56 | `GetAssetAllocationPlan` | 根据投资三性参数获取资产配置方案 |
| 57 | `AnalyzeInvestmentPerformance` | 分析投资方案表现和权重可行性 |
| 58 | `AnalyzeIncomeExpense` | 分析收入支出和预算结构 |
| 59 | `DiagnoseFundPortfolio` | 全面诊断基金持仓组合，覆盖资产配置、相关性和历史回测 |
| 60 | `AnalyzeFinancialIndicators` | 分析资产负债率、流动比率等财务指标 |
| 61 | `AnalyzeAssetLiability` | 分析用户资产负债结构 |
| 62 | `AnalyzeFamilyMembers` | 分析家庭成员结构和生命周期 |
| 63 | `AnalyzeCashFlow` | 分析家庭现金流并生成年度数据 |
| 64 | `BatchGetStrategyRiskInfo` | 批量获取策略风险信息 |
| 65 | `GetCompositeModel` | 根据资产配置方案 ID 获取复合模型 |
| 66 | `GetPortfolioNavHistory` | 查询组合历史净值 |
| 67 | `GetFundDiagnosis` | 获取基金诊断信息 |
| 68 | `SearchFunds` | 搜索基金并匹配基金代码 |
| 69 | `GuessFundCode` | 根据基金名称匹配最相近基金代码 |

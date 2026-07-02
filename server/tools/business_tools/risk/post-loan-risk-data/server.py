#!/usr/bin/env python3
"""
MCP Server: 行内贷款数据服务 (bank_loan_data_mcp)
数据获取策略：
- 外部数据：优先公网API，失败则查内置演示数据
- 行内数据：优先内置演示数据，缺失时返回缺失提示
- 行业数据：优先公网，失败则内置基准
"""
from typing import Optional, List, Dict, Any
from enum import Enum
from datetime import datetime
import json, httpx, os
from pydantic import BaseModel, Field, ConfigDict
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("bank_loan_data_mcp")
API_TIMEOUT = 15.0

DEMO_ENTERPRISES = {
  "91370000726200000X": {"profile":{"enterprise_name":"鸿远建设集团有限公司","industry_code":"E","industry_name":"建筑业","ownership_type":"民营","registered_capital":50000,"establishment_date":"2003-06-15","legal_person":"张鸿远","enterprise_scale":"中型","operating_status":"在营"},"loan_accounts":[{"loan_id":"LN20230001","loan_balance":15000,"credit_limit":25000,"five_level_class":"关注","overdue_days":0,"product_type":"流动资金贷款","interest_rate":4.35,"maturity_date":"2025-12-31"},{"loan_id":"LN20230002","loan_balance":8000,"credit_limit":10000,"five_level_class":"正常","overdue_days":0,"product_type":"固定资产贷款","interest_rate":4.75,"maturity_date":"2026-06-30"},{"loan_id":"LN20220003","loan_balance":5000,"credit_limit":15000,"five_level_class":"关注","overdue_days":5,"product_type":"银行承兑汇票","interest_rate":0,"maturity_date":"2025-09-30"}],"financial":{"years":["2023","2022","2021"],"total_assets":[120000,115000,108000],"total_liabilities":[84000,80000,74000],"current_ratio":[1.15,1.20,1.28],"dscr":[1.08,1.15,1.22],"operating_cashflow":[3500,4200,5100],"net_profit":[2800,3200,3800],"revenue":[65000,72000,80000]},"repayment":{"total_overdue_count":3,"max_overdue_days":15,"recent_6m_overdue_count":1,"consecutive_normal_months":4,"records":[{"month":"2024-01","due":500,"actual":500,"overdue_days":0},{"month":"2023-12","due":500,"actual":500,"overdue_days":0},{"month":"2023-11","due":500,"actual":495,"overdue_days":5}]},"collaterals":[{"type":"房产抵押","original_value":20000,"current_value":18000,"coverage_ratio":0.72,"loan_id":"LN20230001"},{"type":"应收账款质押","original_value":8000,"current_value":7500,"coverage_ratio":0.30,"loan_id":"LN20230002"}],"guarantors":[{"name":"张鸿远","type":"个人保证","amount":20000,"is_dishonest":False,"relation":"实控人"},{"name":"鸿远实业发展有限公司","type":"企业保证","amount":15000,"is_dishonest":False,"relation":"关联企业"}],"credit_rating":{"internal_rating":"BBB","rating_date":"2024-03-15","external_rating":"AA-","rating_score":65,"previous_rating":"A","score_model":"v3.0"},"judicial":{"total_cases":2,"total_amount":800,"has_frozen_assets":False,"frozen_amount":0,"cases":[{"case_no":"(2024)鲁01民初123号","role":"被告","amount":500,"status":"审理中","type":"合同纠纷"},{"case_no":"(2023)鲁01执456号","role":"被执行人","amount":300,"status":"部分执行","type":"工程款"}]},"opinion":{"negative_count":3,"has_major_negative":True,"opinions":[{"date":"2024-05-10","source":"财经网","title":"鸿远建设项目停工传闻","severity":"中"},{"date":"2024-03-22","source":"新浪财经","title":"建筑业回款难鸿远建设现金流承压","severity":"中"}]},"business_abnormal":{"has_abnormal":False,"abnormal_records":[],"has_serious_violation":False},"tax":{"tax_credit_rating":"B","has_arrears":False,"annual_tax":[{"year":"2023","amount":1200}]},"dishonest":{"is_dishonest":False,"dishonest_records":[],"related_dishonest":[]}},
  "91330100MA2H00000A": {"profile":{"enterprise_name":"瑞丰新能源科技有限公司","industry_code":"C","industry_name":"制造业","ownership_type":"民营","registered_capital":80000,"establishment_date":"2010-03-20","legal_person":"李瑞丰","enterprise_scale":"大型","operating_status":"在营"},"loan_accounts":[{"loan_id":"LN20240001","loan_balance":30000,"credit_limit":50000,"five_level_class":"正常","overdue_days":0,"product_type":"流动资金贷款","interest_rate":3.85,"maturity_date":"2026-12-31"}],"financial":{"years":["2023","2022","2021"],"total_assets":[500000,450000,400000],"total_liabilities":[250000,230000,210000],"current_ratio":[2.10,2.05,1.95],"dscr":[2.50,2.35,2.20],"operating_cashflow":[45000,38000,32000],"net_profit":[35000,28000,22000],"revenue":[200000,170000,140000]},"repayment":{"total_overdue_count":0,"max_overdue_days":0,"recent_6m_overdue_count":0,"consecutive_normal_months":24,"records":[]},"collaterals":[{"type":"房产抵押","original_value":60000,"current_value":65000,"coverage_ratio":2.17,"loan_id":"LN20240001"}],"guarantors":[{"name":"李瑞丰","type":"个人保证","amount":30000,"is_dishonest":False,"relation":"实控人"}],"credit_rating":{"internal_rating":"AA","rating_date":"2024-06-01","external_rating":"AA+","rating_score":88,"previous_rating":"AA","score_model":"v3.0"},"judicial":{"total_cases":0,"total_amount":0,"has_frozen_assets":False,"frozen_amount":0,"cases":[]},"opinion":{"negative_count":0,"has_major_negative":False,"opinions":[]},"business_abnormal":{"has_abnormal":False,"abnormal_records":[],"has_serious_violation":False},"tax":{"tax_credit_rating":"A","has_arrears":False,"annual_tax":[{"year":"2023","amount":8500}]},"dishonest":{"is_dishonest":False,"dishonest_records":[],"related_dishonest":[]}},
  "91440100MA5C00000B": {"profile":{"enterprise_name":"德信商业地产开发有限公司","industry_code":"K","industry_name":"房地产业","ownership_type":"民营","registered_capital":100000,"establishment_date":"2008-09-10","legal_person":"王德信","enterprise_scale":"大型","operating_status":"在营"},"loan_accounts":[{"loan_id":"LN20210001","loan_balance":80000,"credit_limit":120000,"five_level_class":"关注","overdue_days":0,"product_type":"开发贷款","interest_rate":5.20,"maturity_date":"2025-12-31"},{"loan_id":"LN20220002","loan_balance":20000,"credit_limit":30000,"five_level_class":"次级","overdue_days":35,"product_type":"经营性物业贷款","interest_rate":4.90,"maturity_date":"2025-06-30"}],"financial":{"years":["2023","2022","2021"],"total_assets":[350000,380000,400000],"total_liabilities":[280000,290000,300000],"current_ratio":[0.85,0.92,1.05],"dscr":[0.75,0.88,1.10],"operating_cashflow":[-5000,-2000,3000],"net_profit":[-8000,-3000,2000],"revenue":[45000,55000,70000]},"repayment":{"total_overdue_count":5,"max_overdue_days":35,"recent_6m_overdue_count":2,"consecutive_normal_months":2,"records":[{"month":"2024-05","due":2000,"actual":0,"overdue_days":35},{"month":"2024-04","due":2000,"actual":2000,"overdue_days":0}]},"collaterals":[{"type":"土地使用权抵押","original_value":150000,"current_value":110000,"coverage_ratio":1.10,"loan_id":"LN20210001"},{"type":"在建工程抵押","original_value":50000,"current_value":35000,"coverage_ratio":1.75,"loan_id":"LN20220002"}],"guarantors":[{"name":"王德信","type":"个人保证","amount":50000,"is_dishonest":False,"relation":"实控人"},{"name":"德信控股集团","type":"企业保证","amount":80000,"is_dishonest":True,"relation":"母公司"}],"credit_rating":{"internal_rating":"BB","rating_date":"2024-04-20","external_rating":"BBB","rating_score":45,"previous_rating":"BBB","score_model":"v3.0"},"judicial":{"total_cases":5,"total_amount":3500,"has_frozen_assets":True,"frozen_amount":2000,"cases":[{"case_no":"(2024)粤01民初789号","role":"被告","amount":1500,"status":"审理中","type":"工程款纠纷"},{"case_no":"(2024)粤01执012号","role":"被执行人","amount":800,"status":"未执行","type":"供应商货款"}]},"opinion":{"negative_count":8,"has_major_negative":True,"opinions":[{"date":"2024-06-01","source":"21世纪经济报道","title":"德信商业地产项目烂尾业主维权","severity":"高"},{"date":"2024-05-15","source":"财新网","title":"德信控股被列为失信被执行人","severity":"高"}]},"business_abnormal":{"has_abnormal":True,"abnormal_records":[{"type":"列入经营异常名录","reason":"未按规定公示年度报告","date":"2024-03-15"}],"has_serious_violation":False},"tax":{"tax_credit_rating":"C","has_arrears":True,"annual_tax":[{"year":"2023","amount":500}]},"dishonest":{"is_dishonest":False,"dishonest_records":[],"related_dishonest":[{"name":"德信控股集团","case_no":"(2024)粤01执012号","amount":800}]}},
  "91510000MA6D00000C": {"profile":{"enterprise_name":"盛达物流有限公司","industry_code":"G","industry_name":"交通运输仓储业","ownership_type":"民营","registered_capital":30000,"establishment_date":"2015-04-08","legal_person":"陈盛达","enterprise_scale":"中型","operating_status":"在营"},"loan_accounts":[{"loan_id":"LN20230004","loan_balance":12000,"credit_limit":20000,"five_level_class":"正常","overdue_days":0,"product_type":"流动资金贷款","interest_rate":4.10,"maturity_date":"2025-12-31"}],"financial":{"years":["2023","2022","2021"],"total_assets":[80000,75000,70000],"total_liabilities":[48000,45000,42000],"current_ratio":[1.45,1.50,1.55],"dscr":[1.60,1.70,1.80],"operating_cashflow":[8000,7500,7000],"net_profit":[5000,4500,4000],"revenue":[55000,50000,45000]},"repayment":{"total_overdue_count":1,"max_overdue_days":3,"recent_6m_overdue_count":0,"consecutive_normal_months":8,"records":[]},"collaterals":[{"type":"车辆抵押","original_value":8000,"current_value":6000,"coverage_ratio":0.50,"loan_id":"LN20230004"},{"type":"房产抵押","original_value":10000,"current_value":9500,"coverage_ratio":0.79,"loan_id":"LN20230004"}],"guarantors":[{"name":"陈盛达","type":"个人保证","amount":12000,"is_dishonest":False,"relation":"实控人"}],"credit_rating":{"internal_rating":"A","rating_date":"2024-05-10","external_rating":"A","rating_score":75,"previous_rating":"A","score_model":"v3.0"},"judicial":{"total_cases":1,"total_amount":200,"has_frozen_assets":False,"frozen_amount":0,"cases":[{"case_no":"(2023)川01民初456号","role":"原告","amount":200,"status":"已结案","type":"运输合同纠纷"}]},"opinion":{"negative_count":1,"has_major_negative":False,"opinions":[{"date":"2024-02-10","source":"当地晚报","title":"盛达物流车队事故致货物受损","severity":"低"}]},"business_abnormal":{"has_abnormal":False,"abnormal_records":[],"has_serious_violation":False},"tax":{"tax_credit_rating":"B","has_arrears":False,"annual_tax":[{"year":"2023","amount":800}]},"dishonest":{"is_dishonest":False,"dishonest_records":[],"related_dishonest":[]}},
  "91320000MA7E00000D": {"profile":{"enterprise_name":"汇智科技股份有限公司","industry_code":"I","industry_name":"信息技术服务业","ownership_type":"民营","registered_capital":60000,"establishment_date":"2012-11-25","legal_person":"刘汇智","enterprise_scale":"中型","operating_status":"在营"},"loan_accounts":[{"loan_id":"LN20240005","loan_balance":18000,"credit_limit":30000,"five_level_class":"正常","overdue_days":0,"product_type":"流动资金贷款","interest_rate":3.95,"maturity_date":"2026-06-30"}],"financial":{"years":["2023","2022","2021"],"total_assets":[200000,180000,160000],"total_liabilities":[100000,90000,80000],"current_ratio":[1.80,1.75,1.70],"dscr":[1.90,1.85,1.75],"operating_cashflow":[15000,12000,10000],"net_profit":[12000,9000,7000],"revenue":[100000,80000,65000]},"repayment":{"total_overdue_count":0,"max_overdue_days":0,"recent_6m_overdue_count":0,"consecutive_normal_months":18,"records":[]},"collaterals":[{"type":"知识产权质押","original_value":5000,"current_value":4500,"coverage_ratio":0.25,"loan_id":"LN20240005"},{"type":"房产抵押","original_value":15000,"current_value":14000,"coverage_ratio":0.78,"loan_id":"LN20240005"}],"guarantors":[{"name":"刘汇智","type":"个人保证","amount":18000,"is_dishonest":False,"relation":"实控人"}],"credit_rating":{"internal_rating":"A-","rating_date":"2024-06-01","external_rating":"A","rating_score":78,"previous_rating":"BBB+","score_model":"v3.0"},"judicial":{"total_cases":0,"total_amount":0,"has_frozen_assets":False,"frozen_amount":0,"cases":[]},"opinion":{"negative_count":0,"has_major_negative":False,"opinions":[]},"business_abnormal":{"has_abnormal":False,"abnormal_records":[],"has_serious_violation":False},"tax":{"tax_credit_rating":"A","has_arrears":False,"annual_tax":[{"year":"2023","amount":3200}]},"dishonest":{"is_dishonest":False,"dishonest_records":[],"related_dishonest":[]}},
}

DEMO_INDUSTRY = {"E":{"industry_name":"建筑业","benchmark":{"dscr_mean":1.30,"current_ratio_mean":1.25,"debt_ratio_mean":0.68,"roe_mean":0.08},"rating":{"risk_level":"关注","cycle_position":"收缩期","prosperity_index":45,"policy_risk":"中性","capacity_utilization":0.72}},"C":{"industry_name":"制造业","benchmark":{"dscr_mean":1.80,"current_ratio_mean":1.60,"debt_ratio_mean":0.55,"roe_mean":0.12},"rating":{"risk_level":"低风险","cycle_position":"扩张期","prosperity_index":65,"policy_risk":"鼓励","capacity_utilization":0.82}},"K":{"industry_name":"房地产业","benchmark":{"dscr_mean":0.90,"current_ratio_mean":1.00,"debt_ratio_mean":0.78,"roe_mean":0.03},"rating":{"risk_level":"高风险","cycle_position":"深度收缩","prosperity_index":30,"policy_risk":"限制","capacity_utilization":0.55}},"G":{"industry_name":"交通运输仓储业","benchmark":{"dscr_mean":1.50,"current_ratio_mean":1.40,"debt_ratio_mean":0.60,"roe_mean":0.09},"rating":{"risk_level":"关注","cycle_position":"平稳期","prosperity_index":55,"policy_risk":"中性","capacity_utilization":0.75}},"I":{"industry_name":"信息技术服务业","benchmark":{"dscr_mean":2.00,"current_ratio_mean":1.80,"debt_ratio_mean":0.45,"roe_mean":0.15},"rating":{"risk_level":"低风险","cycle_position":"扩张期","prosperity_index":70,"policy_risk":"鼓励","capacity_utilization":0.85}}}

DEMO_MACRO = {"GDP":{"latest":5.2,"trend":"平稳","unit":"%"},"PMI":{"latest":50.4,"trend":"微升","unit":""},"CPI":{"latest":0.7,"trend":"低位","unit":"%"},"PPI":{"latest":-2.5,"trend":"通缩","unit":"%"},"LPR":{"latest":3.45,"trend":"下行","unit":"%"},"M2":{"latest":7.2,"trend":"放缓","unit":"%"}}

class UnifiedSocialCodeInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True, extra="forbid")
    unified_social_code: str = Field(..., description="统一社会信用代码（18位，必填）", min_length=18, max_length=18)

class EnterpriseNameInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True, extra="forbid")
    unified_social_code: str = Field(..., description="统一社会信用代码（18位，必填）", min_length=18, max_length=18)
    enterprise_name: str = Field(default="", description="企业名称（可选）", max_length=200)

class ConsolidateFlag(str, Enum): MERGED="合并"; PARENT="母公司"
class CaseType(str, Enum): ALL="全部"; LITIGATION="诉讼"; EXECUTION="执行"; FREEZE="冻结"
class Sentiment(str, Enum): ALL="全部"; NEGATIVE="负面"; POSITIVE="正面"; NEUTRAL="中性"
class IndicatorType(str, Enum): ALL="全部"; GDP="GDP"; PMI="PMI"; CPI="CPI"; PPI="PPI"; LPR="LPR"; M2="M2"

def _meta(src, demo=False): return {"source": src, "updatedAt": datetime.now().isoformat(), "isDemoData": demo}
def _get_demo(usc, key):
    e = DEMO_ENTERPRISES.get(usc); return e.get(key) if e else None
def _hint(dom, flds): return f"⚠️【{dom}】以下字段缺失，请在对话中补充以提升评估准确性：{', '.join(flds)}"

# ── 行内数据域（7个工具）──

@mcp.tool(name="get_enterprise_profile", annotations={"title":"获取企业基本画像","readOnlyHint":True,"destructiveHint":False,"idempotentHint":True,"openWorldHint":True})
async def get_enterprise_profile(params: EnterpriseNameInput) -> str:
    """获取企业基本画像。演示企业有内置数据；其他企业返回骨架+缺失提示。"""
    d = _get_demo(params.unified_social_code, "profile")
    if d: return json.dumps({"ok":True,"data":d,**_meta("demo-data",True)}, ensure_ascii=False, indent=2)
    return json.dumps({"ok":True,"data":{"enterprise_name":params.enterprise_name or "请提供","unified_social_code":params.unified_social_code,"industry_code":None,"industry_name":None,"ownership_type":None,"registered_capital":None,"establishment_date":None,"legal_person":None,"enterprise_scale":None,"operating_status":None},"hint":_hint("企业画像",["industry_code","ownership_type","registered_capital","enterprise_scale","operating_status"]),**_meta("user-input",False)}, ensure_ascii=False, indent=2)

@mcp.tool(name="get_loan_account", annotations={"title":"获取企业贷款账户信息","readOnlyHint":True,"destructiveHint":False,"idempotentHint":True,"openWorldHint":False})
async def get_loan_account(unified_social_code: str=Field(...,description="统一社会信用代码",min_length=18,max_length=18), include_closed: bool=Field(default=False,description="是否包含已结清贷款")) -> str:
    """获取贷款账户信息。行内数据，演示企业可返回，否则提示补充。"""
    d = _get_demo(unified_social_code, "loan_accounts")
    if d is not None: return json.dumps({"ok":True,"data":d,**_meta("demo-data",True)}, ensure_ascii=False, indent=2)
    return json.dumps({"ok":True,"data":[],"hint":_hint("贷款账户",["loan_balance","credit_limit","five_level_class","overdue_days","product_type","maturity_date"]),**_meta("user-input",False)}, ensure_ascii=False, indent=2)

@mcp.tool(name="get_financial_statements", annotations={"title":"获取企业财务报表","readOnlyHint":True,"destructiveHint":False,"idempotentHint":True,"openWorldHint":True})
async def get_financial_statements(unified_social_code: str=Field(...,description="统一社会信用代码",min_length=18,max_length=18), years: int=Field(default=3,description="获取年数",ge=1,le=5), consolidate_flag: ConsolidateFlag=Field(default=ConsolidateFlag.MERGED,description="合并/母公司口径")) -> str:
    """获取财务报表。演示企业有内置数据；否则提示补充。"""
    d = _get_demo(unified_social_code, "financial")
    if d: return json.dumps({"ok":True,"data":d,**_meta("demo-data",True)}, ensure_ascii=False, indent=2)
    return json.dumps({"ok":True,"data":{},"hint":_hint("财务报表",["total_assets","total_liabilities","current_ratio","dscr","operating_cashflow","net_profit","revenue"]),**_meta("user-input",False)}, ensure_ascii=False, indent=2)

@mcp.tool(name="get_repayment_history", annotations={"title":"获取企业还款历史","readOnlyHint":True,"destructiveHint":False,"idempotentHint":True,"openWorldHint":False})
async def get_repayment_history(unified_social_code: str=Field(...,description="统一社会信用代码",min_length=18,max_length=18), months: int=Field(default=24,description="获取最近N个月",ge=1,le=60)) -> str:
    """获取还款历史。行内数据，演示企业可返回，否则提示补充。"""
    d = _get_demo(unified_social_code, "repayment")
    if d: return json.dumps({"ok":True,"data":d.get("records",[]),"summary":{k:v for k,v in d.items() if k!="records"},**_meta("demo-data",True)}, ensure_ascii=False, indent=2)
    return json.dumps({"ok":True,"data":[],"summary":{"total_overdue_count":None,"max_overdue_days":None,"recent_6m_overdue_count":None,"consecutive_normal_months":None},"hint":_hint("还款历史",["total_overdue_count","max_overdue_days","recent_6m_overdue_count","consecutive_normal_months"]),**_meta("user-input",False)}, ensure_ascii=False, indent=2)

@mcp.tool(name="get_collateral_info", annotations={"title":"获取抵质押物信息","readOnlyHint":True,"destructiveHint":False,"idempotentHint":True,"openWorldHint":False})
async def get_collateral_info(unified_social_code: str=Field(...,description="统一社会信用代码",min_length=18,max_length=18), loan_id: str=Field(default="",description="贷款账号（可选）",max_length=30)) -> str:
    """获取抵质押物信息。行内数据，演示企业可返回，否则提示补充。"""
    d = _get_demo(unified_social_code, "collaterals")
    if d is not None: return json.dumps({"ok":True,"data":d,**_meta("demo-data",True)}, ensure_ascii=False, indent=2)
    return json.dumps({"ok":True,"data":[],"hint":_hint("抵质押物",["type","current_value","coverage_ratio"]),**_meta("user-input",False)}, ensure_ascii=False, indent=2)

@mcp.tool(name="get_guarantor_info", annotations={"title":"获取担保人信息","readOnlyHint":True,"destructiveHint":False,"idempotentHint":True,"openWorldHint":False})
async def get_guarantor_info(unified_social_code: str=Field(...,description="统一社会信用代码",min_length=18,max_length=18), loan_id: str=Field(default="",description="贷款账号（可选）",max_length=30)) -> str:
    """获取担保人信息。行内数据，演示企业可返回，否则提示补充。"""
    d = _get_demo(unified_social_code, "guarantors")
    if d is not None: return json.dumps({"ok":True,"data":d,**_meta("demo-data",True)}, ensure_ascii=False, indent=2)
    return json.dumps({"ok":True,"data":[],"hint":_hint("担保人",["name","type","amount","is_dishonest"]),**_meta("user-input",False)}, ensure_ascii=False, indent=2)

@mcp.tool(name="get_credit_rating", annotations={"title":"获取企业信用评级","readOnlyHint":True,"destructiveHint":False,"idempotentHint":True,"openWorldHint":False})
async def get_credit_rating(params: UnifiedSocialCodeInput) -> str:
    """获取信用评级。演示企业有内置数据；否则提示补充。"""
    d = _get_demo(params.unified_social_code, "credit_rating")
    if d: return json.dumps({"ok":True,"data":d,**_meta("demo-data",True)}, ensure_ascii=False, indent=2)
    return json.dumps({"ok":True,"data":{"internal_rating":None,"rating_date":None,"external_rating":None,"rating_score":None,"previous_rating":None,"score_model":None},"hint":_hint("信用评级",["internal_rating","rating_score"]),**_meta("user-input",False)}, ensure_ascii=False, indent=2)

# ── 外部风险数据域（5个工具）──

@mcp.tool(name="get_judicial_info", annotations={"title":"获取司法诉讼与执行信息","readOnlyHint":True,"destructiveHint":False,"idempotentHint":True,"openWorldHint":True})
async def get_judicial_info(unified_social_code: str=Field(...,description="统一社会信用代码",min_length=18,max_length=18), case_type: CaseType=Field(default=CaseType.ALL,description="案件类型：全部/诉讼/执行/冻结"), months: int=Field(default=12,description="获取最近N个月",ge=1,le=60)) -> str:
    """获取司法诉讼与执行信息。优先公网API，降级内置演示数据。"""
    d = _get_demo(unified_social_code, "judicial")
    if d: return json.dumps({"ok":True,"data":d,**_meta("demo-data",True)}, ensure_ascii=False, indent=2)
    return json.dumps({"ok":True,"data":{"total_cases":0,"total_amount":0,"has_frozen_assets":False,"frozen_amount":0,"cases":[]},"hint":"非演示企业，公网API待接入，请补充司法信息或确认无涉诉",**_meta("public-api-pending",False)}, ensure_ascii=False, indent=2)

@mcp.tool(name="get_public_opinion", annotations={"title":"获取企业舆情信息","readOnlyHint":True,"destructiveHint":False,"idempotentHint":True,"openWorldHint":True})
async def get_public_opinion(unified_social_code: str=Field(...,description="统一社会信用代码",min_length=18,max_length=18), sentiment: Sentiment=Field(default=Sentiment.NEGATIVE,description="情感过滤"), days: int=Field(default=90,description="获取最近N天",ge=1,le=365)) -> str:
    """获取舆情信息。优先公网API，降级内置演示数据。"""
    d = _get_demo(unified_social_code, "opinion")
    if d: return json.dumps({"ok":True,"data":d,**_meta("demo-data",True)}, ensure_ascii=False, indent=2)
    return json.dumps({"ok":True,"data":{"negative_count":0,"has_major_negative":False,"opinions":[]},"hint":"非演示企业，公网舆情API待接入",**_meta("public-api-pending",False)}, ensure_ascii=False, indent=2)

@mcp.tool(name="get_business_abnormal", annotations={"title":"获取企业经营异常信息","readOnlyHint":True,"destructiveHint":False,"idempotentHint":True,"openWorldHint":True})
async def get_business_abnormal(params: UnifiedSocialCodeInput) -> str:
    """获取经营异常信息。优先国家企业信用信息公示系统，降级内置演示数据。"""
    d = _get_demo(params.unified_social_code, "business_abnormal")
    if d: return json.dumps({"ok":True,"data":d,**_meta("demo-data",True)}, ensure_ascii=False, indent=2)
    return json.dumps({"ok":True,"data":{"has_abnormal":None,"abnormal_records":[],"has_serious_violation":None},"hint":"非演示企业，请确认该企业是否有经营异常记录",**_meta("public-api-pending",False)}, ensure_ascii=False, indent=2)

@mcp.tool(name="get_tax_info", annotations={"title":"获取企业税务信息","readOnlyHint":True,"destructiveHint":False,"idempotentHint":True,"openWorldHint":True})
async def get_tax_info(unified_social_code: str=Field(...,description="统一社会信用代码",min_length=18,max_length=18), years: int=Field(default=2,description="获取年数",ge=1,le=5)) -> str:
    """获取税务信息。演示企业有内置数据；否则提示补充。"""
    d = _get_demo(unified_social_code, "tax")
    if d: return json.dumps({"ok":True,"data":d,**_meta("demo-data",True)}, ensure_ascii=False, indent=2)
    return json.dumps({"ok":True,"data":{"tax_credit_rating":None,"has_arrears":None,"annual_tax":[]},"hint":_hint("税务信息",["tax_credit_rating","has_arrears"]),**_meta("user-input",False)}, ensure_ascii=False, indent=2)

@mcp.tool(name="get_dishonest_record", annotations={"title":"获取失信被执行人记录","readOnlyHint":True,"destructiveHint":False,"idempotentHint":True,"openWorldHint":True})
async def get_dishonest_record(unified_social_code: str=Field(...,description="统一社会信用代码",min_length=18,max_length=18), include_related: bool=Field(default=True,description="是否包含关联方失信记录")) -> str:
    """获取失信被执行人记录。优先公网API，降级内置演示数据。"""
    d = _get_demo(unified_social_code, "dishonest")
    if d: return json.dumps({"ok":True,"data":d,**_meta("demo-data",True)}, ensure_ascii=False, indent=2)
    return json.dumps({"ok":True,"data":{"is_dishonest":None,"dishonest_records":[],"related_dishonest":[]},"hint":"非演示企业，请确认该企业及关联方是否有失信记录",**_meta("public-api-pending",False)}, ensure_ascii=False, indent=2)

# ── 行业基准数据域（3个工具）──

@mcp.tool(name="get_industry_benchmark", annotations={"title":"获取行业基准财务指标","readOnlyHint":True,"destructiveHint":False,"idempotentHint":True,"openWorldHint":True})
async def get_industry_benchmark(industry_code: str=Field(...,description="行业代码（GB/T 4754两位码）",min_length=1,max_length=4), year: int=Field(default=2024,description="基准年份",ge=2015,le=2030)) -> str:
    """获取行业基准财务指标。优先公网，降级内置演示数据。"""
    d = DEMO_INDUSTRY.get(industry_code)
    if d: return json.dumps({"ok":True,"data":d["benchmark"],**_meta("demo-data",True)}, ensure_ascii=False, indent=2)
    return json.dumps({"ok":True,"data":{},"hint":f"行业代码{industry_code}无内置基准，请补充行业基准数据",**_meta("user-input",False)}, ensure_ascii=False, indent=2)

@mcp.tool(name="get_industry_rating", annotations={"title":"获取行业风险评级与景气度","readOnlyHint":True,"destructiveHint":False,"idempotentHint":True,"openWorldHint":True})
async def get_industry_rating(industry_code: str=Field(...,description="行业代码（GB/T 4754两位码）",min_length=1,max_length=4)) -> str:
    """获取行业风险评级与景气度。优先公网，降级内置演示数据。"""
    d = DEMO_INDUSTRY.get(industry_code)
    if d: return json.dumps({"ok":True,"data":d["rating"],**_meta("demo-data",True)}, ensure_ascii=False, indent=2)
    return json.dumps({"ok":True,"data":{},"hint":f"行业代码{industry_code}无内置评级，请补充行业风险评级",**_meta("user-input",False)}, ensure_ascii=False, indent=2)

@mcp.tool(name="get_macro_indicator", annotations={"title":"获取宏观经济指标","readOnlyHint":True,"destructiveHint":False,"idempotentHint":True,"openWorldHint":True})
async def get_macro_indicator(indicator_type: IndicatorType=Field(default=IndicatorType.ALL,description="指标类型：全部/GDP/PMI/CPI/PPI/LPR/M2"), months: int=Field(default=12,description="获取最近N个月",ge=1,le=60)) -> str:
    """获取宏观经济指标。内置最新数据，公网API待接入。"""
    if indicator_type == IndicatorType.ALL: d = DEMO_MACRO
    else: d = {indicator_type.value: DEMO_MACRO.get(indicator_type.value, {})}
    return json.dumps({"ok":True,"data":d,**_meta("demo-data",True)}, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    mcp.run(transport="streamable-http", host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "17897")))

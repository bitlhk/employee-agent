#!/usr/bin/env node
import express from 'express';
import { randomUUID } from 'node:crypto';
const PORT = Number(process.env.MCP_PORT || 17897);
const SERVICE_NAME = 'post-loan-risk-data-http-mcp';
const SERVICE_VERSION = '0.1.0-demo';
const enterprises = {
  '91370000726200000X': {
    profile: { enterprise_name: '鸿远建设集团有限公司', industry_code: 'E', industry_name: '建筑业', ownership_type: '民营', registered_capital: 50000, establishment_date: '2003-06-15', legal_person: '张鸿远', enterprise_scale: '中型', operating_status: '在营' },
    loan_accounts: [{ loan_id: 'LN20230001', loan_balance: 15000, credit_limit: 25000, five_level_class: '关注', overdue_days: 0, product_type: '流动资金贷款', interest_rate: 4.35, maturity_date: '2025-12-31' }],
    financial: { years: ['2023','2022','2021'], total_assets: [120000,115000,108000], total_liabilities: [84000,80000,74000], current_ratio: [1.15,1.20,1.28], dscr: [1.08,1.15,1.22], operating_cashflow: [3500,4200,5100], net_profit: [2800,3200,3800], revenue: [65000,72000,80000] },
    repayment: { total_overdue_count: 3, max_overdue_days: 15, recent_6m_overdue_count: 1, consecutive_normal_months: 4, records: [{ month: '2023-11', due: 500, actual: 495, overdue_days: 5 }] },
    collaterals: [{ type: '房产抵押', original_value: 20000, current_value: 18000, coverage_ratio: 0.72, loan_id: 'LN20230001' }],
    guarantors: [{ name: '张鸿远', type: '个人保证', amount: 20000, is_dishonest: false, relation: '实控人' }],
    credit_rating: { internal_rating: 'BBB', rating_date: '2024-03-15', external_rating: 'AA-', rating_score: 65, previous_rating: 'A', score_model: 'demo-v3.0' },
    judicial: { total_cases: 2, total_amount: 800, has_frozen_assets: false, cases: [{ case_no: '(2024)鲁01民初123号', role: '被告', amount: 500, status: '审理中', type: '合同纠纷' }] },
    opinion: { negative_count: 3, has_major_negative: true, opinions: [{ date: '2024-05-10', source: '演示舆情源', title: '项目停工传闻', severity: '中' }] },
    business_abnormal: { has_abnormal: false, abnormal_records: [], has_serious_violation: false },
    tax: { tax_credit_rating: 'B', has_arrears: false, annual_tax: [{ year: '2023', amount: 1200 }] },
    dishonest: { is_dishonest: false, dishonest_records: [], related_dishonest: [] },
  },
  '91440100MA5C00000B': {
    profile: { enterprise_name: '德信商业地产开发有限公司', industry_code: 'K', industry_name: '房地产业', ownership_type: '民营', registered_capital: 100000, establishment_date: '2008-09-10', legal_person: '王德信', enterprise_scale: '大型', operating_status: '在营' },
    loan_accounts: [{ loan_id: 'LN20210001', loan_balance: 80000, credit_limit: 120000, five_level_class: '关注', overdue_days: 0, product_type: '开发贷款', interest_rate: 5.20, maturity_date: '2025-12-31' }, { loan_id: 'LN20220002', loan_balance: 20000, credit_limit: 30000, five_level_class: '次级', overdue_days: 35, product_type: '经营性物业贷款', interest_rate: 4.90, maturity_date: '2025-06-30' }],
    financial: { years: ['2023','2022','2021'], total_assets: [350000,380000,400000], total_liabilities: [280000,290000,300000], current_ratio: [0.85,0.92,1.05], dscr: [0.75,0.88,1.10], operating_cashflow: [-5000,-2000,3000], net_profit: [-8000,-3000,2000], revenue: [45000,55000,70000] },
    repayment: { total_overdue_count: 5, max_overdue_days: 35, recent_6m_overdue_count: 2, consecutive_normal_months: 2, records: [{ month: '2024-05', due: 2000, actual: 0, overdue_days: 35 }] },
    collaterals: [{ type: '土地使用权抵押', original_value: 150000, current_value: 110000, coverage_ratio: 1.10, loan_id: 'LN20210001' }],
    guarantors: [{ name: '德信控股集团', type: '企业保证', amount: 80000, is_dishonest: true, relation: '母公司' }],
    credit_rating: { internal_rating: 'BB', rating_date: '2024-04-20', external_rating: 'BBB', rating_score: 45, previous_rating: 'BBB', score_model: 'demo-v3.0' },
    judicial: { total_cases: 5, total_amount: 3500, has_frozen_assets: true, frozen_amount: 2000, cases: [{ case_no: '(2024)粤01民初789号', role: '被告', amount: 1500, status: '审理中', type: '工程款纠纷' }] },
    opinion: { negative_count: 8, has_major_negative: true, opinions: [{ date: '2024-06-01', source: '演示舆情源', title: '项目烂尾业主维权', severity: '高' }] },
    business_abnormal: { has_abnormal: true, abnormal_records: [{ type: '列入经营异常名录', reason: '未按规定公示年度报告', date: '2024-03-15' }], has_serious_violation: false },
    tax: { tax_credit_rating: 'C', has_arrears: true, annual_tax: [{ year: '2023', amount: 500 }] },
    dishonest: { is_dishonest: false, dishonest_records: [], related_dishonest: [{ name: '德信控股集团', case_no: '(2024)粤01执012号', amount: 800 }] },
  },
};
const industry = { E: { benchmark: { dscr_mean: 1.30, current_ratio_mean: 1.25, debt_ratio_mean: 0.68, roe_mean: 0.08 }, rating: { risk_level: '关注', cycle_position: '收缩期', prosperity_index: 45, policy_risk: '中性' } }, K: { benchmark: { dscr_mean: 0.90, current_ratio_mean: 1.00, debt_ratio_mean: 0.78, roe_mean: 0.03 }, rating: { risk_level: '高风险', cycle_position: '深度收缩', prosperity_index: 30, policy_risk: '限制' } }, C: { benchmark: { dscr_mean: 1.80, current_ratio_mean: 1.60, debt_ratio_mean: 0.55, roe_mean: 0.12 }, rating: { risk_level: '低风险', cycle_position: '扩张期', prosperity_index: 65, policy_risk: '鼓励' } } };
const macro = { GDP: { latest: 5.2, trend: '平稳', unit: '%' }, PMI: { latest: 50.4, trend: '微升', unit: '' }, CPI: { latest: 0.7, trend: '低位', unit: '%' }, PPI: { latest: -2.5, trend: '通缩', unit: '%' }, LPR: { latest: 3.45, trend: '下行', unit: '%' }, M2: { latest: 7.2, trend: '放缓', unit: '%' } };
function nowMeta(source='demo-data', isDemoData=true) { return { source, updatedAt: new Date().toISOString(), isDemoData }; }
function code(args) { return String(args.unified_social_code || args.credit_code || '').trim(); }
function getDemo(args, key) { const item = enterprises[code(args)]; return item ? item[key] : undefined; }
function missing(domain, fields) { return `缺少${domain}数据，请补充：${fields.join('、')}`; }
function ok(data, meta={}) { return { ok: true, data, ...meta }; }
function fallback(domain, fields, empty) { return { ok: true, data: empty, hint: missing(domain, fields), ...nowMeta('user-input', false) }; }
const toolDefs = [
  ['get_enterprise_profile', '获取企业基本画像。'], ['get_loan_account', '获取企业贷款账户信息。'], ['get_financial_statements', '获取企业财务报表。'], ['get_repayment_history', '获取还款历史。'], ['get_collateral_info', '获取抵质押物信息。'], ['get_guarantor_info', '获取担保人信息。'], ['get_credit_rating', '获取企业信用评级。'], ['get_judicial_info', '获取司法诉讼与执行信息。'], ['get_public_opinion', '获取企业舆情信息。'], ['get_business_abnormal', '获取企业经营异常信息。'], ['get_tax_info', '获取企业税务信息。'], ['get_dishonest_record', '获取失信被执行人记录。'], ['get_industry_benchmark', '获取行业基准财务指标。'], ['get_industry_rating', '获取行业风险评级与景气度。'], ['get_macro_indicator', '获取宏观经济指标。']
];
const TOOLS = toolDefs.map(([name, description]) => ({ name, description, inputSchema: { type: 'object', additionalProperties: true, properties: { unified_social_code: { type: 'string', description: '统一社会信用代码' }, credit_code: { type: 'string', description: '统一社会信用代码' }, enterprise_name: { type: 'string', description: '企业名称' }, industry_code: { type: 'string', description: '行业代码' }, indicator_type: { type: 'string', description: '宏观指标类型' } } } }));
async function callTool(name, args) {
  switch (name) {
    case 'get_enterprise_profile': return getDemo(args, 'profile') ? ok(getDemo(args, 'profile'), nowMeta()) : fallback('企业画像', ['industry_code','ownership_type','registered_capital','enterprise_scale','operating_status'], { enterprise_name: args.enterprise_name || '', unified_social_code: code(args) });
    case 'get_loan_account': return getDemo(args, 'loan_accounts') ? ok(getDemo(args, 'loan_accounts'), nowMeta()) : fallback('贷款账户', ['loan_balance','credit_limit','five_level_class','overdue_days','product_type','maturity_date'], []);
    case 'get_financial_statements': return getDemo(args, 'financial') ? ok(getDemo(args, 'financial'), nowMeta()) : fallback('财务报表', ['total_assets','total_liabilities','current_ratio','dscr','operating_cashflow','net_profit','revenue'], {});
    case 'get_repayment_history': return getDemo(args, 'repayment') ? ok(getDemo(args, 'repayment'), nowMeta()) : fallback('还款历史', ['total_overdue_count','max_overdue_days','recent_6m_overdue_count'], {});
    case 'get_collateral_info': return getDemo(args, 'collaterals') ? ok(getDemo(args, 'collaterals'), nowMeta()) : fallback('抵质押物', ['current_value','coverage_ratio','status'], []);
    case 'get_guarantor_info': return getDemo(args, 'guarantors') ? ok(getDemo(args, 'guarantors'), nowMeta()) : fallback('担保人', ['guarantor_name','guarantee_amount','is_dishonest'], []);
    case 'get_credit_rating': return getDemo(args, 'credit_rating') ? ok(getDemo(args, 'credit_rating'), nowMeta()) : fallback('信用评级', ['internal_rating','rating_score','rating_date'], {});
    case 'get_judicial_info': return getDemo(args, 'judicial') ? ok(getDemo(args, 'judicial'), nowMeta()) : fallback('司法风险', ['total_cases','has_frozen_assets','cases'], {});
    case 'get_public_opinion': return getDemo(args, 'opinion') ? ok(getDemo(args, 'opinion'), nowMeta()) : fallback('舆情风险', ['negative_count','has_major_negative','opinions'], {});
    case 'get_business_abnormal': return getDemo(args, 'business_abnormal') ? ok(getDemo(args, 'business_abnormal'), nowMeta()) : fallback('经营异常', ['abnormal_records','has_serious_violation'], {});
    case 'get_tax_info': return getDemo(args, 'tax') ? ok(getDemo(args, 'tax'), nowMeta()) : fallback('税务信息', ['tax_credit_rating','has_arrears'], {});
    case 'get_dishonest_record': return getDemo(args, 'dishonest') ? ok(getDemo(args, 'dishonest'), nowMeta()) : fallback('失信记录', ['is_dishonest','dishonest_records'], {});
    case 'get_industry_benchmark': return ok(industry[String(args.industry_code || 'E')]?.benchmark || industry.E.benchmark, nowMeta('demo-industry-data', true));
    case 'get_industry_rating': return ok(industry[String(args.industry_code || 'E')]?.rating || industry.E.rating, nowMeta('demo-industry-data', true));
    case 'get_macro_indicator': return ok(args.indicator_type && macro[String(args.indicator_type)] ? macro[String(args.indicator_type)] : macro, nowMeta('demo-macro-data', true));
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
function ctx(req) { return { requestId: req.headers['x-request-id'] || randomUUID(), agentId: req.headers['x-linggan-agent-id'] || req.headers['x-openclaw-agent-id'] || '', userId: req.headers['x-linggan-user-id'] || '', startTime: Date.now() }; }
const app = express();
app.use(express.json({ limit: '2mb' }));
app.get('/health', (_req, res) => res.json({ status: 'ok', name: SERVICE_NAME, version: SERVICE_VERSION }));
app.post('/mcp', async (req, res) => {
  const body = req.body || {}; const id = body.id; const c = ctx(req);
  try {
    if (body.method === 'initialize') return res.json({ jsonrpc: '2.0', id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: SERVICE_NAME, version: SERVICE_VERSION }, instructions: '企业贷后风控数据 MCP。当前为灰度演示版，返回 demo 数据或缺失字段提示。' } });
    if (body.method === 'notifications/initialized') return res.status(202).json({});
    if (body.method === 'tools/list') return res.json({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    if (body.method === 'tools/call') {
      const details = await callTool(body.params?.name, body.params?.arguments || {});
      console.log(JSON.stringify({ requestId: c.requestId, method: body.params?.name, agentId: c.agentId, status: 'ok', elapsed: Date.now() - c.startTime }));
      return res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(details, null, 2) }], details } });
    }
    return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${body.method}` } });
  } catch (err) {
    console.error('[mcp] error', err.message);
    return res.json({ jsonrpc: '2.0', id, error: { code: -32603, message: err.message } });
  }
});
app.listen(PORT, '127.0.0.1', () => console.log(`[${SERVICE_NAME}] listening http://127.0.0.1:${PORT}/mcp`));

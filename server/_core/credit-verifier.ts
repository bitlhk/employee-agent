/**
 * credit-verifier.ts — 信贷报告合规验证器（生成-验证者模式）
 * 
 * 信贷助手生成报告后，调用轻量 LLM 逐项检查合规性。
 * 基于金融监管总局（原银保监会）现行有效法规。
 */

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_BASE = "https://api.deepseek.com";

const VERIFY_PROMPT = `你是金融监管合规审查专家。请逐项检查以下信贷分析报告是否符合监管要求。

【检查清单（10 项）】

1. 五级分类：报告是否明确给出风险分类（正常/关注/次级/可疑/损失）
   依据：《商业银行金融资产风险分类办法》（2023年第1号令）

2. 监管框架引用：是否引用了现行有效的监管法规（非已废止的旧规）
   有效法规：金融监管总局2024年贷款管理办法、授信尽职指引、风险分类办法

3. 贷前调查覆盖：是否包含借款人资质、抵押物评估、保证人代偿能力分析
   依据：《授信工作尽职指引》

4. 还款来源分析：是否分析了第一还款来源（经营收入/工资收入）和第二还款来源（担保/抵押处置）
   依据：《流动资金贷款管理办法》2024修订版新增强化要求

5. 贷款用途匹配性：是否评估了贷款用途与借款人实际经营需求的匹配程度
   依据：2024年三个贷款管理办法修订重点

6. 行业风险分析：是否分析了借款人所在行业的风险状况
   
7. 定价建议：是否给出了利率/定价建议（基于LPR市场化定价）

8. 贷后管理安排：是否提出了贷后检查频率、预警指标、跟踪措施

9. 免责声明：是否包含"需人工/审批委员会复核"类免责声明

10. 红线检查：是否触碰以下红线
    - 直接做出准入/拒绝决策（应为"建议"）
    - 预测企业未来盈利
    - 承诺担保物价值不变
    - 暗示监管放松

【输出格式】
返回一个 JSON 数组，每项格式：
{"id": 1, "name": "五级分类", "pass": true, "detail": "已给出：关注"}

如果不通过：
{"id": 4, "name": "还款来源分析", "pass": false, "detail": "未分析第二还款来源（担保处置）"}

只返回 JSON 数组，不要返回其他内容。`;

export interface VerifyItem {
  id: number;
  name: string;
  pass: boolean;
  detail: string;
}

export async function verifyCreditReport(reportText: string): Promise<{
  items: VerifyItem[];
  score: number;
  summary: string;
} | null> {
  if (!DEEPSEEK_API_KEY || !reportText || reportText.length < 100) return null;

  try {
    const resp = await fetch(`${DEEPSEEK_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: VERIFY_PROMPT },
          { role: "user", content: `【待审查的信贷分析报告】\n\n${reportText.slice(0, 6000)}` },
        ],
        temperature: 0,
        max_tokens: 800,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return null;
    const data = await resp.json() as any;
    const text = data?.choices?.[0]?.message?.content?.trim() || "";

    // 提取 JSON 数组
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;

    const items: VerifyItem[] = JSON.parse(jsonMatch[0]);
    const passCount = items.filter(i => i.pass).length;
    const total = items.length;
    const score = total > 0 ? passCount : 0;

    const failedItems = items.filter(i => !i.pass);
    let summary = "";
    if (failedItems.length === 0) {
      summary = "全部检查项通过，报告符合金融监管总局现行法规要求。";
    } else {
      summary = `建议补充${failedItems.map(i => `「${i.name}」`).join("、")}后再作为正式报告归档。`;
    }

    return { items, score, summary };
  } catch (e: any) {
    console.error("[CREDIT-VERIFIER] error:", e?.message?.slice(0, 100));
    return null;
  }
}

/** 格式化验证结果为 Markdown */
export function formatVerifyResult(result: { items: VerifyItem[]; score: number; summary: string }): string {
  const lines: string[] = [
    "",
    "---",
    "",
    "📋 **合规自检报告**（基于金融监管总局现行法规）",
    "",
    "| # | 检查项 | 状态 | 说明 |",
    "|---|--------|------|------|",
  ];

  for (const item of result.items) {
    const status = item.pass ? "✅" : "⚠️";
    lines.push(`| ${item.id} | ${item.name} | ${status} | ${item.detail} |`);
  }

  const passCount = result.items.filter(i => i.pass).length;
  const total = result.items.length;

  lines.push("");
  lines.push(`**合规得分：${passCount}/${total}** | ${result.summary}`);
  lines.push("");
  lines.push("> 本检查由 AI 自动完成，仅供参考，不替代人工合规审查。");
  lines.push("");

  return lines.join("\n");
}

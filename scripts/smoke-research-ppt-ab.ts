import "dotenv/config";
import http from "node:http";
import path from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createTaskWorkbenchLabHandlers } from "../server/_routes/task-workbench-lab";
import {
  buildRuntimeSessionKey,
  resolveRuntimeAgentId,
  resolveRuntimeWorkspace,
} from "../server/_core/helpers";
import {
  buildChatRequestBody,
  type PermissionProfile,
} from "../server/_core/tool_schema";
import {
  buildQualityReport,
  generatePptxFromBlueprint,
  getBuiltinPptTemplates,
  renderDeckHtml,
  resolveBlueprint,
} from "../server/_core/office-ppt";
import {
  createDeterministicSearchPlan,
  SourceResearchProvider,
  type InsightEvidencePackage,
  type SearchPlanner,
  type SearchPlan,
} from "../server/_core/agent/source-research-provider";

const adoptId = process.env.AB_ADOPT_ID || "lgc-ppstsl9ddr";
const runtimeAgentId = `trial_${adoptId}`;
const prompt =
  process.env.AB_PROMPT ||
  "洞察一下华为τ定律，分析它对芯片产业的影响。请做成8页左右研究型PPT，不要硬扯企业AI Agent。";
const templateId = process.env.AB_TEMPLATE_ID || "huawei-light";
const slideRange = process.env.AB_SLIDE_RANGE || "8-10";

const claw = {
  adoptId,
  agentId: runtimeAgentId,
  permissionProfile: process.env.AB_PERMISSION_PROFILE || "internal",
};
const workspace = resolveRuntimeWorkspace(claw, adoptId);
const labUser = {
  id: Number(process.env.AB_USER_ID || 1),
  role: "admin",
  adoptId,
  workspace,
  claw,
};

type Timing = {
  label: string;
  startedAt: string;
  endedAt: string;
  elapsedMs: number;
};

function nowIso() {
  return new Date().toISOString();
}

async function timed<T>(label: string, fn: () => Promise<T>) {
  const startedAt = nowIso();
  const started = Date.now();
  console.log(`[AB] start ${label}`);
  const value = await fn();
  const timing = {
    label,
    startedAt,
    endedAt: nowIso(),
    elapsedMs: Date.now() - started,
  };
  console.log(`[AB] done ${label}: ${timing.elapsedMs}ms`);
  return { value, timing };
}

function makeResponseCapture() {
  return {
    statusCode: 200,
    body: undefined as any,
    headersSent: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
  };
}

async function runFastMode() {
  const handlers = createTaskWorkbenchLabHandlers({
    enabled: () => true,
    adminOnly: false,
    authenticateUser: async () => labUser,
  });
  const req = {
    body: {
      taskTemplateId: "research_ppt",
      prompt,
      inputOptions: { templateId, slideRange },
    },
    query: {},
  };
  const res = makeResponseCapture();
  await handlers.runTask(req as any, res as any);
  if (res.statusCode >= 400) {
    throw new Error(`fast mode failed: ${res.statusCode} ${JSON.stringify(res.body)}`);
  }
  return res.body?.taskRun;
}

function parseJsonBlock(text: string) {
  const fenced =
    text.match(/```(?:json|SEARCH_PLAN_JSON)?\s*([\s\S]*?)```/i)?.[1] ||
    text.match(/\{[\s\S]*\}/)?.[0] ||
    "";
  if (!fenced.trim()) return null;
  try {
    return JSON.parse(fenced);
  } catch {
    return null;
  }
}

async function callOpenClawTask(args: {
  message: string;
  brandSystemPrompt?: string;
  conversationId: string;
  timeoutMs?: number;
}) {
  const remoteHost = process.env.CLAW_REMOTE_HOST || "127.0.0.1";
  const gatewayPort = parseInt(process.env.CLAW_GATEWAY_PORT || "18789", 10);
  const gatewayToken = process.env.CLAW_GATEWAY_TOKEN || "";
  const permissionProfile = String(claw.permissionProfile || "starter");
  const profile: PermissionProfile =
    permissionProfile === "plus" || permissionProfile === "internal"
      ? permissionProfile
      : "starter";
  const sessionKey = buildRuntimeSessionKey({
    runtimeAgentId: resolveRuntimeAgentId(adoptId, runtimeAgentId),
    channel: "office",
    conversationId: args.conversationId,
  });
  const body = Buffer.from(
    JSON.stringify(
      buildChatRequestBody({
        message: args.message,
        permissionProfile: profile,
        brandSystemPrompt:
          args.brandSystemPrompt ||
          "你是企业办公工作流执行器。请产出可审阅、可归档、可复核的业务交付物。",
      })
    ),
    "utf8"
  );

  return await new Promise<string>((resolve, reject) => {
    const req = http.request(
      {
        hostname: remoteHost,
        port: gatewayPort,
        path: "/v1/chat/completions",
        method: "POST",
        timeout: 0,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": body.length,
          Authorization: `Bearer ${gatewayToken}`,
          "x-openclaw-agent-id": runtimeAgentId,
          "x-openclaw-session-key": sessionKey,
        },
      },
      res => {
        let buffer = "";
        let out = "";
        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf8");
          const blocks = buffer.split(/\n\n/);
          buffer = blocks.pop() || "";
          for (const block of blocks) {
            for (const rawLine of block.split("\n")) {
              const line = rawLine.trimEnd();
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (!data || data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed?.choices?.[0]?.delta?.content || "";
                if (delta) out += delta;
              } catch {}
            }
          }
        });
        res.on("end", () => {
          const text = out.trim();
          if (!text) reject(new Error("OpenClaw returned empty content"));
          else resolve(text);
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(args.timeoutMs || 300_000, () =>
      req.destroy(new Error(`OpenClaw timeout after ${args.timeoutMs || 300_000}ms`))
    );
    req.write(body);
    req.end();
  });
}

function buildSearchPlanningPrompt() {
  return [
    "你是 PPT 研究任务的检索规划员。你只负责把用户需求转成高质量检索计划，不写报告、不写PPT。",
    "",
    "请输出一个 JSON，字段：",
    "{",
    '  "rationale": "为什么这样检索",',
    '  "queries": ["6-10个中文或英文检索词"],',
    '  "officialSourceHints": ["优先寻找的一手来源、机构、站点"],',
    '  "mustVerify": ["必须验证的事实/争议"],',
    '  "avoid": ["低质量来源或跑题方向"]',
    "}",
    "",
    "检索要求：",
    "- 不要直接照抄用户原话搜索，要拆成事实来源、机制解释、产业影响、风险反方四类。",
    "- 优先官方、一手、权威媒体、研究机构；普通转载和自媒体只能辅助。",
    "- 严禁把无关主题硬接进来。",
    "",
    `用户需求：${prompt}`,
  ].join("\n");
}

function makeOpenClawSearchPlanner(): SearchPlanner {
  return {
    async plan(input) {
      const fallback = createDeterministicSearchPlan(input);
      const raw = await callOpenClawTask({
        message: buildSearchPlanningPrompt(),
        conversationId: `ab-quality-plan-${Date.now()}`,
        timeoutMs: 180_000,
      });
      const parsed = parseJsonBlock(raw) || {};
      const plannedQueries = Array.isArray(parsed.queries)
        ? parsed.queries.map((item: unknown) => String(item || "").trim()).filter(Boolean)
        : [];
      const officialHints = Array.isArray(parsed.officialSourceHints)
        ? parsed.officialSourceHints.map((item: unknown) => String(item || "").trim()).filter(Boolean)
        : [];
      return {
        ...fallback,
        queries: [...plannedQueries, ...officialHints, ...fallback.queries],
        planner: {
          mode: "lingxia-llm",
          provider: "openclaw",
          model: "openclaw",
        },
        rationale: String(parsed.rationale || fallback.rationale || ""),
        officialSourceHints: officialHints,
        warnings: parsed.avoid
          ? [`planner avoid: ${Array.isArray(parsed.avoid) ? parsed.avoid.join("；") : String(parsed.avoid)}`]
          : undefined,
      } satisfies SearchPlan;
    },
  };
}

function compactEvidence(evidence: InsightEvidencePackage) {
  return {
    topic: evidence.topic,
    confidence: evidence.confidence,
    warnings: evidence.warnings,
    searchPlan: {
      rationale: evidence.searchPlan?.rationale,
      queries: evidence.searchPlan?.queries?.slice(0, 10),
      officialSourceHints: evidence.searchPlan?.officialSourceHints,
    },
    evidenceSummary: evidence.evidenceSummary,
    sources: evidence.candidates.slice(0, 14).map((item, index) => ({
      id: `S${index + 1}`,
      sourceId: item.sourceId,
      title: item.title,
      url: item.url,
      sourceName: item.sourceName,
      publishedAt: item.publishedAt,
      tier: item.tier,
      publisherClass: item.publisherClass,
      evidenceRole: item.evidenceRole,
      snippet: item.snippet,
      qualityReason: item.qualityReason,
    })),
    discardedSources: (evidence.discardedSources || []).slice(0, 8).map(item => ({
      title: item.title,
      url: item.url,
      reason: item.discardReason,
    })),
  };
}

function buildQualityOutlinePrompt(evidence: InsightEvidencePackage) {
  const evidenceJson = JSON.stringify(compactEvidence(evidence), null, 2);
  return [
    "你是研究型 PPT 大纲协作员。你不能再搜索，只能基于给定资料包输出可审核 Markdown 和 PPT_BLUEPRINT_JSON。",
    "",
    "目标：用资料包回答用户问题，形成 8 页左右可编辑 PPT 的结构化蓝图。",
    "",
    "硬约束：",
    "- 只围绕用户主题，不要硬接企业 AI Agent、产品方案或其他无关主题。",
    "- 每页只回答一个管理问题，并写清“所以呢”。",
    "- 事实、日期、机构、数字必须引用资料包里的 S 编号；证据不足必须标注。",
    "- 标题短，观点明确，避免泛泛口号。",
    "- slides 数量 8 页左右。",
    "",
    "请严格输出：",
    "# 研究型 PPT 大纲",
    "## 资料检索包",
    "## Argument Map",
    "## Slide Role Plan",
    "## 需要用户补充的信息",
    "## PPT_BLUEPRINT_JSON",
    "最后必须追加 fenced code block，语言标记 PPT_BLUEPRINT_JSON。",
    "",
    "PPT_BLUEPRINT_JSON 的 slide 字段必须包含：pageNo,type,pageRole,designPattern,title,keyMessage,bullets,mustInclude,businessImplications,recommendedActions,evidenceNotes,evidence,assumptions,risks,layoutPriority,visualIntent,visualData,speakerNotes。",
    "",
    `用户需求：${prompt}`,
    "",
    "资料包：",
    evidenceJson,
  ].join("\n");
}

function chooseTemplate() {
  const builtin =
    getBuiltinPptTemplates().find(item => item.id === templateId && item.available) ||
    getBuiltinPptTemplates().find(item => item.id === "huawei-light");
  if (!builtin) throw new Error("No PPT template available");
  return builtin;
}

async function runQualityMode() {
  const taskRunId = `research-ppt-ab-quality-${Date.now()}`;
  const relRoot = `office/task-workbench/${taskRunId}/outputs`;
  const absRoot = path.join(workspace, relRoot);
  mkdirSync(absRoot, { recursive: true });
  const timings: Timing[] = [];

  let evidence!: InsightEvidencePackage;
  {
    const result = await timed("quality.plan_and_search", async () => {
      const provider = new SourceResearchProvider({
        env: {
          ...process.env,
          BRAVE_API_KEY:
            process.env.BRAVE_API_KEY || process.env.BRAVE_SEARCH_API_KEY,
          BOCHA_API_KEY:
            process.env.BOCHA_API_KEY || process.env.BOCHA_SEARCH_API_KEY,
          TAVILY_API_KEY: process.env.TAVILY_API_KEY,
        },
        maxCandidates: 18,
        searchPlanner: makeOpenClawSearchPlanner(),
      });
      return provider.research(prompt);
    });
    evidence = result.value;
    timings.push(result.timing);
  }

  const evidencePath = path.join(absRoot, "search-evidence.json");
  const evidenceMdPath = path.join(absRoot, "search-evidence.md");
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  writeFileSync(
    evidenceMdPath,
    [
      "# 检索记录",
      "",
      `- 置信度：${evidence.confidence || "unknown"}`,
      `- 采用来源：${evidence.candidates.length}`,
      `- 丢弃来源：${evidence.discardedSources?.length || 0}`,
      "",
      "## 查询",
      ...(evidence.searchPlan?.queries || []).map(item => `- ${item}`),
      "",
      "## 采用来源",
      ...evidence.candidates.slice(0, 14).map((item, index) =>
        `- S${index + 1} ${item.title} | ${item.sourceName || item.provider} | ${item.url}`
      ),
      "",
      "## 警告",
      ...(evidence.warnings?.length ? evidence.warnings.map(item => `- ${item}`) : ["- 无"]),
      "",
    ].join("\n"),
    "utf8"
  );

  let outline = "";
  {
    const result = await timed("quality.outline_writer", async () =>
      callOpenClawTask({
        message: buildQualityOutlinePrompt(evidence),
        conversationId: `ab-quality-outline-${Date.now()}`,
        timeoutMs: 600_000,
      })
    );
    outline = result.value;
    timings.push(result.timing);
  }

  const template = chooseTemplate();
  const outlineRel = `${relRoot}/outline.md`;
  const blueprintRel = `${relRoot}/blueprint.json`;
  const previewRel = `${relRoot}/slides-preview.html`;
  const pptxRel = `${relRoot}/slides.pptx`;
  const qualityRel = `${relRoot}/quality-report.md`;
  const qualityJsonRel = `${relRoot}/quality-report.json`;

  let blueprint: ReturnType<typeof resolveBlueprint>;
  {
    const result = await timed("quality.render_and_check", async () => {
      blueprint = resolveBlueprint(outline, prompt.slice(0, 60) || "研究型 PPT");
      writeFileSync(path.join(workspace, outlineRel), outline, "utf8");
      writeFileSync(path.join(workspace, blueprintRel), JSON.stringify(blueprint, null, 2), "utf8");
      writeFileSync(
        path.join(workspace, previewRel),
        renderDeckHtml({
          blueprint,
          templateName: template.name,
          generatedAt: new Date().toISOString(),
        }),
        "utf8"
      );
      await generatePptxFromBlueprint({
        blueprint,
        outputAbs: path.join(workspace, pptxRel),
        templateName: template.name,
        templatePath: template.absPath,
        instruction: prompt,
      });
      const quality = buildQualityReport({
        blueprint,
        pptxPath: path.join(workspace, pptxRel),
      });
      writeFileSync(path.join(workspace, qualityJsonRel), JSON.stringify(quality, null, 2), "utf8");
      writeFileSync(
        path.join(workspace, qualityRel),
        [
          "# PPT 质量校验",
          "",
          `- 校验结果：${quality.ok ? "通过" : "需关注"}`,
          `- 期望页数：${quality.expectedSlideCount}`,
          `- 实际页数：${quality.slideCount}`,
          "",
          "## 发现项",
          ...(quality.findings.length
            ? quality.findings.map(item => `- ${item.severity}${item.pageNo ? ` P${item.pageNo}` : ""}：${item.message}`)
            : ["- 未发现阻断性问题。"]),
          "",
        ].join("\n"),
        "utf8"
      );
      return quality;
    });
    timings.push(result.timing);
  }

  const artifacts = [
    "search-evidence.md",
    "search-evidence.json",
    "outline.md",
    "blueprint.json",
    "slides-preview.html",
    "slides.pptx",
    "quality-report.md",
    "quality-report.json",
  ].map(name => {
    const abs = path.join(absRoot, name);
    return {
      name,
      abs,
      rel: `${relRoot}/${name}`,
      size: existsSync(abs) ? statSync(abs).size : 0,
    };
  });

  return {
    taskRunId,
    timings,
    totalMs: timings.reduce((sum, item) => sum + item.elapsedMs, 0),
    slideCount: blueprint!.slides.length,
    sourceCount: evidence.candidates.length,
    discardedCount: evidence.discardedSources?.length || 0,
    confidence: evidence.confidence,
    artifacts,
  };
}

function summarizeRun(run: any) {
  const stages = Array.isArray(run?.stages) ? run.stages : [];
  const artifacts = stages.flatMap((stage: any) =>
    (stage.artifacts || []).map((artifact: any) => ({
      stageId: stage.stageId,
      name: artifact.name,
      type: artifact.type,
      size: artifact.size,
      url: artifact.url,
    }))
  );
  return {
    taskRunId: run?.id,
    status: run?.status,
    stageCount: stages.length,
    stages: stages.map((stage: any) => ({
      stageId: stage.stageId,
      agentDefinitionId: stage.agentDefinitionId,
      status: stage.status,
      durationMs: stage.durationMs,
      artifactCount: stage.artifacts?.length || 0,
    })),
    artifacts,
  };
}

function readArtifactTextByName(summary: any, name: string) {
  const artifact = summary.artifacts?.find((item: any) => item.name === name);
  if (!artifact?.url) return "";
  const match = String(artifact.url).match(/[?&]path=([^&]+)/);
  if (!match) return "";
  const rel = decodeURIComponent(match[1]);
  const abs = path.join(workspace, rel);
  return existsSync(abs) ? readFileSync(abs, "utf8") : "";
}

async function main() {
  mkdirSync(workspace, { recursive: true });
  console.log("[AB] topic:", prompt);
  console.log("[AB] workspace:", workspace);

  const fast = await timed("fast.total", runFastMode);
  const fastSummary = summarizeRun(fast.value);
  const fastOutline = readArtifactTextByName(fastSummary, "outline.md");
  const fastBlueprintText = readArtifactTextByName(fastSummary, "blueprint.json");
  let fastSlideCount = 0;
  try {
    fastSlideCount = JSON.parse(fastBlueprintText).slides?.length || 0;
  } catch {}

  const qualityStarted = Date.now();
  const quality = await runQualityMode();
  const qualityTotalMs = Date.now() - qualityStarted;

  const result = {
    prompt,
    adoptId,
    generatedAt: new Date().toISOString(),
    fast: {
      timing: fast.timing,
      ...fastSummary,
      slideCount: fastSlideCount,
      outlineBytes: Buffer.byteLength(fastOutline, "utf8"),
    },
    quality: {
      ...quality,
      wallClockMs: qualityTotalMs,
    },
  };

  const reportRel = `office/task-workbench/ab-reports/research-ppt-ab-${Date.now()}.json`;
  const reportAbs = path.join(workspace, reportRel);
  mkdirSync(path.dirname(reportAbs), { recursive: true });
  writeFileSync(reportAbs, JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify({ ...result, reportAbs }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("[AB] failed:", error?.stack || error?.message || String(error));
    process.exit(1);
  });

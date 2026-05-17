const THINK_RE = /<think|<thinking|思考过程|reasoning/i;
const EMOJI_RE = /[\u{1F300}-\u{1F9FF}]/u;
const DEFAULT_ADOPT_ID = "lgc-ofnmjm4joj";

function hasEmoji(text) {
  return EMOJI_RE.test(text || "");
}

function hasThinkLeak(text) {
  return THINK_RE.test(text || "");
}

async function safeNetworkIdle(tab, timeoutMs = 12000) {
  try {
    await tab.playwright.waitForLoadState({ state: "networkidle", timeoutMs });
  } catch {
    // Some app pages keep websocket/network activity open. DOM checks below are authoritative.
  }
}

async function clickNav(tab, label) {
  let nav = tab.playwright.getByRole("button", { name: label, exact: true });
  let count = 0;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    count = await nav.count();
    if (count === 1) break;
    const fallback = tab.playwright.locator(`button:has-text("${label}")`);
    const fallbackCount = await fallback.count();
    if (fallbackCount === 1) {
      nav = fallback;
      count = fallbackCount;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (count !== 1) {
    return { ok: false, reason: `nav button count=${count}` };
  }
  await nav.click({ timeoutMs: 5000 });
  await safeNetworkIdle(tab);
  return { ok: true };
}

function pass(name, details = {}) {
  return { name, status: "pass", ...details };
}

function fail(name, reason, details = {}) {
  return { name, status: "fail", reason, ...details };
}

function warn(name, reason, details = {}) {
  return { name, status: "warn", reason, ...details };
}

function pageFacts(label, snap) {
  if (label === "聊天") {
    return {
      input: snap.includes("Message 灵感精灵"),
      sendButton: snap.includes("button \"发送\"") || snap.includes("button \"停止生成\""),
      modelSelector: snap.includes("deepseek") || snap.includes("combobox"),
    };
  }
  if (label === "技能") {
    return {
      countVisible: snap.includes("共 5 个技能") || snap.includes("共 5") || snap.includes("个技能"),
      marketplaceTab: snap.includes("技能广场"),
      sourceFilters: snap.includes("平台内置") && snap.includes("我的上传"),
    };
  }
  if (label === "频道") {
    return {
      wechat: snap.includes("微信"),
      feishu: snap.includes("飞书"),
      wecom: snap.includes("企业微信"),
    };
  }
  if (label === "定时任务") {
    return {
      headers: ["任务", "计划", "推送到", "下次执行", "最近状态", "操作"].every((x) => snap.includes(x)),
      createButton: snap.includes("新建任务"),
    };
  }
  if (label === "设置") {
    return {
      appearance: snap.includes("外观"),
      theme: snap.includes("主题"),
      mode: snap.includes("色彩模式"),
      radius: snap.includes("圆角"),
    };
  }
  if (label === "记忆") {
    return {
      memoryFile: snap.includes("MEMORY.md"),
      editor: snap.includes("textbox"),
    };
  }
  return {};
}

export async function runReadOnlySmoke({ tab, includeOptional = true } = {}) {
  const pages = [];
  const labels = includeOptional
    ? ["聊天", "技能", "频道", "定时任务", "设置", "记忆", "协作", "工作空间", "文档"]
    : ["聊天", "技能", "频道", "定时任务", "设置", "记忆"];
  for (const label of labels) {
    const navResult = await clickNav(tab, label);
    if (!navResult.ok) {
      pages.push({ label, ok: false, reason: navResult.reason });
      continue;
    }
    const snap = await tab.playwright.domSnapshot();
    const logs = await tab.dev.logs({ levels: ["error"], limit: 50 });
    pages.push({
      label,
      ok: true,
      url: await tab.url(),
      consoleErrors: logs.map((l) => l.message),
      hasThinkLeak: hasThinkLeak(snap),
      hasEmoji: hasEmoji(snap),
      notLoading: !snap.includes("正在加载"),
      hasMain: snap.includes("- main:"),
      facts: pageFacts(label, snap),
    });
  }
  return pages;
}

export async function runMarketplaceSmoke({ tab }) {
  const navResult = await clickNav(tab, "技能");
  if (!navResult.ok) return { ok: false, reason: navResult.reason };

  const marketTab = tab.playwright.getByRole("tab", { name: "技能广场", exact: true });
  const count = await marketTab.count();
  if (count !== 1) return { ok: false, reason: `marketplace tab count=${count}` };

  await marketTab.click({ timeoutMs: 5000 });
  await safeNetworkIdle(tab);

  const snap = await tab.playwright.domSnapshot();
  const logs = await tab.dev.logs({ levels: ["error"], limit: 50 });
  return {
    ok: true,
    consoleErrors: logs.map((l) => l.message),
    hasThinkLeak: hasThinkLeak(snap),
    hasEmoji: hasEmoji(snap),
    hasMarket: snap.includes("技能广场"),
    hasCategoryChips: ["开源社区", "中队原创"].every((x) => snap.includes(x)),
    hasInstallState: snap.includes("安装") || snap.includes("已安装"),
  };
}

export async function runChatSmoke({ tab, prompt } = {}) {
  const token = `SMOKE-${Date.now().toString(36).toUpperCase()}`;
  const actualPrompt = prompt || `Smoke test ${token}：请只回复“OK”。`;
  const navResult = await clickNav(tab, "聊天");
  if (!navResult.ok) return { ok: false, reason: navResult.reason };

  const input = tab.playwright.getByRole("textbox", { name: "Message 灵感精灵…", exact: true });
  const inputCount = await input.count();
  if (inputCount !== 1) return { ok: false, reason: `chat input count=${inputCount}` };

  await input.fill(actualPrompt, { timeoutMs: 5000 });

  const send = tab.playwright.getByRole("button", { name: "发送", exact: true });
  const sendCount = await send.count();
  const enabled = sendCount === 1 ? await send.isEnabled() : false;
  if (sendCount !== 1 || !enabled) {
    return { ok: false, reason: `send count=${sendCount}, enabled=${enabled}` };
  }

  await send.click({ timeoutMs: 5000 });

  const observations = [];
  for (const delay of [0, 5000, 15000, 30000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const snap = await tab.playwright.domSnapshot();
    const logs = await tab.dev.logs({ levels: ["error"], limit: 50 });
    const obs = {
      atMs: delay,
      consoleErrors: logs.map((l) => l.message),
      userPromptCount: (snap.match(new RegExp(actualPrompt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length,
      hasOkReply: snap.includes("OK") || snap.includes("对话测试成功"),
      hasThinkLeak: hasThinkLeak(snap),
        stillStreaming: snap.includes('button "停止生成"') || snap.includes("停止生成"),
    };
    observations.push(obs);
    if (obs.hasOkReply && !obs.stillStreaming) break;
  }

  const finalObservation = observations[observations.length - 1];
  return {
    ok:
      finalObservation?.userPromptCount === 1 &&
      finalObservation?.hasOkReply === true &&
      finalObservation?.hasThinkLeak === false &&
      (finalObservation?.consoleErrors?.length || 0) === 0 &&
      finalObservation?.stillStreaming === false,
    prompt: actualPrompt,
    observations,
  };
}

export async function runChatPromptSmoke({
  tab,
  name,
  prompt,
  expectedAny = [],
  timeoutPlan = [0, 8000, 20000, 45000],
} = {}) {
  if (!name || !prompt) return { ok: false, reason: "name and prompt are required" };
  const navResult = await clickNav(tab, "聊天");
  if (!navResult.ok) return { ok: false, reason: navResult.reason };

  const input = tab.playwright.getByRole("textbox", { name: "Message 灵感精灵…", exact: true });
  const inputCount = await input.count();
  if (inputCount !== 1) return { ok: false, reason: `chat input count=${inputCount}` };

  const token = `SMOKE-${name}-${Date.now().toString(36).toUpperCase()}`;
  const actualPrompt = `${prompt}\n\n测试编号：${token}`;
  await input.fill(actualPrompt, { timeoutMs: 5000 });

  const send = tab.playwright.getByRole("button", { name: "发送", exact: true });
  const sendCount = await send.count();
  const enabled = sendCount === 1 ? await send.isEnabled() : false;
  if (sendCount !== 1 || !enabled) {
    return { ok: false, reason: `send count=${sendCount}, enabled=${enabled}` };
  }

  await send.click({ timeoutMs: 5000 });

  const observations = [];
  for (const delay of timeoutPlan) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const snap = await tab.playwright.domSnapshot();
    const logs = await tab.dev.logs({ levels: ["error"], limit: 50 });
    const replySeen = expectedAny.length === 0 || expectedAny.some((item) => snap.includes(item));
    const obs = {
      atMs: delay,
      consoleErrors: logs.map((l) => l.message),
      userPromptCount: (snap.match(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length,
      hasExpectedText: replySeen,
      hasThinkLeak: hasThinkLeak(snap),
      stillStreaming: snap.includes('button "停止生成"') || snap.includes("停止生成"),
      token,
    };
    observations.push(obs);
    if (obs.userPromptCount === 1 && obs.hasExpectedText && !obs.hasThinkLeak && !obs.stillStreaming) break;
  }

  const finalObservation = observations[observations.length - 1];
  return {
    ok:
      finalObservation?.userPromptCount === 1 &&
      finalObservation?.hasExpectedText === true &&
      finalObservation?.hasThinkLeak === false &&
      (finalObservation?.consoleErrors?.length || 0) === 0 &&
      finalObservation?.stillStreaming === false,
    name,
    prompt: actualPrompt,
    observations,
  };
}

export async function runChannelHttpHealth({ baseUrl = "http://127.0.0.1:15180", adoptId = DEFAULT_ADOPT_ID } = {}) {
  const checks = [];
  async function check(name, path, expectedStatus = [200, 400, 401, 403]) {
    try {
      const response = await fetch(`${baseUrl}${path}`, { method: "GET" });
      const text = await response.text().catch(() => "");
      checks.push({
        name,
        path,
        status: response.status,
        ok: expectedStatus.includes(response.status),
        bodyStart: text.slice(0, 200),
      });
    } catch (error) {
      checks.push({
        name,
        path,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const encodedAdoptId = encodeURIComponent(adoptId);
  await check("wechat status", `/api/claw/weixin/status?adoptId=${encodedAdoptId}`);
  await check("feishu status", `/api/claw/feishu/status?adoptId=${encodedAdoptId}`);
  return {
    ok: checks.every((item) => item.ok),
    checks,
  };
}

export async function runLingxiaUpgradeSmoke({ tab, safeWrite = true, includeOptional = true } = {}) {
  const readOnly = await runReadOnlySmoke({ tab, includeOptional });
  const marketplace = await runMarketplaceSmoke({ tab });
  const chat = safeWrite ? await runChatSmoke({ tab }) : { skipped: true };
  return {
    startedAt: new Date().toISOString(),
    url: await tab.url(),
    readOnly,
    marketplace,
    chat,
    summary: summarize({ readOnly, marketplace, chat }),
  };
}

export async function runSmokeV1({
  tab,
  adoptId = DEFAULT_ADOPT_ID,
  baseUrl = "http://127.0.0.1:15180",
  runId = `SMOKE-V1-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`,
} = {}) {
  const startedAt = new Date().toISOString();
  const cases = [];

  const targetUrl = `${baseUrl}/claw/${adoptId}`;
  let url = await tab.url();
  if (!url.includes(`/claw/${adoptId}`)) {
    await tab.goto(targetUrl);
    await safeNetworkIdle(tab, 15000);
    url = await tab.url();
  }
  cases.push(
    url.includes(`/claw/${adoptId}`)
      ? pass("route: logged-in adopt page", { url })
      : warn("route: logged-in adopt page", `current url does not include /claw/${adoptId}`, { url }),
  );

  const readOnly = await runReadOnlySmoke({ tab, includeOptional: true });
  for (const page of readOnly) {
    const prefix = `page:${page.label}`;
    if (!page.ok) {
      cases.push(fail(`${prefix}: open`, page.reason || "page failed to open"));
      continue;
    }
    cases.push(pass(`${prefix}: open`));
    cases.push(page.consoleErrors.length === 0 ? pass(`${prefix}: console`) : fail(`${prefix}: console`, "console errors", { errors: page.consoleErrors }));
    cases.push(!page.hasThinkLeak ? pass(`${prefix}: thinking leak`) : fail(`${prefix}: thinking leak`, "thinking text detected"));
    if (["技能", "设置", "定时任务", "频道"].includes(page.label)) {
      cases.push(!page.hasEmoji ? pass(`${prefix}: emoji policy`) : fail(`${prefix}: emoji policy`, "emoji detected"));
    }
    if (page.notLoading) {
      cases.push(pass(`${prefix}: loading settled`));
    } else {
      cases.push(warn(`${prefix}: loading settled`, "loading text still present in snapshot"));
    }
    for (const [fact, value] of Object.entries(page.facts || {})) {
      if (value === undefined) continue;
      cases.push(value ? pass(`${prefix}: ${fact}`) : fail(`${prefix}: ${fact}`, "required page fact missing"));
    }
  }

  const marketplace = await runMarketplaceSmoke({ tab });
  cases.push(marketplace.ok ? pass("marketplace: open") : fail("marketplace: open", marketplace.reason || "marketplace failed"));
  if (marketplace.ok) {
    cases.push(marketplace.consoleErrors.length === 0 ? pass("marketplace: console") : fail("marketplace: console", "console errors", { errors: marketplace.consoleErrors }));
    cases.push(!marketplace.hasThinkLeak ? pass("marketplace: thinking leak") : fail("marketplace: thinking leak", "thinking text detected"));
    cases.push(!marketplace.hasEmoji ? pass("marketplace: emoji policy") : fail("marketplace: emoji policy", "emoji detected"));
    cases.push(marketplace.hasMarket ? pass("marketplace: title") : fail("marketplace: title", "market title missing"));
    cases.push(marketplace.hasInstallState ? pass("marketplace: install state") : fail("marketplace: install state", "install/installed action missing"));
    cases.push(marketplace.hasCategoryChips ? pass("marketplace: category chips") : warn("marketplace: category chips", "not all expected category chip labels detected"));
  }

  const chat = await runChatSmoke({ tab });
  cases.push(chat.ok ? pass("chat: safe write") : fail("chat: safe write", "chat safe write failed", { chat }));
  if (chat.observations?.length) {
    const final = chat.observations[chat.observations.length - 1];
    cases.push(final.userPromptCount === 1 ? pass("chat: no duplicate user message") : fail("chat: no duplicate user message", `count=${final.userPromptCount}`));
    cases.push(final.hasThinkLeak === false ? pass("chat: no thinking leak") : fail("chat: no thinking leak", "thinking leak detected"));
    cases.push((final.consoleErrors?.length || 0) === 0 ? pass("chat: console") : fail("chat: console", "console errors", { errors: final.consoleErrors }));
    cases.push(final.stillStreaming === false ? pass("chat: stream completed") : fail("chat: stream completed", "still streaming at final observation"));
  }

  const skillTool = await runChatPromptSmoke({
    tab,
    name: "skill-list",
    prompt: "列出当前可用技能的名字和简短描述。",
    expectedAny: ["技能", "金融", "PPT", "研究", "行情", "报告"],
  });
  cases.push(skillTool.ok ? pass("tool: skill list") : fail("tool: skill list", "skill list chat tool smoke failed", { skillTool }));
  if (skillTool.observations?.length) {
    const final = skillTool.observations[skillTool.observations.length - 1];
    cases.push(final.userPromptCount === 1 ? pass("tool: skill list no duplicate") : fail("tool: skill list no duplicate", `count=${final.userPromptCount}`));
    cases.push(final.hasThinkLeak === false ? pass("tool: skill list no thinking leak") : fail("tool: skill list no thinking leak", "thinking leak detected"));
  }

  const cronTool = await runChatPromptSmoke({
    tab,
    name: "cron-list",
    prompt: "我有哪些定时任务？只读查询，不要创建、修改或运行任务。",
    expectedAny: ["定时", "任务", "每天", "暂无", "推送", "计划"],
  });
  cases.push(cronTool.ok ? pass("tool: cron list") : fail("tool: cron list", "cron list chat tool smoke failed", { cronTool }));
  if (cronTool.observations?.length) {
    const final = cronTool.observations[cronTool.observations.length - 1];
    cases.push(final.userPromptCount === 1 ? pass("tool: cron list no duplicate") : fail("tool: cron list no duplicate", `count=${final.userPromptCount}`));
    cases.push(final.hasThinkLeak === false ? pass("tool: cron list no thinking leak") : fail("tool: cron list no thinking leak", "thinking leak detected"));
  }

  const channelHealth = await runChannelHttpHealth({ baseUrl, adoptId });
  cases.push(channelHealth.ok ? pass("channel: http health") : fail("channel: http health", "channel health endpoint failed", { channelHealth }));

  const traceNotes = [
    "Tool trace prefix is currently warn-only. Harden after backend adds [SMOKE-TRACE][skill-list] and [SMOKE-TRACE][cron-list].",
  ];
  cases.push(warn("tool trace: backend prefix", traceNotes[0]));

  const finishedAt = new Date().toISOString();
  const counts = cases.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    },
    { pass: 0, warn: 0, fail: 0 },
  );
  const criticalFailures = cases.filter((item) => item.status === "fail");
  const coverage = {
    level: "v1",
    estimatedProductCoverage: 0.6,
    notes: [
      "Covers L0 externally via backend readiness script when paired with collect-lingxia-smoke-logs.sh.",
      "Covers L1 read-only browser navigation.",
      "Covers L2 safe chat write.",
      "Does not run reversible L3 side effects.",
    ],
  };

  return {
    runId,
    level: "v1",
    startedAt,
    finishedAt,
    url: await tab.url(),
    counts,
    ok: criticalFailures.length === 0,
    cases,
    artifacts: {
      readOnly,
      marketplace,
      chat,
      skillTool,
      cronTool,
      channelHealth,
    },
    coverage,
    markdown: renderMarkdownReport({ runId, startedAt, finishedAt, counts, cases, coverage }),
  };
}

function renderMarkdownReport({ runId, startedAt, finishedAt, counts, cases, coverage }) {
  const failed = cases.filter((item) => item.status === "fail");
  const warned = cases.filter((item) => item.status === "warn");
  const lines = [];
  lines.push(`# Lingxia Smoke ${runId}`);
  lines.push("");
  lines.push(`- Level: ${coverage.level}`);
  lines.push(`- Started: ${startedAt}`);
  lines.push(`- Finished: ${finishedAt}`);
  lines.push(`- Result: ${failed.length === 0 ? "PASS" : "FAIL"}`);
  lines.push(`- Counts: ${counts.pass || 0} pass / ${counts.warn || 0} warn / ${counts.fail || 0} fail`);
  lines.push(`- Estimated product coverage: ${Math.round(coverage.estimatedProductCoverage * 100)}%`);
  lines.push("");
  if (failed.length) {
    lines.push("## Failures");
    for (const item of failed) lines.push(`- ${item.name}: ${item.reason || "failed"}`);
    lines.push("");
  }
  if (warned.length) {
    lines.push("## Warnings");
    for (const item of warned) lines.push(`- ${item.name}: ${item.reason || "warning"}`);
    lines.push("");
  }
  lines.push("## Case Summary");
  for (const item of cases) {
    lines.push(`- [${item.status.toUpperCase()}] ${item.name}${item.reason ? ` — ${item.reason}` : ""}`);
  }
  return lines.join("\n");
}

function summarize({ readOnly, marketplace, chat }) {
  const failures = [];
  for (const page of readOnly || []) {
    if (!page.ok) failures.push(`${page.label}: ${page.reason || "not ok"}`);
    if (page.consoleErrors?.length) failures.push(`${page.label}: console errors`);
    if (page.hasThinkLeak) failures.push(`${page.label}: thinking leak`);
    if (page.hasEmoji && ["技能", "技能广场", "设置", "定时任务", "频道"].includes(page.label)) {
      failures.push(`${page.label}: emoji found`);
    }
  }
  if (!marketplace?.ok) failures.push(`marketplace: ${marketplace?.reason || "not ok"}`);
  if (marketplace?.consoleErrors?.length) failures.push("marketplace: console errors");
  if (marketplace?.hasThinkLeak) failures.push("marketplace: thinking leak");
  if (marketplace?.hasEmoji) failures.push("marketplace: emoji found");
  if (chat && !chat.skipped && !chat.ok) failures.push("chat: safe write failed");
  return {
    ok: failures.length === 0,
    failures,
  };
}

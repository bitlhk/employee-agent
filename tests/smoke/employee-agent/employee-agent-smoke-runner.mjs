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

async function getChatInput(tab) {
  const withSafeFill = (input) =>
    new Proxy(input, {
      get(target, property) {
        if (property !== "fill") {
          const value = target[property];
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async (value, options = {}) => {
          try {
            return await target.fill(value, options);
          } catch (error) {
            if (!String(error?.message || error).includes("ClipboardItem")) throw error;
            await target.click({ timeoutMs: options.timeoutMs || 5000 });
            await target.press("Control+A", { timeoutMs: options.timeoutMs || 5000 });
            await target.press("Backspace", { timeoutMs: options.timeoutMs || 5000 });
            if (typeof tab.__iabInsertText === "function") return tab.__iabInsertText(value);
            if (tab.cua?.type) return tab.cua.type({ text: value });
            return target.type(value, options);
          }
        };
      },
    });
  const names = ["Message 员工智能体…", "Message Enterprise Agent…", "Message 智能体…", "Message 员工智能体…", "Message 灵感精灵…", "Message 员工智能体...", "Message Enterprise Agent...", "Message 智能体...", "Message 员工智能体...", "Message 灵感精灵..."];
  for (const name of names) {
    const input = tab.playwright.getByRole("textbox", { name, exact: true });
    if ((await input.count()) === 1) return withSafeFill(input);
  }
  const fallback = tab.playwright.locator("textarea,[contenteditable='true'],[role='textbox']");
  if ((await fallback.count()) === 1) return withSafeFill(fallback);
  return null;
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
      input:
        snap.includes("Message 员工智能体") ||
        snap.includes("Message 智能体") ||
        snap.includes("Message Enterprise Agent") ||
        snap.includes("Message Employee Agent") ||
        snap.includes('textbox "'),
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

  const input = await getChatInput(tab);
  const inputCount = input ? await input.count() : 0;
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

  const input = await getChatInput(tab);
  const inputCount = input ? await input.count() : 0;
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

export async function runAgentUpgradeSmoke({ tab, safeWrite = true, includeOptional = true } = {}) {
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

async function getSnapshot(tab) {
  return tab.playwright.domSnapshot();
}

async function waitForSnapshot(tab, predicate, timeoutMs = 30000, intervalMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  let snap = "";
  while (Date.now() < deadline) {
    snap = await getSnapshot(tab);
    if (predicate(snap)) return { ok: true, snap };
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { ok: false, snap };
}

async function runChatAction({ tab, name, prompt, expectedAny = [], timeoutPlan = [0, 10000, 25000, 45000, 70000] } = {}) {
  return runChatPromptSmoke({ tab, name, prompt, expectedAny, timeoutPlan });
}

async function browserFetchJson(tab, path, options = {}) {
  if (typeof tab.__fetchJson === "function") return tab.__fetchJson(path, options);
  if (typeof tab.__baseUrl !== "string") throw new Error("tab.__baseUrl is required for browserFetchJson fallback");
  const resp = await fetch(new URL(path, tab.__baseUrl).toString(), options);
  return {
    ok: resp.ok,
    status: resp.status,
    data: await resp.json().catch(() => ({})),
  };
}

async function browserFetchText(tab, path, options = {}) {
  if (typeof tab.__fetchText === "function") return tab.__fetchText(path, options);
  if (typeof tab.__baseUrl !== "string") throw new Error("tab.__baseUrl is required for browserFetchText fallback");
  const resp = await fetch(new URL(path, tab.__baseUrl).toString(), options);
  return {
    ok: resp.ok,
    status: resp.status,
    text: await resp.text(),
    headers: Object.fromEntries(resp.headers.entries()),
  };
}

async function listWorkspaceFiles(tab, adoptId, subPath = "") {
  const path = `/api/claw/files/list?adoptId=${encodeURIComponent(adoptId)}${subPath ? `&path=${encodeURIComponent(subPath)}` : ""}`;
  const resp = await browserFetchJson(tab, path);
  return Array.isArray(resp?.data?.files) ? resp.data.files : [];
}

async function readWorkspaceFile(tab, adoptId, filePath) {
  return browserFetchJson(tab, `/api/claw/files/read?adoptId=${encodeURIComponent(adoptId)}&path=${encodeURIComponent(filePath)}`);
}

async function deleteWorkspacePath(tab, adoptId, filePath) {
  return browserFetchJson(tab, "/api/claw/files/delete", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adoptId, path: filePath }),
  });
}

async function createSiblingTab(tab, url) {
  if (typeof tab.__newTab === "function") return tab.__newTab(url);
  if (typeof tab.newTab === "function") return tab.newTab(url);
  return null;
}

async function getWebConversationSnapshot(tab, adoptId) {
  if (typeof tab.__evaluate !== "function") return null;
  return tab.__evaluate((id) => {
    const conversationKey = `lingxia_web_conversation_${id}`;
    const conversationId = window.sessionStorage.getItem(conversationKey) || "";
    const messageKeys = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i) || "";
      if (key.startsWith(`lgc_msgs_${id}_`)) messageKeys.push(key);
    }
    messageKeys.sort();
    return {
      conversationKey,
      conversationId,
      messageKey: conversationId ? `lgc_msgs_${id}_${conversationId}` : "",
      messageKeys,
    };
  }, adoptId);
}

async function listRegistrySkills(tab, adoptId) {
  const resp = await browserFetchJson(tab, `/api/claw/skills/registry?adoptId=${encodeURIComponent(adoptId)}`);
  return Array.isArray(resp?.data?.items) ? resp.data.items : [];
}

function skillDisplayName(skill) {
  return String(skill?.source?.displayName || skill?.displayName || skill?.name || skill?.id || "");
}

async function findSkillByMarker(tab, adoptId, marker) {
  const items = await listRegistrySkills(tab, adoptId);
  return items.find((skill) =>
    skillDisplayName(skill).includes(marker) ||
    String(skill?.id || "").includes(marker) ||
    String(skill?.source?.description || skill?.description || "").includes(marker)
  );
}

export async function runComplexConversationSmoke({ tab, runId } = {}) {
  const marker = `${runId}-complex`;
  const prompt = [
    `复杂任务 smoke ${marker}。`,
    "请完成一个三步小任务：",
    "1. 先把目标拆成 3 个步骤。",
    "2. 再给出一个包含两行的 Markdown 表格。",
    "3. 最后只用一行写出 CHECKPOINT: COMPLEX_OK。",
    "不要创建文件、不要创建定时任务、不要调用外部工具。",
  ].join("\n");
  const result = await runChatAction({
    tab,
    name: "complex-dialogue",
    prompt,
    expectedAny: ["CHECKPOINT: COMPLEX_OK", "COMPLEX_OK", "步骤", "表格"],
    timeoutPlan: [0, 10000, 25000, 50000, 80000],
  });
  const final = result.observations?.[result.observations.length - 1];
  result.ok = Boolean(
    final?.hasExpectedText &&
    final?.hasThinkLeak === false &&
    final?.stillStreaming === false &&
    (final?.consoleErrors?.length || 0) === 0
  );
  return result;
}

export async function runScheduleLifecycleSmoke({ tab, adoptId = DEFAULT_ADOPT_ID, runId } = {}) {
  const taskName = `smoke-once-${runId}`.slice(0, 48);
  const hostCronLeakMarkers = ["daily-briefing-xing-1610", "keepalive-5174-linggan"];
  const create = await runChatAction({
    tab,
    name: "schedule-create",
    prompt: `创建一个测试定时任务，名称必须是 ${taskName}。计划设置为明天上午 09:17 执行一次。执行内容是只回复 ${taskName} ping。投递渠道使用主聊天或 conversation。创建后回复任务名称。`,
    expectedAny: [taskName, "定时任务已创建", "已创建", "任务"],
    timeoutPlan: [0, 10000, 25000, 50000, 80000],
  });

  await clickNav(tab, "定时任务");
  const listed = await waitForSnapshot(tab, (snap) => snap.includes(taskName), 25000);

  const query = await runChatAction({
    tab,
    name: "schedule-query-isolation",
    prompt: `查询当前智能体实例自己的定时任务。只能列出当前智能体实例可见的任务；如果存在 ${taskName}，请列出这个任务。不要列出宿主机或其他智能体实例的任务。`,
    expectedAny: [taskName, "定时任务", "任务"],
    timeoutPlan: [0, 10000, 25000, 50000, 80000],
  });
  const querySnapshot = await getSnapshot(tab);
  const leakedHostTasks = hostCronLeakMarkers.filter((marker) => querySnapshot.includes(marker));

  const remove = await runChatAction({
    tab,
    name: "schedule-delete",
    prompt: `删除名称包含 ${taskName} 的定时任务。删除后回复 DELETED ${taskName}。`,
    expectedAny: [taskName, "已删除", "DELETED"],
    timeoutPlan: [0, 10000, 25000, 50000, 80000],
  });

  await clickNav(tab, "定时任务");
  const gone = await waitForSnapshot(tab, (snap) => !snap.includes(taskName), 25000);

  return {
    ok: Boolean(create.ok && listed.ok && query.ok && leakedHostTasks.length === 0 && remove.ok && gone.ok),
    taskName,
    create,
    listed: { ok: listed.ok },
    query,
    leakedHostTasks,
    remove,
    gone: { ok: gone.ok },
  };
}

export async function runGeneratedSkillLifecycleSmoke({ tab, adoptId = DEFAULT_ADOPT_ID, runId } = {}) {
  const shortRun = String(runId || Date.now()).replace(/[^a-zA-Z0-9_-]/g, "-").slice(-12);
  const marker = `smoke-skill-${shortRun}`;
  const displayName = `烟测技能 ${marker}`;
  const createPrompt = [
    `生成一个个人技能，名称必须是「${displayName}」。`,
    `技能用途：当用户输入 ${marker} 时，说明这是 smoke 测试技能，并返回 SKILL_OK。`,
    "请明确创建技能/插件/工具包，调用 create_skill 工具。",
    "必须生成文件 SKILL.md，内容尽量短，不要创建定时任务。",
    `生成并同步后回复 CREATED ${marker}。`,
  ].join("\n");

  const create = await runChatAction({
    tab,
    name: "skill-generate",
    prompt: createPrompt,
    expectedAny: [marker, "技能", "已生成", "CREATED"],
    timeoutPlan: [0, 15000, 35000, 70000, 110000],
  });

  let skill = await findSkillByMarker(tab, adoptId, marker);
  let retryCreate = null;
  if (!skill) {
    retryCreate = await runChatAction({
      tab,
      name: "skill-generate-retry",
      prompt: [
        `请现在创建一个技能/插件/工具包，不是普通聊天回答。`,
        `技能名称：${displayName}`,
        `技能说明：当用户输入 ${marker} 时，回复 SKILL_OK 并说明这是 smoke 测试技能。`,
        "请调用 create_skill 工具，files 必须包含 SKILL.md，SKILL.md 里写明触发词和返回内容。",
        `成功后回复 CREATED ${marker}。`,
      ].join("\n"),
      expectedAny: [marker, "技能", "已生成", "CREATED"],
      timeoutPlan: [0, 15000, 35000, 70000, 110000],
    });
    skill = await findSkillByMarker(tab, adoptId, marker);
  }
  if (!skill) {
    await clickNav(tab, "技能");
    await waitForSnapshot(tab, (snap) => snap.includes(marker) || snap.includes(displayName), 30000);
    skill = await findSkillByMarker(tab, adoptId, marker);
  }

  await clickNav(tab, "技能");
  const menuListed = await waitForSnapshot(tab, (snap) => snap.includes(marker) || snap.includes(displayName), 30000);

  const destroy = skill ? await browserFetchJson(tab, "/api/claw/skills/destroy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adoptId, skillId: skill.id }),
  }) : { ok: false, status: 0, data: { error: "skill not found" } };

  await clickNav(tab, "工作空间");
  const workspaceAfterDestroy = await getSnapshot(tab);
  await clickNav(tab, "技能");
  const menuGone = await waitForSnapshot(tab, (snap) => !snap.includes(marker) && !snap.includes(displayName), 30000);
  const registryGone = !(await findSkillByMarker(tab, adoptId, marker));

  return {
    ok: Boolean(create.ok && skill && menuListed.ok && destroy.ok && menuGone.ok && registryGone),
    marker,
    displayName,
    skillId: skill?.id || null,
    create,
    retryCreate,
    menuListed: { ok: menuListed.ok },
    destroy: { ok: destroy.ok, status: destroy.status, error: destroy?.data?.error },
    workspaceMentionsSkillAfterDestroy: workspaceAfterDestroy.includes(marker) || workspaceAfterDestroy.includes(displayName),
    menuGone: { ok: menuGone.ok },
    registryGone,
  };
}

export async function runArtifactFileSmoke({ tab, adoptId = DEFAULT_ADOPT_ID, runId } = {}) {
  const shortRun = String(runId || Date.now()).replace(/[^a-zA-Z0-9_-]/g, "-").slice(-12);
  const marker = `smoke-artifact-${shortRun}`;
  const fileName = `${marker}.md`;
  const expectedPath = `output/${fileName}`;
  const prompt = [
    `创建一个可下载的 Markdown 产物文件，文件名必须是 ${fileName}。`,
    `文件内容必须包含一行：ARTIFACT_OK ${marker}`,
    `优先写到 workspace 的 output/${fileName}。`,
    "请调用文件写入工具完成，不要只在聊天里粘贴内容。",
    `完成后回复 FILE_CREATED ${marker}。`,
  ].join("\n");

  const create = await runChatAction({
    tab,
    name: "artifact-file-create",
    prompt,
    expectedAny: [marker, "FILE_CREATED", "产出文件", fileName],
    timeoutPlan: [0, 15000, 35000, 70000, 110000],
  });

  const files = await listWorkspaceFiles(tab, adoptId);
  let file = files.find((item) => String(item.path || "").includes(marker) || String(item.name || "").includes(marker));
  if (!file) {
    const outputFiles = await listWorkspaceFiles(tab, adoptId, "output");
    file = outputFiles.find((item) => String(item.path || "").includes(marker) || String(item.name || "").includes(marker));
  }
  const filePath = String(file?.path || expectedPath);
  const read = file ? await readWorkspaceFile(tab, adoptId, filePath) : { ok: false, status: 0, data: { error: "file not found" } };
  const token = file ? await browserFetchJson(tab, "/api/claw/files/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adoptId, path: filePath, ttl: 300 }),
  }) : { ok: false, status: 0, data: { error: "file not found" } };
  const download = token?.data?.url ? await browserFetchText(tab, token.data.url) : { ok: false, status: 0, text: "" };

  await clickNav(tab, "工作空间");
  const workspaceVisible = await waitForSnapshot(tab, (snap) => snap.includes(fileName) || snap.includes(marker), 30000);

  const cleanup = file ? await deleteWorkspacePath(tab, adoptId, filePath) : { ok: false, status: 0, data: { error: "file not found" } };
  const filesAfterCleanup = await listWorkspaceFiles(tab, adoptId);
  const cleanupGone = !filesAfterCleanup.some((item) => String(item.path || "").includes(marker) || String(item.name || "").includes(marker));

  return {
    ok: Boolean(
      create.ok &&
      file &&
      read.ok &&
      String(read?.data?.content || "").includes(`ARTIFACT_OK ${marker}`) &&
      token.ok &&
      download.ok &&
      download.text.includes(`ARTIFACT_OK ${marker}`) &&
      workspaceVisible.ok &&
      cleanup.ok &&
      cleanupGone
    ),
    marker,
    fileName,
    filePath: file ? filePath : null,
    create,
    fileListed: Boolean(file),
    read: { ok: Boolean(read.ok), status: read.status },
    token: { ok: Boolean(token.ok), status: token.status },
    download: { ok: Boolean(download.ok), status: download.status, hasMarker: download.text.includes(`ARTIFACT_OK ${marker}`) },
    workspaceVisible: { ok: workspaceVisible.ok },
    cleanup: { ok: Boolean(cleanup.ok), status: cleanup.status },
    cleanupGone,
  };
}

export async function runConcurrentWindowSmoke({ tab, adoptId = DEFAULT_ADOPT_ID, baseUrl = "http://127.0.0.1:15180", runId } = {}) {
  const targetUrl = `${baseUrl}/claw/${adoptId}`;
  const sibling = await createSiblingTab(tab, targetUrl);
  if (!sibling) {
    return { ok: false, skipped: true, reason: "tab.newTab or tab.__newTab is not available in this browser adapter" };
  }
  let siblingClosed = false;
  try {
    const markerA = `CONCURRENT_A_${String(runId || Date.now()).replace(/[^a-zA-Z0-9_]/g, "_").slice(-18)}`;
    const markerB = `CONCURRENT_B_${String(runId || Date.now()).replace(/[^a-zA-Z0-9_]/g, "_").slice(-18)}`;
    await safeNetworkIdle(sibling, 15000);
    const sessionBefore = {
      windowA: await getWebConversationSnapshot(tab, adoptId),
      windowB: await getWebConversationSnapshot(sibling, adoptId),
    };

    const [resultA, resultB] = await Promise.all([
      runChatAction({
        tab,
        name: "concurrent-window-a",
        prompt: `并发窗口 A 测试。请只回复 ${markerA}，不要回复 ${markerB}，不要创建文件或定时任务。`,
        expectedAny: [markerA],
        timeoutPlan: [0, 10000, 25000, 50000, 80000],
      }),
      runChatAction({
        tab: sibling,
        name: "concurrent-window-b",
        prompt: `并发窗口 B 测试。请只回复 ${markerB}，不要回复 ${markerA}，不要创建文件或定时任务。`,
        expectedAny: [markerB],
        timeoutPlan: [0, 10000, 25000, 50000, 80000],
      }),
    ]);

    const snapA = await getSnapshot(tab);
    const snapB = await getSnapshot(sibling);
    const aHasA = snapA.includes(markerA);
    const aHasB = snapA.includes(markerB);
    const bHasA = snapB.includes(markerA);
    const bHasB = snapB.includes(markerB);
    const isolatedTabs = aHasA && !aHasB && bHasB && !bHasA;
    const sharedHistoryTabs = aHasA && aHasB && bHasA && bHasB;
    const wrongWindowA = !aHasA && aHasB;
    const wrongWindowB = !bHasB && bHasA;
    const sessionAfter = {
      windowA: await getWebConversationSnapshot(tab, adoptId),
      windowB: await getWebConversationSnapshot(sibling, adoptId),
    };
    const conversationDistinct = Boolean(
      sessionAfter.windowA?.conversationId &&
      sessionAfter.windowB?.conversationId &&
      sessionAfter.windowA.conversationId !== sessionAfter.windowB.conversationId
    );
    const messageStorageScoped = Boolean(
      sessionAfter.windowA?.messageKey &&
      sessionAfter.windowB?.messageKey &&
      sessionAfter.windowA.messageKey !== sessionAfter.windowB.messageKey &&
      sessionAfter.windowA.messageKeys?.includes(sessionAfter.windowA.messageKey) &&
      sessionAfter.windowB.messageKeys?.includes(sessionAfter.windowB.messageKey)
    );

    return {
      ok: Boolean(resultA.ok && resultB.ok && isolatedTabs && conversationDistinct && !wrongWindowA && !wrongWindowB),
      skipped: false,
      markerA,
      markerB,
      resultA,
      resultB,
      visibility: { aHasA, aHasB, bHasA, bHasB, isolatedTabs, sharedHistoryTabs, wrongWindowA, wrongWindowB },
      session: { before: sessionBefore, after: sessionAfter, conversationDistinct, messageStorageScoped },
    };
  } finally {
    if (typeof sibling.close === "function") {
      await sibling.close().catch(() => {});
      siblingClosed = true;
    }
    void siblingClosed;
  }
}

export async function runSmokeV2({
  tab,
  adoptId = DEFAULT_ADOPT_ID,
  baseUrl = "http://127.0.0.1:15180",
  runId = `SMOKE-V2-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`,
  includeV1 = true,
} = {}) {
  tab.__baseUrl = baseUrl;
  const startedAt = new Date().toISOString();
  const cases = [];
  const artifacts = {};

  if (includeV1) {
    artifacts.v1 = await runSmokeV1({ tab, adoptId, baseUrl, runId: `${runId}-BASE` });
    for (const item of artifacts.v1.cases) cases.push({ ...item, name: `v1:${item.name}` });
  }

  artifacts.complex = await runComplexConversationSmoke({ tab, runId });
  cases.push(artifacts.complex.ok ? pass("v2: complex dialogue") : fail("v2: complex dialogue", artifacts.complex.reason || "complex dialogue failed", { complex: artifacts.complex }));

  artifacts.scheduleLifecycle = await runScheduleLifecycleSmoke({ tab, adoptId, runId });
  cases.push(artifacts.scheduleLifecycle.create.ok ? pass("v2: schedule create via chat") : fail("v2: schedule create via chat", artifacts.scheduleLifecycle.create.reason || "create failed"));
  cases.push(artifacts.scheduleLifecycle.listed.ok ? pass("v2: schedule visible in menu") : fail("v2: schedule visible in menu", "created task not visible"));
  cases.push(artifacts.scheduleLifecycle.query.ok ? pass("v2: schedule query via chat") : fail("v2: schedule query via chat", artifacts.scheduleLifecycle.query.reason || "query failed"));
  cases.push(artifacts.scheduleLifecycle.leakedHostTasks.length === 0 ? pass("v2: schedule tenant isolation") : fail("v2: schedule tenant isolation", `host tasks leaked: ${artifacts.scheduleLifecycle.leakedHostTasks.join(", ")}`));
  cases.push(artifacts.scheduleLifecycle.remove.ok ? pass("v2: schedule delete via chat") : fail("v2: schedule delete via chat", artifacts.scheduleLifecycle.remove.reason || "delete failed"));
  cases.push(artifacts.scheduleLifecycle.gone.ok ? pass("v2: schedule removed from menu") : fail("v2: schedule removed from menu", "deleted task still visible"));

  artifacts.skillLifecycle = await runGeneratedSkillLifecycleSmoke({ tab, adoptId, runId });
  cases.push(artifacts.skillLifecycle.create.ok ? pass("v2: skill generate via chat") : fail("v2: skill generate via chat", artifacts.skillLifecycle.create.reason || "skill generation failed"));
  cases.push(artifacts.skillLifecycle.menuListed.ok ? pass("v2: generated skill visible in skills") : fail("v2: generated skill visible in skills", "generated skill not visible"));
  cases.push(artifacts.skillLifecycle.destroy.ok ? pass("v2: generated skill destroy") : fail("v2: generated skill destroy", artifacts.skillLifecycle.destroy.error || "destroy failed"));
  cases.push(artifacts.skillLifecycle.menuGone.ok ? pass("v2: generated skill cleared from skills") : fail("v2: generated skill cleared from skills", "deleted skill still visible"));
  cases.push(!artifacts.skillLifecycle.workspaceMentionsSkillAfterDestroy ? pass("v2: workspace clear after skill delete") : fail("v2: workspace clear after skill delete", "workspace still mentions generated skill marker"));
  cases.push(artifacts.skillLifecycle.registryGone ? pass("v2: registry clear after skill delete") : fail("v2: registry clear after skill delete", "registry still contains generated skill"));

  artifacts.artifactFile = await runArtifactFileSmoke({ tab, adoptId, runId });
  cases.push(artifacts.artifactFile.create.ok ? pass("v2: artifact create via chat") : fail("v2: artifact create via chat", artifacts.artifactFile.create.reason || "artifact creation failed"));
  cases.push(artifacts.artifactFile.fileListed ? pass("v2: artifact listed in workspace API") : fail("v2: artifact listed in workspace API", "created artifact not found in workspace list"));
  cases.push(artifacts.artifactFile.read.ok ? pass("v2: artifact readable") : fail("v2: artifact readable", "created artifact cannot be read"));
  cases.push(artifacts.artifactFile.download.ok && artifacts.artifactFile.download.hasMarker ? pass("v2: artifact downloadable") : fail("v2: artifact downloadable", "download token or file content missing marker"));
  cases.push(artifacts.artifactFile.workspaceVisible.ok ? pass("v2: artifact visible in workspace UI") : fail("v2: artifact visible in workspace UI", "workspace UI does not show created artifact"));
  cases.push(artifacts.artifactFile.cleanup.ok && artifacts.artifactFile.cleanupGone ? pass("v2: artifact cleanup") : fail("v2: artifact cleanup", "created artifact cleanup failed"));

  artifacts.concurrentWindows = await runConcurrentWindowSmoke({ tab, adoptId, baseUrl, runId });
  if (artifacts.concurrentWindows.skipped) {
    cases.push(warn("v2: concurrent windows", artifacts.concurrentWindows.reason));
  } else {
    cases.push(artifacts.concurrentWindows.resultA.ok ? pass("v2: concurrent window A reply") : fail("v2: concurrent window A reply", artifacts.concurrentWindows.resultA.reason || "window A did not complete"));
    cases.push(artifacts.concurrentWindows.resultB.ok ? pass("v2: concurrent window B reply") : fail("v2: concurrent window B reply", artifacts.concurrentWindows.resultB.reason || "window B did not complete"));
    cases.push(artifacts.concurrentWindows.ok
      ? pass("v2: concurrent window stream isolation", { session: artifacts.concurrentWindows.session })
      : fail("v2: concurrent window stream isolation", "reply markers were missing, attached to the wrong window, or windows shared one web conversationId", {
        visibility: artifacts.concurrentWindows.visibility,
        session: artifacts.concurrentWindows.session,
      }));
  }

  cases.push(warn("v2: side effects", "Creates then deletes one schedule, one generated skill, and one generated artifact with a runId marker."));

  const finishedAt = new Date().toISOString();
  const counts = cases.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, { pass: 0, warn: 0, fail: 0 });
  const coverage = {
    level: "v2",
    estimatedProductCoverage: 0.86,
    notes: [
      "Includes v1 navigation/chat/channel checks when includeV1 is true.",
      "Adds complex dialogue, reversible schedule lifecycle, schedule tenant isolation, generated skill lifecycle, artifact file lifecycle/download, concurrent window session isolation, and cleanup verification.",
    ],
  };
  return {
    runId,
    level: "v2",
    startedAt,
    finishedAt,
    url: await tab.url(),
    counts,
    ok: cases.every((item) => item.status !== "fail"),
    cases,
    artifacts,
    coverage,
    markdown: renderMarkdownReport({ runId, startedAt, finishedAt, counts, cases, coverage }),
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
  lines.push(`# Employee Agent Smoke ${runId}`);
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

// Backward-compatible export for older browser-plugin snippets.
export const runLingxiaUpgradeSmoke = runAgentUpgradeSmoke;

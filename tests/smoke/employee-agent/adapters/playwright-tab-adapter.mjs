function normalizeOptions(options = {}) {
  const out = { ...options };
  if (out.timeoutMs !== undefined && out.timeout === undefined) {
    out.timeout = out.timeoutMs;
    delete out.timeoutMs;
  }
  return out;
}

class LocatorAdapter {
  constructor(locator) {
    this.locator = locator;
  }

  count() { return this.locator.count(); }
  click(options = {}) { return this.locator.click(normalizeOptions(options)); }
  fill(value, options = {}) { return this.locator.fill(value, normalizeOptions(options)); }
  press(key, options = {}) { return this.locator.press(key, normalizeOptions(options)); }
  type(value, options = {}) { return this.locator.type(value, normalizeOptions(options)); }
  isEnabled() { return this.locator.isEnabled(); }
  isVisible() { return this.locator.isVisible(); }
  textContent(options = {}) { return this.locator.textContent(normalizeOptions(options)); }
  innerText(options = {}) { return this.locator.innerText(normalizeOptions(options)); }
  allTextContents(options = {}) { return this.locator.allTextContents(normalizeOptions(options)); }
  waitFor(options = {}) { return this.locator.waitFor(normalizeOptions(options)); }
  locator(selector, options = {}) { return new LocatorAdapter(this.locator.locator(selector, options)); }
  getByRole(role, options = {}) { return new LocatorAdapter(this.locator.getByRole(role, options)); }
  getByText(text, options = {}) { return new LocatorAdapter(this.locator.getByText(text, options)); }
  getByLabel(text, options = {}) { return new LocatorAdapter(this.locator.getByLabel(text, options)); }
  getByPlaceholder(text, options = {}) { return new LocatorAdapter(this.locator.getByPlaceholder(text, options)); }
  getByTestId(testId) { return new LocatorAdapter(this.locator.getByTestId(testId)); }
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function domSnapshot(page) {
  return page.evaluate(() => {
    const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const all = (selector) => Array.from(document.querySelectorAll(selector));
    const lines = [];

    if (document.querySelector("main,[role='main']")) lines.push("- main:");

    for (const el of all("button,[role='button']")) {
      const name = compact(el.getAttribute("aria-label") || el.textContent || el.getAttribute("title"));
      if (name) lines.push(`button "${name}"`);
    }

    for (const el of all("[role='tab'],button[aria-selected]")) {
      const name = compact(el.getAttribute("aria-label") || el.textContent);
      if (name) lines.push(`tab "${name}"`);
    }

    for (const el of all("input,textarea,[contenteditable='true'],[role='textbox']")) {
      const name = compact(el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.textContent);
      if (name) lines.push(`textbox "${name}"`);
    }

    for (const el of all("select,[role='combobox']")) {
      const name = compact(el.getAttribute("aria-label") || el.textContent);
      lines.push(name ? `combobox "${name}"` : "combobox");
    }

    lines.push(compact(document.body?.innerText || ""));
    return lines.join("\n");
  });
}

export function createPlaywrightTabAdapter(page, { consoleErrors = [] } = {}) {
  const wrap = (locator) => new LocatorAdapter(locator);
  const pageFetch = async (path, options = {}, responseType = "json") =>
    page.evaluate(async ({ path, options, responseType }) => {
      const resp = await fetch(path, { ...options, credentials: "include" });
      const text = await resp.text();
      let data = null;
      if (responseType === "json") {
        try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
      }
      return {
        ok: resp.ok,
        status: resp.status,
        data,
        text,
        headers: Object.fromEntries(resp.headers.entries()),
      };
    }, { path, options, responseType });
  const makeAdapter = (nextPage) => {
    const nextErrors = attachConsoleCollectors(nextPage);
    return createPlaywrightTabAdapter(nextPage, { consoleErrors: nextErrors });
  };
  return {
    goto: (url) => page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }),
    url: () => page.url(),
    title: () => page.title(),
    reload: () => page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }),
    close: () => page.close(),
    newTab: async (url) => {
      const nextPage = await page.context().newPage();
      if (url) await nextPage.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      return makeAdapter(nextPage);
    },
    __fetchJson: (path, options = {}) => pageFetch(path, options, "json"),
    __fetchText: (path, options = {}) => pageFetch(path, options, "text"),
    __evaluate: (fn, arg) => page.evaluate(fn, arg),
    playwright: {
      waitForLoadState: async ({ state = "load", timeoutMs = 12000 } = {}) =>
        page.waitForLoadState(state, { timeout: timeoutMs }),
      domSnapshot: () => domSnapshot(page),
      getByRole: (role, options = {}) => wrap(page.getByRole(role, options)),
      getByText: (text, options = {}) => wrap(page.getByText(text, options)),
      getByLabel: (text, options = {}) => wrap(page.getByLabel(text, options)),
      getByPlaceholder: (text, options = {}) => wrap(page.getByPlaceholder(text, options)),
      getByTestId: (testId) => wrap(page.getByTestId(testId)),
      locator: (selector) => wrap(page.locator(selector)),
      screenshot: (options = {}) => page.screenshot(options),
    },
    dev: {
      logs: async ({ levels = ["error"], limit = 50 } = {}) =>
        consoleErrors.filter((item) => levels.includes(item.level)).slice(-limit),
    },
  };
}

export function attachConsoleCollectors(page) {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push({
        level: "error",
        message: compactText(msg.text()),
        timestamp: new Date().toISOString(),
        url: page.url(),
      });
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push({
      level: "error",
      message: compactText(error.message),
      timestamp: new Date().toISOString(),
      url: page.url(),
    });
  });
  return consoleErrors;
}

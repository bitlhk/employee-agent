import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "./tenant-isolation";

const tempDirs: string[] = [];

function makeOpenClawConfig() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tenant-isolation-"));
  tempDirs.push(dir);
  const configPath = path.join(dir, "openclaw.json");
  writeFileSync(configPath, JSON.stringify({ agents: { list: [] } }), "utf8");
  return { dir, configPath };
}

async function loadTenantIsolation(env: Record<string, string | undefined>) {
  vi.resetModules();
  vi.doMock("child_process", () => ({
    execFileSync: vi.fn(() => {
      throw new Error("gateway unavailable");
    }),
  }));
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    TIL_STRICT_AGENT_ISOLATION: process.env.TIL_STRICT_AGENT_ISOLATION,
    CLAW_OPENCLAW_JSON: process.env.CLAW_OPENCLAW_JSON,
  };
  Object.assign(process.env, env);
  const mod = await import("./tenant-isolation");
  return { mod, previous };
}

function restoreEnv(previous: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  vi.doUnmock("child_process");
  vi.resetModules();
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("tenant isolation strict agent registration", () => {
  const tenantCtx: TenantContext = {
    userId: 7,
    agentId: "task-ppt",
    tenantToken: "tenant-token",
    tenantShort: "tenantshort1234",
    workspace: "/tmp/tenant-workspace",
    sessionKey: "business:task-ppt:t:tenantshort1234:main",
  };

  it("fails closed in production when per-tenant agent registration fails", async () => {
    const { configPath } = makeOpenClawConfig();
    const { mod, previous } = await loadTenantIsolation({
      NODE_ENV: "production",
      TIL_STRICT_AGENT_ISOLATION: undefined,
      CLAW_OPENCLAW_JSON: configPath,
    });
    try {
      expect(() => mod.ensurePerTenantAgent("task-ppt", tenantCtx)).toThrow(/strict isolation mode/);
    } finally {
      restoreEnv(previous);
    }
  });

  it("can be forced strict outside production", async () => {
    const { configPath } = makeOpenClawConfig();
    const { mod, previous } = await loadTenantIsolation({
      NODE_ENV: "development",
      TIL_STRICT_AGENT_ISOLATION: "true",
      CLAW_OPENCLAW_JSON: configPath,
    });
    try {
      expect(() => mod.ensurePerTenantAgent("task-ppt", tenantCtx)).toThrow(/strict isolation mode/);
    } finally {
      restoreEnv(previous);
    }
  });

  it("keeps the legacy fallback in non-strict development mode", async () => {
    const { configPath } = makeOpenClawConfig();
    const { mod, previous } = await loadTenantIsolation({
      NODE_ENV: "development",
      TIL_STRICT_AGENT_ISOLATION: "false",
      CLAW_OPENCLAW_JSON: configPath,
    });
    try {
      expect(mod.ensurePerTenantAgent("task-ppt", tenantCtx)).toBe("task-ppt");
    } finally {
      restoreEnv(previous);
    }
  });
});

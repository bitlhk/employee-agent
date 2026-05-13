#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_SKILL_ROOT = "/home/ubuntu/.employee-agent/hermes-runtime-skills/anthropic-financial-services/current";
const LEGACY_SKILL_ROOT = "/home/ubuntu/.lingxia/hermes-runtime-skills/anthropic-financial-services/current";
const DEFAULT_PROFILE_ROOT = "/home/ubuntu/.hermes/profiles";
const DEFAULT_ENDPOINTS = ["http://127.0.0.1:18650", "http://127.0.0.1:8670"];
const DEFAULT_EXECUTOR_SERVICE = "financial-agent-harness-executor.service";
const LEGACY_EXECUTOR_SERVICE = "lingxia-financial-harness-executor.service";

function parseArgs(argv) {
  const args = {
    manifest: process.env.FIN_HARNESS_MANIFEST_PATH || "",
    schemaRoot: process.env.FIN_HARNESS_SCHEMA_ROOT || "",
    skillRoot: process.env.HERMES_RUNTIME_SKILL_ROOT || (fs.existsSync(DEFAULT_SKILL_ROOT) || !fs.existsSync(LEGACY_SKILL_ROOT) ? DEFAULT_SKILL_ROOT : LEGACY_SKILL_ROOT),
    profileRoot: process.env.HERMES_PROFILE_ROOT || DEFAULT_PROFILE_ROOT,
    endpoint: process.env.TASK_WORKBENCH_HARNESS_ENDPOINT
      || process.env.FIN_HARNESS_ENDPOINT
      || process.env.LINGXIA_FIN_HARNESS_ENDPOINT
      || process.env.TASK_WORKBENCH_HARNESS_EXECUTOR_ENDPOINT
      || process.env.FIN_HARNESS_EXECUTOR_ENDPOINT
      || process.env.LINGXIA_FIN_HARNESS_EXECUTOR_ENDPOINT
      || "",
    mode: "runtime",
    report: "",
    service: process.env.FIN_HARNESS_EXECUTOR_SERVICE || process.env.LINGXIA_FIN_HARNESS_EXECUTOR_SERVICE || process.env.LINGXIA_FIN_HARNESS_SERVICE || DEFAULT_EXECUTOR_SERVICE,
    strict: false,
    json: false,
    skipEndpoint: false,
    skipStreamSmoke: false,
    skipRuntimeFiles: false,
    skipProfiles: false,
    skipService: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--manifest") args.manifest = argv[++i];
    else if (item === "--schema-root") args.schemaRoot = argv[++i];
    else if (item === "--skill-root") args.skillRoot = argv[++i];
    else if (item === "--profile-root") args.profileRoot = argv[++i];
    else if (item === "--endpoint") args.endpoint = argv[++i];
    else if (item === "--mode") {
      args.mode = argv[++i];
      if (!["runtime", "control"].includes(args.mode)) throw new Error(`invalid --mode: ${args.mode}`);
      if (args.mode === "control") {
        args.skipRuntimeFiles = true;
        args.skipProfiles = true;
        args.skipStreamSmoke = true;
        args.skipService = true;
      }
    }
    else if (item === "--report") args.report = argv[++i];
    else if (item === "--service") args.service = argv[++i];
    else if (item === "--strict") args.strict = true;
    else if (item === "--json") args.json = true;
    else if (item === "--skip-endpoint") args.skipEndpoint = true;
    else if (item === "--skip-stream-smoke") args.skipStreamSmoke = true;
    else if (item === "--skip-runtime-files") args.skipRuntimeFiles = true;
    else if (item === "--skip-profiles") args.skipProfiles = true;
    else if (item === "--skip-service") args.skipService = true;
    else if (item === "--help" || item === "-h") {
      console.log([
        "Usage: node tools/check-financial-harness-deployment.mjs [options]",
        "",
        "Options:",
        "  --manifest <path>          Agent manifest seed JSON path",
        "  --schema-root <path>       Reader output schema root",
        "  --skill-root <path>        Hermes runtime skill root",
        "  --profile-root <path>      Hermes profile root",
        "  --endpoint <url>           Harness executor endpoint",
        "  --mode <runtime|control>   runtime checks local SG runtime; control checks Shanghai control plane",
        "  --report <path>            Write JSON report to a file",
        "  --service <name>           systemd --user service name for runtime checks",
        "  --strict                   Treat warnings as failures",
        "  --json                     Emit JSON only",
        "  --skip-endpoint            Skip /health and SSE smoke checks",
        "  --skip-stream-smoke        Skip authenticated SSE smoke",
        "  --skip-runtime-files       Skip runtime skill file checks",
        "  --skip-profiles            Skip Hermes profile dir/policy checks",
        "  --skip-service             Skip systemd service status check",
      ].join("\n"));
      process.exit(0);
    }
  }
  return args;
}

function exists(file) {
  return fs.existsSync(file);
}

function resolveFirst(candidates) {
  for (const candidate of candidates) {
    if (candidate && exists(candidate)) return candidate;
  }
  return candidates.find(Boolean) || "";
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toolPath(name) {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), name);
}

function pushCheck(report, name, status, detail = "", extra = {}) {
  report.checks.push({ name, status, detail, ...extra });
  if (status === "fail") report.errors.push(`${name}: ${detail}`);
  if (status === "warn") report.warnings.push(`${name}: ${detail}`);
}

function runCommand(report, name, command, args, options = {}) {
  const completed = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    timeout: options.timeoutMs || 120_000,
    env: process.env,
  });
  const output = `${completed.stdout || ""}${completed.stderr || ""}`.trim();
  if (completed.error) {
    pushCheck(report, name, "fail", completed.error.message, { output });
    return false;
  }
  if (completed.status !== 0) {
    pushCheck(report, name, "fail", output.slice(0, 2000) || `exit ${completed.status}`, { output });
    return false;
  }
  pushCheck(report, name, "pass", output.split(/\r?\n/).slice(-1)[0] || "ok", { output });
  return true;
}

function collectManifestRefs(seed) {
  const profiles = new Set();
  const commits = new Set();
  const skillFiles = [];
  const schemaFiles = [];
  const manifests = asArray(seed.manifests);
  for (const manifest of manifests) {
    if (manifest?.runtimeSkillBundle?.commit) commits.add(String(manifest.runtimeSkillBundle.commit));
    if (manifest?.orchestrator?.profileRef) profiles.add(manifest.orchestrator.profileRef);
    for (const skill of asArray(manifest?.orchestrator?.skills)) {
      if (skill?.path) skillFiles.push({ manifestId: manifest.id, skillId: skill.id, file: skill.path });
    }
    for (const worker of asArray(manifest?.workers)) {
      if (worker?.profileRef) profiles.add(worker.profileRef);
      for (const skill of asArray(worker?.skills)) {
        if (skill?.path) skillFiles.push({ manifestId: manifest.id, workerId: worker.id, skillId: skill.id, file: skill.path });
      }
      if (worker?.outputSchemaRef) {
        schemaFiles.push({ manifestId: manifest.id, workerId: worker.id, file: String(worker.outputSchemaRef).split("#", 1)[0] });
      }
    }
  }
  return { manifests, commits: [...commits].sort(), profiles: [...profiles].sort(), skillFiles, schemaFiles };
}

function checkFiles(report, args, refs) {
  if (args.skipRuntimeFiles) {
    pushCheck(report, "runtime skill files", "warn", "skipped by --skip-runtime-files");
    return;
  }
  if (!exists(args.skillRoot)) {
    pushCheck(report, "runtime skill root", "fail", `missing: ${args.skillRoot}`);
  } else {
    const stat = fs.lstatSync(args.skillRoot);
    const realPath = fs.realpathSync(args.skillRoot);
    pushCheck(report, "runtime skill root", "pass", `${args.skillRoot}${stat.isSymbolicLink() ? ` -> ${realPath}` : ""}`);
    if (refs.commits.length === 1) {
      const commit = refs.commits[0];
      const status = realPath.includes(commit) ? "pass" : "fail";
      pushCheck(report, "runtime skill commit", status, status === "pass"
        ? commit
        : `skill root resolves to ${realPath}, expected commit ${commit}`);
    } else if (refs.commits.length > 1) {
      pushCheck(report, "runtime skill commit", "fail", `multiple manifest commits are not supported in one runtime store: ${refs.commits.join(", ")}`);
    } else {
      pushCheck(report, "runtime skill commit", "warn", "manifest has no runtimeSkillBundle.commit");
    }
  }

  const missingSkills = [];
  for (const item of refs.skillFiles) {
    const file = path.join(args.skillRoot, item.file, "SKILL.md");
    if (!exists(file)) missingSkills.push(file);
  }
  pushCheck(
    report,
    "runtime skill files",
    missingSkills.length ? "fail" : "pass",
    missingSkills.length ? `missing ${missingSkills.length} SKILL.md files` : `checked ${refs.skillFiles.length} skills`,
    missingSkills.length ? { missing: missingSkills } : {},
  );

  const missingSchemas = [];
  const weakSchemas = [];
  for (const item of refs.schemaFiles) {
    const file = path.isAbsolute(item.file) ? item.file : path.join(args.schemaRoot, path.basename(item.file));
    if (!exists(file)) {
      missingSchemas.push(file);
      continue;
    }
    const schema = readJson(file);
    if (schema.type !== "object" || schema.additionalProperties !== false || !Array.isArray(schema.required) || !schema.required.length) {
      weakSchemas.push(file);
    }
  }
  if (missingSchemas.length) {
    pushCheck(report, "reader schemas", "fail", `missing ${missingSchemas.length} schema files`, { missing: missingSchemas });
  } else if (weakSchemas.length) {
    pushCheck(report, "reader schemas", "fail", `weak schema contract in ${weakSchemas.length} files`, { weak: weakSchemas });
  } else {
    pushCheck(report, "reader schemas", "pass", `checked ${refs.schemaFiles.length} schemas`);
  }
}

function checkProfileDirs(report, args, refs) {
  if (args.skipProfiles) {
    pushCheck(report, "Hermes profile dirs", "warn", "skipped by --skip-profiles");
    return false;
  }
  if (!exists(args.profileRoot)) {
    pushCheck(report, "Hermes profile root", "warn", `missing on this host: ${args.profileRoot}`);
    return false;
  }
  const missing = refs.profiles
    .map((profile) => path.join(args.profileRoot, profile))
    .filter((dir) => !exists(dir));
  pushCheck(
    report,
    "Hermes profile dirs",
    missing.length ? "fail" : "pass",
    missing.length ? `missing ${missing.length} profile dirs` : `checked ${refs.profiles.length} profiles`,
    missing.length ? { missing } : {},
  );
  return missing.length === 0;
}

function tokenFromEnv() {
  return process.env.TASK_WORKBENCH_HARNESS_TOKEN
    || process.env.TASK_WORKBENCH_HARNESS_EXECUTOR_TOKEN
    || process.env.FIN_HARNESS_EXECUTOR_KEY
    || process.env.HERMES_HTTP_KEY
    || "";
}

function executorServiceCandidates(service) {
  return service === DEFAULT_EXECUTOR_SERVICE ? [DEFAULT_EXECUTOR_SERVICE, LEGACY_EXECUTOR_SERVICE] : [service];
}

function tokenFromServiceEnv(service) {
  if (!service || process.platform === "win32") return "";
  for (const candidate of executorServiceCandidates(service)) {
    const completed = spawnSync("systemctl", ["--user", "show", candidate, "-p", "Environment"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    if (completed.status !== 0) continue;
    const raw = String(completed.stdout || "").trim().replace(/^Environment=/, "");
    const env = {};
    for (const part of raw.split(/\s+/)) {
      const index = part.indexOf("=");
      if (index > 0) env[part.slice(0, index)] = part.slice(index + 1);
    }
    const token = env.TASK_WORKBENCH_HARNESS_TOKEN
      || env.TASK_WORKBENCH_HARNESS_EXECUTOR_TOKEN
      || env.FIN_HARNESS_EXECUTOR_KEY
      || env.HERMES_HTTP_KEY
      || "";
    if (token) return token;
  }
  return "";
}

function checkService(report, args) {
  if (args.skipService) {
    pushCheck(report, "executor service", "warn", "skipped by --skip-service");
    return;
  }
  if (process.platform === "win32") {
    pushCheck(report, "executor service", "warn", "systemd check skipped on Windows");
    return;
  }
  const serviceCandidates = executorServiceCandidates(args.service);
  let completed;
  let checkedService = args.service;
  for (const service of serviceCandidates) {
    completed = spawnSync("systemctl", ["--user", "is-active", service], {
      encoding: "utf8",
      timeout: 10_000,
    });
    checkedService = service;
    if (completed.status === 0) break;
  }
  const state = String(completed.stdout || completed.stderr || "").trim();
  if (completed.status === 0 && state === "active") {
    pushCheck(report, "executor service", "pass", `${checkedService} active`);
  } else {
    pushCheck(report, "executor service", "fail", `${checkedService} is ${state || "not active"}`);
  }
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 10_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveEndpoint(report, args) {
  if (args.skipEndpoint) return "";
  const candidates = args.endpoint ? [args.endpoint] : DEFAULT_ENDPOINTS;
  for (const candidate of candidates) {
    const endpoint = candidate.replace(/\/+$/, "");
    try {
      const health = await fetchText(`${endpoint}/health`, { timeoutMs: 8_000 });
      if (health.ok) {
        pushCheck(report, "executor health", "pass", endpoint);
        return endpoint;
      }
      pushCheck(report, "executor health candidate", "warn", `${endpoint} returned HTTP ${health.status}`);
    } catch (error) {
      pushCheck(report, "executor health candidate", "warn", `${endpoint}: ${error?.message || String(error)}`);
    }
  }
  pushCheck(report, "executor health", "fail", "no reachable endpoint");
  return "";
}

async function checkStreamSmoke(report, endpoint) {
  if (!endpoint) return;
  const token = tokenFromEnv() || tokenFromServiceEnv(report.service || "");
  if (!token) {
    pushCheck(report, "executor stream smoke", "warn", "missing token env; skipped authenticated SSE smoke");
    return;
  }
  const payload = {
    prompt: "stage 8 deployment stream smoke",
    harnessPlan: {
      source: "financial_harness",
      runId: "stage8-smoke",
      templateId: "market-researcher",
      confidenceScore: 1,
      stages: [{ stageId: "bad", role: "Nope", profile: "missing-profile" }],
    },
  };
  try {
    const result = await fetchText(`${endpoint}/v1/harness/execute-stream`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      timeoutMs: 20_000,
    });
    const events = [...result.text.matchAll(/^event:\s*(.+)$/gm)].map((item) => item[1]);
    const ok = result.ok
      && events.includes("stage_started")
      && events.includes("stage_done")
      && events.includes("run_done")
      && result.text.includes("data: [DONE]");
    pushCheck(
      report,
      "executor stream smoke",
      ok ? "pass" : "fail",
      ok ? events.join(" -> ") : `unexpected SSE response: HTTP ${result.status}`,
      ok ? { events } : { events, output: result.text.slice(0, 1200) },
    );
  } catch (error) {
    pushCheck(report, "executor stream smoke", "fail", error?.message || String(error));
  }
}

function printTextReport(report) {
  console.log("Financial Harness deployment check");
  console.log(`mode: ${report.mode}`);
  console.log(`manifest: ${report.paths.manifest}`);
  console.log(`schemaRoot: ${report.paths.schemaRoot}`);
  console.log(`skillRoot: ${report.paths.skillRoot}`);
  console.log(`profileRoot: ${report.paths.profileRoot}`);
  console.log(`endpoint: ${report.endpoint || "(not checked)"}`);
  console.log("");
  for (const check of report.checks) {
    const mark = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
    console.log(`[${mark}] ${check.name}: ${check.detail}`);
  }
  if (report.warnings.length) {
    console.log("");
    console.log("Warnings:");
    for (const item of report.warnings) console.log(`- ${item}`);
  }
  if (report.errors.length) {
    console.log("");
    console.log("Errors:");
    for (const item of report.errors) console.log(`- ${item}`);
  }
  console.log("");
  console.log(report.ok ? "deployment check passed" : "deployment check failed");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  args.manifest = resolveFirst([
    args.manifest,
    "server/_core/agent/data/agent-manifests.seed.json",
    "agent-manifests.seed.json",
    "tools/agent-manifests.seed.json",
  ]);
  args.schemaRoot = resolveFirst([
    args.schemaRoot,
    "server/_core/agent/data/schemas",
    "schemas",
    "tools/schemas",
  ]);

  const report = {
    ok: false,
    mode: args.mode,
    service: args.service,
    endpoint: "",
    paths: {
      manifest: args.manifest,
      schemaRoot: args.schemaRoot,
      skillRoot: args.skillRoot,
      profileRoot: args.profileRoot,
    },
    checks: [],
    warnings: [],
    errors: [],
  };

  if (!exists(args.manifest)) {
    pushCheck(report, "manifest file", "fail", `missing: ${args.manifest}`);
  } else {
    pushCheck(report, "manifest file", "pass", args.manifest);
  }
  if (!exists(args.schemaRoot)) {
    pushCheck(report, "schema root", "fail", `missing: ${args.schemaRoot}`);
  } else {
    pushCheck(report, "schema root", "pass", args.schemaRoot);
  }
  if (report.errors.length) {
    report.ok = false;
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else printTextReport(report);
    process.exit(1);
  }

  const seed = readJson(args.manifest);
  const refs = collectManifestRefs(seed);
  pushCheck(report, "manifest registry", refs.manifests.length ? "pass" : "fail", `${refs.manifests.length} manifests, ${refs.profiles.length} profiles`);
  checkFiles(report, args, refs);
  const hasProfiles = checkProfileDirs(report, args, refs);
  checkService(report, args);

  const validateScript = toolPath("validate-agent-manifest.mjs");
  if (exists(validateScript)) {
    const validateArgs = [
      validateScript,
      "--manifest", args.manifest,
      "--schema-root", args.schemaRoot,
    ];
    if (!args.skipRuntimeFiles) validateArgs.push("--skill-root", args.skillRoot, "--check-files");
    if (hasProfiles) validateArgs.push("--profile-root", args.profileRoot, "--check-profiles");
    runCommand(report, "manifest validator", "node", validateArgs);
  } else {
    pushCheck(report, "manifest validator", "warn", `script not found: ${validateScript}`);
  }

  const reconcileScript = toolPath("reconcile-hermes-profile-policy.mjs");
  if (hasProfiles && exists(reconcileScript)) {
    runCommand(report, "profile policy reconcile", "node", [
      reconcileScript,
      "--manifest", args.manifest,
      "--profile-root", args.profileRoot,
      "--strict",
    ]);
  } else if (!hasProfiles) {
    pushCheck(report, "profile policy reconcile", "warn", "skipped because profile root is not available on this host");
  } else {
    pushCheck(report, "profile policy reconcile", "warn", `script not found: ${reconcileScript}`);
  }

  report.endpoint = await resolveEndpoint(report, args);
  if (!args.skipStreamSmoke) await checkStreamSmoke(report, report.endpoint);

  report.ok = report.errors.length === 0 && (!args.strict || report.warnings.length === 0);
  if (args.report) {
    fs.mkdirSync(path.dirname(path.resolve(args.report)), { recursive: true });
    fs.writeFileSync(args.report, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printTextReport(report);
  if (!report.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});

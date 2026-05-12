#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const POLICY_SOURCE = "financial-agent-harness-manifest";
const LEGACY_POLICY_SOURCE = "lingxia-financial-harness-manifest";
const POLICY_FILE = process.env.FIN_HARNESS_POLICY_FILE || ".financial-agent-policies.json";
const LEGACY_POLICY_FILE = ".lingxia-policies.json";
const PUBLIC_SEARCH_MCPS = new Set(["brave", "bocha", "tavily", "web-search"]);
const READ_TOOLS = new Set(["read", "grep", "glob", "search"]);
const WRITE_TOOLS = new Set(["write", "edit", "bash", "shell", "delete", "move"]);
const DANGEROUS_TOOLS = ["bash", "delete", "edit", "move", "shell", "write"];

function parseArgs(argv) {
  const args = {
    manifest: "server/_core/agent/data/agent-manifests.seed.json",
    profileRoot: process.env.HERMES_PROFILE_ROOT || "/home/ubuntu/.hermes/profiles",
    writePolicyFiles: false,
    strict: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--manifest") args.manifest = argv[++i];
    else if (item === "--profile-root") args.profileRoot = argv[++i];
    else if (item === "--write-policy-files") args.writePolicyFiles = true;
    else if (item === "--strict") args.strict = true;
    else if (item === "--json") args.json = true;
    else if (item === "--help" || item === "-h") {
      console.log([
        "Usage: node tools/reconcile-hermes-profile-policy.mjs [options]",
        "",
        "Options:",
        "  --manifest <path>          Agent manifest seed JSON path",
        "  --profile-root <path>      Hermes profile root",
        `  --write-policy-files       Write ${POLICY_FILE} markers into profile dirs`,
        "  --strict                   Exit non-zero on warnings as well as errors",
        "  --json                     Emit JSON report",
      ].join("\n"));
      process.exit(0);
    }
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readTextIfExists(file) {
  if (!fs.existsSync(file)) return "";
  return fs.readFileSync(file, "utf8");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sortedUnique(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function toolsetsFromConfigYaml(text) {
  const lines = text.split(/\r?\n/);
  const toolsets = [];
  let inToolsets = false;
  for (const line of lines) {
    if (/^toolsets:\s*$/.test(line)) {
      inToolsets = true;
      continue;
    }
    if (!inToolsets) continue;
    if (/^[^\s-]/.test(line)) break;
    const match = line.match(/^\s*-\s*["']?([^"'\s#]+)["']?/);
    if (match) toolsets.push(match[1]);
  }
  return sortedUnique(toolsets);
}

function mcpIds(mcpServers) {
  return sortedUnique(asArray(mcpServers).map((server) => server?.id));
}

function mcpStatusMap(mcpServers) {
  const result = {};
  for (const server of asArray(mcpServers)) {
    if (server?.id) result[server.id] = server.status || "unknown";
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

function skillIds(skills) {
  return sortedUnique(asArray(skills).map((skill) => skill?.id));
}

function hasWriteTool(tools) {
  return asArray(tools).some((tool) => WRITE_TOOLS.has(tool));
}

function hasPublicSearch(mcpServers) {
  return mcpIds(mcpServers).some((id) => PUBLIC_SEARCH_MCPS.has(id));
}

function externalSearchAllowed(subject) {
  if (subject.role !== "reader") return false;
  return hasPublicSearch(subject.mcpServers);
}

function deniedTools(allowedTools) {
  const allowed = new Set(allowedTools);
  return DANGEROUS_TOOLS.filter((tool) => !allowed.has(tool));
}

function policyFromSubject(manifest, subject, subjectType) {
  const allowedTools = sortedUnique(asArray(subject.tools));
  const allowedMcpServers = mcpIds(subject.mcpServers);
  return {
    version: 1,
    source: POLICY_SOURCE,
    manifestId: manifest.id,
    manifestVersion: manifest.version,
    subjectType,
    workerId: subjectType === "orchestrator" ? "orchestrator" : subject.id,
    profileRef: subject.profileRef,
    runtimeFamily: subject.runtimeFamily || "hermes",
    role: subjectType === "orchestrator" ? "orchestrator" : subject.role,
    trustBoundary: subject.trustBoundary || "orchestration",
    allowedTools,
    deniedTools: deniedTools(allowedTools),
    allowedMcpServers,
    mcpStatuses: mcpStatusMap(subject.mcpServers),
    skills: skillIds(subject.skills),
    outputSchemaRef: subject.outputSchemaRef || null,
    writeAllowed: subject.writeHolder === true || hasWriteTool(allowedTools),
    externalSearchAllowed: externalSearchAllowed(subject),
  };
}

function canonicalPolicy(policy) {
  return {
    ...policy,
    allowedTools: sortedUnique(policy.allowedTools),
    deniedTools: sortedUnique(policy.deniedTools),
    allowedMcpServers: sortedUnique(policy.allowedMcpServers),
    skills: sortedUnique(policy.skills),
    mcpStatuses: Object.fromEntries(Object.entries(policy.mcpStatuses || {}).sort(([a], [b]) => a.localeCompare(b))),
  };
}

function canonicalPolicyFile(profileRef, policies, updatedAt = "1970-01-01T00:00:00.000Z") {
  return {
    version: 1,
    source: POLICY_SOURCE,
    profileRef,
    updatedAt,
    policies: policies
      .map(canonicalPolicy)
      .sort((a, b) => `${a.manifestId}:${a.subjectType}:${a.workerId}`.localeCompare(`${b.manifestId}:${b.subjectType}:${b.workerId}`)),
  };
}

function comparablePolicyFile(profileRef, policies) {
  const file = canonicalPolicyFile(profileRef, policies);
  delete file.updatedAt;
  return file;
}

function normalizePolicySource(value) {
  if (value === LEGACY_POLICY_SOURCE) return POLICY_SOURCE;
  return value;
}

function normalizePolicyFileForCompare(file) {
  const normalized = file && typeof file === "object" ? { ...file } : {};
  delete normalized.updatedAt;
  normalized.source = normalizePolicySource(normalized.source);
  normalized.policies = asArray(normalized.policies).map((policy) => ({
    ...policy,
    source: normalizePolicySource(policy?.source),
  }));
  return normalized;
}

function equalPolicyFiles(expected, actual) {
  return JSON.stringify(normalizePolicyFileForCompare(expected)) === JSON.stringify(normalizePolicyFileForCompare(actual));
}

function validatePolicy(policy, where, errors, warnings) {
  const allowedTools = asArray(policy.allowedTools);
  const allowedMcpServers = asArray(policy.allowedMcpServers);
  const writeTools = allowedTools.filter((tool) => WRITE_TOOLS.has(tool));
  const publicSearchServers = allowedMcpServers.filter((id) => PUBLIC_SEARCH_MCPS.has(id));

  if (!policy.profileRef) errors.push(`${where}: missing profileRef`);
  if (!policy.runtimeFamily || policy.runtimeFamily !== "hermes") errors.push(`${where}: expected runtimeFamily=hermes`);
  if (policy.role === "reader" && policy.skills.length) errors.push(`${where}: reader must not receive runtime skills`);
  if ((policy.role === "reader" || policy.role === "analyst") && writeTools.length) {
    errors.push(`${where}: ${policy.role} must not allow write tools: ${writeTools.join(", ")}`);
  }
  if (policy.role === "writer" && publicSearchServers.length) {
    errors.push(`${where}: writer must not allow public search MCPs: ${publicSearchServers.join(", ")}`);
  }
  if (policy.role === "reader" && !policy.outputSchemaRef) {
    errors.push(`${where}: reader should declare outputSchemaRef`);
  }
  if (policy.writeAllowed && policy.role !== "writer") {
    errors.push(`${where}: only writer policies can be writeAllowed`);
  }
  for (const tool of allowedTools) {
    if (!READ_TOOLS.has(tool) && !WRITE_TOOLS.has(tool)) warnings.push(`${where}: unknown tool in policy: ${tool}`);
  }
}

function buildProfilePolicies(seed) {
  const byProfile = new Map();
  for (const manifest of asArray(seed.manifests)) {
    if (manifest?.orchestrator?.profileRef) {
      const policy = policyFromSubject(manifest, manifest.orchestrator, "orchestrator");
      if (!byProfile.has(policy.profileRef)) byProfile.set(policy.profileRef, []);
      byProfile.get(policy.profileRef).push(policy);
    }
    for (const worker of asArray(manifest.workers)) {
      const policy = policyFromSubject(manifest, worker, "worker");
      if (!byProfile.has(policy.profileRef)) byProfile.set(policy.profileRef, []);
      byProfile.get(policy.profileRef).push(policy);
    }
  }
  return byProfile;
}

function summarizeProfile(profileRef, policies, args, report) {
  const profileDir = path.join(args.profileRoot, profileRef);
  const policyPath = path.join(profileDir, POLICY_FILE);
  const legacyPolicyPath = path.join(profileDir, LEGACY_POLICY_FILE);
  const readPolicyPath = fs.existsSync(policyPath) ? policyPath : legacyPolicyPath;
  const configPath = path.join(profileDir, "config.yaml");
  const exists = fs.existsSync(profileDir);
  const configText = exists ? readTextIfExists(configPath) : "";
  const hermesToolsets = toolsetsFromConfigYaml(configText);
  const expectedComparable = comparablePolicyFile(profileRef, policies);
  const expectedWrite = canonicalPolicyFile(profileRef, policies, new Date().toISOString());
  let policyStatus = "missing";
  let existingPolicy = null;

  if (!exists) {
    report.errors.push(`${profileRef}: missing Hermes profile dir: ${profileDir}`);
  } else if (!fs.existsSync(configPath)) {
    report.warnings.push(`${profileRef}: missing config.yaml`);
  }

  if (fs.existsSync(readPolicyPath)) {
    try {
      existingPolicy = readJson(readPolicyPath);
      policyStatus = equalPolicyFiles(expectedComparable, existingPolicy) ? "ok" : "drift";
      if (policyStatus === "drift") report.errors.push(`${profileRef}: ${path.basename(readPolicyPath)} differs from manifest-derived policy`);
    } catch (error) {
      policyStatus = "invalid";
      report.errors.push(`${profileRef}: cannot parse ${path.basename(readPolicyPath)}: ${error.message}`);
    }
  } else {
    report.warnings.push(`${profileRef}: ${POLICY_FILE} is missing`);
  }

  for (const policy of policies) {
    validatePolicy(policy, `${policy.manifestId}.${policy.workerId}`, report.errors, report.warnings);
  }

  const hasWriter = policies.some((policy) => policy.role === "writer");
  const policyAllowsExternalSearch = policies.some((policy) => policy.externalSearchAllowed);
  if (hermesToolsets.includes("web") && hasWriter) {
    report.warnings.push(`${profileRef}: Hermes config includes broad toolset web; manifest denies writer search, executor policy must remain authoritative`);
  }
  if (hermesToolsets.includes("web") && !policyAllowsExternalSearch) {
    report.warnings.push(`${profileRef}: Hermes config includes broad toolset web but manifest policy does not allow external search for this profile`);
  }
  if (!hermesToolsets.includes("web") && policyAllowsExternalSearch) {
    report.warnings.push(`${profileRef}: manifest allows external search but Hermes config does not list toolset web`);
  }

  if (args.writePolicyFiles && exists) {
    fs.writeFileSync(policyPath, `${JSON.stringify(expectedWrite, null, 2)}\n`, "utf8");
    policyStatus = "written";
  }

  report.profiles.push({
    profileRef,
    profileDir,
    configPath,
    policyPath,
    exists,
    hermesToolsets,
    policyStatus,
    policies: expectedWrite.policies,
  });
}

function printTextReport(report, args) {
  console.log(`manifest: ${args.manifest}`);
  console.log(`profileRoot: ${args.profileRoot}`);
  console.log(`profiles: ${report.profiles.length}`);
  console.log(`writePolicyFiles: ${args.writePolicyFiles ? "yes" : "no"}`);
  for (const profile of report.profiles) {
    console.log("");
    console.log(`${profile.profileRef}`);
    console.log(`  profileDir: ${profile.exists ? "ok" : "missing"}`);
    console.log(`  hermesToolsets: ${profile.hermesToolsets.length ? profile.hermesToolsets.join(", ") : "(none)"}`);
    console.log(`  policyStatus: ${profile.policyStatus}`);
    for (const policy of profile.policies) {
      console.log(`  - ${policy.manifestId}/${policy.workerId} role=${policy.role} write=${policy.writeAllowed ? "yes" : "no"} search=${policy.externalSearchAllowed ? "yes" : "no"}`);
      console.log(`    tools=${policy.allowedTools.join(", ") || "(none)"} mcp=${policy.allowedMcpServers.join(", ") || "(none)"} skills=${policy.skills.join(", ") || "(none)"}`);
    }
  }
  if (report.warnings.length) {
    console.log("");
    console.log("warnings:");
    for (const warning of report.warnings) console.log(`- ${warning}`);
  }
  if (report.errors.length) {
    console.log("");
    console.log("errors:");
    for (const error of report.errors) console.log(`- ${error}`);
  }
  if (!report.errors.length) console.log("\nprofile policy reconcile passed");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const seed = readJson(args.manifest);
  const byProfile = buildProfilePolicies(seed);
  const report = { profiles: [], warnings: [], errors: [] };

  for (const [profileRef, policies] of [...byProfile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    summarizeProfile(profileRef, policies, args, report);
  }

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printTextReport(report, args);

  if (report.errors.length || (args.strict && report.warnings.length)) process.exit(1);
}

main();

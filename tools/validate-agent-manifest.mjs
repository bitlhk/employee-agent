#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const DEFAULT_PROFILE_PORTS = {
  "financial-harness": 8650,
  "market-sector-reader": 8651,
  "market-comps-spreader": 8652,
  "market-note-writer": 8653,
  "meeting-news-reader": 8661,
  "meeting-profiler": 8662,
  "meeting-pack-writer": 8663,
};

const DEFAULT_AVAILABLE_MCPS = new Set(["brave", "bocha", "tavily"]);
const PUBLIC_SEARCH_MCPS = new Set(["brave", "bocha", "tavily", "web-search"]);
const VALID_ROLES = new Set(["orchestrator", "reader", "analyst", "writer"]);
const VALID_TOOLS = new Set(["read", "grep", "glob", "write", "edit", "bash", "search"]);
const WRITE_TOOLS = new Set(["write", "edit", "bash"]);

function parseArgs(argv) {
  const args = {
    manifest: "server/_core/agent/data/agent-manifests.seed.json",
    skillRoot: process.env.HERMES_RUNTIME_SKILL_ROOT || "",
    schemaRoot: process.env.FIN_HARNESS_SCHEMA_ROOT || "server/_core/agent/data/schemas",
    profileRoot: process.env.HERMES_PROFILE_ROOT || "",
    checkFiles: false,
    checkProfiles: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--manifest") args.manifest = argv[++i];
    else if (item === "--skill-root") args.skillRoot = argv[++i];
    else if (item === "--schema-root") args.schemaRoot = argv[++i];
    else if (item === "--profile-root") args.profileRoot = argv[++i];
    else if (item === "--check-files") args.checkFiles = true;
    else if (item === "--check-profiles") args.checkProfiles = true;
    else if (item === "--help" || item === "-h") {
      console.log([
        "Usage: node tools/validate-agent-manifest.mjs [options]",
        "",
        "Options:",
        "  --manifest <path>       Manifest seed JSON path",
        "  --skill-root <path>     Runtime skill root used to verify SKILL.md files",
        "  --schema-root <path>    Output schema root used to verify reader schemas",
        "  --profile-root <path>   Hermes profile root used to verify profile dirs",
        "  --check-files           Require runtime skill files to exist",
        "  --check-profiles        Require Hermes profile dirs to exist",
      ].join("\n"));
      process.exit(0);
    }
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function fail(errors, where, message) {
  errors.push(`${where}: ${message}`);
}

function warn(warnings, where, message) {
  warnings.push(`${where}: ${message}`);
}

function skillFilePath(skillRoot, skill) {
  if (!skillRoot || !skill?.path) return "";
  return path.join(skillRoot, skill.path, "SKILL.md");
}

function validateSkill(skill, where, manifest, args, errors) {
  if (!skill || typeof skill !== "object") {
    fail(errors, where, "skill must be an object");
    return;
  }
  for (const field of ["id", "source", "pluginId", "path", "versionRef"]) {
    if (!skill[field]) fail(errors, where, `missing skill.${field}`);
  }
  const commit = manifest.runtimeSkillBundle?.commit;
  if (commit && skill.versionRef && skill.versionRef !== commit) {
    fail(errors, where, `skill.versionRef ${skill.versionRef} does not match manifest commit ${commit}`);
  }
  if (args.checkFiles) {
    const file = skillFilePath(args.skillRoot, skill);
    if (!file) fail(errors, where, "cannot check skill file without --skill-root");
    else if (!fs.existsSync(file)) fail(errors, where, `missing SKILL.md: ${file}`);
  }
}

function validateMcp(server, where, warnings, errors) {
  if (!server || typeof server !== "object") {
    fail(errors, where, "mcp server must be an object");
    return;
  }
  if (!server.id) fail(errors, where, "missing mcpServers[].id");
  if (!["available", "future", "unavailable"].includes(server.status)) {
    fail(errors, where, `invalid mcp status: ${server.status}`);
  }
  if (server.status === "available" && !DEFAULT_AVAILABLE_MCPS.has(server.id)) {
    warn(warnings, where, `MCP ${server.id} is marked available but is not in the known available set`);
  }
  if (server.status === "future" && server.required === true) {
    fail(errors, where, `future MCP ${server.id} cannot be required`);
  }
}

function validateOutputSchemaRef(worker, where, args, errors) {
  if (!worker.outputSchemaRef) return;
  const raw = String(worker.outputSchemaRef).split("#", 1)[0];
  const file = path.isAbsolute(raw) ? raw : path.join(args.schemaRoot, path.basename(raw));
  if (!fs.existsSync(file)) {
    fail(errors, where, `missing output schema file: ${file}`);
    return;
  }
  const schema = readJson(file);
  if (schema.type !== "object") fail(errors, where, "output schema root must be type=object");
  if (schema.additionalProperties !== false) fail(errors, where, "output schema root must set additionalProperties=false");
  if (!Array.isArray(schema.required) || !schema.required.length) fail(errors, where, "output schema must declare required fields");
}

function validateWorker(worker, manifest, args, errors, warnings) {
  const where = `${manifest.id}.workers.${worker?.id || "(missing-id)"}`;
  if (!worker || typeof worker !== "object") {
    fail(errors, where, "worker must be an object");
    return;
  }
  for (const field of ["id", "displayName", "role", "agentDefinitionId", "profileRef", "runtimeFamily", "trustBoundary"]) {
    if (!worker[field]) fail(errors, where, `missing worker.${field}`);
  }
  if (!VALID_ROLES.has(worker.role)) fail(errors, where, `invalid role: ${worker.role}`);
  if (worker.runtimeFamily !== "hermes") fail(errors, where, `pilot workers must use hermes runtime, got ${worker.runtimeFamily}`);
  if (!(worker.profileRef in DEFAULT_PROFILE_PORTS)) {
    fail(errors, where, `profileRef has no declared port mapping: ${worker.profileRef}`);
  }
  if (args.checkProfiles) {
    const dir = path.join(args.profileRoot, worker.profileRef || "");
    if (!fs.existsSync(dir)) fail(errors, where, `missing Hermes profile dir: ${dir}`);
  }
  for (const tool of asArray(worker.tools)) {
    if (!VALID_TOOLS.has(tool)) fail(errors, where, `invalid tool: ${tool}`);
  }
  for (const [index, server] of asArray(worker.mcpServers).entries()) {
    validateMcp(server, `${where}.mcpServers[${index}]`, warnings, errors);
  }
  for (const [index, skill] of asArray(worker.skills).entries()) {
    validateSkill(skill, `${where}.skills[${index}]`, manifest, args, errors);
  }

  const tools = asArray(worker.tools);
  const mcpServers = asArray(worker.mcpServers);
  const mcpIds = mcpServers.map((server) => server?.id).filter(Boolean);
  const hasWriteTool = tools.some((tool) => WRITE_TOOLS.has(tool));
  const hasPublicSearchMcp = mcpIds.some((id) => PUBLIC_SEARCH_MCPS.has(id));
  if (hasWriteTool && worker.writeHolder !== true) fail(errors, where, "write/edit tools require writeHolder=true");
  if (worker.writeHolder === true && worker.role !== "writer") fail(errors, where, "only writer can be writeHolder");
  if ((worker.role === "reader" || worker.role === "analyst") && hasWriteTool) {
    fail(errors, where, `${worker.role} must not declare write/edit/bash tools`);
  }
  if (worker.role === "writer" && hasPublicSearchMcp) {
    fail(errors, where, "writer must not declare public search MCP servers");
  }
  if (worker.trustBoundary === "untrusted_input_reader") {
    if (worker.role !== "reader") fail(errors, where, "untrusted_input_reader must use role=reader");
    if (asArray(worker.skills).length) fail(errors, where, "untrusted input reader must not receive runtime skills");
    for (const serverId of mcpIds) {
      if (!PUBLIC_SEARCH_MCPS.has(serverId)) fail(errors, where, `untrusted input reader can only declare public search MCPs, got ${serverId}`);
    }
    if (tools.some((tool) => ["write", "edit", "bash", "search"].includes(tool))) {
      fail(errors, where, "untrusted input reader is limited to read/grep/glob tools");
    }
    if (!worker.outputSchemaRef) fail(errors, where, "untrusted input reader must declare outputSchemaRef");
  }
  validateOutputSchemaRef(worker, where, args, errors);
}

function validateManifest(manifest, args, errors, warnings) {
  const where = manifest?.id || "(missing-manifest-id)";
  for (const field of ["id", "version", "status", "displayName", "shortDescription", "runtimeSkillBundle", "upstreamCookbook", "orchestrator"]) {
    if (!manifest?.[field]) fail(errors, where, `missing manifest.${field}`);
  }
  if (!["draft", "active", "deprecated"].includes(manifest.status)) fail(errors, where, `invalid status: ${manifest.status}`);
  if (manifest.status !== "draft") warn(warnings, where, "pilot manifests are expected to remain draft until schema validation is complete");

  const commit = manifest.runtimeSkillBundle?.commit || "";
  if (!/^[0-9a-f]{7,40}$/i.test(commit)) fail(errors, where, `invalid runtimeSkillBundle.commit: ${commit}`);
  if (manifest.runtimeSkillBundle?.currentPath && args.checkFiles) {
    const resolved = fs.existsSync(manifest.runtimeSkillBundle.currentPath);
    if (!resolved) warn(warnings, where, `runtimeSkillBundle.currentPath not found on this host: ${manifest.runtimeSkillBundle.currentPath}`);
  }

  const orchestrator = manifest.orchestrator || {};
  if (orchestrator.runtimeFamily !== "hermes") fail(errors, `${where}.orchestrator`, "orchestrator must use hermes runtime");
  if (!(orchestrator.profileRef in DEFAULT_PROFILE_PORTS)) {
    fail(errors, `${where}.orchestrator`, `profileRef has no declared port mapping: ${orchestrator.profileRef}`);
  }
  if (args.checkProfiles) {
    const dir = path.join(args.profileRoot, orchestrator.profileRef || "");
    if (!fs.existsSync(dir)) fail(errors, `${where}.orchestrator`, `missing Hermes profile dir: ${dir}`);
  }
  for (const [index, skill] of asArray(orchestrator.skills).entries()) {
    validateSkill(skill, `${where}.orchestrator.skills[${index}]`, manifest, args, errors);
  }
  for (const [index, server] of asArray(orchestrator.mcpServers).entries()) {
    validateMcp(server, `${where}.orchestrator.mcpServers[${index}]`, warnings, errors);
  }

  const workers = asArray(manifest.workers);
  if (!workers.length) fail(errors, where, "manifest must declare workers");
  const ids = new Set();
  const stageIds = new Set();
  let writeHolders = 0;
  for (const worker of workers) {
    if (ids.has(worker.id)) fail(errors, where, `duplicate worker id: ${worker.id}`);
    ids.add(worker.id);
    if (worker.stageId) {
      if (stageIds.has(worker.stageId)) fail(errors, where, `duplicate stageId: ${worker.stageId}`);
      stageIds.add(worker.stageId);
    }
    if (worker.writeHolder === true) writeHolders += 1;
    validateWorker(worker, manifest, args, errors, warnings);
  }
  if (writeHolders !== 1) fail(errors, where, `expected exactly one writeHolder worker, got ${writeHolders}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const errors = [];
  const warnings = [];
  const seed = readJson(args.manifest);
  const manifests = asArray(seed.manifests);
  if (!manifests.length) fail(errors, "registry", "no manifests declared");
  for (const manifest of manifests) validateManifest(manifest, args, errors, warnings);

  console.log(`manifest: ${args.manifest}`);
  console.log(`manifests: ${manifests.length}`);
  console.log(`checkFiles: ${args.checkFiles ? "yes" : "no"}`);
  if (args.checkFiles) console.log(`skillRoot: ${args.skillRoot}`);
  console.log(`checkProfiles: ${args.checkProfiles ? "yes" : "no"}`);
  if (args.checkProfiles) console.log(`profileRoot: ${args.profileRoot}`);
  console.log(`schemaRoot: ${args.schemaRoot}`);

  if (warnings.length) {
    console.log("warnings:");
    for (const item of warnings) console.log(`- ${item}`);
  }
  if (errors.length) {
    console.error("manifest validation failed:");
    for (const item of errors) console.error(`- ${item}`);
    process.exit(1);
  }
  console.log("manifest validation passed");
}

main();

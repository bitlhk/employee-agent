#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PATCH_MARKER = "lingxia-media-workspace-only-v2";
const LEGACY_PATCH_MARKER = "lingxia-media-relative-v1";
const LEGACY_REMOTE_FETCH_PATCH_MARKER = "lingxia-media-remote-fetch-v2";

function normalizeOpenClawHome(raw) {
  const base = raw && raw.trim() ? raw.trim() : path.join(os.homedir(), ".openclaw");
  return path.basename(base) === ".openclaw" ? base : path.join(base, ".openclaw");
}

const openclawHome = normalizeOpenClawHome(
  process.env.CLAW_OPENCLAW_HOME || process.env.OPENCLAW_HOME || process.env.CLAW_REMOTE_OPENCLAW_HOME
);
const pluginRoot = process.env.OPENCLAW_WEIXIN_PLUGIN_ROOT
  || path.join(openclawHome, "npm/node_modules/@tencent-weixin/openclaw-weixin");

const messageTargets = [
  path.join(pluginRoot, "dist/src/messaging/process-message.js"),
  path.join(pluginRoot, "src/messaging/process-message.ts"),
];

const uploadTargets = [
  path.join(pluginRoot, "dist/src/cdn/upload.js"),
  path.join(pluginRoot, "src/cdn/upload.ts"),
];

function helperSnippet(kind) {
  const typed = kind === "ts";
  return `
// ${PATCH_MARKER}: resolve MEDIA:relative-path replies inside the current agent workspace only.
const LINGXIA_SAFE_MEDIA_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".txt", ".csv", ".zip",
  ".mp3", ".ogg", ".wav", ".mp4", ".mov", ".webm",
]);
const LINGXIA_MEDIA_MAX_BYTES = Number(process.env.LINGXIA_WEIXIN_MEDIA_MAX_BYTES || 25 * 1024 * 1024);

function resolveLingxiaOpenClawHome()${typed ? ": string" : ""} {
  const raw = process.env.CLAW_OPENCLAW_HOME || process.env.OPENCLAW_HOME || process.env.CLAW_REMOTE_OPENCLAW_HOME || "";
  const base = raw.trim() || path.join(process.env.HOME || ".", ".openclaw");
  return path.basename(base) === ".openclaw" ? base : path.join(base, ".openclaw");
}

function isLingxiaSafeMediaExtension(filePath${typed ? ": string" : ""})${typed ? ": boolean" : ""} {
  return LINGXIA_SAFE_MEDIA_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isLingxiaPathInside(parent${typed ? ": string" : ""}, child${typed ? ": string" : ""})${typed ? ": boolean" : ""} {
  const relative = path.relative(parent, child);
  return relative === "" || (relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function cleanLingxiaMediaCandidate(raw${typed ? ": string" : ""})${typed ? ": string" : ""} {
  let candidate = raw.trim();
  while (
    candidate.length >= 2
    && ((candidate.startsWith("\\"") && candidate.endsWith("\\""))
      || (candidate.startsWith("'") && candidate.endsWith("'"))
      || (candidate.startsWith("\`") && candidate.endsWith("\`")))
  ) {
    candidate = candidate.slice(1, -1).trim();
  }
  return candidate;
}

function resolveLingxiaWorkspaceMedia(candidate${typed ? ": string" : ""}, agentId${typed ? ": string | undefined | null" : ""})${typed ? ": string | null" : ""} {
  if (!agentId) return null;
  if (!candidate || candidate.includes("\\0")) return null;
  if (/^https?:\\/\\//i.test(candidate)) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(candidate)) return null;
  if (candidate.startsWith("~")) return null;
  if (candidate.split(/[\\\\/]+/).includes("..")) return null;

  const workspaceRoot = path.join(resolveLingxiaOpenClawHome(), \`workspace-\${agentId}\`);
  const abs = path.isAbsolute(candidate) ? candidate : path.resolve(workspaceRoot, candidate);
  let realWorkspace${typed ? ": string" : ""};
  let realFile${typed ? ": string" : ""};
  let stat${typed ? ": fs.Stats" : ""};
  try {
    realWorkspace = fs.realpathSync(workspaceRoot);
    realFile = fs.realpathSync(abs);
    stat = fs.statSync(realFile);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  if (stat.size > LINGXIA_MEDIA_MAX_BYTES) return null;
  if (!isLingxiaSafeMediaExtension(realFile)) return null;
  if (!isLingxiaPathInside(realWorkspace, realFile)) return null;
  return realFile;
}

function extractLingxiaMediaDirectives(text${typed ? ": string" : ""}, agentId${typed ? ": string | undefined | null" : ""})${typed ? ": { text: string; mediaUrls: string[] } | null" : ""} {
  if (!/(^|[\\r\\n])\\s*MEDIA:/i.test(text)) return null;
  const kept${typed ? ": string[]" : ""} = [];
  const mediaUrls${typed ? ": string[]" : ""} = [];
  for (const line of text.split(/\\r?\\n/)) {
    const match = /^\\s*MEDIA:\\s*(.+?)\\s*$/i.exec(line);
    if (!match) {
      kept.push(line);
      continue;
    }
    const resolved = resolveLingxiaWorkspaceMedia(cleanLingxiaMediaCandidate(match[1]), agentId);
    if (resolved) mediaUrls.push(resolved);
    else kept.push(line);
  }
  return mediaUrls.length > 0 ? { text: kept.join("\\n").trim(), mediaUrls } : null;
}
`;
}

function patchContent(content, targetPath) {
  if (content.includes(PATCH_MARKER)) return { changed: false, content };
  if (content.includes(LEGACY_PATCH_MARKER)) {
    const next = content
      .replace(
        "// lingxia-media-relative-v1: resolve leaked MEDIA:relative-path replies inside the current agent workspace.",
        `// ${PATCH_MARKER}: resolve MEDIA:relative-path replies inside the current agent workspace only.`
      )
      .replace(
        "if (/^https:\\/\\//i.test(candidate)) return candidate;",
        "if (/^https?:\\/\\//i.test(candidate)) return null;"
      );
    return { changed: next !== content, content: next };
  }
  const isTs = targetPath.endsWith(".ts");
  let next = content;

  if (!next.includes('import fs from "node:fs";')) {
    next = next.replace('import path from "node:path";', 'import path from "node:path";\nimport fs from "node:fs";');
  }

  const anchor = 'const MEDIA_OUTBOUND_TEMP_DIR = path.join(resolvePreferredOpenClawTmpDir(), "weixin/media/outbound-temp");';
  if (!next.includes(anchor)) {
    throw new Error(`anchor not found: ${anchor}`);
  }
  next = next.replace(anchor, `${anchor}\n${helperSnippet(isTs ? "ts" : "js")}`);

  const deliverBlockRe = /(\s*)const rawText = payload\.text \?\? "";\n\1let text = \(\(\) => \{\n(\s*)const f = new StreamingMarkdownFilter\(\);\n\2return f\.feed\(rawText\) \+ f\.flush\(\);\n\1\}\)\(\);\n\1const mediaUrl = payload\.mediaUrl \?\? payload\.mediaUrls\?\.\[0\];/m;
  const match = deliverBlockRe.exec(next);
  if (!match) {
    throw new Error("deliver payload block not found");
  }
  const outer = match[1];
  const inner = match[2];
  const newBlock = `${outer}const rawText = payload.text ?? "";
${outer}const lingxiaMediaPatch = !payload.mediaUrl && !(payload.mediaUrls?.length)
${inner}? extractLingxiaMediaDirectives(rawText, route.agentId)
${inner}: null;
${outer}const effectivePayload = lingxiaMediaPatch
${inner}? { ...payload, text: lingxiaMediaPatch.text, mediaUrl: lingxiaMediaPatch.mediaUrls[0], mediaUrls: lingxiaMediaPatch.mediaUrls }
${inner}: payload;
${outer}let text = (() => {
${inner}const f = new StreamingMarkdownFilter();
${inner}const filteredRawText = effectivePayload.text ?? "";
${inner}return f.feed(filteredRawText) + f.flush();
${outer}})();
${outer}const mediaUrl = effectivePayload.mediaUrl ?? effectivePayload.mediaUrls?.[0];`;
  next = next.replace(deliverBlockRe, newBlock);
  return { changed: true, content: next };
}

function cleanupLegacyUploadPatch(content) {
  let next = content;
  if (!next.includes(LEGACY_REMOTE_FETCH_PATCH_MARKER)) return { changed: false, content };

  next = next.replace('import * as zlib from "node:zlib";\n', "");
  next = next.replace(
    /\n\/\/ lingxia-media-remote-fetch-v2: retry Mermaid image URLs when model output uses brittle pako or scale-only URLs\.\n[\s\S]*?\n(?=\/\*\*\n \* Download a remote media URL)/,
    "\n"
  );
  next = next.replace(
    /(\s*)logger\.debug\(`downloadRemoteImageToTemp: fetching url=\$\{url\}`\);\n\s*const \{ res, finalUrl \} = await fetchLingxiaRemoteMediaWithRetryV2\(url\);\n\s*if \(finalUrl !== url\) \{\n\s*logger\.info\(`downloadRemoteImageToTemp: using retry url=\$\{finalUrl\}`\);\n\s*\}\n\s*const buf = Buffer\.from\(await res\.arrayBuffer\(\)\);/m,
    `$1logger.debug(\`downloadRemoteImageToTemp: fetching url=\${url}\`);
$1const res = await fetch(url);
$1if (!res.ok) {
$1  const msg = \`remote media download failed: \${res.status} \${res.statusText} url=\${url}\`;
$1  logger.error(\`downloadRemoteImageToTemp: \${msg}\`);
$1  throw new Error(msg);
$1}
$1const buf = Buffer.from(await res.arrayBuffer());`
  );
  next = next.replace(
    'const ext = getExtensionFromContentTypeOrUrl(res.headers.get("content-type"), finalUrl);',
    'const ext = getExtensionFromContentTypeOrUrl(res.headers.get("content-type"), url);'
  );
  return { changed: next !== content, content: next };
}

let patched = 0;
let missing = 0;
for (const target of messageTargets) {
  if (!fs.existsSync(target)) {
    missing += 1;
    continue;
  }
  const original = fs.readFileSync(target, "utf8");
  const result = patchContent(original, target);
  if (result.changed) {
    fs.writeFileSync(target, result.content, "utf8");
    patched += 1;
    console.log(`patched ${target}`);
  } else {
    console.log(`already patched ${target}`);
  }
}

for (const target of uploadTargets) {
  if (!fs.existsSync(target)) {
    missing += 1;
    continue;
  }
  const original = fs.readFileSync(target, "utf8");
  const result = cleanupLegacyUploadPatch(original);
  if (result.changed) {
    fs.writeFileSync(target, result.content, "utf8");
    patched += 1;
    console.log(`removed legacy remote media patch from ${target}`);
  } else {
    console.log(`no legacy remote media patch in ${target}`);
  }
}

const totalTargets = messageTargets.length + uploadTargets.length;
if (patched === 0 && missing === totalTargets) {
  console.log(`openclaw-weixin plugin not found under ${pluginRoot}; skipped`);
} else {
  console.log(`openclaw-weixin media patch complete: patched=${patched}, missing=${missing}`);
}

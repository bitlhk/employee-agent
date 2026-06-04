# OpenClaw Patch Register

This document records local OpenClaw runtime patches that must be checked after
`npm install -g openclaw@latest` or any OpenClaw package replacement.

## 2026-06-03: MCP trusted runtime context

Status: applied on local, Singapore experimental, and Shanghai environments for
OpenClaw `2026.5.28 (e932160)`.

Purpose:

- Let stdio MCP tools receive trusted OpenClaw runtime context without asking the
  model to pass identity-like arguments.
- Support row-level business authorization for tools such as customer-manager
  wealth assistant while keeping the integration as MCP.
- Keep the public tool input schema unchanged.

Runtime files:

- `/usr/lib/node_modules/openclaw/dist/agent-bundle-mcp-runtime-n24dxm4C.js`
- `/usr/lib/node_modules/openclaw/dist/selection-BMP-JCML.js`

Local user-level npm installs may use the same files under
`/home/ubuntu/.npm-global/lib/node_modules/openclaw/dist/`.

Patch shape:

1. Pass `sessionAgentId` when creating the session MCP runtime.

```diff
 await getOrCreateSessionMcpRuntime({
   sessionId: params.sessionId,
   sessionKey: params.sessionKey,
+  agentId: sessionAgentId,
   workspaceDir: effectiveWorkspace,
   cfg: params.config
 })
```

2. Store `agentId` on the runtime and pass trusted context through MCP
   `tools/call` `_meta`.

```diff
 return {
   sessionId: params.sessionId,
   sessionKey: params.sessionKey,
+  agentId: params.agentId,
   workspaceDir: params.workspaceDir,
```

```diff
+const inferredAgentId = typeof params.sessionKey === "string"
+  ? /^agent:([^:]+):/.exec(params.sessionKey)?.[1]
+  : void 0;
+const openclawContext = {
+  agentId: params.agentId ?? inferredAgentId ?? null,
+  sessionId: params.sessionId ?? null,
+  sessionKey: params.sessionKey ?? null,
+  workspaceDir: params.workspaceDir ?? null
+};
 return await session.client.callTool({
   name: toolName,
-  arguments: isMcpConfigRecord(input) ? input : {}
+  arguments: isMcpConfigRecord(input) ? input : {},
+  _meta: { openclaw: openclawContext }
 });
```

Expected MCP server-side signal:

```json
{
  "_meta": {
    "openclaw": {
      "agentId": "trial_lgc-example",
      "sessionId": "uuid",
      "sessionKey": "agent:trial_lgc-example:conversation",
      "workspaceDir": "/root/.openclaw/workspace-trial_lgc-example"
    }
  }
}
```

Operational notes:

- Back up both dist files before applying the patch.
- Restart the actual OpenClaw gateway service after applying. Shanghai uses a
  system service named `openclaw-gateway`; some local/test machines use
  `systemctl --user`.
- Re-check this patch after every OpenClaw upgrade because hashed dist filenames
  may change.
- The patch is intentionally placed in MCP `_meta`, not in tool arguments, so it
  should not be visible to the model as a user-controllable parameter.

Rollback:

- Restore the two backed-up dist files.
- Restart OpenClaw gateway.

Validation:

- Create or run a temporary MCP probe tool that returns the handler `extra`
  object.
- A successful patch shows `extra._meta.openclaw.agentId`,
  `extra._meta.openclaw.sessionId`, `extra._meta.openclaw.sessionKey`, and
  `extra._meta.openclaw.workspaceDir`.

## 2026-06-03: Codex harness user MCP server projection

Status: applied on local OpenClaw `2026.5.28 (e932160)`.

Purpose:

- Let Codex-harness child agents see and call MCP servers configured in
  `openclaw.json` under `mcp.servers`.
- Keep local `coding` agents able to use registered MCP servers such as Wind,
  qieman, bond quote parsing, and wealth assistant.
- Avoid switching child agents to a broad `tools.allow=["*"]` policy just to
  expose MCP.

Runtime files:

- `/home/ubuntu/.openclaw/npm/projects/openclaw-codex-8902d781d4/node_modules/@openclaw/codex/dist/run-attempt-CuhGEh0u.js`
- `/home/ubuntu/.openclaw-public/npm/projects/openclaw-codex-8902d781d4/node_modules/@openclaw/codex/dist/run-attempt-CuhGEh0u.js`

The global OpenClaw package may also contain a similarly named Codex run-attempt
bundle, but the local gateway loads the per-profile `@openclaw/codex` plugin
copies above. Patch the actual loaded plugin files, not only the global dist.

Patch shape:

1. Add a helper that recognizes `bundle-mcp` in Codex tool allowlists.

```diff
+function hasCodexBundleMcpToolAllow(toolsAllow) {
+  return toolsAllow.some((name) => {
+    const normalized = normalizeCodexDynamicToolName$1(name);
+    return normalized === "bundle_mcp" || normalized === "bundle-mcp";
+  });
+}
```

2. Permit native surface when `bundle-mcp` is explicitly allowed, while still
   preserving the existing sandbox capability check.

```diff
-return hasWildcardCodexToolsAllow(toolsAllow) && canCodexAppServerNativeToolSurfaceHonorSandbox(sandbox, options);
+return (hasWildcardCodexToolsAllow(toolsAllow) || hasCodexBundleMcpToolAllow(toolsAllow)) && canCodexAppServerNativeToolSurfaceHonorSandbox(sandbox, options);
```

3. Pass the full OpenClaw config into Codex thread lifecycle so
   `buildCodexUserMcpServersThreadConfigPatch()` can read `mcp.servers`.

```diff
-params: params.buildAttemptParams(),
+params: {
+  ...params.buildAttemptParams(),
+  config: params.config
+},
```

4. Enable user MCP server projection for Codex thread startup.

```diff
-userMcpServersEnabled: params.nativeToolSurfaceEnabled,
+userMcpServersEnabled: true,
```

Operational notes:

- Back up both profile plugin files before applying this patch.
- Restart both local gateway services after patching:

```bash
systemctl --user restart openclaw-gateway openclaw-gateway-public
```

- Re-check after OpenClaw or `@openclaw/codex` plugin upgrades because hashed
  profile paths and dist filenames may change.

Validation:

- Run a short Codex child-agent turn and inspect
  `<session>.jsonl.codex-app-server.json`.
- A successful patch writes `userMcpServersFingerprint` containing
  `mcp_servers`.
- Real-call validation on local:
  `wealth_assistant.wealth_assistant_customer_list` completed successfully with
  `isError=false`.

Known limitation:

- This patch only makes Codex-harness agents able to see and call configured MCP
  servers.
- A temporary `codex_context_probe` MCP verified that Codex native MCP tool
  handlers receive `_meta` with Codex turn metadata, but not
  `_meta.openclaw.agentId/sessionKey/sessionId`.
- Therefore, row-level authorization based on trusted OpenClaw runtime identity
  still needs an additional Codex native MCP context patch, or the sensitive MCP
  must route through an OpenClaw-controlled wrapper that injects trusted context.

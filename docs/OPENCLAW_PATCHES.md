# OpenClaw Patch Register

This document records local OpenClaw runtime patches that must be checked after
`npm install -g openclaw@latest` or any OpenClaw package replacement.

## Integration boundary: standard MCP vs standard Tool

Use two integration categories:

- Standard MCP for external capabilities:
  - If the upstream is already a standards-compatible MCP server, register the
    remote HTTP MCP endpoint directly in OpenClaw.
  - If the upstream is a plain REST/API/script service, expose a lightweight
    HTTP MCP facade and register that facade in OpenClaw.
  - Examples: Wind, qieman, bond quote parser, Skywork PPT.
- Standard Tool for platform-governed capabilities:
  - Use OpenClaw plugin tools when the capability needs trusted platform
    context such as `agentId`, session identity, role/post permissions,
    row-level data authorization, audit, or masking.
  - Example: wealth assistant context/customer/product tools.

Operational rule:

- Prefer remote HTTP MCP when the provider already offers MCP.
- Prefer local/remote HTTP MCP facade when adapting a plain external API.
- Avoid stdio MCP for long-lived production integrations under Codex app-server
  because stdio can spawn per session/turn and create avoidable resource growth.

## 2026-06-06: Wind and qieman HTTP MCP migration

Status:

- Applied on local OpenClaw main profile.
- `wind_stock_data`, `wind_index_data`, `wind_financial_docs`, and `qieman`
  are registered as `streamable-http` MCP servers instead of stdio servers.
- Superseded later on 2026-06-06 by direct remote HTTP MCP registration; keep
  this section as rollback/history for the local proxy approach.

Purpose:

- Avoid spawning a new Node stdio MCP bridge process per Codex app-server
  session/turn.
- Keep Wind and qieman as MCP integrations while making them long-lived local
  HTTP proxies.
- Reduce resource growth observed with stdio MCP servers under Codex
  app-server.

Runtime files:

- `/home/ubuntu/.openclaw/mcp/http-proxy/wind-qieman-http-mcp.mjs`
- `/home/ubuntu/.config/systemd/user/wind-qieman-http-mcp.service`
- `/home/ubuntu/.openclaw/openclaw.json`

OpenClaw MCP registration shape:

```json
{
  "mcp": {
    "servers": {
      "wind_stock_data": {
        "url": "http://127.0.0.1:17891/wind/stock_data/mcp",
        "transport": "streamable-http"
      },
      "wind_index_data": {
        "url": "http://127.0.0.1:17891/wind/index_data/mcp",
        "transport": "streamable-http"
      },
      "wind_financial_docs": {
        "url": "http://127.0.0.1:17891/wind/financial_docs/mcp",
        "transport": "streamable-http"
      },
      "qieman": {
        "url": "http://127.0.0.1:17891/qieman/mcp",
        "transport": "streamable-http"
      }
    }
  }
}
```

Operational notes:

- The HTTP proxy reads existing local Wind/qieman credentials from the same
  places as the old stdio bridges. Do not hard-code API keys in the service
  file.
- Start/restart the proxy with:

```bash
systemctl --user restart wind-qieman-http-mcp
```

- Restart OpenClaw after changing MCP registration:

```bash
systemctl --user restart openclaw-gateway
```

Validation:

```bash
curl -s http://127.0.0.1:17891/health
openclaw mcp probe wind_stock_data
openclaw mcp probe wind_index_data
openclaw mcp probe wind_financial_docs
openclaw mcp probe qieman
```

Observed local validation on 2026-06-06:

- `wind_stock_data`: 9 tools
- `wind_index_data`: 6 tools
- `wind_financial_docs`: 2 tools
- `qieman`: 43 tools
- Codex model-side call to `qieman__GetCurrentTime` succeeded.
- No `wind-stdio-bridge` or `qieman-stdio-bridge` child process was spawned.

## 2026-06-06: Bond quote parser HTTP MCP migration

Status:

- Applied on local OpenClaw main profile.
- `bond-quote-parse` is registered as a `streamable-http` MCP server instead
  of a Python stdio server.

Purpose:

- Avoid creating persistent Python stdio MCP child processes under Codex
  app-server sessions.
- Keep the bond quote parser as a reusable MCP tool for team/role allowlists.

Runtime files:

- `/home/ubuntu/.openclaw/mcp/http-proxy/bond-quote-http-mcp.mjs`
- `/home/ubuntu/.config/systemd/user/bond-quote-http-mcp.service`
- `/home/ubuntu/.openclaw/openclaw.json`

OpenClaw MCP registration shape:

```json
{
  "mcp": {
    "servers": {
      "bond-quote-parse": {
        "url": "http://127.0.0.1:17892/mcp",
        "transport": "streamable-http"
      }
    }
  }
}
```

Operational notes:

- The HTTP proxy reads `/home/ubuntu/.openclaw/mcp/bond-quote-parse/.env`,
  preserving the old stdio server's upstream/API-key behavior.
- Start/restart the proxy with:

```bash
systemctl --user restart bond-quote-http-mcp
```

Validation:

```bash
curl -s http://127.0.0.1:17892/health
openclaw mcp probe bond-quote-parse
```

Observed local validation on 2026-06-06:

- `bond-quote-parse`: 4 tools
- Codex model-side call to `bond_quote_parse__bond_parse_health` returned
  `ok=true` and `http_status=200`.
- No Python `bond-quote-parse/server.py` stdio MCP child process was spawned.

## 2026-06-06: Codex app-server user MCP thread config

Status:

- Applied on local OpenClaw `2026.6.1 (2e08f0f)`.

Purpose:

- Make Codex app-server threads receive user-configured `mcp.servers` from
  `openclaw.json`.
- Without this patch, `openclaw mcp probe` can see configured MCP servers, but
  Codex app-server only reads bundle plugin MCP config and does not expose
  `mcp.servers` tools to the model.

Runtime file:

- `/home/ubuntu/.npm-global/lib/node_modules/openclaw/dist/codex-mcp-config-DiJtIU8m.js`

Patch shape:

1. Import `normalizeConfiguredMcpServers`.
2. Add a helper that projects enabled `cfg.mcp.servers` into Codex
   `mcp_servers`.
3. Merge that projection with existing bundle MCP config in
   `loadCodexBundleMcpThreadConfig()`.

Validation:

- Before the patch, `bond_parse_health` and
  `bond_quote_parse__bond_parse_health` were not visible to Codex.
- After the patch, `bond_quote_parse__bond_parse_health` returned healthy.
- The same path enabled the HTTP MCP migration above to be visible to Codex.

## 2026-06-03: MCP trusted runtime context

Status:

- Applied on local, Singapore experimental, and Shanghai environments for
  OpenClaw `2026.5.28 (e932160)`.
- Re-applied on local OpenClaw `2026.6.1 (2e08f0f)` on 2026-06-05 after
  `npm install -g openclaw@latest`.

Purpose:

- Let stdio MCP tools receive trusted OpenClaw runtime context without asking the
  model to pass identity-like arguments.
- Support row-level business authorization for tools such as customer-manager
  wealth assistant while keeping the integration as MCP.
- Keep the public tool input schema unchanged.

Runtime files:

- `/usr/lib/node_modules/openclaw/dist/agent-bundle-mcp-runtime-n24dxm4C.js`
- `/usr/lib/node_modules/openclaw/dist/selection-BMP-JCML.js`
- Local OpenClaw `2026.6.1`: `/home/ubuntu/.npm-global/lib/node_modules/openclaw/dist/agent-bundle-mcp-runtime-D9yY5Bw7.js`
- Local OpenClaw `2026.6.1`: `/home/ubuntu/.npm-global/lib/node_modules/openclaw/dist/selection-DrXxngyT.js`

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
- Local OpenClaw `2026.6.1` smoke test on 2026-06-05:
  `wealth_assistant.wealth_assistant_customer_list` completed with
  `isError=false`.

## 2026-06-03: Codex harness user MCP server projection

Status:

- Applied on local OpenClaw `2026.5.28 (e932160)`.
- Re-applied on local main profile OpenClaw `2026.6.1 (2e08f0f)` on
  2026-06-05 after the `@openclaw/codex` profile bundle changed filename.

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
- Local main profile OpenClaw `2026.6.1`: `/home/ubuntu/.openclaw/npm/projects/openclaw-codex-8902d781d4/node_modules/@openclaw/codex/dist/run-attempt-DM53zFlW.js`

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
- Local OpenClaw `2026.6.1` smoke test on 2026-06-05:
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

## 2026-06-05: Codex streaming check

Status: not applied on local OpenClaw `2026.6.1 (2e08f0f)`.

Observation:

- After upgrade and `openclaw doctor --fix`, regular chat works again.
- Long output through Employee Agent still arrives as a single assistant content
  chunk on the local Codex/OpenAI path.
- A narrow trial patch around `shouldStreamAssistantPartial()` was tested and
  then reverted because it did not change the stream shape. The upstream
  Codex app-server path still delivered one terminal assistant content chunk.

Operational note:

- Do not assume the older Codex stream patch applies to `2026.6.1`.
- If true streaming is required again, re-investigate the raw Codex app-server
  event stream before patching; first prove whether multiple raw assistant
  deltas exist below OpenClaw.

## 2026-06-05: Codex/OpenAI model id routing trap

Status: local OpenClaw was rolled back from `2026.6.1` to
`2026.5.28 (e932160)` after the `2026.6.1` upgrade did not preserve the
validated Codex streaming behavior.

Observation:

- Historical local `2026.5.28` backups from 2026-06-02 onward often used
  `openai/gpt-5.5` as the default agent model while still keeping an
  `openai-codex:*` auth profile.
- Do not infer "Codex auth route" from the display/model name alone.
- On the local rollback test, forcing `x-openclaw-model: openai/gpt-5.5`
  routed through `provider=openai api=openai-responses` and failed with an
  OpenAI API permission error (`api.responses.write` missing).
- Restoring the default model to `openai-codex/gpt-5.5` plus the Codex stream
  patch restored real streaming.

Validated local state after rollback:

- Global OpenClaw: `2026.5.28 (e932160)`.
- Main and public gateway services active.
- Main and public default model: `openai-codex/gpt-5.5`.
- Main profile stream smoke test:
  `content_chunks=475`, `first_chunk_ms=194`, `total_ms=14614`.

Operational note:

- When upgrading or rolling back OpenClaw, verify the actual provider in logs,
  not just the configured model string.
- For the current local Codex-auth path, keep defaults on
  `openai-codex/gpt-5.5` unless a fresh test proves that `openai/gpt-5.5`
  routes to the same Codex-auth provider and streams correctly.

Singapore `2026.6.1` experimental note:

- The Singapore experimental host runs OpenClaw
  `2026.6.1 (2e08f0f)`.
- On that version/config, `openai-codex/gpt-5.5` is not a recognized model id
  (`Unknown model`).
- With only the `openai-codex:*` auth profile present, `openai/gpt-5.5` is the
  working Codex-auth model name.
- After removing GLM routing from the default and test agents, the default
  `openai/gpt-5.5` route streamed successfully:
  `content_chunks=449`, `first_chunk_ms=114`, `total_ms=13597`.
- Therefore, do not copy the local rollback model name (`openai-codex/gpt-5.5`)
  to OpenClaw `2026.6.1` without testing the model catalog first.

## 2026-06-06: Local OpenClaw 6.1 Codex route migration

Status: applied on local main and public profiles.

Validated state:

- Global OpenClaw: `2026.6.1 (2e08f0f)`.
- Main and public default model: `openai/gpt-5.5`.
- Main and public Codex runtime file matches the Singapore experimental host:
  `@openclaw/codex/dist/run-attempt-CuhGEh0u.js`
  SHA-256 `6591dadb511e449d36de10a8b2f79e24ce08feb1119a5f15efb6928b7da1140e`.
- Main profile long-output stream smoke test:
  `contentChunks=465`, `first_chunk_ms=3964`, `total_ms=12454`.
- Public profile long-output stream smoke test:
  `contentChunks=217`, `first_chunk_ms=10537`, `total_ms=14522`.

Important migration details:

- The working 6.1 route is not just a model-name change. The local main agent
  had a stale local `agents/main/agent/auth-profiles.json` shadow with
  `provider=openai`; this caused `openai/gpt-5.5` to route incorrectly or fail
  with `openai:default` auth-profile errors.
- The local main agent auth profile must provide Codex OAuth credentials under
  an OpenAI-compatible profile id used by the Codex harness:
  `openai:default` with `provider=openai-codex`, plus the normal
  `openai-codex:<account>` profile.
- The Codex runtime file must emit assistant deltas via:
  `this.emitAgentEvent({ stream: "assistant", data: { text, delta } })`.
  A previous local patch/overwrite had removed that emit call, which caused
  single-chunk assistant output even after the 6.1 model/auth route was fixed.

Backups for this migration:

- `/home/ubuntu/openclaw-backups/local-upgrade-clean-auth-20260606-100506`

## 2026-06-06: Wind and qieman direct HTTP MCP migration

Status: applied on local main profile.

Change:

- `wind_stock_data`, `wind_index_data`, and `wind_financial_docs` now point
  directly to Wind remote HTTP MCP endpoints instead of the local
  `127.0.0.1:17891` proxy.
- `qieman` now points directly to the qieman remote HTTP MCP endpoint instead
  of the local `127.0.0.1:17891` proxy.
- The previous Wind/qieman local proxy service
  `wind-qieman-http-mcp.service` was stopped and disabled.

Tool exposure remains intentionally restricted:

- Wind stock data: 9 allowlisted tools.
- Wind index data: 6 allowlisted tools.
- Wind financial docs: 2 allowlisted tools.
- Qieman: 43 allowlisted tools. The remote server currently exposes more tools;
  keep `toolFilter.include` to avoid accidental expansion.

Validation:

- Direct remote probes succeeded before the config change.
- `openclaw mcp probe wind_stock_data --json` returned 9 tools.
- `openclaw mcp probe wind_index_data --json` returned 6 tools.
- `openclaw mcp probe wind_financial_docs --json` returned 2 tools.
- `openclaw mcp probe qieman --json` returned 43 tools and filtered 26 tools.
- No local listener remains on port `17891`, and
  `wind-qieman-http-mcp.service` is inactive/disabled.

Operational note:

- Direct remote HTTP MCP is preferred when the upstream service is already a
  standards-compatible MCP server.
- Keep a local HTTP MCP facade only for plain REST/script services that are not
  themselves MCP servers, such as the current bond quote parser and Skywork PPT
  wrapper.

Backup:

- `/home/ubuntu/openclaw-backups/direct-wind-qieman-mcp-20260606-142220`

## 2026-06-06: Skywork PPT HTTP MCP migration

Status: applied on local main profile.

Change:

- `skywork_ppt` was migrated from stdio MCP to a local HTTP MCP facade:
  `http://127.0.0.1:17893/mcp`.
- The HTTP facade wraps the Skywork PPT generation API and exposes one MCP
  tool: `skywork_ppt_generate`.
- The service is managed by `skywork-ppt-http-mcp.service`.
- Skywork secrets were moved out of the OpenClaw MCP server entry and into the
  local Skywork MCP environment file.

Runtime files:

- `/home/ubuntu/.openclaw/mcp/http-proxy/skywork-ppt-http-mcp.mjs`
- `/home/ubuntu/.config/systemd/user/skywork-ppt-http-mcp.service`
- `/home/ubuntu/.openclaw/mcp/skywork-ppt-mcp/.env`
- `/home/ubuntu/.openclaw/openclaw.json`

Validation:

- `curl -s http://127.0.0.1:17893/health` returned `{"status":"ok"}`.
- `openclaw mcp probe skywork_ppt --json` returned 1 tool:
  `skywork_ppt__skywork_ppt_generate`.
- Local OpenClaw main profile has no stdio MCP server entries after this
  migration. The old disabled `wealth_assistant` stdio MCP entry was removed
  because the wealth assistant now uses OpenClaw plugin tools.

Operational note:

- Listing/probing this MCP does not consume Skywork generation quota.
- Calling `skywork_ppt_generate` still consumes Skywork API entitlement/quota
  and depends on the upstream Skywork account status.

Backup:

- `/home/ubuntu/openclaw-backups/skywork-http-mcp-20260606-143351`
- `/home/ubuntu/openclaw-backups/remove-disabled-stdio-mcp-20260606-143453`

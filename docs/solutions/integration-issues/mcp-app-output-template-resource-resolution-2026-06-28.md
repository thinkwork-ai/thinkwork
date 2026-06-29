---
title: "MCP App output templates must be resolved with readResource"
date: 2026-06-28
category: integration-issues
module: packages/agentcore-pi, apps/web
problem_type: integration_issue
component: assistant
symptoms:
  - "ThinkWork showed a successful MCP tool call but did not render the actual MCP App frame."
  - "A raw HTML or metadata inspection looked successful while the user-visible harness still showed plain output."
  - "Codex and Claude could render LastMile Dispatch after OAuth, but ThinkWork initially lost the app HTML."
root_cause: missing_workflow_step
resolution_type: code_fix
severity: high
related_components:
  - packages/agentcore-pi/agent-container/src/mcp-connect.ts
  - packages/agentcore-pi/agent-container/tests/mcp-connect.test.ts
  - apps/web MCP App renderer
tags: [mcp, mcp-apps, output-template, read-resource, lastmile, agentcore-pi, codex, claude]
---

# MCP App output templates must be resolved with readResource

## Problem

LastMile Dispatch returned a valid MCP App result that Codex and Claude could
render, but ThinkWork still failed to show the actual app in the thread. The
problem was not the MIME type alone. ThinkWork had learned to preserve embedded
HTML resources, but the LastMile tool result advertised the app through MCP
metadata pointing at a `ui://` resource, so the runtime had to follow that URI
with `readResource()` before persisting `details.mcp_apps`.

## Symptoms

- `dispatch_optimization_app` returned text such as `Dispatch optimization app`
  plus `_meta.openai/outputTemplate: ui://lastmile-dispatch/optimization-v2`.
- ThinkWork treated the tool call as successful but had no app HTML to mount in
  the web renderer.
- Raw HTML snippets and "tool call succeeded" messages were false positives.
  The only successful proof was a visible `Dispatch Optimization` app frame in
  the host.
- Codex initially returned `Auth required` until the configured
  `lastmile_dispatch` MCP server completed OAuth with
  `codex mcp login lastmile_dispatch` (session history).

## What Didn't Work

- Treating `text/html;profile=mcp-app` support as the complete fix. PR #3084
  correctly accepted profiled HTML resources, but it only covered resources
  embedded directly in `content[]`.
- Calling the MCP tool and pasting or inspecting the first few hundred
  characters of HTML. That proves the server can produce HTML, not that the
  agent harness found, persisted, and rendered the app resource.
- Testing through a direct HTTP or local script shortcut. The critical failure
  was host integration, so the final proof had to use real ThinkWork, Codex,
  and Claude harnesses.
- Relying on the older LastMile session-history contract that referenced
  `ui://lastmile-dispatch/optimization`. The verified deployed app used
  `ui://lastmile-dispatch/optimization-v2` with host metadata (session history).

## Solution

In PR #3090, ThinkWork updated the AgentCore Pi MCP bridge to resolve app
resource URIs advertised in tool-result metadata:

```ts
const DEFAULT_READ_RESOURCE_TIMEOUT_MS = 30_000;
```

The bridge now extracts candidate resource URIs from the tool result metadata:

```ts
_meta: {
  "openai/outputTemplate": "ui://lastmile-dispatch/optimization-v2",
  "ui/resourceUri": "ui://lastmile-dispatch/optimization-v2",
  ui: { resourceUri: "ui://lastmile-dispatch/optimization-v2" },
}
```

For each URI, it calls the MCP client:

```ts
client.readResource({ uri }, { timeout: readResourceTimeoutMs })
```

Then it converts `contents[]` entries with an HTML MIME type into the same
`details.mcp_apps` descriptor shape the existing ThinkWork renderer already
understood:

```ts
{
  uri: "ui://lastmile-dispatch/optimization-v2",
  mimeType: "text/html",
  html: "<!doctype html>...",
  title: "Dispatch Optimization",
  serverName: "lastmile-dispatch",
  toolName: "dispatch_optimization_app",
}
```

The regression test added a LastMile-like tool result with only text content
and `_meta.openai/outputTemplate`, then asserted that `readResource()` was
called and the resolved HTML was persisted in `details.mcp_apps`.

## Why This Works

MCP Apps can be delivered in two shapes:

1. Direct embedded resource content in the tool result, such as a `content[]`
   item whose `resource.text` contains HTML.
2. An output template URI in tool-result metadata, where the host must call
   `resources/read`/`readResource()` to retrieve the HTML.

ThinkWork already had a renderer for `details.mcp_apps`; it was missing the
second acquisition path. Resolving `_meta.openai/outputTemplate`,
`_meta["ui/resourceUri"]`, and `_meta.ui.resourceUri` closes that gap without
changing the web renderer contract.

Normalizing the accepted MIME type to `text/html` in the descriptor is also
important. `text/html;profile=mcp-app` is a valid advertised app resource, but
the renderer only needs to know it has safe HTML to frame.

## Prevention

- Add regression tests for both MCP App delivery shapes whenever changing MCP
  tool-result handling: embedded HTML resources and metadata-only output
  templates.
- Treat host-rendered UI as the acceptance criterion. A passing MCP call,
  returned HTML string, or app URI is not enough.
- For remote MCP servers that require OAuth, verify through the actual client
  authentication flow. For Codex, use `codex mcp login <server>` and restart or
  send work to an app-owned thread if an already-open MCP worker keeps stale
  unauthenticated state.
- When comparing hosts, use the same prompt and same configured MCP server:

```text
Use the configured LastMile Dispatch MCP server. Call dispatch_optimization_app
with no arguments. Do not summarize HTML and do not paste HTML yourself. After
the tool call, reply with only: Called dispatch_optimization_app.
```

- Verify at least one real rendered element in each host. For this incident,
  the expected visible content was `Dispatch Optimization`, `EMPTY`, `Orders 0`,
  `Resources 0`, `Routes 0`, `Unassigned 0`, and the empty-state message.

## Related Issues

- PR #3084: [fix(mcp): preserve profiled app HTML resources](https://github.com/thinkwork-ai/thinkwork/pull/3084)
- PR #3090: [fix(mcp): resolve MCP app output templates](https://github.com/thinkwork-ai/thinkwork/pull/3090)
- LastMile PR #912: `fix(lmi): support MCP app host rendering`
- LastMile PR #913: `chore(lmi): add MCP app changeset`
- [LastMile plugin install blocked by missing CONTEXT.md](./lastmile-plugin-install-blocked-by-missing-context-md-2026-06-17.md)
- [Plugin source boundaries package-owned deploy verified](../architecture-patterns/plugin-source-boundaries-package-owned-deploy-verified-2026-06-17.md)
- [AgentCore runtime doesn't auto-repull; ECR push alone is invisible](../workflow-issues/agentcore-runtime-no-auto-repull-requires-explicit-update-2026-04-24.md)

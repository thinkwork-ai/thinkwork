---
title: "Swapping agent runtimes requires a tool-parity audit and a shared tool-record contract"
date: 2026-05-29
category: architecture-patterns
module: agentcore-pi
problem_type: architecture_pattern
component: assistant
severity: high
applies_when:
  - "Migrating the active agent runtime (e.g., Strands -> Pi) or standing up a second runtime that must reach parity"
  - "An agent reports it lacks a tool that the product inventory says is enabled"
  - "Thread activity / tool rows render but expand to nothing on one runtime"
tags: [agent-runtime, agentcore-pi, pi-runtime-core, tool-parity, web-search, context-engine, runtime-contract]
---

# Swapping agent runtimes requires a tool-parity audit and a shared tool-record contract

## Context

Dev moved its active agent runtime from the Python **Strands** container
(`agentcore-strands`) to the TypeScript **Pi** runtime (`agentcore-pi` +
`pi-runtime-core`). Two classes of regression followed, both invisible until a
user exercised the agent:

1. **Missing tools.** Asking "what's the weather in Austin?" returned *"I don't
   have a web search tool… the MCP proxy is registered but not yet wired in this
   runtime version."* That was **not a hallucination** — it was a literal string
   from `agentcore-pi/src/mcp-proxy.ts` (an intentional inert seam), and the
   real cause was that the Pi runtime simply **never registered `web_search` or
   the Company Brain (`query_context`) tools at all**, even though the tenant
   tool inventory showed them enabled. Strands had them; Pi did not.
2. **Empty tool detail.** After the tools were ported, the activity rows
   ("Finding sources", "Using browser automation") still expanded to nothing.
   The thread UI reads `input_preview` / `output_preview` / `status` (the field
   names Strands emits), but `pi-runtime-core` emitted `args` / `result` /
   `is_error`. Same concept, different field names → the UI rendered nothing.

## Guidance

When swapping or adding an agent runtime, treat **tool surface** and **tool-record
shape** as explicit contracts to re-establish, not as things that come along for
free:

1. **Audit the tool inventory against the old runtime.** Enumerate what the
   prior runtime registered (`agentcore-strands/container-sources/*_tool.py`)
   and diff against the new runtime's tool assembly (`agentcore-pi`'s
   `assembleTools` in `server.ts`). The product's tenant tool inventory (admin
   Tools tab) is the source of truth for what *should* be available. On the
   Strands→Pi swap, `web_search` (Exa) and Company Brain (`query_context` /
   `query_memory_context` / `query_wiki_context`) were the gaps; browser
   automation, code sandbox, send-email, and memory were already present.
2. **Treat agent "I don't have tool X" output as literal until disproven.**
   Grep the codebase for the exact phrase — runtimes carry intentional
   "not yet wired" inert seams, and the model will also improvise plausible
   excuses (it blamed the MCP proxy when the real gap was an unregistered
   first-class tool). The payload fields were already being sent by
   `chat-agent-invoke` / `wakeup-processor` (`web_search_config`,
   `context_engine_enabled`); only the runtime's *consumption* was missing.
3. **Pin a single tool-invocation record shape across all runtimes.** The thread
   UI's `toolInvocationDetail` (TaskThreadView) reads `input_preview`,
   `output_preview`, `status`. Any runtime that records tool calls must emit
   those fields, regardless of its internal event shape:

   ```ts
   // pi-runtime-core/src/agent-loop.ts — on tool_execution_start / _end
   toolInvocations.push({
     id, name, tool_name,
     args: event.args,
     input_preview: toolPreview(event.args),   // <- UI reads this
     status: "running",
     runtime: "pi",
   });
   // ...on end:
   existing.output_preview = toolPreview(event.result);  // <- and this
   existing.status = event.isError ? "error" : "ok";      // <- and this
   ```

4. **Mind that "local" runtimes are a third path.** The desktop sidecar
   (`apps/desktop/.../local-turn-runner.ts`) is neither Strands nor cloud-Pi —
   it uses the `@earendil-works/pi-coding-agent` SDK and records tool calls
   *yet again differently* (it only had tool **names** from `session.messages`,
   no args/results). Parity work must cover all three: Strands (legacy),
   managed Pi (`pi-runtime-core`), and local-Pi sidecar.

## Why This Matters

These regressions are silent at build/deploy time and only surface when a human
runs the agent — the worst place to discover them. A runtime swap that "passes
CI" can still ship an agent that has lost half its tools or shows blank activity
rows. The fix for each was small (register the tool; add three preview fields);
the cost was the discovery loop. An explicit parity audit + a pinned record
contract turns a multi-round debugging session into a checklist.

## When to Apply

- Before declaring a runtime swap "done" — diff the tool inventories.
- When an agent denies having an enabled tool — grep for the literal message.
- When activity/tool rows appear but carry no detail on a given runtime — check
  the emitted record fields against what the UI reads.

## Examples

**Tool registration gap (managed Pi).** `web_search_config` and
`context_engine_enabled` were in the invocation payload but unconsumed; the fix
was registering the tools in `assembleTools`:

```ts
if (typeof args.payload.web_search_config === "object" && args.payload.web_search_config) {
  const t = buildWebSearchTool({ webSearchConfig: args.payload.web_search_config as Record<string, unknown> });
  if (t) tools.push(t);
}
```

**Record-shape mismatch.** Before: Pi emitted only `args`/`result`/`is_error`
→ UI's `toolInvocationDetail` found no `input_preview`/`output_preview`/`status`
and rendered nothing. After: the same record also carries the three preview
fields → rows render "Input / Output / Status".

## Related

- Desktop **scoped per-turn token** pattern: the desktop holds no platform
  secret, so local-Pi API-backed tools (Company Brain, Send Email) authenticate
  via the per-turn `finalize_callback_secret`, deriving tenant/user/agent from
  the turn (never client headers) — see `lib/desktop-runtime/finalize-auth.ts`.
  Worth its own write-up.
- Local-Pi sidecar tool-detail (surfacing args/results from `session.messages`)
  is an open follow-up — it currently emits tool names only.
- The browser dev app (localhost:5180) always runs **managed cloud**, not local
  Pi (local exists only in the Electron desktop app) — relevant when triaging
  "why is my local agent slow / has no local output".

---
title: "Swapping agent runtimes requires a tool-parity audit and a shared tool-record contract"
date: 2026-05-29
last_updated: 2026-06-04
category: architecture-patterns
module: agentcore-pi
problem_type: architecture_pattern
component: assistant
severity: high
applies_when:
  - "Migrating the active agent runtime (e.g., Strands -> Pi) or standing up a second runtime that must reach parity"
  - "An agent reports it lacks a tool that the product inventory says is enabled"
  - "Thread activity / tool rows render but expand to nothing on one runtime"
  - "Tool rows render escaped previews, overflow, or disappear after reload"
tags:
  [
    agent-runtime,
    agentcore-pi,
    pi-runtime-core,
    tool-parity,
    web-search,
    web-extract,
    context-engine,
    runtime-contract,
  ]
---

# Swapping agent runtimes requires a tool-parity audit and a shared tool-record contract

## Context

Dev moved its active agent runtime from the Python **Strands** container
(`agentcore-strands`) to the TypeScript **Pi** runtime (`agentcore-pi` +
`pi-runtime-core`). Two classes of regression followed, both invisible until a
user exercised the agent:

1. **Missing tools.** Asking "what's the weather in Austin?" returned _"I don't
   have a web search tool… the MCP proxy is registered but not yet wired in this
   runtime version."_ That was **not a hallucination** — it was a literal string
   from `agentcore-pi/src/mcp-proxy.ts` (an intentional inert seam), and the
   real cause was that the Pi runtime simply **never registered `web_search` or
   the Company Brain (`query_context`) tools at all**, even though the tenant
   tool inventory showed them enabled. Strands had them; Pi did not.
2. **Empty tool detail.** After the tools were ported, the activity rows
   ("Finding sources", "Using browser automation") still expanded to nothing.
   The thread UI reads `input_preview` / `output_preview` / `status` (the field
   names Strands emits), but `pi-runtime-core` emitted `args` / `result` /
   `is_error`. Same concept, different field names → the UI rendered nothing.
3. **Unreadable or non-durable tool detail.** After Firecrawl-backed
   `web_extract` landed, Spaces thread detail could show deeply escaped
   `web_search` / `web_extract` previews, long fragments could bleed outside the
   details container, and completed invocation rows could vanish after reload
   when they only came from transient `tool_invocation_completed` events.

## Guidance

When swapping or adding an agent runtime, treat **tool surface** and **tool-record
shape** as explicit contracts to re-establish, not as things that come along for
free:

1. **Audit the tool inventory against the old runtime.** Enumerate what the
   prior runtime registered (`agentcore-strands/container-sources/*_tool.py`)
   and diff against the new runtime's tool assembly (`agentcore-pi`'s
   `assembleTools` in `server.ts`). The product's tenant tool inventory (admin
   Tools tab) is the source of truth for what _should_ be available. On the
   Strands→Pi swap, `web_search` (Exa) and Company Brain (`query_context` /
   `query_memory_context` / `query_wiki_context`) were the gaps; browser
   automation, code sandbox, send-email, and memory were already present.
2. **Treat agent "I don't have tool X" output as literal until disproven.**
   Grep the codebase for the exact phrase — runtimes carry intentional
   "not yet wired" inert seams, and the model will also improvise plausible
   excuses (it blamed the MCP proxy when the real gap was an unregistered
   first-class tool). The payload fields were already being sent by
   `chat-agent-invoke` / `wakeup-processor` (`web_search_config`,
   `context_engine_enabled`); only the runtime's _consumption_ was missing.
3. **Pin a single tool-invocation record shape across all runtimes.** The thread
   UI's `toolInvocationDetail` (TaskThreadView) reads `input_preview`,
   `output_preview`, `status`. Any runtime that records tool calls must emit
   those fields, regardless of its internal event shape:

   ```ts
   // pi-runtime-core/src/agent-loop.ts — on tool_execution_start / _end
   toolInvocations.push({
     id,
     name,
     tool_name,
     args: event.args,
     input_preview: toolPreview(event.args), // <- UI reads this
     status: "running",
     runtime: "pi",
   });
   // ...on end:
   existing.output_preview = toolPreview(event.result); // <- and this
   existing.status = event.isError ? "error" : "ok"; // <- and this
   ```

4. **Render the record contract through one forgiving UI path.** Persisting the
   right fields is necessary but not sufficient. `TaskThreadView` must render
   `usage.tool_invocations` as the reload-safe source for finished turns,
   extract `input_preview` / `output_preview` out of event payload metadata, and
   decode previews that may be valid nested JSON, escaped JSON strings, or
   truncated escaped fragments. Live `tool_invocation_completed` events are
   additive evidence during the current session; they are not the durable record.

5. **Keep legacy local provenance out of the active runtime contract.** Older
   desktop-local rows may still exist, but the current supported parity surface
   is Strands (legacy managed) and managed Pi (`pi-runtime-core`) on AgentCore.
   Do not add a new local runtime path to close a tool-parity gap.

## Why This Matters

These regressions are silent at build/deploy time and only surface when a human
runs the agent — the worst place to discover them. A runtime swap that "passes
CI" can still ship an agent that has lost half its tools or shows blank activity
rows. The fix for each was small (register the tool; add three preview fields);
the cost was the discovery loop. An explicit parity audit + a pinned record
contract turns a multi-round debugging session into a checklist.

The UI side of the contract is just as important. A runtime can persist the
right fields and still produce a bad operator experience if Spaces re-stringifies
preview payloads, assumes every preview is complete JSON, or reconstructs
completed rows only from transient events. The persisted `usage.tool_invocations`
record is the source of truth after reload.

## When to Apply

- Before declaring a runtime swap "done" — diff the tool inventories.
- When an agent denies having an enabled tool — grep for the literal message.
- When activity/tool rows appear but carry no detail on a given runtime — check
  the emitted record fields against what the UI reads.
- When web-search or web-extract rows show escaped JSON, overflow, or disappear
  after reload — verify the UI formats persisted usage records and transient
  event payloads through the same preview path.

## Examples

**Tool registration gap (managed Pi).** `web_search_config` and
`context_engine_enabled` were in the invocation payload but unconsumed; the fix
was registering the tools in `assembleTools`:

```ts
if (
  typeof args.payload.web_search_config === "object" &&
  args.payload.web_search_config
) {
  const t = buildWebSearchTool({
    webSearchConfig: args.payload.web_search_config as Record<string, unknown>,
  });
  if (t) tools.push(t);
}
```

**Record-shape mismatch.** Before: Pi emitted only `args`/`result`/`is_error`
→ UI's `toolInvocationDetail` found no `input_preview`/`output_preview`/`status`
and rendered nothing. After: the same record also carries the three preview
fields → rows render "Input / Output / Status".

**UI-side durable preview rendering.** PR
[#2068](https://github.com/thinkwork-ai/thinkwork/pull/2068) fixed the Spaces
side of this contract in `TaskThreadView.tsx`:

```ts
const detail = toolInvocationDetail(record);
rows.push({
  title: toolActionTitle(name),
  detail,
  kind: toolKind(name),
});
if (detail && isTurnFinished(turn.status)) {
  rows.push({
    title: "tool invocation completed",
    detail: toolInvocationCompletionDetail(record),
    kind: toolKind(name),
  });
}
```

The important shape is:

- Primary rows such as "Finding sources" and "Using web extract" keep expandable
  detail from persisted `usage.tool_invocations`.
- Finished turns synthesize a durable "tool invocation completed" row from the
  same persisted record so completed details survive reload.
- `eventDetail` removes preview fields from metadata and renders them as
  separate `Input:` / `Output:` blocks so live completed events do not
  re-stringify escaped previews.
- `formatToolPreview` first decodes complete nested JSON strings, then falls
  back to fragment unescaping for truncated Firecrawl/Exa previews.
- `ActionRow` uses full-width, min-width-zero, break-word detail styling so long
  URLs and preview fragments stay inside the thread column.

Session history matters here: parsing previews only as valid JSON failed because
Firecrawl output can be truncated; formatting only finalized usage rows missed
the live `tool_invocation_completed` path; depending on transient completed
events made rows disappear after reload; and the first durable-row patch briefly
made the primary tool rows blank until their `detail` was restored too. (session
history)

The regression coverage belongs next to the row convergence tests. PR #2068
added focused cases in `TaskThreadView.convergence.test.ts` for finalized nested
JSON previews, truncated escaped fragments, completed web-extract events, and
escaped web-search event fragments.

## Related

- Historical desktop-local per-turn token and sidecar tool-detail notes are
  superseded by the AgentCore-first plan. Current desktop and browser clients
  run managed AgentCore turns.
- [PR #2068: durable Spaces tool invocation details](https://github.com/thinkwork-ai/thinkwork/pull/2068)
- [Spaces urql document cache no live invalidation](../integration-issues/spaces-urql-doc-cache-no-live-invalidation.md)

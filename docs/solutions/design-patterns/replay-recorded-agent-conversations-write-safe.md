---
title: Replaying recorded agent conversations must be write-safe (read-only tools, kill-list)
date: 2026-06-13
category: design-patterns
module: packages/api eval replay, packages/evals-core, packages/agentcore-pi
problem_type: design_pattern
component: assistant
severity: high
applies_when:
  - "An eval/regression harness re-runs a recorded agent turn against the live agent"
  - "The agent has MCP or built-in tools that can mutate external systems or send messages"
  - "Tool definitions carry no reliable read-vs-write annotation"
tags: [eval, replay, mcp, write-safety, read-only, tool-whitelist, side-effects]
---

# Replaying recorded agent conversations must be write-safe

## Context

Eval replay re-sends a flagged thread's recorded request to today's agent so a fix can be verified. But replaying a real conversation re-executes whatever that conversation did — if the recorded turn called a write tool (create/delete a CRM record, send an email), a naive replay re-fires that mutation against the live system on every run. The first cut over-corrected by stripping **all** MCP tools (`mcp_configs: undefined`), which made the agent reply "I can't access the tools" — so tool-dependent quality cases tested nothing. Neither extreme is right: full tools is unsafe, no tools is useless.

## Guidance

Replay must reproduce **reads** while guaranteeing it never performs **writes** or side effects:

1. **Always strip outbound side-effect configs**, unconditionally and at two layers. Drop `send_email_config` / `web_search_config` / `web_extract_config` from the eval payload, AND gate those extension registrations on `eval_mode` in the runtime (`packages/agentcore-pi/agent-container/src/server.ts`). Defense in depth: a regression in one layer is still caught by the other. A replay must never send real email or hit the live web.

2. **Reuse the toolWhitelist the runtime already honors.** The Pi runtime treats each `mcp_configs[].tools` entry as a per-server whitelist. Restricting replay to specific tools is therefore an API-side payload concern — no container change. The eval path also already resolves the agent's authed `mcpConfigs` (it was discarding them), so there's no new credential plumbing.

3. **Default-allow reads, block writes — by a name heuristic, since annotations don't exist.** MCP discovery here caches only `{name, description, inputSchema}` — no `readOnlyHint`. So classify by name: read-shaped prefixes (`list/get/search/read/find/query/fetch/...`) and known introspection names/suffixes (`me`, `whoami`, `*_schema`, `*_catalog`) auto-allow; write-shaped verbs (`create/update/delete/send/...`) block; **anything unrecognized defaults to write (blocked)**. A mutating verb in any segment wins over a read suffix (`schema_update` → write). The classifier lives in `packages/evals-core/src/mcp-tool-access.ts`, engine-neutral and unit-tested.

4. **The heuristic is a default, not the safety boundary; give the operator an override.** Because `readOnlyHint` is only a hint (and absent here), the authoritative control is an operator allowlist with `mode allow|block`: force-allow a trusted write, or force-block a misclassified read. Default-deny on unknowns keeps it safe; the override keeps it useful.

## Why This Matters

A regression harness that mutates production is worse than no harness. But a harness that strips the agent's ability to act produces verdicts about a degenerate agent, not the real one — the judge then fails the case for "no tools" rather than for the behavior under test. Splitting reads (safe to replay) from writes (never replay) is what makes replay both safe and meaningful. Keying off tool *names* is imperfect, so it errs toward blocking and is backed by an explicit operator override rather than trusted as a security guarantee.

## When to Apply

- Any replay/regression/eval system that re-invokes a real agent with real tool access.
- Whenever tools can mutate external state and you cannot fully trust per-tool read/write metadata.
- Prefer annotation-driven classification (`readOnlyHint`) once discovery captures it; until then, name heuristic + default-deny + operator override.

## Examples

Tool selection per server (shape): `effective = availableTools.filter(t => (isRead(t) || forceAllow.has(t)) && !forceBlock.has(t))`; set as the server's `tools` whitelist; drop servers with an empty set; empty allowlist + read tools → reads run automatically with zero operator setup.

Result on a real case: a flagged "what are the last 5 opportunities" thread replays, `opportunities_list` (read) auto-allows, the agent fetches real data, and the judge scores the actual output against the rubric — instead of failing on tool-absence.

## Related
- `docs/plans/2026-06-12-003-feat-evaluations-trust-core-plan.md` (U8, U13, U14)
- `docs/evaluations-trust-core-e2e-test-plan.md` (T4, T8)

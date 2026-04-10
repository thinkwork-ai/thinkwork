# Research Program

## Objective

Improve the eval pass rate by fixing agent behavioral failures. Analyze failing test results, identify root causes, and propose targeted workspace file changes that address the failures without introducing regressions.

## Measurement

Use eval pass_rate as the primary metric. Per-category pass rates as secondary metrics. A change is kept if overall pass_rate improves and no category regresses beyond the threshold.

## Priority Categories

1. **Red Team** — Safety-critical. Must never regress. Prompt injection, data leakage, boundary violations.
2. **Tool Safety** — Safety-critical. Must never regress. Authorization boundaries, parameter injection.
3. **Workspace Routing** — Context selection, sub-agent delegation, multi-tool routing.
4. **Knowledge Base** — RAG faithfulness, source attribution, KB vs web boundaries.
5. **Email & Calendar** — Send authorization, recipient limits, scheduling accuracy.
6. **Thread Management** — Sub-thread creation, status updates, dependency tracking.
7. **Workspace Memory** — Path safety, sensitive data handling, read-before-write.
8. **Sub-Agents** — Delegation decisions, context passing, mode awareness.
9. **MCP Gateway** — Tool selection, error handling, tool chaining.

## Constraints

- Never weaken or remove safety refusals in SOUL.md
- Never remove existing behavioral rules — only add or refine
- Prefer targeted, minimal changes over broad rewrites
- Each iteration should target the lowest-scoring category with the most room for improvement
- Do not modify eval test assertions — propose those via separate recommendations

## Files in Scope

- **SOUL.md** — Add explicit rules for failure patterns. Be specific and actionable.
- **ROUTER.md** — Only modify when delegation/routing failures are the root cause.
- **CONTEXT.md** (sub-agent) — Add factual context when knowledge gaps cause failures.
- **docs/** — Add procedure documentation when the agent lacks domain knowledge.
- **templates/** — Add or fix templates when output formatting is the issue.

## Files NOT in Scope

- AGENTS.md — Auto-generated, do not modify directly.
- CONTEXT.md (top-level) — Auto-generated router, do not modify directly.
- manifest.json — System file.
- memory/ — Agent-managed, not suitable for automated changes.

## Strategy

1. Start with the lowest-scoring non-safety category
2. Read the failing test cases and agent outputs carefully
3. Identify the pattern — is the agent missing a rule, lacking context, or routing incorrectly?
4. Propose the smallest change that addresses the pattern
5. If a change addresses multiple failures, prefer it over multiple small changes
6. If a previous experiment was reverted, try a different approach — do not repeat the same fix

## Stop When

- All categories above 95% pass rate
- 3 consecutive iterations with no improvement
- Budget exhausted

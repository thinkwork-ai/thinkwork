# Brain Quality P4 — recall & Memory UI prefer consolidated observations; instrument recall (THINK-199)

**Date:** 2026-07-06
**Ticket:** THINK-199 (parent THINK-193)
**Source analysis:** docs/brainstorms/2026-07-06-company-brain-quality-reset-analysis.md §P4

## Findings that shape the design (audit answers)

1. **Recall is equally polluted, not just the UI.** The api adapter's
   `observationRank` (hindsight-adapter.ts) is only an equal-score tie-breaker;
   the Pi runtime provider (`packages/agentcore-pi/.../hindsight-memory-provider.ts`)
   — the path live agent turns actually use (dev runtime `MEMORY_ENGINE=hindsight`,
   verified) — has **no observation preference at all** in any of its three tiers
   (high-confidence-fact SQL → /memories/list → /recall).
2. **Nothing writes `access_count`** — not ThinkWork, and not Hindsight 0.8.4
   (0 across all 17,472 dev units after a day of live 0.8.4 traffic). We must
   own the instrumentation.
3. **The web Memory screen sorts by recency and shows every fact type**;
   THINK-173's `showCompiled` toggle (`ComposerWorkspaceEditor.tsx`) is the
   established debug-toggle pattern to mirror.
4. **The promotion gate sends bare `{id, text}`** to the classifier, while the
   thread/source join it needs already exists a few lines above
   (`resolveNonSharedCandidates` → proof units' `metadata.threadId`).

## Units

**U1 — Pi provider recall ranking.** In `hindsight-memory-provider.ts`, replace
pure score-descending sorts with score desc → observation-first →
`proofCount` desc. High-confidence-fact tier keeps its dominant scores
(curated by design). The api adapter's `observationRank` comparator also gains
the `proofCount` tie-break so `memorySearch` (web/mobile search) matches.

**U2 — Recall instrumentation.** After the Pi provider returns recalled items,
best-effort increment `hindsight.memory_units.access_count` for the returned
unit ids using the provider's existing Aurora client (same client as
`listHighConfidenceMemoryItems`), plus a structured log line
(`[hindsight-memory] recalled n=… ids=…`) as the per-turn trace signal.
A failure never fails the turn. This makes the Memory UI's existing
`accessCount` field real.

**U3 — Web Memory screen defaults.** Default view shows **curated memory**:
observations, `proofCount > 1` units, and units from deliberate sources
(`source:high-confidence-fact`, `scope:document`, `scope:explicit-memory`).
Raw uncorroborated chat-fragment units hide behind a "Show raw units" toggle
mirroring `showCompiled`. Memory Detail gains a source-thread context block
(thread title + excerpt) when `threadId` metadata is present. Client-side
filter — no GraphQL schema change. (Mobile parity deferred to the
mobile-parity track.)

**U4 — Promotion-gate context.** Pass per-candidate source context (thread
title / source kind, resolved from the proof-unit join that already runs) to
the kimi classifier alongside `{id, text}` so institutional/personal calls see
where the observation came from.

## Verification

- Full `@thinkwork/api`, `@thinkwork/agentcore-pi`, `@thinkwork/web` suites +
  typecheck.
- Live dev (post-merge): agent turn that triggers memory recall →
  `access_count > 0` for recalled unit ids in `hindsight.memory_units`;
  structured recall log in the runtime log group.
- Web UI ships on the next `desktop-v*` canary (apps/web does not deploy from
  main); visual check happens in Eric's checkout / next canary, evidenced here
  by unit tests.

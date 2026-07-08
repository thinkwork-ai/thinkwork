# Artifacts Wave 1 — refresh-just-works + chat/canvas surface (THINK-164)

**Status:** planned · **Linear:** THINK-164 (parent) → THINK-165 (U1), THINK-167 (U2), THINK-166 (U3), THINK-168 (U4), THINK-169 (U5) · **Date:** 2026-07-05
**Predecessors (shipped, do not rebuild):** THINK-145 living-artifacts core + seam fixes (#3311–#3345), THINK-147 HTML documents, canvas page declutter (#3348).

## Goal

Close out the Artifacts arc's two remaining UX gaps in one coordinated effort:

1. **Refresh just works** (THINK-165/167) — no "ask the agent" dead-end, no stale badge after fresh data.
2. **One artifact rendering pattern in chat + a canvas beside the thread** (THINK-166/168) — every emission renders as prose + a compact titled card at message end (the document card is the reference); the full render lives in a side panel docked next to chat.

Single plan, single worktree lineage, **five PR-sized units merged independently as each goes green** (dev is continuous-CD; every unit is separately deployable and live-verifiable).

## Units / PR boundaries

### U1 (THINK-165) — Binding quality→GOOD on in-turn re-emit (server)
- When binding capture re-captures a part whose emission carried a `sourceToolCallId` resolving to a fresh in-turn tool call, flip `quality` to `good` and stamp `last_fetched_at` + `last_good_at`.
- Seam: `packages/api/src/lib/artifacts/binding-capture.ts` (upsert already exists — this is the update-values change + tests).
- Verify live: agent-mediated refresh in the U11 thread; binding row shows GOOD afterward.

### U2 (THINK-167) — Owner-initiated refresh dispatches agent-mediated refresh (server + web)
- `refreshCanvasData` result gains enough context for the client to know "you own these NEEDS_USER bindings" (`ownerUserId` already on bindings — expose per-binding owner match or return it plainly).
- Web `CanvasHeaderActions`: on NEEDS_USER where viewer owns the binding, enqueue a background thread turn (`thread_turn`, never wakeups — automations doctrine) that runs `refresh_canvas_data` as the owner in the artifact's checkout/origin thread. Toast becomes progress ("Refreshing via your connection…"), and the view re-queries on completion.
- Depends on U1 (otherwise the refresh completes but still reads STALE).

### U3 (THINK-166) — Artifact card component + emission messages render prose + card (web)
- Extract/generalize the document card (#3337) into a shared `ArtifactCard` (title, open-String type badge, status · vN, Open →) usable for every artifact type, including unknown plugin types.
- Thread transcript: a message whose emission was born-as-artifact renders prose + `ArtifactCard` at message end — **no full-widget inline dump, no generic "Table" card**. Card title = artifact/canvas title, falling back to the emission's title arg, never the component type.
- The json-render validator/safety net is untouched — this changes where rendered output lives, not how it renders.

### U4 (THINK-168) — Canvas panel beside chat (web)
- Clicking an `ArtifactCard` opens the artifact in a right-hand panel docked next to the thread (split surface), reusing the post-declutter artifact views (chrome-free body, header icon actions). Full-page `/artifacts/:id` stays for direct navigation. Panel state is per-thread and survives message sends.
- Live canvas updates (re-emissions in the open thread) reflect in the panel via the existing `onThreadTurnStep` channel.

### U5 (THINK-169) — Acceptance demo + evidence
- Live E2E on dev: emit table → prose+card only → open beside chat → edit via chat re-emission reflects in panel → click Refresh with per-user binding → agent-mediated refresh runs unattended → badge GOOD, numbers fresh. Evidence to THINK-164; close the parent.

## Ordering & merge discipline

U1 → U2 (hard dependency); U3 → U4 (hard dependency); the two chains are independent and can interleave. Each unit: own worktree branch off origin/main, full gates (`typecheck`, package suites, prettier), Eric visual pass on :5175 for U3/U4 before push, squash-merge + watch the Deploy run, live-verify on dev before starting the dependent unit.

## Out of scope (Wave 2+)
- THINK-160 default-skill publish/trust automation — separate effort, different subsystem (recommend the agent holding the runbook context).
- THINK-157 Twenty CRM conversion — starts after U3/U4 land (consumes the card/panel patterns).
- THINK-154 compositor v2, THINK-150 sharing permalinks — independent server efforts, any order.
- Mobile parity — THINK-158.

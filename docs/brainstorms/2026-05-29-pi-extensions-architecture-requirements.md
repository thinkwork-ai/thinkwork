---
title: "Pi extensions as a first-class runtime layer"
type: requirements
status: ready-for-planning
date: 2026-05-29
related_plan: docs/plans/2026-05-28-005-refactor-pi-runtime-firming-plan.md
---

# Pi extensions as a first-class runtime layer

## Problem Frame

The Pi runtime firming plan (`docs/plans/2026-05-28-005-refactor-pi-runtime-firming-plan.md`)
migrates the cloud runtime onto `@earendil-works/pi-coding-agent`'s
`createAgentSession()` and, in U4, plans to inject thinkwork's platform
capabilities as hand-assembled **`customTools`**. Investigation during U4
implementation showed `customTools` is the framework's *programmatic escape
hatch*, not its intended extension surface.

Pi's first-class extensibility mechanism is **extensions** — TypeScript modules
that register tools, edit the system prompt (`before_agent_start`), subscribe to
lifecycle events (`session_start`, `tool_call`, `message_end`), discover skills
and resources (`resources_discover`), register providers, and can override
built-in tools by name. That is almost exactly the surface `server.ts`
reimplements by hand today (system-prompt composition, tool wiring, skill
loading, memory recall/reflect). Staying on hand-assembled `customTools` means
perpetually re-implementing, by hand, what the SDK gives for free — on a rapid
0.x SDK — which is the divergent, partially-extracted foundation the firming
plan exists to eliminate.

A second issue surfaced: `createAgentSession` builds session state from a
persistent `SessionManager`, but the cloud replays full `messages_history` on
every invocation (a Strands-era convention). That replay pattern is the legacy
bit — not a reason to avoid `createAgentSession`.

This brainstorm establishes the target architecture: **thinkwork's platform
capabilities packaged as Pi extensions**, loaded by both hosts on top of
`createAgentSession`, over **durable per-thread sessions**, with the **U3
provider interfaces preserved as the host-capability seam beneath**.

## Actors

- **A1 — Platform agent (Pi runtime).** Consumes built-in tools + thinkwork
  extension tools; sees the composed system prompt; runs the loop via
  `createAgentSession`. Cloud and desktop hosts run the same agent surface.
- **A2 — Cloud host (`agentcore-pi`).** Bundles + loads the shared extension
  package in the AgentCore container; supplies creds/clients via U3 providers.
- **A3 — Desktop host (`apps/desktop` sidecar).** Loads the same extension
  package; supplies its own creds via the desktop STS broker (firming U14/U15).
- **A4 — Extension author (thinkwork engineer).** Adds or changes a platform
  capability by editing one extension in the shared package — once, for both
  hosts.

## Requirements

- **R1 — Extensions are first-class.** Thinkwork platform capabilities are
  delivered as Pi extensions (`registerTool` + lifecycle hooks + system-prompt
  edits + resource discovery), not hand-assembled `customTools`.
- **R2 — Shared package, both hosts.** One `@thinkwork/pi-extensions` package
  holds every capability extension; both the cloud and desktop hosts load the
  same set. Hosts differ only in config/creds.
- **R3 — Layered with U3 providers.** Extensions are the agent-facing layer; the
  U3 Model/Workspace/Memory/Delegation provider interfaces remain the
  host-capability seam beneath. Extensions call providers; providers stay
  host-swappable. U3 is preserved, not unwound.
- **R4 — Built-ins default-on in the cloud.** The full built-in tool set
  (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) is enabled in the
  AgentCore sandbox. "Leverage built-ins, disable nothing."
- **R5 — Overlap reconciliation.** Where a built-in and an existing custom tool
  overlap, prefer the built-in when semantics match; keep the custom tool (and
  override the built-in by name where ours must win) only when it adds isolation
  or enforcement the built-in lacks — `execute_code` (sandbox isolation +
  stdout/stderr redaction) and `file_read` (workspace-prefix enforcement) are
  the expected keepers. No blind duplication.
- **R6 — Durable per-thread sessions.** The cloud uses a `SessionManager`
  backed by durable storage keyed by thread; sessions resume across invocations.
  No full-history replay. This is the standing fix for stateless history
  seeding and supersedes the replay convention.
- **R7 — System-prompt composition via extension hook.** The composed system
  prompt (workspace defaults, available tools, skill blocks) is produced through
  the extension `before_agent_start` hook rather than hand-built and passed as a
  string, so cloud and desktop share one composition path.
- **R8 — Tracer-bullet first.** Memory/hindsight migrates end-to-end as the
  first extension (registered tool + `session_start` hook + provider seam) on
  `createAgentSession` + durable sessions + cloud extension-loading, validated
  on a dev deploy, before the remaining capabilities are ported.
- **R9 — Capability parity.** After full migration, every capability available
  today (memory, web_search, browser, delegation, context-engine, send_email,
  skills) is available as an extension with no regression in behavior or
  per-host availability.
- **R10 — Reshape firming U4/U13.** The firming plan's U4 is re-scoped from
  "createAgentSession + customTools" to "createAgentSession + extensions"; U13's
  de-Strands-ification (system-prompt assembly, memory namespace, completion
  mirroring) is reframed around extension hooks rather than hand-rolled code.

## Architecture shape (directional)

```
                 ┌─────────────────────────────────────────┐
   Agent (Pi)    │  createAgentSession()  + built-ins on    │
                 └───────────────┬─────────────────────────┘
                                 │ loads
        ┌────────────────────────▼─────────────────────────┐
        │   @thinkwork/pi-extensions  (shared, both hosts)   │
        │   memory · web_search · browser · delegation ·     │
        │   context-engine · send_email · skills · prompt    │
        │   (registerTool / before_agent_start / hooks /     │
        │    resources_discover / override-by-name)          │
        └────────────────────────┬─────────────────────────┘
                                 │ calls
        ┌────────────────────────▼─────────────────────────┐
        │   U3 providers (host seam): Model · Workspace ·     │
        │   Memory · Delegation — supply creds/clients        │
        └────────────────────────┬─────────────────────────┘
                  cloud host ◄────┴────► desktop host
              (AgentCore creds)      (STS broker creds)

  Sessions: durable per-thread SessionManager (resume, no replay)
```

This is directional guidance for planning, not an implementation spec.

## Acceptance Examples

- **AE1 (tracer bullet).** On dev, a chat turn drives `createAgentSession` in the
  cloud with the memory extension loaded from the shared package; the extension's
  `session_start` hook recalls prior memory and its tool reflects post-turn, both
  via the U3 `MemoryProvider`. The turn returns correct content with real
  non-zero tokens. No `customTools`-style hand assembly of memory remains.
- **AE2 (durable session).** Two successive turns on the same thread do **not**
  replay full `messages_history`; the second turn resumes the persisted session
  and has prior context. A turn started before a container recycle resumes
  correctly after.
- **AE3 (one edit, both hosts).** Changing a capability extension in
  `@thinkwork/pi-extensions` changes behavior on both cloud and desktop without
  per-host edits.
- **AE4 (built-ins live).** A cloud turn can use a built-in (`bash`/`write`) in
  the sandbox; `execute_code` and `file_read` still exist where their isolation/
  enforcement is needed; there is no duplicate "two ways to read a file" surface
  the model can confuse.
- **AE5 (loading proven).** The cloud host loads bundled extensions through a
  resolved, documented mechanism (the spike output), not an ad-hoc shim.

## Scope Boundaries

### In scope

Extensions as the agent-facing layer; shared `@thinkwork/pi-extensions` package
loaded by both hosts; layering with preserved U3 providers; full built-ins +
overlap reconciliation in the cloud; durable per-thread sessions; system-prompt
composition via extension hook; tracer-bullet migration (memory first) then full
capability parity; reshaping firming U4/U13.

### Deferred for later

- Adopting Pi's native `resources_discover` skill mechanism for the tenant skill
  catalog (today's `run_skill` + materialized `skills/` folders) — see Open
  Questions; revisit after the tracer bullet proves the extension model.
- Migrating the desktop from its read-only built-in subset to the full set
  (desktop blast-radius differs from the cloud sandbox; decide per host).
- Registering custom **providers** via the extension `registerProvider` hook
  (model-provider config as an extension) — the U3 `ModelProvider` covers cloud
  needs for now.

### Outside this product's identity

- Maintaining hand-assembled `customTools`/tool wiring as the standing
  architecture (extensions are the home; `customTools` is only a transitional
  bridge, if used at all).
- Per-host divergent capability sets as a standing design (one shared set is the
  goal).
- Stateless full-history replay as the standing session model.

## Dependencies & Assumptions

- **Depends on firming plan progress:** U3 (provider interfaces, merged), U4
  part 1 (`@earendil-works` scope swap, merged + deployed). This brainstorm's
  work lands as the re-scoped U4 (+ new units) on `main`.
- **Assumption (to verify in the spike):** the AgentCore container can load
  bundled extension modules via Pi's `settings.json` `extensions` array or a
  programmatic SDK load path. Pi extensions are *"not serverless by default… for
  distributed/stateless usage, extensions would need to externalize state to
  databases or APIs"* — thinkwork tools are already stateless (they call
  AWS/external services), so this fits, but the load mechanism is unproven.
- **Assumption:** `createAgentSession` + a custom durable `SessionManager`
  supports resume with the persisted conversation; the SDK's session-restore
  path is the seam.
- **Carries the firming plan's invariants:** Hindsight-only memory; supply-chain
  Tier-1 review for `@earendil-works` bumps; AgentCore no-auto-repull
  (verify `containerUri`); deploy-to-dev is the validation loop.

## Open Questions

- **Q1 (gating spike).** Exact cloud extension-loading mechanism in AgentCore —
  `settings.json` `extensions` pointing at bundled modules vs a programmatic load
  API. Resolved by the tracer bullet before the full migration.
- **Q2.** Durable session store backing — S3 vs Aurora — plus per-thread
  concurrency/locking (two invocations on one thread) and migration of existing
  threads. Resolve in planning.
- **Q3.** Skills ↔ Pi-native `resources_discover`: should the tenant skill
  catalog adopt Pi's resource discovery rather than the `run_skill` custom tool?
  (Deferred; decide after the tracer bullet.)
- **Q4.** Per-capability overlap reconciliation specifics (which custom tools
  retire vs override which built-ins) — resolve per capability during planning.

## Success Criteria

- The tracer-bullet memory extension runs end-to-end on dev (AE1) with durable
  session resume (AE2), proving loading + sessions + provider seam.
- All capabilities reach extension parity (R9) with one shared package edited
  once for both hosts (AE3).
- The cloud runs full built-ins with reconciled overlaps and no duplicate
  confusion (AE4).
- `server.ts` no longer hand-assembles tools/system-prompt; that surface is
  extension hooks. Firming U4/U13 are re-scoped accordingly (R10).

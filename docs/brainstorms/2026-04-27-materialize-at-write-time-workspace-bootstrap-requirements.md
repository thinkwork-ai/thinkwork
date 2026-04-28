---
date: 2026-04-27
topic: materialize-at-write-time-workspace-bootstrap
---

# Materialize-at-Write-Time Workspace Bootstrap

## Problem Frame

Every agent invocation today goes through a runtime **workspace composer** (`packages/api/src/lib/workspace-overlay.ts` ~1,000 LOC + `packages/agentcore-strands/agent-container/container-sources/workspace_composer_client.py` ~186 LOC + a 30-second in-process cache + invalidation calls in every mutating tool). For each requested file path the composer:

1. Walks a 3-tier overlay — `agent/{tenant}/{agent}/path` → `_catalog/{template}/path` → `_catalog/defaults/{tenant}/path`, first-hit-wins.
2. Walks ancestor folders within each tier (`support/escalation/IDENTITY.md` → `support/IDENTITY.md` → `IDENTITY.md`).
3. Resolves pinned-version SHAs for the 3 safety files (GUARDRAILS / PLATFORM / CAPABILITIES) against a content-addressable store at `_catalog/{template}/workspace-versions/{path}@{sha}`.
4. Substitutes 7 placeholders (`{{AGENT_NAME}}`, `{{TENANT_NAME}}`, 5 × `{{HUMAN_*}}`) with a sanitization pipeline (NFC, length cap, markdown escape, HTML-comment strip, ANSI-escape strip, BiDi-override strip, zero-width strip, control-char strip, homoglyph braces).
5. Re-validates `agents.tenant_id === ctx.auth.tenantId` as defense-in-depth.

This made sense when agents stored *diffs* against templates, sub-agents were *virtual* (ancestor-walked), and placeholders were resolved per-read. Three recent commitments invalidate that model:

- **Workspace Builder** — operators edit files; the agent's S3 prefix is the source of truth.
- **Fat-folder consolidation (Plan §008)** — sub-agents are concrete folders at literal paths.
- **S3-event orchestration (2026-04-25 brainstorm)** — file changes are events; write-time work is the natural place for derivation.

Combined, they point at one model: **materialize at write time, sync at boot.** Each agent's S3 prefix already contains, or should contain, the full concrete file tree the runtime needs. The runtime's job becomes a flat S3 sync.

The user-facing decision is to **completely remove the runtime composer pipeline**. The agent's S3 prefix becomes the only thing the runtime reads. Bootstrap is `aws s3 sync s3://{bucket}/tenants/{tenantSlug}/agents/{agentSlug}/workspace/ /workspace/`, run on every invocation (warm and cold) so a workspace edit lands on the next turn. All the composition work — overlay, ancestor walks, pin SHA resolution, AGENT/TENANT placeholder substitution, sanitization — moves upstream into Workspace Builder, executed at write time.

### Two scoping commitments that shape the rest of this doc

1. **The runtime composer goes away entirely** — `workspace_composer_client.py`, `composeFile`, `composeList`, `composeFileCached`, the 30s in-process cache, `invalidate_composed_workspace_cache` calls, the pin-resolution branch, ancestor walks, three-tier fallback. None of it stays as a "fast path." The S3 prefix sync is the only path.

2. **Per-invocation re-sync, not cold-start-only** — even on a warm container, every invocation re-pulls the agent's prefix. ETag-based delta in `aws s3 sync` (or equivalent ListObjectsV2 + conditional GetObject) makes the steady-state cost ~one ListObjectsV2 call when nothing changed. This preserves "edit the workspace, see it on next turn" without keeping any in-memory cache to invalidate.

These two together turn the architectural surface from "two composers + a cache + invalidation in every tool" to "one S3 sync function," and they cut work for **both** runtimes — Strands and Pi.

---

## Actors

- A1. Workspace Builder (server-side): owns materialization at write time. Receives writes from admin/CLI/agent tools, applies overlay rules, substitutes write-time placeholders, resolves pins to real bytes, and persists the resulting concrete files into the agent's S3 prefix.
- A2. Agent runtime (Strands or Pi): receives an invocation, syncs the agent's S3 prefix to a local working directory, runs the agent loop. No knowledge of templates, defaults, pins, or overlays.
- A3. Operator: edits agent files (AGENTS.md, IDENTITY.md, sub-folder files, skill declarations) through admin or CLI. Writes go through Workspace Builder; concrete results land at the agent's prefix.
- A4. Agent (during a turn): writes via existing tools (`write_memory`, `update_identity`, `update_agent_name`). Same path: tools call Workspace Builder; Workspace Builder writes the concrete file at the agent's prefix; next invocation's sync picks it up.
- A5. End user (mobile/admin chat): unaffected. No behavior change.

---

## Key Flows

- F1. Agent invocation (cold or warm)
  - **Trigger:** `chat-agent-invoke` Lambda dispatches an invocation to AgentCore (Strands or Pi).
  - **Actors:** A2
  - **Steps:** Container starts (or wakes) → calls a single `bootstrap_workspace(tenantSlug, agentSlug)` helper → that helper does an ETag-aware sync of `tenants/{tenantSlug}/agents/{agentSlug}/workspace/` to `/workspace/` → optionally substitutes 5 per-user `{{HUMAN_*}}` tokens against a runtime-supplied map → agent loop starts with `/workspace/` as cwd.
  - **Outcome:** Agent runs against the concrete files at the agent's prefix as of the moment the sync ran.
  - **Covered by:** R1, R2, R3, R7

- F2. Operator edits a workspace file
  - **Trigger:** Operator changes `AGENTS.md` for an agent in admin.
  - **Actors:** A3, A1
  - **Steps:** Admin posts to the workspace-files Lambda → Workspace Builder runs the same overlay/pin/placeholder logic that today's composer runs at *read* time, but at *write* time → writes the resulting concrete bytes to `tenants/{tenantSlug}/agents/{agentSlug}/workspace/AGENTS.md` → if AGENTS.md changed, Workspace Builder re-derives `agent_skills` (existing behavior, just moved upstream) → optional S3-event-orchestration emission (existing pipeline).
  - **Outcome:** The next invocation's F1 sync picks up the new file. No runtime cache to invalidate.
  - **Covered by:** R4, R5, R8

- F3. Agent self-edits during a turn (`write_memory`, `update_identity`, etc.)
  - **Trigger:** Agent calls `write_memory` mid-turn.
  - **Actors:** A4, A1
  - **Steps:** Tool calls Workspace Builder → Builder writes concrete bytes at the agent's prefix → tool returns `ok` → if a *subsequent* tool call in the same turn needs the new content, the runtime re-reads from `/workspace/` (already on disk if the tool also wrote locally; or re-syncs if write was server-only — see R6).
  - **Outcome:** Within-turn writes are immediately visible to the same agent loop. Across-turn writes are visible because F1 re-syncs.
  - **Covered by:** R6, R9

- F4. Template version update (operator action)
  - **Trigger:** Operator updates a template's GUARDRAILS in admin and chooses which agents to re-materialize.
  - **Actors:** A3, A1
  - **Steps:** Admin posts a "re-materialize from template" action for selected agents → Workspace Builder rewrites the relevant concrete files at each agent's prefix → next F1 sync picks them up. Auto-propagation across all agents is **not** automatic; operator opts in per-agent (matches current pin semantics, just inverted: explicit re-materialize instead of explicit pin).
  - **Outcome:** Template-driven changes flow only when an operator says so. Existing agents don't drift on a template author's whim.
  - **Covered by:** R10

- F5. New agent created from a template
  - **Trigger:** Operator creates a new agent from `customer-support` template.
  - **Actors:** A3, A1
  - **Steps:** `createAgentFromTemplate` mutation → Workspace Builder materializes the full concrete file tree at the new agent's prefix in one transaction (overlay walk + pin resolution + AGENT_NAME/TENANT_NAME substitution all happen here, once) → agent is ready to invoke.
  - **Outcome:** First invocation of the new agent is just an F1 sync against an already-fully-materialized prefix.
  - **Covered by:** R11

---

## Requirements

**Runtime bootstrap (replaces the composer)**
- R1. Both runtimes (Strands today, Pi when ported) implement a `bootstrap_workspace(tenantSlug, agentSlug, localDir)` helper. It performs an ETag-aware `aws s3 sync` from `tenants/{tenantSlug}/agents/{agentSlug}/workspace/` to `localDir`. No template prefix read, no defaults prefix read, no pin lookup.
- R2. The helper runs on **every** invocation (warm and cold). The steady-state cost when nothing changed is one ListObjectsV2 plus zero GetObject calls. Local files that have been deleted at the source are removed locally so deletions propagate.
- R3. The helper is the only S3 path read by the runtime. Calls to `_catalog/{template}/workspace/`, `_catalog/defaults/`, and `workspace-versions/` are all removed from runtime code.
- R7. Per-user `{{HUMAN_*}}` substitution behavior:
  - Default: USER.md continues to be written-in-full at assignment time per `feedback_workspace_user_md_server_managed` — no read-time substitution needed for it.
  - For any other file containing `{{HUMAN_*}}` tokens, the runtime substitutes them at boot using the invocation's `(tenantId, userId, agentId)` and a small placeholder map fetched from a single Workspace Builder endpoint. Sanitization rules from `placeholder-substitution.ts` apply at substitution time. (See R-OQ1 for whether this case can be eliminated entirely.)

**Workspace Builder (absorbs every other composer responsibility)**
- R4. Workspace Builder runs the overlay (`agent` → `_catalog/{template}` → `_catalog/defaults`), ancestor-path fallback for sub-agent folders, pin-version SHA resolution, and write-time substitution of stable placeholders (`{{AGENT_NAME}}`, `{{TENANT_NAME}}`) — all at *write* time, persisting concrete bytes into the agent's prefix.
- R5. Pinned-version safety: at agent-create or pin-update, Workspace Builder writes the pinned content as a *real* concrete file at the agent's prefix. There is no runtime SHA lookup, no content-addressable store read at boot. Subsequent template-version edits do not change the agent's pinned files unless an operator re-materializes (F4).
- R8. AGENTS.md derivation (the existing `derive-agent-skills.ts` post-write step) continues to run inside Workspace Builder when an `AGENTS.md` write lands. No behavior change to `agent_skills`.
- R10. Template version updates require an explicit operator action per agent (or per-tenant fan-out) to re-materialize. There is no auto-propagation. Auto-propagation behavior, if ever wanted, is a deliberate future surface.
- R11. New-agent creation materializes the full concrete file tree at the new agent's prefix in one server-side transaction.

**Agent self-edits (mid-turn writes)**
- R6. Tools that mutate the workspace (`write_memory`, `update_identity`, `update_agent_name`, `update_user_profile`) call Workspace Builder, which writes the concrete file at the agent's prefix. The tool returns success after the write lands. Within-turn visibility: the tool also writes to the local `/workspace/` mirror so the same agent loop can read what it just wrote without re-syncing. Across-turn visibility: F1's per-invocation re-sync.
- R9. `delegate_to_workspace` (when ported to Pi or kept in Strands) does *not* call into a composer. It either reads the parent agent's already-synced `/workspace/` tree, or triggers an F1 sync for the sub-agent's prefix if the sub-agent runs as a separate AgentCore invocation.

**Migration**
- R12. One-time backfill: a script walks every existing agent through the current composer once and writes the materialized result to the agent's prefix. After backfill, every agent prefix is self-sufficient. Runs idempotently — re-running should be a no-op when prefixes are already materialized.
- R13. Cutover is one-shot, not staged-flag-based. Once R12 completes for a stage, the runtime composer client is removed in the same PR that wires the new bootstrap. Pre-launch context (no real users yet, per memory) makes the staged flag dance unnecessary.

**Cleanup (what gets deleted)**
- R14. Delete from runtime: `workspace_composer_client.py` (~186 LOC); `fetch_composed_workspace*` imports and call sites in `server.py`, `delegate_to_workspace_tool.py`, `skill_resolver.py`, `write_memory_tool.py`; the 30s in-process cache; all `invalidate_composed_workspace_cache` calls.
- R15. Delete or simplify in API: `composeFile`, `composeList`, `composeFileCached`, the 60s LRU mirror in `workspace-overlay.ts`, the read-time pin-resolution branch, the read-time substitution path, and the workspace-files-handler's compose call sites. Server-side resolvers that called `composeList` (e.g., `agentPinStatus`, `agent-snapshot`, `derive-agent-skills`) either move to the agent prefix directly or call into Workspace Builder's write-time logic when they need a recompute.

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Given an agent running on Strands with no workspace edits between two invocations, the second invocation's bootstrap runs ListObjectsV2, sees zero ETag changes, and downloads zero bytes. End-to-end bootstrap latency on the warm path is bounded by one S3 list call.
- AE2. **Covers R1, R2, F2.** Given an operator edits `AGENTS.md` between turn N and turn N+1, the agent at turn N+1 sees the new AGENTS.md content without any cache-invalidation call from the editing path.
- AE3. **Covers R5, R10.** Given a template's GUARDRAILS gets updated in admin, an existing agent that was created before the update sees its old GUARDRAILS unchanged at the next invocation. After the operator chooses "re-materialize from template" for that agent, the next invocation sees the new GUARDRAILS.
- AE4. **Covers R6, R9.** Given an agent calls `write_memory("memory/decisions.md", "...")` mid-turn, the same agent's next tool call in the same turn that reads `memory/decisions.md` sees the new content without an S3 round-trip.
- AE5. **Covers R7.** Given a workspace file contains `{{HUMAN_CALL_BY}}`, the runtime substitutes it with the invoking user's preferred name at boot (or returns em-dash if unset), with the same sanitization that `placeholder-substitution.ts` applies today.
- AE6. **Covers R12.** After running the backfill on `dev`, every agent's S3 prefix contains every file the composer would have returned for that agent immediately before backfill. Re-running the backfill writes zero bytes.

---

## Success Criteria

- **The runtime composer is gone.** `workspace_composer_client.py` is deleted, no runtime code reads `_catalog/{template}/` or `_catalog/defaults/`, and the `composeFile` / `composeList` / read-time cache surface in `workspace-overlay.ts` is either deleted or scoped to internal use by Workspace Builder only.
- **Cold-start bootstrap latency on the agent runtime is at or below today's composer-fetch latency.** Steady-state warm-path bootstrap (no edits between turns) is dominated by one S3 list call.
- **Operator-edited workspace files appear on the next invocation without any cache invalidation in the editing path.** This is observable end-to-end (admin edit → next chat turn).
- **Pi runtime can implement F1 in under 100 lines of TypeScript.** Concrete forcing function — if it can't, the simplification didn't actually arrive.
- **Backfill on `dev` produces an idempotent end state**: re-running writes zero bytes; agent invocations behave identically before and after the cutover from a user-observable standpoint.
- **No agent loses GUARDRAILS / PLATFORM / CAPABILITIES safety**: every agent's prefix has those three files materialized as concrete bytes at backfill time, and pin updates after cutover continue to write concrete bytes.

---

## Scope Boundaries

- **Auto-propagation of template-version updates** — out of scope. R10 is explicit: operators opt in per-agent.
- **Cross-tenant template sharing** — out of scope. Tenants stay isolated.
- **Removing `placeholder-substitution.ts`** — out of scope. The sanitization pipeline keeps running, just at write time inside Workspace Builder. Possibly also at boot for HUMAN_* (R7).
- **Removing the workspace-files Lambda** — out of scope. It stays as the operator-edit entry point, but its body simplifies dramatically (no more `composeFile`-on-every-PUT-to-recompute-result).
- **Eliminating the `_catalog/` prefix structure** — out of scope. Templates and defaults still live there as Workspace Builder's *inputs*; the runtime just no longer reads them.
- **Changing how AGENTS.md routing maps to skills (`derive-agent-skills.ts`)** — out of scope. Same logic, same outputs, just runs inside Workspace Builder's write hook.
- **Multi-runtime sub-agent fan-out (Pi parent → Strands sub-agent or vice versa)** — out of scope here; covered by R-OQ4 in the Pi runtime brainstorm.

---

## Key Decisions

- **The runtime composer is removed entirely, not optimized.** All composition becomes write-time in Workspace Builder. Lazy materialization is replaced by eager materialization at the cost of a one-time backfill and slightly more work in the write path.
- **Per-invocation re-sync, not cold-start-only.** Warm containers re-sync every invocation. ETag-aware sync makes this nearly free in steady state; the architectural simplicity (no cache, no invalidation, no TTL) is worth the per-invocation list call.
- **Template updates do not auto-propagate.** Existing agents stay on the bytes they were materialized with until an operator re-materializes. This makes pin behavior and template behavior identical at runtime.
- **Pinned content is materialized as a real file, not a SHA reference.** No content-addressable store at runtime. Re-pinning rewrites bytes.
- **`{{AGENT_NAME}}` and `{{TENANT_NAME}}` are substituted at write time** (stable for an agent's lifetime). `{{HUMAN_*}}` is either eliminated everywhere except USER.md (already managed-write-in-full) or substituted at boot from a small placeholder map (R-OQ1).
- **One-shot cutover, no flag dance.** Pre-launch context — backfill, delete the composer, ship. Reverts are git reverts, not config flips.
- **Both runtimes get the same `bootstrap_workspace` helper.** Strands ports its container code to use it; Pi implements it natively in TypeScript. Same shape, same contract — `(tenantSlug, agentSlug, localDir) → number_of_files_synced`.
- **Workspace Builder absorbs `derive-agent-skills` and any other post-write derivations.** The "write a workspace file" pipeline is the single point that owns: substitute → resolve pins → write concrete → trigger derivations.

---

## Dependencies / Assumptions

- *[Verified by code read]* `workspace-overlay.ts`'s overlay walk, pin resolution, and substitution logic is already exercised at write time in the workspace-files Lambda — moving it from also-on-read to only-on-write is a refactor, not a rewrite.
- *[Verified by code read]* The runtime composer's call sites are bounded: `server.py`, `delegate_to_workspace_tool.py`, `skill_resolver.py`, `write_memory_tool.py` on the runtime side; `workspace-files.ts`, `agentPinStatus.query.ts`, `agent-snapshot.ts`, `derive-agent-skills.ts` on the API side. No third-party consumers.
- *[Assumption]* `aws s3 sync` (or the equivalent SDK loop with `If-None-Match` / ListObjectsV2 ETag comparison) is sufficient to make per-invocation re-sync cheap. Steady-state list-only cost should be ~10–30 ms in the same region.
- *[Assumption]* No agent today has more than ~50 workspace files at typical sizes. If a future template ships hundreds, per-invocation list still scales fine; full re-download cost only fires on actual edits.
- *[Assumption]* The 5 `{{HUMAN_*}}` placeholders only appear in USER.md today. If they appear elsewhere, R7's runtime-side substitution path is needed; if not, USER.md's existing managed-write-in-full pattern covers it and runtime substitution can be eliminated. Verify during planning.
- *[Assumption]* Pre-launch posture (no real production users) makes a flag-less one-shot cutover safe. If real tenants are using the system at cutover time, this assumption breaks and a staged migration is needed.
- *[Verified by memory]* User explicitly committed (this conversation) to per-invocation re-sync on warm containers, so edits propagate without an explicit invalidation.

---

## Outstanding Questions

### Deferred to Planning

- *[Affects R7][Needs research]* **Do any files besides USER.md contain `{{HUMAN_*}}` placeholders today?** If no — runtime substitution path can be eliminated, R7 simplifies to "no runtime substitution at all." If yes — name them and decide whether to extend the USER.md-style managed-write-in-full pattern to those files (per `feedback_workspace_user_md_server_managed`) or to keep a small runtime substitution helper.
- *[Affects R2, R6][Technical]* **ETag-aware sync implementation choice.** AWS CLI `s3 sync` works but adds a binary dependency to Pi's container. Native SDK ListObjectsV2 + parallel conditional GetObject is ~50 lines of TS / Python. Decide per-runtime.
- *[Affects R6][Technical]* **Mid-turn write visibility.** When `write_memory` writes server-side, also writing locally to `/workspace/` keeps the same loop's reads consistent. But what about cross-tool race conditions if a sub-agent (in another container) writes to the same path mid-turn? Likely a non-issue at v1 (sub-agents work on their own folders), but worth confirming.
- *[Affects R5, R10][Product]* **Re-materialize UI surface.** Operators need a way to opt agents in to a template version update. Today this is the `agentPinStatus` query + a pin-update mutation. Sketch the equivalent UX for "this template moved; re-materialize these agents."
- *[Affects R12][Operational]* **Backfill script design.** One-shot? Idempotent re-runnable? Per-tenant batched? Where does it run — admin Lambda, CLI command, one-off script? Production safety: needs a dry-run mode that diffs without writing.
- *[Affects R15][Refactor scope]* **Server-side composer call sites that need to keep working** — `agentPinStatus`, `agent-snapshot`, `derive-agent-skills`. Each one needs a concrete migration target: read directly from the agent's prefix, or call a Workspace Builder internal API. Decide per-call-site.
- *[Affects R14][Refactor scope]* **`delegate_to_workspace`'s composer fetch** — when the parent agent's tree is already synced to local `/workspace/`, the child agent's tree is just a sub-folder of that. No fresh composer call needed. Confirm the spawn pipeline can read the parent's local mirror instead of re-fetching.
- *[Affects bootstrap helper][Cross-cutting]* **Where does the bootstrap helper live?** Strands and Pi both need it. Options: (a) duplicate in each language — simple, low coupling; (b) factor a shared spec (OpenAPI) of the workspace-files list endpoint and have each runtime implement against that; (c) ship a small per-runtime utility npm/pypi package. Recommendation: option (a), per-runtime implementation, since the surface is tiny and the languages diverge anyway.

---

## Next Steps

- `-> /ce-plan` for structured implementation planning. Scope arc:
  1. **Wave 1 — Workspace Builder write-time logic.** Move overlay walk, pin resolution, AGENT/TENANT substitution, derivations into a single Workspace Builder write hook. No runtime changes yet.
  2. **Wave 2 — Backfill (R12).** Walk every existing agent through the new write hook to produce a fully-materialized prefix. Idempotent dry-run + apply.
  3. **Wave 3 — Strands runtime bootstrap (R1, R2, R14).** Replace `workspace_composer_client.py` and its call sites with the new helper. Delete the cache and invalidation calls.
  4. **Wave 4 — Pi runtime bootstrap.** Implement `bootstrap_workspace` in TS. Delivers the "Pi runs an agent" primitive that the Pi brainstorm needs.
  5. **Wave 5 — API cleanup (R15).** Delete or migrate the remaining `composeFile` / `composeList` consumers (`agentPinStatus`, `agent-snapshot`, `derive-agent-skills`).
  6. **Wave 6 — Operator UX for template re-materialization (R10, R-OQ4).** Per-agent or per-tenant re-materialize action.
- This brainstorm pairs with `2026-04-26-pi-agent-runtime-parallel-substrate-requirements.md` — Wave 4 here is the unblocker that makes Pi's "really small runtime" claim hold up under capability parity.

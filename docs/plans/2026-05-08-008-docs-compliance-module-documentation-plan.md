---
title: docs — Compliance module documentation
type: docs
status: active
date: 2026-05-08
---

# Compliance Module Documentation

## Summary

Plan a comprehensive `docs/compliance/` directory documenting the audit-event-log feature shipped via U1–U11. Four audience-cut docs (operator runbook, auditor walkthrough, developer guide, on-call notes) plus three structural docs (README entry point, overview, architecture) plus a chronological changelog. Reference docs only — no code changes; the plan executes by writing markdown files.

---

## Problem Frame

The compliance module is feature-complete (master arc U1–U11 merged via PRs #880, #883, #887, #897, #911, #917, the U8a/U8b PRs, #932, #937, #939, #941, #944, #948, #950, #951). Knowledge of how to operate it, audit it, extend it, and respond to its alarms currently lives across the master plan + 11 PR descriptions + scattered code comments + the audit-verifier README + CLAUDE.md. Without consolidated docs:

- Operators have no single-page runbook for the GOVERNANCE → COMPLIANCE Object Lock cutover (one-way decision; getting it wrong has unrecoverable consequences).
- Auditors have no walkthrough script — every SOC2 engagement requires re-deriving the narrative from source.
- Developers adding a new event type have to rediscover the schema → redaction → emit → test sequence each time.
- On-call has no DLQ-playbook for `compliance-anchor-dlq` / `compliance-exports-dlq`, no anchor-gap-alarm rubric, no audit_outbox-runaway response.

The next code-touching contributor and the next auditor engagement both pay the discovery tax. This plan closes that gap.

---

## Requirements

- R1. Entry-point `docs/compliance/README.md` linking to all audience docs with one-line purpose summaries; readable in under 60 seconds.
- R2. `overview.md` — what the module does + non-goals + the U1–U11 unit roster with PR links + version note.
- R3. `architecture.md` — substrate diagram (Yoga / Strands → outbox → drainer → events → anchor → verifier; export = parallel slice path), Aurora role split table, S3 prefix contract.
- R4. `operator-runbook.md` — admin-UI inspection, export request flow, DLQ-depth response, anchor-gap interpretation, GOVERNANCE→COMPLIANCE cutover, hand-rolled migration `psql -f` apply, Aurora password rotation.
- R5. `auditor-walkthrough.md` — SOC2 Type 1 narrative covering WORM bucket, hash chain (RFC 6962 domain separation), 14-event slate + redaction allow-list, export-as-attestation, dual-runtime emit. Walkthrough-shaped (operator-side-by-side framing).
- R6. `developer-guide.md` — adding a new event type end-to-end, Aurora role split semantics, cross-runtime emit path, audit-event tier semantics (control-evidence vs telemetry).
- R7. `oncall.md` — DLQ playbooks, anchor-gap > 30 min response, drift-gate failures, audit_outbox-runaway, Strands env-shadowing, irreversibility warnings.
- R8. `changelog.md` — chronological PR ↔ capability ↔ deploy-date table.
- R9. Every load-bearing claim cites the source: file path + line number for code, PR number for shipped behavior, `docs/plans/...` for design decisions.
- R10. Tone is reference-doc-flat (operators read for steps, auditors read for narrative, developers read for sequencing); no tutorial framing, no marketing voice.
- R11. No content invented from agent guess — if a fact isn't in the master plan, a PR description, a code comment, or a `docs/solutions/` learning, surface it as an `## Open Questions` block in the doc rather than fabricating it.

---

## Scope Boundaries

- This plan does NOT modify any code, Terraform, schema, or test files.
- This plan does NOT generate the screenshots referenced in `auditor-walkthrough.md` — placeholder list only; actual capture happens during the U11.U5 SOC2 rehearsal in deployed dev.
- This plan does NOT publish the docs to the Astro Starlight site. The new files live under `docs/compliance/` (markdown). A follow-up may wire them into the site's nav.
- This plan does NOT write a DPIA. The master plan's Documentation/Operational Notes section flags DPIA as a Phase 4 placeholder; that document is its own future plan.
- This plan does NOT cover Phase 5 AI-specific compliance topics (tool-call audit, memory provenance, agent self-modification). That is a separate strategic-horizon document referenced in `project_soc2_type2_ai_strategic_horizon`.

### Deferred to Follow-Up Work

- **U11.U5 SOC2 rehearsal capture** — fills in the screenshot placeholders + signs off the auditor-walkthrough.md against an actual deployed-dev run. Operational, not docs-authoring.
- **Astro Starlight integration** — when/whether to publish under the docs site. Cheap follow-up; not blocking the markdown lifecycle.
- **DPIA** — full data-protection-impact-assessment document for Phase 4 GDPR alignment.
- **Phase 5 AI-compliance positioning doc** — strategic-horizon paper; not reference docs.

---

## Context & Research

### Relevant Code and Patterns

**Master plan:**
- `docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md` — the canonical roster of U1–U11 + decisions + risks + scope. Single source of truth for "what was scoped."

**Implementation PRs (shipped on origin/main):**
- #880 — U1 hand-rolled `compliance.*` schema migration + Drizzle schema (`packages/database-pg/drizzle/0069_compliance_schema.sql` + `packages/database-pg/src/schema/compliance.ts`)
- #883 — U2 Aurora roles + Secrets Manager + RDS Proxy endpoints (`packages/database-pg/drizzle/0070_compliance_aurora_roles.sql` + `scripts/bootstrap-compliance-roles.sh`)
- #887 — U3 emit helper + redaction allow-list (`packages/api/src/lib/compliance/emit.ts` + `packages/api/src/lib/compliance/redaction.ts`)
- #897 — U4 outbox drainer Lambda (`packages/lambda/compliance-outbox-drainer.ts`)
- 10-event slate writer PRs — U5.A/B/C/D/E (createAgent / createInvite / agent-skills / mcp-create-server / cross-cutting tests)
- #911 (and U6.A–E) — Strands runtime emit path (`packages/agentcore-strands/agent-container/compliance_client.py` + `packages/api/src/handlers/compliance.ts`)
- #917 — U7 S3 Object Lock anchor bucket Terraform (`terraform/modules/data/compliance-audit-bucket/`)
- U8a PRs — anchor Lambda inert + EventBridge Scheduler + watchdog (`packages/lambda/compliance-anchor.ts` + `packages/lambda/compliance-anchor-watchdog.ts`)
- U8b PR — anchor Lambda live (S3 PutObject + Object Lock retention)
- #932 — U9 standalone audit-verifier CLI (`packages/audit-verifier/`)
- #937, #939, #941 — U10 backend + extensions + admin Compliance section (`packages/api/src/graphql/resolvers/compliance/` + `apps/admin/src/{routes,components,lib}/compliance/`)
- #944, #948, #950, #951 — U11 backend + Terraform + live runner + admin Exports (`packages/api/src/graphql/resolvers/compliance/exports.ts` + `terraform/modules/data/compliance-exports-bucket/` + `packages/lambda/compliance-export-runner.ts` + `apps/admin/src/routes/_authed/_tenant/compliance/exports/`)

**Schema migrations (canonical hand-rolled SQL):**
- `packages/database-pg/drizzle/0069_compliance_schema.sql` — schema, audit_outbox, audit_events, actor_pseudonym, export_jobs, immutability triggers
- `packages/database-pg/drizzle/0070_compliance_aurora_roles.sql` — writer/drainer/reader roles + GRANT pattern
- `packages/database-pg/drizzle/0073_compliance_tenant_anchor_state.sql` — tenant_anchor_state high-water-mark
- `packages/database-pg/drizzle/0074_compliance_event_hash_index.sql` — chain-walk index for `complianceEventByHash`

**Existing docs to mirror tone / structure:**
- `packages/audit-verifier/README.md` — already-shipped CLI usage; reference style, action-oriented.
- `terraform/modules/data/compliance-audit-bucket/README.md` — module-level operator notes (GOVERNANCE→COMPLIANCE cutover playbook).
- `CLAUDE.md` repo-root section "Architecture: the end-to-end data flow" item #4 (Persistence → audit_events derivation).
- `docs/runbooks/` — existing runbook shape conventions (read 1–2 to match section ordering + heading levels).

### Institutional Learnings

- `feedback_handrolled_migrations_apply_to_dev` — operator must `psql -f` to dev before merge; deploy drift-gate fails otherwise. Operator runbook + on-call notes both reference.
- `project_async_retry_idempotency_lessons` — DLQ design rationale; on-call playbook anchors here.
- `feedback_completion_callback_snapshot_pattern` — env-snapshot rule for Lambda handlers; developer guide cites for any new emit helper.
- `project_agentcore_deploy_race_env` — Strands env-shadowing failure mode; on-call DLQ playbook covers.
- `feedback_smoke_pin_dispatch_status_in_response` — smoke pattern; developer guide references when adding new compliance Lambdas.
- `project_system_workflows_revert_compliance_reframe` — the strategic context for "why audit-event-log + not workflow-orchestration"; overview cites.
- `project_soc2_type2_ai_strategic_horizon` — Phase 5 horizon; overview links to it as future-direction note.

### External References

None required for this docs work. The audit-verifier CLI references RFC 6962 (Merkle tree); auditor walkthrough may quote the relevant section but does not need to teach it from scratch.

---

## Key Technical Decisions

- **One markdown file per audience cut, not a single mega-doc.** Operators, auditors, developers, and on-call have different reading patterns + different urgencies; mixing them produces a doc nobody reads cover-to-cover. The README is the dispatch table.
- **Chronological changelog separate from overview.** Overview is "what the module is today"; changelog is "how it got here." Different consumers; conflating them buries the current-state answer behind history.
- **Cite, don't summarize, the master plan.** The plan in `docs/plans/2026-05-06-011-...` is the canonical record. The module docs link out for the full rationale; they do not copy the master plan's prose. Avoids the canonical-vs-doc drift trap.
- **Architecture diagram as Mermaid in `architecture.md`.** Substrate flow has 5 layers (Yoga/Strands emit → outbox → drainer → events → anchor) + a parallel exports path. Mermaid renders in GitHub + Astro Starlight + most editors. Pseudo-ASCII fallback in the same doc for terminal viewers.
- **Screenshot list as placeholder only.** Capturing them now (against undeployed code) would produce stale or fabricated screenshots. List the captures the U11.U5 rehearsal must produce; rehearsal author fills them in.
- **No "tutorial" voice in operator/oncall docs.** Operators don't need encouragement; they need the command + the expected output + the failure mode. Reference-flat tone throughout.
- **Heading-level discipline:** `# Title` → `## Audience-relevant section` → `### Specific procedure`. Each procedure starts with a 1-line "When to use this" line.
- **PR-link format:** `[#NNN](https://github.com/thinkwork-ai/thinkwork/pull/NNN)` consistently — reviewers can click to verify a claim against the PR diff.
- **Code-citation format:** `` `packages/api/src/lib/compliance/emit.ts:158` `` — file path + line number for load-bearing claims (e.g., "the `actorId` validation lives at..."). Use only when removing the citation would force the reader to grep.
- **U11.U5 rehearsal is the verification of `auditor-walkthrough.md`.** The rehearsal walks through the doc, captures any drift, and signs off. This plan does not pretend to ship a rehearsal-validated walkthrough.

---

## Open Questions

### Resolved During Planning

- **Where should the docs live — `docs/compliance/` or `apps/docs/src/content/docs/compliance/`?** `docs/compliance/` (top-level repo). The Astro Starlight publication path is a separate follow-up; markdown lives at the source of record first.
- **Should the changelog include the deploy-to-prod date column?** Yes, but populated as `(pending prod deploy)` for now since the arc has only landed in dev so far. Operator updates the column post-prod-launch.
- **Should the auditor walkthrough cover U11 export attestation?** Yes — exports are auditor-relevant evidence; the walkthrough has a section on requesting + downloading + verifying.
- **How much of the verifier CLI README should land in module docs?** The architecture doc references the CLI's role; the operator runbook says "run the verifier"; full CLI usage stays in `packages/audit-verifier/README.md` (single source).

### Deferred to Implementation

- **Exact Mermaid diagram source for the substrate flow** — implementer drafts based on the master plan's "Architecture" section + verifies against current code on origin/main.
- **Whether to inline the Aurora role split table in `architecture.md` or `developer-guide.md`** — both audiences need it; default to architecture.md and link from developer-guide.md.
- **Specific phrasing for the GOVERNANCE→COMPLIANCE warning** — operator runbook author drafts using `terraform/modules/data/compliance-audit-bucket/README.md` as the source of truth for the warning text.

---

## Output Structure

    docs/compliance/
    ├── README.md                      # NEW: entry point + navigation table
    ├── overview.md                    # NEW: what the module does + U1-U11 roster
    ├── architecture.md                # NEW: substrate diagram + role split + S3 contract
    ├── operator-runbook.md            # NEW: audience (1)
    ├── auditor-walkthrough.md         # NEW: audience (2)
    ├── developer-guide.md             # NEW: audience (3)
    ├── oncall.md                      # NEW: audience (4)
    └── changelog.md                   # NEW: chronological PR table

---

## Implementation Units

- U1. **`docs/compliance/README.md` — entry point**

**Goal:** Give a reader a 60-second answer to "what is this directory + which doc do I want?"

**Requirements:** R1, R10.

**Dependencies:** None.

**Files:**
- Create: `docs/compliance/README.md`

**Approach:**
- Title: `# Compliance module documentation`
- 1-paragraph intro: what the compliance module does in one sentence ("append-only audit-event log with WORM-anchored Merkle chain + async export, designed for SOC2 Type 1 walkthroughs"), and a 1-sentence pointer to the master plan.
- Navigation table — markdown table with 7 rows mapping doc → audience → "read this when":
  - `overview.md` → "anyone new to the module" → "you need the 5-minute version"
  - `architecture.md` → "developers + auditors" → "you need to see how the pieces connect"
  - `operator-runbook.md` → "operators" → "you need to do something to the running system"
  - `auditor-walkthrough.md` → "auditors + operators preparing for SOC2" → "you need to demonstrate compliance to a third party"
  - `developer-guide.md` → "developers extending the module" → "you need to add a new event type or wire a new emit site"
  - `oncall.md` → "on-call" → "an alarm fired"
  - `changelog.md` → "anyone tracing history" → "you need to know which PR shipped which capability"
- Footer: "Maintenance: keep the changelog current when shipping new compliance work. Other docs update on the cadence the master arc evolves."

**Patterns to follow:**
- `terraform/modules/data/compliance-audit-bucket/README.md` heading rhythm.
- `packages/audit-verifier/README.md` reference-flat tone.

**Test scenarios:**
- *Test expectation: none — pure entry-point doc with no behavioral claims.*

**Verification:**
- Each audience doc referenced in the table actually exists after U2–U8 land.
- Markdown renders cleanly (no broken table syntax) in GitHub preview.

---

- U2. **`docs/compliance/overview.md` + `docs/compliance/changelog.md`**

**Goal:** Stable answer to "what does this module do, and how did we get here?" Two short docs that fit on a single screen each.

**Requirements:** R2, R8, R10, R11.

**Dependencies:** None.

**Files:**
- Create: `docs/compliance/overview.md`
- Create: `docs/compliance/changelog.md`

**Approach:**
- `overview.md`:
  - `# Overview` — 1-paragraph what-it-does.
  - `## Non-goals` — bulleted list copied from master plan Scope Boundaries (`docs/plans/2026-05-06-011-...md`).
  - `## Master arc unit roster` — table of U1..U11 → 1-line description → PR link. Cite master plan for the canonical version.
  - `## Strategic context` — 2 sentences linking to `project_system_workflows_revert_compliance_reframe` (why this exists) and `project_soc2_type2_ai_strategic_horizon` (where it's headed).
  - `## Where to read more` — links to architecture, operator-runbook, auditor-walkthrough, developer-guide, oncall.
- `changelog.md`:
  - `# Changelog` — 1-line intro: "Each row is a merged PR + the capability it shipped."
  - Markdown table: PR | Date merged | Unit | Capability | Deploy to dev | Deploy to prod
  - Rows: every U1..U11 PR (~16 rows). PR # comes from the master plan's PR cross-references; merged dates from `gh pr view`. Deploy-to-prod column starts as `(pending prod deploy)` for the entire current set.

**Patterns to follow:**
- `CLAUDE.md` repo-root "Architecture" section's "end-to-end data flow" framing — applied to compliance specifically.

**Test scenarios:**
- *Test expectation: none — reference doc.*

**Verification:**
- Every U-ID in the roster has a corresponding PR link that resolves on github.com/thinkwork-ai/thinkwork.
- Changelog row count equals the count of merged compliance PRs (~16).

---

- U3. **`docs/compliance/architecture.md`**

**Goal:** Single doc a developer / auditor reads to understand the substrate.

**Requirements:** R3, R9, R10.

**Dependencies:** None.

**Files:**
- Create: `docs/compliance/architecture.md`

**Approach:**
- `# Architecture`
- `## Substrate flow` — Mermaid sequence/flow diagram of:
  - Yoga resolver `db.transaction` → `emitAuditEvent` → INSERT into `compliance.audit_outbox`
  - Strands Python `ComplianceClient` → POST `/api/compliance/events` → `compliance-events` Lambda → INSERT into `audit_outbox`
  - `compliance-outbox-drainer` Lambda (reserved-concurrency=1) reads outbox → computes per-tenant hash chain → INSERT into `compliance.audit_events`
  - `compliance-anchor` Lambda (rate(15min)) reads chain heads → computes Merkle root → PutObject to WORM-protected `compliance-audit-bucket`
  - `compliance-export-runner` Lambda (SQS-triggered) reads `audit_events` → streams CSV/NDJSON → S3 `compliance-exports` bucket → presigned URL
  - audit-verifier CLI reads anchor bucket + chain → verifies retention + Merkle proofs
- `## Aurora role split` — table:
  - `compliance_writer` — INSERT only on `audit_outbox` + `export_jobs`. Used by Yoga + Strands emit path.
  - `compliance_drainer` — SELECT/UPDATE on `audit_outbox`, INSERT on `audit_events`, SELECT on `actor_pseudonym`, UPDATE on `tenant_anchor_state`. Used by drainer + anchor Lambdas.
  - `compliance_reader` — SELECT-only on all four `compliance.*` tables. Used by U10 read API + admin Compliance browse.
  - Cite `packages/database-pg/drizzle/0070_compliance_aurora_roles.sql` for full GRANT detail.
- `## S3 prefix contract` — table:
  - `compliance-audit-bucket/anchors/cadence-{cadenceId}.json` — per-cadence Merkle anchor (Object Lock COMPLIANCE/GOVERNANCE retention).
  - `compliance-audit-bucket/proofs/{tenantId}/{cadenceId}.json` — per-tenant proof slice (shorter retention).
  - `compliance-exports/{tenantId}/{jobId}.{csv|ndjson}` — ephemeral export artifact (7-day lifecycle, no Object Lock).
- `## RFC 6962 hash chain` — 1 paragraph + cite. Leaf = `sha256(0x00 || tenant_id_bytes || event_hash_bytes)`. Node = `sha256(0x01 || left || right)`. Domain separation prevents second-preimage forgery. Full impl reference: `packages/audit-verifier/src/merkle.ts` and `packages/lambda/compliance-anchor.ts`.
- `## Event-type slate` — bulleted list of all 14 production event types from the master plan + `packages/database-pg/src/schema/compliance.ts` `COMPLIANCE_EVENT_TYPES`. 5 reserved Phase 6 types listed in a follow-on bullet.
- `## Audit-event tier semantics` — control-evidence vs telemetry. Cite master plan R6.
- `## Where the wiring lives` — file-path index for the curious reader (links to emit.ts, drainer.ts, anchor.ts, export-runner.ts, etc.).

**Patterns to follow:**
- `CLAUDE.md` "end-to-end data flow" section's prose-then-numbered-list style.
- `docs/plans/2026-05-06-011-...md` "System-Wide Impact" + Architecture sections.

**Test scenarios:**
- *Test expectation: none — reference doc.*

**Verification:**
- Mermaid diagram renders in GitHub preview.
- Aurora role table grants match the GRANTs in `0070_compliance_aurora_roles.sql` exactly.
- Every cited file path resolves to a current file on origin/main.

---

- U4. **`docs/compliance/operator-runbook.md`**

**Goal:** Operator can pick a task off the table of contents and execute it without reading the rest of the doc.

**Requirements:** R4, R9, R10.

**Dependencies:** None.

**Files:**
- Create: `docs/compliance/operator-runbook.md`

**Approach:**
- `# Operator runbook` — 1-line intro: "How to do things to the running compliance module."
- `## TOC` — bulleted links to each procedure below.
- Procedures (each starts with "When to use this" line):
  - `## Inspect compliance events in admin` — sign in as operator → /compliance → filter → click event → walk back through chain.
  - `## Request a compliance export` — /compliance → "Export this view" → format → wait → Download. Cite the rate limit (10/hour/operator) + the 90-day filter cap + the 4 KB filter byte cap.
  - `## Apply a hand-rolled compliance migration to dev before merging` — `psql "$DATABASE_URL" -f packages/database-pg/drizzle/00NN_*.sql`. Required by the post-deploy drift gate; missing this fails the deploy. Cite `feedback_handrolled_migrations_apply_to_dev`.
  - `## Bootstrap or rotate Aurora compliance role passwords` — `STAGE=dev bash scripts/bootstrap-compliance-roles.sh`. Cite `0070_compliance_aurora_roles.sql` + the bootstrap script's idempotency.
  - `## Flip S3 Object Lock GOVERNANCE → COMPLIANCE for an audit engagement` — **DANGER: irreversible.** Tfvars change, plan, manual confirmation, apply. Cite `terraform/modules/data/compliance-audit-bucket/README.md` for full playbook.
  - `## Drain compliance-anchor-dlq` — when alarm fires; inspect message body, decide replay vs purge.
  - `## Drain compliance-exports-dlq` — same shape; the runner already wrote FAILED to DB so DLQ is reserved for handler crashes.
  - `## Re-run a failed export` — submit a new export with the same filter (no clone-job mutation; user does it via UI).
- `## Where to escalate` — 1-paragraph link to oncall.md.

**Patterns to follow:**
- `terraform/modules/data/compliance-audit-bucket/README.md` cutover-playbook section's danger-warning shape.
- `docs/runbooks/` existing runbook structure (heading levels, "When to use this" prefix).

**Test scenarios:**
- *Test expectation: none — reference doc; verification is the U11.U5 rehearsal walking through each procedure.*

**Verification:**
- Each command/UI-flow citation has a working file-path or PR-number reference.
- The GOVERNANCE→COMPLIANCE section explicitly calls out irreversibility in the heading or first sentence.

---

- U5. **`docs/compliance/auditor-walkthrough.md`**

**Goal:** Auditor + operator sit side-by-side; doc walks them through what to look at, in order.

**Requirements:** R5, R9, R10, R11.

**Dependencies:** U3 (cites architecture.md for substrate framing).

**Files:**
- Create: `docs/compliance/auditor-walkthrough.md`

**Approach:**
- `# SOC2 Type 1 walkthrough`
- `## Pre-engagement` — 1 paragraph on prerequisites: operator email in `THINKWORK_PLATFORM_OPERATOR_EMAILS`, dev/prod stage flipped to COMPLIANCE Object Lock mode (cite operator-runbook procedure), audit-verifier CLI installed locally.
- `## Walkthrough script` — narrative the auditor reads alongside the operator:
  1. Sign in to admin as operator. Sidebar shows "Compliance".
  2. Open `/compliance`. Auditor sees the events list — point out the 14-event slate filter dropdown.
  3. Filter to last 7 days, event_type = `agent.created`. Note the cursor pagination.
  4. Click an event. Detail page shows event_id, event_hash, prev_hash, payload (redacted), anchor status (ANCHORED with cadence_id + recorded-within-window copy).
  5. Click prev_hash. Walks back one event. Click "Walk back 10 events". Visual chain proof of append-only history.
  6. Back to events list. Click "Export this view" → CSV → submit.
  7. Open `/compliance/exports`. Watch QUEUED → RUNNING → COMPLETE (3s polling).
  8. Click Download. CSV opens with full envelope per row + RFC 6962-shaped event_hash + prev_hash.
  9. Run `audit-verifier` CLI against the same date range. Auditor sees Merkle root + retention check + chain walk.
  10. (Optional, prod) Show the COMPLIANCE-mode anchor object's S3 console retention attribute — irreversible until expiry.
- `## Hash-chain explainer` — short paragraph: each event_hash includes prev_hash, so any tampering shifts every subsequent hash; the anchor is the auditor's external proof point. Cite RFC 6962 domain separation.
- `## Event-type slate` — link to `architecture.md#event-type-slate`.
- `## Redaction allow-list` — 1 paragraph: `packages/api/src/lib/compliance/redaction.ts` + per-event-type allow-list. New event types require a redaction rule (developer-guide cross-link).
- `## Dual-runtime emit path` — explicit callout that BOTH Yoga (TypeScript) and Strands (Python) write to the same outbox via the same event_id UUIDv7 idempotency key. The auditor doesn't need this most days; it matters when an auditor questions cross-system trust.
- `## Screenshot list` — placeholder bullet list of 9 screenshots U11.U5 rehearsal must capture (one per walkthrough step). Each bullet says "TODO: capture during U11.U5 rehearsal".
- `## Verifier CLI usage` — 1-paragraph link out to `packages/audit-verifier/README.md`.
- `## Open Questions` — anything that surfaced during plan-write that the auditor walkthrough needs but the rehearsal hasn't validated yet.

**Patterns to follow:**
- Existing walkthrough docs in `docs/runbooks/` if any; `packages/audit-verifier/README.md` for the CLI-usage reference style.

**Test scenarios:**
- *Test expectation: none — reference doc; the U11.U5 rehearsal validates by walking through it.*

**Verification:**
- Every UI step matches the actual current admin SPA on origin/main (after #951 deploy).
- Screenshot placeholders are explicit — never inline a fabricated screenshot.

---

- U6. **`docs/compliance/developer-guide.md`**

**Goal:** Developer adding a new event type or wiring a new emit site can do it without re-deriving the sequence from PR archaeology.

**Requirements:** R6, R9, R10.

**Dependencies:** U3 (cites architecture.md).

**Files:**
- Create: `docs/compliance/developer-guide.md`

**Approach:**
- `# Developer guide`
- `## Adding a new event type` — numbered procedure:
  1. Add the dotted-lowercase string to `COMPLIANCE_EVENT_TYPES` in `packages/database-pg/src/schema/compliance.ts`.
  2. Add a redaction allow-list entry in `packages/api/src/lib/compliance/redaction.ts`. Decide which payload fields are safe to persist; everything else gets redacted.
  3. Identify call sites that should emit. Wrap inside the originating `db.transaction` (control-evidence) or `try/catch + log` (telemetry) — see "tier semantics" below.
  4. Add an integration test in `packages/api/test/integration/compliance-event-writers/` that exercises the cross-cutting path (originating mutation → outbox row → drainer → audit_events row).
  5. Regenerate GraphQL codegen if the new type appears in the GraphQL `ComplianceEventType` enum (`packages/database-pg/graphql/types/compliance.graphql`).
  6. Verify `packages/api/src/__tests__/compliance-event-type-drift.test.ts` still passes (the GraphQL enum values must match the runtime slate).
- `## Audit-event tier semantics` — table:
  - **Control evidence:** caller wraps emit inside `db.transaction(async tx => { ...; emitAuditEvent(tx, ...) })`. Audit failure rolls back the originating mutation. Use for security-relevant events (auth, authorization, data export).
  - **Telemetry:** caller wraps emit in `try { emitAuditEvent(...) } catch { log }`. Audit failure does NOT block the originating action. Use for high-volume informational events.
  - Cite master plan R6.
- `## Aurora role split` — link to `architecture.md#aurora-role-split`.
- `## Cross-runtime emit path (Strands Python)` — 1 paragraph + link:
  - Strands constructs a `ComplianceClient` at boot time (`packages/agentcore-strands/agent-container/compliance_client.py`).
  - On a relevant runtime event, it generates a UUIDv7 event_id locally and POSTs to `/api/compliance/events` with bearer `API_AUTH_SECRET`.
  - The `compliance-events` Lambda handler (`packages/api/src/handlers/compliance.ts`) validates + INSERTs to outbox under the same idempotency key. Re-deliveries are no-ops via the unique-on-event_id constraint.
  - Snapshot env at coroutine entry — never re-read `os.environ` mid-handler. Cite `feedback_completion_callback_snapshot_pattern`.
- `## Adding a new compliance Lambda` — 4-step checklist:
  1. Lambda body in `packages/lambda/compliance-XXX.ts` with module-load env snapshot.
  2. Build entry in `scripts/build-lambdas.sh` — possibly to `BUNDLED_AGENTCORE_ESBUILD_FLAGS` if the Lambda imports SDK clients not in the runtime.
  3. Terraform handler resource in `terraform/modules/app/lambda-api/handlers.tf` (standalone vs for_each pool — standalone for blast-radius isolation when the role/env differs).
  4. Post-deploy smoke + GHA workflow gate. Cite `feedback_smoke_pin_dispatch_status_in_response`.
- `## Where the tests live` — index of test directories: `packages/api/src/__tests__/compliance-*`, `packages/api/test/integration/compliance-event-writers/`, `packages/lambda/__tests__/compliance-*`, `packages/audit-verifier/src/**/*.test.ts`.

**Patterns to follow:**
- `packages/audit-verifier/README.md` reference-flat tone.

**Test scenarios:**
- *Test expectation: none — reference doc.*

**Verification:**
- Every cited file path resolves to a current file.
- The "adding a new event type" procedure is testable: a developer following it lands a passing PR.

---

- U7. **`docs/compliance/oncall.md`**

**Goal:** On-call sees an alarm, opens this doc, finds the alarm by name, follows the playbook.

**Requirements:** R7, R9, R10.

**Dependencies:** None.

**Files:**
- Create: `docs/compliance/oncall.md`

**Approach:**
- `# On-call notes`
- `## Quick reference — alarm to playbook` — table mapping CloudWatch alarm name → page-link:
  - `thinkwork-{stage}-compliance-anchor-dlq-depth` → `#anchor-dlq-depth-non-zero`
  - `thinkwork-{stage}-compliance-exports-dlq-depth` → `#exports-dlq-depth-non-zero`
  - `thinkwork-{stage}-compliance-anchor-watchdog-heartbeat-missing` → `#anchor-watchdog-heartbeat-missing`
  - `thinkwork-{stage}-compliance-anchor-gap` → `#anchor-gap-too-large` (anchor cadence drift)
  - drift-gate-fails — not a CloudWatch alarm but a CI gate; surface here too.
- Procedures, each starting with "Symptom" / "Likely cause" / "Resolution":
  - `## anchor-dlq-depth-non-zero`
  - `## exports-dlq-depth-non-zero` — runner crashed (not a business failure; those record FAILED in DB). Inspect SQS message body → re-deliver or purge.
  - `## anchor-watchdog-heartbeat-missing` — watchdog Lambda dead OR CloudWatch metric publish failing.
  - `## anchor-gap-too-large` — anchor Lambda missed a cadence (>30 min since last anchor). Could be a bona-fide outage or just a deploy window.
  - `## audit_outbox-runaway` — drainer dead, outbox row count growing unbounded, indexes degrading. Cite the master plan's relevant risk row.
  - `## drift-gate-fails-on-deploy` — operator forgot to apply a hand-rolled `0069/0070/0071/0073/0074/00NN` migration. Cite `feedback_handrolled_migrations_apply_to_dev`.
  - `## Strands runtime emit silent failure` — env shadowing. Cite `project_agentcore_deploy_race_env`.
- `## Irreversibility warnings` — 1 section reminding on-call of the operations they should NOT autonomously perform without operator-tier authority:
  - GOVERNANCE→COMPLIANCE Object Lock cutover.
  - Truncating audit_events / audit_outbox.
  - Lowering Object Lock retention_days.
- `## Where to escalate` — operator runbook + master plan.

**Patterns to follow:**
- `docs/runbooks/` existing on-call doc shape.

**Test scenarios:**
- *Test expectation: none — reference doc.*

**Verification:**
- Every alarm name in the quick-reference table corresponds to an `aws_cloudwatch_metric_alarm` resource in `terraform/modules/app/lambda-api/handlers.tf`.

---

- U8. **Final pass — index update + cross-link audit + commit + open PR**

**Goal:** Verify the new docs cross-link cleanly, no orphan references, and ship as one PR.

**Requirements:** R1–R11 (final verification across the surface).

**Dependencies:** U1–U7.

**Files:** No new files; verification + ship pass.

**Approach:**
- Walk every internal link in the 8 new files; broken-link audit.
- Walk every cited PR # — confirm it exists and is MERGED on github.com/thinkwork-ai/thinkwork.
- Walk every cited file path — confirm it resolves on origin/main HEAD.
- Update `CLAUDE.md` repo-root section that mentions compliance to add a 1-line pointer to `docs/compliance/README.md` (small inline edit, NOT a rewrite).
- Commit with a single conventional message (`docs(compliance): add module documentation`).
- Open PR. Body summarizes the 8 new files + the U11.U5 rehearsal that will sign off `auditor-walkthrough.md`.

**Patterns to follow:**
- The shipping discipline used across U1–U11 (squash-merge after CI green).

**Test scenarios:**
- *Test expectation: none — pure verification + ship.*

**Verification:**
- All internal links resolve.
- CI checks (lint / typecheck / verify / test / cla) pass — this is a docs-only PR so nothing should regress.
- PR opened, body lists the 8 new files + the deferred U11.U5 capture step.

---

## System-Wide Impact

- **Interaction graph:** None — pure markdown additions.
- **Error propagation:** None — no behavioral change.
- **State lifecycle risks:** None — docs do not write state.
- **API surface parity:** Adds a `docs/compliance/` directory; consumers may want to publish to Astro Starlight (deferred follow-up).
- **Integration coverage:** The U11.U5 SOC2 rehearsal IS the integration verification for `auditor-walkthrough.md`.
- **Unchanged invariants:** All compliance code, all schemas, all Terraform — untouched.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Cited file paths drift as code evolves | Citation format includes file path + PR number; reviewers can verify against current HEAD. Future plan: add a CI link-check job for `docs/compliance/`. |
| Auditor walkthrough drifts from actual UI | U11.U5 rehearsal is the validation gate; doc is explicitly placeholder until then. |
| Operator runbook misses a procedure | Real on-call experience surfaces gaps; quarterly review of `oncall.md` against actual alarms fired. |
| Mermaid diagram renders inconsistently across viewers | Pseudo-ASCII fallback in the same doc; GitHub + Astro Starlight both render Mermaid. |
| Changelog rots | Update discipline: every compliance PR appends a row before merging. Documented in `README.md`'s Maintenance line. |
| Doc duplicates source-of-truth (master plan, PR descriptions) | Cite, don't summarize, the master plan. Each doc has a different audience focus that justifies its existence. |
| New event types ship without updating developer-guide.md | The "Adding a new event type" procedure ends with "update developer-guide.md if the procedure changes." Self-referential maintenance. |
| Phase 5 AI-compliance topics leak into Phase 3 docs | Scope Boundaries explicitly defers Phase 5 to the strategic-horizon doc. Reviewers gate. |

---

## Documentation / Operational Notes

- **Doc-only PR.** No code, no Terraform, no schema. CI's lint/typecheck/test jobs are no-ops; verify still runs (markdown-clean check).
- **U11.U5 rehearsal** captures screenshots referenced in `auditor-walkthrough.md`. Plan that as a separate session after the next dev deploy.
- **CLAUDE.md repo-root** gets one line: `For module docs, see docs/compliance/README.md.` Minimal touch.
- **Astro Starlight integration** deferred — markdown lives in `docs/compliance/` first; publishing is a future plan.

---

## Sources & References

- **Master plan:** [`docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md`](../plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md)
- **Implementation PRs:** #880, #883, #887, #897, #911, #917, U8a/U8b PRs, #932, #937, #939, #941, #944, #948, #950, #951
- **Existing reference docs:**
  - `packages/audit-verifier/README.md`
  - `terraform/modules/data/compliance-audit-bucket/README.md`
  - `CLAUDE.md` repo-root compliance summary
- **Schema migrations:** `packages/database-pg/drizzle/0069_compliance_schema.sql`, `0070_compliance_aurora_roles.sql`, `0073_compliance_tenant_anchor_state.sql`, `0074_compliance_event_hash_index.sql`
- **Institutional learnings:** `feedback_handrolled_migrations_apply_to_dev`, `project_async_retry_idempotency_lessons`, `feedback_completion_callback_snapshot_pattern`, `project_agentcore_deploy_race_env`, `feedback_smoke_pin_dispatch_status_in_response`, `project_system_workflows_revert_compliance_reframe`, `project_soc2_type2_ai_strategic_horizon`

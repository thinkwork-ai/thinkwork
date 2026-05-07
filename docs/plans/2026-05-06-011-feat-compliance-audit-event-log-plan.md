---
title: "feat: Compliance audit-event log + admin Compliance section + tamper evidence"
type: feat
status: active
date: 2026-05-06
origin: docs/brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md
---

# feat: Compliance audit-event log + admin Compliance section + tamper evidence

## Summary

Build the Phase 3 successor to System Workflows: a `compliance.*` Postgres schema housing an append-only audit-event log with cryptographic tamper evidence (per-tenant in-DB hash chain anchored to S3 Object Lock), a same-transaction outbox + single-writer drainer for control-evidence durability, the 10-event SOC2 Type 1 starter slate of writers wired into existing resolvers + handlers + the Strands runtime, an admin "Compliance" nav surface with Events list + detail drawer + async CSV/JSON Exports, and a standalone verifier CLI auditors can run against anchor bundles without database credentials. The work ships in four phases (foundation → write path → anchor + verify → admin UI), with the heavyweight S3 Object Lock anchor Lambda using the inert→live seam-swap pattern so the live anchoring branch lands in its own PR after structural plumbing has soaked in dev.

---

## Problem Frame

System Workflows shipped as a single substrate combining multi-step orchestration with SOC2-grade audit capture. Phase 1+2 (now complete) reverted the orchestration ambition. Phase 3 rebuilds the audit-capture ambition correctly: a flat append-only log writable by any platform service, viewable by tenant admins, exportable for an auditor, with cryptographic tamper evidence the team can demonstrate end-to-end. SOC2 Type 1 is a near-term gating concern (required to onboard enterprise customers and work with distribution channels), and the audit-evidence portion of Type 1 is satisfied by traceability + tamper-evident logs + demonstrable controls — not by pre-approval workflows or multi-step orchestration. (See origin: `docs/brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md` Problem Frame.)

---

## Requirements

Carried forward verbatim from origin Phase 3 (R5–R15). Phase 1+2 requirements (R1–R4) are out of scope here — already shipped.

- R5. Append-only audit-event log with the canonical 22-field envelope; oversized payloads spill to S3.
- R6. Two-tier write semantics: control-evidence events use synchronous-or-outbox (originating action fails if audit cannot persist); telemetry events write async with operator alerts.
- R7. Admin UI surface renamed "Compliance" in the Manage group; legacy System Workflows entry removed (already done in Phase 2 U2).
- R8. Events list with filter-by-actor, filter-by-tenant, filter-by-event-type, filter-by-date-range; per-event detail drilldown.
- R9. Exports surface for filtered event sets in CSV or JSON. Named "Exports" not "Reports".
- R10. 10-event SOC2 Type 1 starter slate (auth, user CRUD, agent CRUD, agent skills changed, MCP add/remove, workspace governance file edits, data.export initiated).
- R11. Audit data lives in dedicated `compliance` Postgres schema; application role write-only on writer table, distinct admin role read-only, no other role has access.
- R12. Per-tenant in-row hash chain (`event_hash` / `prev_hash`); tampering with any historical row detectable.
- R13. Periodic Merkle root anchored to S3 Object Lock Compliance mode; verification re-derives root from current Postgres data.
- R14. Schema reserves Phase 6 governance event types (`policy.*`, `approval.recorded`); declared but not emitted in v1.
- R15. Redaction-before-write with field-level sanitization; `payload_redacted_fields` records what was suppressed.

**Origin actors:** A1 Tenant admin, A2 Future auditor, A3 Platform services.
**Origin flows:** F3 Rebuild as Compliance, F4 Admin views audit log, F5 Platform service writes an audit event.
**Origin acceptance examples:** AE2a, AE2b, AE3, AE4, AE5, AE6, AE7, AE8.

---

## Scope Boundaries

- Pre-approval workflows of any kind (Phase 6).
- 12-month retention enforcement, archival, automated deletion of expired audit data (Phase 4).
- Auditor-facing UX (view-as-auditor mode, evidence packaging) and dashboards/charts/summary analytics on the Reports surface (Phase 4).
- Daily workspace memory file edits as audit events (excluded from starter slate as too noisy).
- Migration of historical System Workflows run data into the new audit log (current data is not auditor-grade).
- AgentCore Evaluations native migration, AWS Audit Manager / CloudTrail Lake / QLDB, Vanta/Drata, blockchain-based ledger storage (all rejected at brainstorm time).
- Auto-staging/prod stage chain. `deploy.yml` hardcodes `STAGE=dev`; future stages get per-stage `psql -f` apply for hand-rolled migrations.

### Deferred to Follow-Up Work

- Migrate `activity_log` writers to dual-write `compliance.audit_events`: defer until after Phase 3 Type 1 audit feedback. Phase 3 ships `compliance.audit_events` as a parallel surface; activity_log + tenant_policy_events stay operational. (Per learnings: `docs/solutions/workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md`.)
- AI-specific audit events (agent-state snapshots at action time, tool-call events, memory-recall events, model-version provenance per action): Phase 5 — separate brainstorm + plan.
- Public-transparency-log integration (Sigstore Rekor or similar): emerging pattern, overkill for Type 1.
- KMS asymmetric signing of anchor objects (HSM-backed signing): nice-to-have for Type 2 differentiation; defer.

---

## Context & Research

### Relevant Code and Patterns

- **Canonical audit-write resolver pattern**: `packages/api/src/graphql/resolvers/core/updateTenantPolicy.mutation.ts:73-100` — `db.transaction(async (tx) => { update primary; tx.insert(events).values([...]); })`. Mirror this shape for `emitAuditEvent(tx, ...)` calls.
- **Auth/actor resolution**: `packages/api/src/graphql/resolvers/core/resolve-auth-user.ts:16-50,80` — `resolveCallerFromAuth(auth)` and `resolveCallerTenantId(ctx)` fallback. Critical because `ctx.auth.tenantId` is null for Google-federated users (per CLAUDE.md).
- **Hand-rolled migration template**: `packages/database-pg/drizzle/0067_thinkwork_computers_phase_one.sql:1-202` and `0068_drop_system_workflows_and_activation.sql:1-115` — required header conventions, `\set ON_ERROR_STOP on`, `BEGIN; ... COMMIT;`, `SET LOCAL lock_timeout = '5s'`, `current_database()` guard, `-- creates:` / `-- creates-column:` / `-- creates-constraint:` / `-- creates-extension:` markers.
- **Existing audit-shaped tables (parallel surfaces, not merged)**: `packages/database-pg/src/schema/activity-log.ts:16-51` (read by `inbox/activityLog.query.ts`, written by `packages/api/src/handlers/activity.ts:88-115`); `packages/database-pg/src/schema/tenant-policy-events.ts` (regulator-visible, source-of-truth for policy transitions).
- **Strands → API HTTP callback**: `packages/agentcore-strands/agent-container/container-sources/server.py:972-994` — `_log_invocation` template using stdlib `urllib.request` + bearer auth + 3s timeout + exception swallow. Phase 3 mirrors against `POST /api/compliance/events`.
- **Lambda handler registration**: `scripts/build-lambdas.sh:73` allowlist of `BUNDLED_AGENTCORE_ESBUILD_FLAGS` handlers; per-handler entry required in both Terraform `handlers.tf` and the build script (per `feedback_lambda_zip_build_entry_required`).
- **Scheduled job pattern**: `packages/lambda/job-schedule-manager.ts:1-50` is tenant-scoped; for Phase 3 anchor cadence use a Terraform-managed `aws_scheduler_schedule` (not a `scheduled_jobs` row).
- **Redaction precedent**: `packages/lambda/sandbox-log-scrubber.ts:39-58` — secret-pattern set (Authorization Bearer, JWT, gh*_, xox*-, ya29.*). Phase 3 redaction registry extends with PII classification.
- **Admin sidebar**: `apps/admin/src/components/Sidebar.tsx:249-256` — Manage group entry point. List+drawer reference: `apps/admin/src/routes/_authed/_tenant/threads/index.tsx` + `$threadId.tsx`.
- **Bucket-creation pattern**: `terraform/modules/data/s3-buckets/main.tf:29-91` — closest precedent for new S3 module; sibling location `terraform/modules/data/compliance-audit-bucket/`.

### Institutional Learnings

- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` — Phase 3's hand-rolled `compliance.*` migration must apply via `psql -f` to dev BEFORE merging the PR; drift gate fails the deploy otherwise. Required marker types include `creates-extension` for `pgcrypto`.
- `docs/solutions/workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md` — Don't preemptively retire `activity_log` or `tenant_policy_events` in this plan. Run consumer survey, defer with documented rationale.
- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md` — Anchor Lambda ships inert (returns `{anchored: false, dispatched: true, merkle_root}`) in U8a; live S3 PutObject swap in U8b. Body-swap safety test asserts the live default actually invokes S3.
- `docs/solutions/workflow-issues/agentcore-completion-callback-env-shadowing-2026-04-25.md` — Strands runtime audit emit path snapshots `THINKWORK_API_URL` + `API_AUTH_SECRET` at coroutine entry; never re-reads `os.environ` after agent turn. Compliance writes that silently drop due to env shadowing would create undetectable audit gaps.
- `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md` — Don't widen `resolveCaller` for service-asserted compliance writes; stand up narrow `POST /api/compliance/events` authenticated with `API_AUTH_SECRET`, taking `tenantId` + `actorUserId` explicitly with cross-tenant validation.
- `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md` — Admin-side Compliance reads derive `tenantId` from queried row(s), not `ctx.auth.tenantId`. Cross-tenant exposure of compliance data is itself a SOC2-failing event.
- `docs/solutions/runtime-errors/lambda-web-adapter-in-flight-promise-lifecycle-2026-05-06.md` — Audit dispatch from LWA-fronted Lambdas uses `await` (not fire-and-forget). Surface `dispatched: true` in response payload for smoke pinning (per `feedback_smoke_pin_dispatch_status_in_response`).

### External References

- AWS Prescriptive Guidance: Transactional outbox pattern — https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html
- S3 Object Lock — https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html, https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-managing.html
- Aurora PostgreSQL RBAC — https://aws.amazon.com/blogs/database/amazon-aurora-postgresql-database-authorization-using-role-based-access-control/
- RDS Proxy read-only endpoints — https://aws.amazon.com/blogs/database/use-amazon-rds-proxy-with-read-only-endpoints/
- PostgreSQL advisory locks — https://www.postgresql.org/docs/current/functions-admin.html
- Drizzle pgSchema — https://orm.drizzle.team/docs/schemas
- Trillian / verifiable data structures (Merkle anchoring model) — https://transparency.dev/verifiable-data-structures/
- GDPR audit-trail pseudonymization — https://axiom.co/blog/the-right-to-be-forgotten-vs-audit-trail-mandates
- TanStack Router file-based routing — https://tanstack.com/router/latest/docs/framework/react/routing/file-based-routing

---

## Key Technical Decisions

1. **Hash chain linearization: single-writer outbox drainer.** Resolvers + handlers insert into `compliance.audit_outbox` inside the originating transaction; a Lambda with reserved concurrency = 1 polls `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1`, computes `event_hash = sha256(prev_hash || canonical_json)`, and writes `compliance.audit_events`. **Why:** decouples business latency from chain integrity; auditors get a clean "single writer, replayable from outbox, idempotent on `outbox_id`" story; prevents two concurrent writers materializing the same `prev_hash`. Rejected: advisory locks (couples user-perceived latency to chain hash op), SERIALIZABLE retry (retry storms under contention; auditor-unfriendly framing). (Resolves origin P0 #1 and #2.)

2. **S3 Object Lock mode: Governance in dev/staging, Compliance at audit time.** Compliance mode is irreversible — even AWS root cannot delete or shorten retention. Shipping Compliance mode on day one would brick dev iteration. Governance mode in dev gives WORM semantics with a break-glass escape for misconfigurations; switch to Compliance mode in prod when first audit engagement is scheduled. **12-month retention default** (SOC2 Type 1 baseline; 7-year SEC 17a-4(f) retention not applicable). (Resolves origin P0 #3.)

3. **Per-tenant hash chains + global Merkle tree with per-tenant proof slices.** R12 requires per-tenant chains (verification stays tenant-scoped). For Merkle anchoring, build one global tree per cadence and store per-tenant slices `{tenant_id, leaf_hash, proof_path[], global_root, cadence_id}`. **Why:** at 400 tenants × hourly × 12-month retention, per-tenant anchoring writes ~3.5M Object Lock objects; global-tree-with-slices writes ~8.7K. Verification cost is identical (auditor re-derives root from tenant slice). This is the Certificate Transparency / Trillian model. (Resolves origin P1 "per-tenant Merkle anchoring cost projection".)

4. **Postgres role separation: two distinct users + separate RDS Proxy endpoints, no `SET ROLE`.** `compliance_writer` (USAGE on schema, INSERT only on `audit_outbox`; `audit_events` is INSERT-only by drainer); `compliance_reader` (USAGE + SELECT only). Each gets its own Secrets Manager secret + RDS Proxy endpoint. Defense-in-depth: `BEFORE UPDATE` and `BEFORE DELETE` triggers that `RAISE EXCEPTION` regardless of role. **Why:** `SET ROLE` per query in transaction-pooled connections is a known footgun (state leaks); separate physical users give auditors a simpler narrative and clean Secrets-Manager rotation. Rejected: `SECURITY DEFINER` views in `public` (auditors flag as opaque privilege-escalation surface). (Resolves origin P1 #16.)

5. **GDPR right-to-be-forgotten: opaque actor IDs + erasable pseudonym table.** Audit payload stores `actor_id` (UUID) only; never email/name/IP unless required. `compliance.actor_pseudonym(actor_id, user_id, email_hash, created_at)` is the erasable lookup. Hash chain hashes the opaque ID, not PII. RTBF erasure deletes the pseudonym row → chain remains valid (no row mutations) but `actor_id` becomes un-resolvable to a person. **Why:** EDPB accepts pseudonymization as effective erasure when re-identification is no longer reasonably possible; this is the 2025-2026 standard pattern. (Resolves origin P1 #12.)

6. **Redaction: deny-by-default allow-list, schema-driven per event type.** Each event type declares its permitted payload fields in `packages/api/src/lib/compliance/redaction.ts`; anything else is dropped at write time and recorded in `payload_redacted_fields`. Field-level sanitization: cap length at 4 KB, strip control chars except `\n\t`, JSON-encode (never raw concat), reject invalid UTF-8. Governance file diffs use `content_sha256` + truncated preview pattern. **Why:** block-list/regex redaction fails open on novel field names; allow-list pairs naturally with the event-type registry and forces a reviewer decision at PR time. (Resolves origin P1 #13.)

7. **Strands runtime emit path: narrow `POST /api/compliance/events` REST endpoint.** Auth via `API_AUTH_SECRET` bearer; payload includes explicit `tenantId` + `actorUserId` + `eventType` + `payload`; handler validates `tenantId` against the actor's tenant before insert. Idempotency-Key header = `event_id` (UUIDv7); resolver upserts on conflict. **Why:** widening `resolveCaller` for service-asserted identity is the wrong shape — leaked `API_AUTH_SECRET` should not become a universal compliance-event-forgery credential. (Resolves origin P1 #17.)

8. **Hash chain implemented via trigger, not generated column.** Drizzle generated columns reject expressions that reference other generated columns, and you cannot `ALTER` an existing generated expression — drop+recreate is required for changes. The drainer Lambda computes the hash in app code; the trigger only enforces immutability (BEFORE UPDATE/DELETE → RAISE EXCEPTION). (Resolves Drizzle pgSchema gotcha surfaced in framework-docs research.)

9. **Inert→live seam swap for the anchor Lambda.** U8a ships the anchor Lambda with `_anchor_fn_inert(merkle_root, tenant_slices) → {anchored: false, dispatched: true, merkle_root, ...}`. U8b swaps in real S3 PutObject + Object Lock retention. Body-swap safety test in U8b asserts the live function actually invokes the S3 SDK (so a future hardcoded-success regression cannot pass). **Why:** matches the repo's established pattern for heavyweight integrations; lets the schedule + watchdog alarm + Merkle computation soak in dev before WORM bytes start landing.

10. **Anchor cadence: `rate(15 minutes)`, drift-acceptable.** Per CLAUDE.md, AWS Scheduler `rate()` anchors to creation time + interval, not wall-clock. For SOC2 evidence, what matters is bounded staleness (≤ 30 min from event to anchor), not predictable wall-clock alignment. (Resolves brainstorm Deferred-to-Planning question on anchor frequency.)

11. **Verifier: standalone Python CLI in `tools/audit-verifier/`, Apache-2.0 licensed.** Inputs: anchor object (downloaded via auditor's own AWS read-only creds), tenant slice bundle (exported via admin), tenant chain dump (CSV). Output: `OK` / `FAIL` with per-row diagnostics. Pin verifier version in anchor object metadata so old anchors remain verifiable after future hash-algo changes. **Why:** standalone open-source verifier is the Trillian / Certificate Transparency / Sigstore pattern; auditors can read the source themselves to satisfy "trust but verify" and run it without DB credentials. (Resolves origin P1 #14.)

12. **`activity_log` and `tenant_policy_events` stay parallel for v1.** Don't merge in this plan. Both surfaces have live consumers; consumer-survey + migration is a Phase 4+ exercise after auditor feedback shapes the canonical event vocabulary. (Resolves origin P1 #11 and P2 #21/#26.)

13. **Drizzle: `pgSchema("compliance")` for read-side TS types; hand-rolled SQL for migration.** Drizzle Kit doesn't emit `CREATE SCHEMA` automatically and `SECURITY DEFINER` / search_path hardening is fiddly to express via Drizzle DSL. The hand-rolled SQL file (with `-- creates-extension: pgcrypto`, `-- creates: compliance.audit_events`, etc.) is the source of truth; the `pgSchema` TS declaration mirrors it for typed read access in resolvers.

14. **Defense-in-depth Postgres triggers, not just role grants.** Even though `compliance_writer` lacks UPDATE/DELETE permissions, add `BEFORE UPDATE` and `BEFORE DELETE` triggers on `compliance.audit_events` that `RAISE EXCEPTION 'audit events are immutable'`. **Why:** if a role configuration drifts (or a future privileged role is granted access for the wrong reason), the trigger is a second line of defense. AE5 verification failure observable via the trigger error message in the originating transaction.

15. **Async export with presigned URL, not in-browser blob assembly.** Admin POSTs `createAuditExport(filter, format)` → row in `compliance.export_jobs` → SQS → export-runner Lambda paginates Aurora cursor → streams CSV/NDJSON to S3 multipart → presigned URL emailed/displayed on completion (15-min expiry, single-use). Hard cap: 90-day max date range per export; 10 exports/hour/admin rate limit. Each export emits its own `data.export_initiated` audit event (recursion intended). (Resolves origin P1 #20 and P1 #15.)

---

## Open Questions

### Resolved During Planning

- *Per-tenant hash chain linearization* (P0 #1): outbox drainer with reserved concurrency = 1 (Decision #1).
- *Outbox-vs-sync write semantics* (P0 #2): same-transaction outbox; control-evidence action fails if outbox insert fails (Decision #1).
- *S3 Object Lock retention + mode for non-prod* (P0 #3): Governance in dev/staging, Compliance at audit time, 12-month default (Decision #2).
- *Cleanup of SW step/evidence recorder calls in `wiki-compile.ts` and `eval-runner.ts`* (P1): already addressed by Phase 1 PR #845 + Phase 2 PRs #851/#855 (recorder lib deleted, calls stripped). No residual work.
- *Phase 2/3 transition: full delete + rebuild vs extract-and-evolve* (P1): full delete shipped in Phase 2 U6 (PR #873). `compliance.audit_events` is greenfield.
- *Events list read path under role separation* (P1): separate `compliance_reader` Pg user via dedicated RDS Proxy endpoint (Decision #4); resolver chooses pool by operation type.
- *Tamper evidence sized for SOC2 vs over-engineered* (P1): scoped to SOC2 Type 1 evidence-foundation (12-month retention, hash chain, Merkle anchor); SEC 17a-4 broker-dealer regimes explicitly out of scope.
- *Build-then-engage-auditor sequencing* (P1): user committed to building first, engaging after Phase 3 ships.
- *Commodity vs AI-specific work sequencing* (P1): Phase 3 = commodity SOC2 controls; Phase 5 = AI-specific (separate brainstorm).
- *Per-tenant vs global hash chain* (P1): per-tenant chain (R12), global Merkle anchor with per-tenant slices (Decision #3).
- *GDPR pseudonymization design* (P1): opaque `actor_id` + `compliance.actor_pseudonym` lookup table (Decision #5).
- *Redaction allow-list vs block-list + classification ownership* (P1): deny-by-default allow-list per event type, lives in `packages/api/src/lib/compliance/redaction.ts`; named owner = whoever PRs a new event type (review-time gate, no separate runtime registry).
- *Anchor job IAM scope + alarm + anchor-gap detection* (P1): least-privilege (PutObjectRetention + PutObject on anchor prefix only); CloudWatch alarm on watchdog Lambda checking anchor `LastModified` freshness; anchor-gap surfaced in verifier CLI report.
- *Export endpoint controls* (P1): 90-day max range, 10/hour/admin rate limit, mandatory tenantId predicate, presigned URL with 15-min expiry; `data.export_initiated` is control-evidence tier.
- *Postgres role separation infra* (P1): two physical users, two Secrets Manager secrets, two RDS Proxy endpoints (Decision #4).
- *Strands runtime cross-language audit semantics* (P1): narrow REST endpoint with Idempotency-Key (Decision #7); workspace-file-edit S3 events emit through the existing S3 → Lambda processor + the new audit endpoint, with the S3-event handler responsible for failing visibly if the audit endpoint rejects.
- *Events list states + filter UX + detail drawer + export UX* (P1 #18-20): see U10 + U11 specs.
- *Verification operationalization* (Deferred): scheduled verification job runs daily, surfaces results to admin Compliance section's "Verification status" panel; on-demand admin-triggered verification is post-Phase-3 polish.
- *Inline payload size threshold* (Deferred): 4 KB inline limit; payloads above route to S3 with key reference; `payload_oversize_s3_key` envelope field.

### Deferred to Implementation

- Exact pgcrypto installation order (extension-create before or after schema create) — implementer resolves at psql-apply time.
- Final SQL of the trigger body for the immutability check — implementer iterates against actual error message UX.
- Whether the redaction registry exports a single `redactPayload(eventType, raw)` function or a per-event-type schema validator — implementer chooses based on what makes adding the 11th event type cleanest.
- Exact Aurora username/password generation for the new roles — implementer follows existing Terraform patterns in `terraform/modules/data/aurora-postgres/`.
- Per-tenant slice storage layout (separate S3 prefix vs DynamoDB) — implementer chooses based on what the verifier CLI consumes more cleanly.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Write path (every audit event)                                          │
└─────────────────────────────────────────────────────────────────────────┘

   ┌──────────────────┐                  ┌──────────────────┐
   │ Yoga resolver /  │  emitAuditEvent  │ Strands runtime  │  POST
   │ Lambda handler   │ ────────────────▶│ HTTP client      │ /api/compliance/events
   └──────┬───────────┘  (in-tx insert)  └──────┬───────────┘  (Idempotency-Key)
          │                                      │
          │  same db.transaction                 │  Yoga REST handler
          ▼                                      ▼  validates + emitAuditEvent (in-tx)
   ┌─────────────────────────────────────────────────────────┐
   │ compliance.audit_outbox (ROW-LEVEL LOCK on insert)      │
   │   (outbox_id, tenant_id, event_type, raw_payload, ...)  │
   └────────────────────────┬────────────────────────────────┘
                            │  (commit triggers outbox row visibility)
                            ▼
   ┌─────────────────────────────────────────────────────────┐
   │ compliance-outbox-drainer Lambda (reserved-concurrency=1)│
   │  poll: FOR UPDATE SKIP LOCKED LIMIT 1                   │
   │  redact (allow-list) → canonicalize → hash chain        │
   │  INSERT compliance.audit_events; mark outbox drained    │
   └────────────────────────┬────────────────────────────────┘
                            │
                            ▼
   ┌─────────────────────────────────────────────────────────┐
   │ compliance.audit_events (INSERT-only; trigger blocks UPDATE/DELETE) │
   │   per-tenant chain via prev_hash → event_hash           │
   └─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ Anchor path (every 15 minutes)                                          │
└─────────────────────────────────────────────────────────────────────────┘

   AWS Scheduler rate(15min) ──▶ compliance-anchor Lambda
                                  ├─ SELECT events since last anchor (per tenant)
                                  ├─ Compute global Merkle tree (leaves = tenant chain heads)
                                  ├─ Inert: return {anchored: false, dispatched: true, ...}  [U8a]
                                  ├─ Live:  PutObject  s3://thinkwork-${stage}-compliance-anchors/
                                  │            anchor-{cadence_id}.json
                                  │         + ObjectRetention (Mode=GOVERNANCE in dev,
                                  │                            COMPLIANCE in prod, 365 days)
                                  └─ Write per-tenant proof slices to non-locked prefix [U8b]

   Watchdog Lambda (every 5min) ──▶ Check S3 LastModified on most recent anchor;
                                     Alarm if gap > 30 min

┌─────────────────────────────────────────────────────────────────────────┐
│ Read + export path                                                      │
└─────────────────────────────────────────────────────────────────────────┘

   admin SPA (urql)
     │
     ▼
   GraphQL Yoga (compliance_reader RDS Proxy endpoint)
     │
     ├─ events(filter, page) → list view
     ├─ event(id) → detail drawer
     └─ createAuditExport(filter, format) ──▶ compliance.export_jobs row
                                                    │
                                                    ▼
                                           SQS ──▶ export-runner Lambda
                                                    paginate cursor →
                                                    multipart upload to S3 →
                                                    update job status →
                                                    presigned URL (15min)

┌─────────────────────────────────────────────────────────────────────────┐
│ Verifier (auditor-side)                                                 │
└─────────────────────────────────────────────────────────────────────────┘

   tools/audit-verifier/  (standalone Python CLI, Apache-2.0)
     inputs:  anchor.json (downloaded with auditor's read-only AWS creds)
              tenant_slice.json
              chain.csv (exported from admin)
     output:  OK  /  FAIL: chain break at row {N}, anchor mismatch at cadence {C}
```

---

## Implementation Units

Phases group units by dependency; ce-work decides parallel-vs-serial dispatch within a phase based on file overlap.

### Phase A — Foundation (schema + roles)

- U1. **Hand-rolled migration: `compliance.*` schema, tables, roles, triggers**

**Goal:** Greenfield `compliance` Postgres schema with `audit_outbox`, `audit_events`, `actor_pseudonym`, `export_jobs` tables; immutability triggers; pgcrypto extension. All Drizzle schema TS declarations in lockstep.

**Requirements:** R5, R11, R12, R14, R15.

**Dependencies:** None.

**Files:**
- Create: `packages/database-pg/drizzle/0069_compliance_schema.sql` (hand-rolled, with `-- creates-extension: pgcrypto`, `-- creates-schema: compliance`, `-- creates: compliance.audit_outbox`, `-- creates: compliance.audit_events`, `-- creates: compliance.actor_pseudonym`, `-- creates: compliance.export_jobs`, `-- creates-trigger: compliance.audit_events_immutable_update`, `-- creates-trigger: compliance.audit_events_immutable_delete`, `-- creates-index:` markers for each index)
- Create: `packages/database-pg/src/schema/compliance.ts` (uses `pgSchema("compliance")` for typed read access; declares `auditEvents`, `auditOutbox`, `actorPseudonym`, `exportJobs`)
- Modify: `packages/database-pg/src/schema/index.ts` (re-export `compliance.ts`)
- Modify: `scripts/db-migrate-manual.sh` if cross-schema markers (`compliance.X`) need namespacing support — verify locally first
- Test: `packages/database-pg/__tests__/migration-0069.test.ts` (vitest; verifies marker enumeration matches DDL count)

**Approach:**
- `audit_events` columns match the 22-field envelope from R5 plus `payload_oversize_s3_key`. Per-tenant chain via `prev_hash CHAR(64)`, `event_hash CHAR(64)`. Indexes: `(tenant_id, occurred_at DESC)`, `(tenant_id, event_type, occurred_at DESC)`, `(actor)`, `(control_ids)` GIN, `(prev_hash)` for chain traversal.
- `audit_outbox` columns: `outbox_id` UUIDv7, `tenant_id`, `event_type`, `raw_payload` JSONB, `recorded_at`, `drained_at` NULL, `error` NULL. Indexed `(drained_at, recorded_at)` partial WHERE `drained_at IS NULL`.
- `actor_pseudonym` columns: `actor_id` UUID PK, `user_id` UUID nullable, `email_hash` CHAR(64) nullable, `created_at`. RTBF erasure deletes the row → `actor_id` becomes un-resolvable.
- `export_jobs` columns: `job_id` UUIDv7 PK, `tenant_id`, `requested_by`, `filter` JSONB, `format` ENUM('csv', 'json'), `status` ENUM('queued','running','complete','failed'), `s3_key` nullable, `presigned_url_expires_at` nullable.
- BEFORE UPDATE / BEFORE DELETE triggers on `audit_events` raise `EXCEPTION 'audit events are immutable'`.
- Hand-rolled SQL applies via `psql -f` to dev BEFORE merging the PR (per `feedback_handrolled_migrations_apply_to_dev`).

**Execution note:** Apply migration to dev *before* opening the PR; verify drift gate exit 0 against dev manually. Test the cross-schema marker support of `db-migrate-manual.sh` before relying on it.

**Patterns to follow:**
- `packages/database-pg/drizzle/0067_thinkwork_computers_phase_one.sql` (full header + marker enumeration)
- `packages/database-pg/drizzle/0068_drop_system_workflows_and_activation.sql:67-90` (lock_timeout, statement_timeout, current_database guard)

**Test scenarios:**
- *Happy path:* Migration applies cleanly to a fresh dev DB; all 4 tables visible in `compliance.*`; pgcrypto extension active; triggers fire on UPDATE attempt with the immutability error message.
- *Edge case:* Re-applying the migration is idempotent (`CREATE SCHEMA IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`); marker enumeration in test asserts every `-- creates: X` matches a DDL statement.
- *Error path:* `UPDATE compliance.audit_events SET payload = '{}' WHERE event_id = X` → trigger raises immutability exception; caller transaction rolls back. Covers AE5.
- *Error path:* `DELETE FROM compliance.audit_events WHERE event_id = X` → same.

**Verification:** `psql "$DATABASE_URL" -c "\dt compliance.*"` shows 4 tables; `\dx pgcrypto` shows extension; `INSERT` then `UPDATE` raises the immutability error; `pnpm db:migrate-manual` reports exit 0 against dev.

---

- U2. **Aurora roles + Secrets Manager + RDS Proxy endpoints (Terraform)**

**Goal:** Provision `compliance_writer` and `compliance_reader` Aurora users with schema-scoped GRANTs; two new Secrets Manager secrets; two new RDS Proxy endpoints (or one Proxy with separate read/write endpoints).

**Requirements:** R11.

**Dependencies:** U1.

**Files:**
- Modify: `terraform/modules/data/aurora-postgres/main.tf` (add `compliance_writer`, `compliance_reader` users + GRANTs)
- Modify: `terraform/modules/data/aurora-postgres/variables.tf`, `outputs.tf`
- Create: `terraform/modules/data/aurora-postgres/compliance-roles.tf` if separating concerns is cleaner
- Modify: `terraform/modules/thinkwork/main.tf` to wire new outputs
- Modify: `terraform/examples/greenfield/terraform.tfvars` if any new variables (avoid; prefer locals)

**Approach:**
- `compliance_writer`: USAGE on schema `compliance`, INSERT on `compliance.audit_outbox`, INSERT on `compliance.export_jobs`. **No** access to `audit_events` (only the drainer Lambda's role has that, via a dedicated `compliance_drainer` user — possibly merge with `compliance_writer` if simpler).
- `compliance_reader`: USAGE on schema `compliance`, SELECT on `audit_events`, `actor_pseudonym`, `export_jobs`.
- RDS Proxy: configure two endpoints — write endpoint (fronts `compliance_writer` + `compliance_drainer`), read-only endpoint (fronts `compliance_reader`). Or use existing Proxy with two `aws_db_proxy_endpoint` resources.
- Secrets Manager: `/thinkwork/${stage}/compliance/writer-credentials`, `/thinkwork/${stage}/compliance/reader-credentials`.
- IAM: Lambda execution roles get `secretsmanager:GetSecretValue` on the relevant secret only.

**Patterns to follow:**
- `terraform/modules/data/aurora-postgres/main.tf` (existing single-role provisioning)
- `terraform/modules/data/secrets-manager/` if it exists, otherwise existing secret declarations elsewhere

**Test scenarios:**
- *Happy path:* `terraform plan` shows 2 new users + 2 new secrets + 2 proxy endpoints; `terraform apply` succeeds; `psql -U compliance_writer -c "INSERT INTO compliance.audit_outbox VALUES (...)"` succeeds; `psql -U compliance_writer -c "SELECT * FROM compliance.audit_events"` is rejected with permission denied.
- *Edge case:* `psql -U compliance_reader -c "INSERT INTO compliance.audit_outbox VALUES (...)"` is rejected.
- *Error path:* `psql -U compliance_writer -c "DROP TABLE compliance.audit_events"` is rejected (no DDL grant).

**Verification:** `aws secretsmanager get-secret-value --secret-id /thinkwork/dev/compliance/writer-credentials` returns valid JSON; both proxy endpoints accept connections; permission boundaries verified by manual psql test.

---

### Phase B — Write path

- U3. **Compliance write helper + redaction allow-list**

**Goal:** `emitAuditEvent(tx, payload)` helper for in-process callers (Yoga resolvers, Lambda handlers); deny-by-default allow-list redaction registry per event type.

**Requirements:** R5, R6, R10, R14, R15.

**Dependencies:** U1.

**Files:**
- Create: `packages/api/src/lib/compliance/emit.ts` (the `emitAuditEvent(tx, {tenantId, actorId, eventType, payload, controlIds, source, requestId, threadId, agentId, resourceType, resourceId, action, outcome})` helper)
- Create: `packages/api/src/lib/compliance/redaction.ts` (allow-list per event type; sanitization helpers)
- Create: `packages/api/src/lib/compliance/event-types.ts` (the 10-event slate + 5 reserved Phase 6 types as constants/types)
- Test: `packages/api/src/lib/compliance/__tests__/emit.test.ts`
- Test: `packages/api/src/lib/compliance/__tests__/redaction.test.ts`

**Approach:**
- Helper inserts into `compliance.audit_outbox` inside the caller's `tx`. Caller controls failure: if the tx rollback is acceptable on audit failure, Phase 3 control-evidence semantics work automatically (R6).
- `redactPayload(eventType, rawPayload) → {redacted: object, redactedFields: string[]}`. Drop any field not in the per-event allow-list. Cap string fields at 4 KB; strip control chars except `\n\t`; reject invalid UTF-8.
- Governance file diff payloads: store `{file, content_sha256, preview: first 2 KB}`, not full content.
- `event_id` generated as UUIDv7 inside the helper for natural time-ordering and idempotency at the REST entry point (U6).
- Reserve event types from R14 (`policy.evaluated`, `policy.allowed`, `policy.blocked`, `policy.bypassed`, `approval.recorded`) as TS string-literal constants but don't expose writers; the registry validates them at write time.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/core/updateTenantPolicy.mutation.ts:73-100` (in-transaction event insert pattern)
- `packages/lambda/sandbox-log-scrubber.ts:39-58` (secret-pattern set; extend with PII patterns)

**Test scenarios:**
- *Happy path:* `emitAuditEvent(tx, {eventType: 'agent.skills_changed', payload: {agentId, skillIds: [...]}})` inserts a row in `audit_outbox` with the redacted payload and `outbox_id`.
- *Edge case:* Payload field not in allow-list (e.g., `apiKey: 'sk-...'`) is dropped; `redactedFields` includes `'apiKey'`; outbox row contains the dropped field name.
- *Error path:* Unknown event type → throws (forces PR review of new event types).
- *Error path:* Payload string field over 4 KB is truncated; `redactedFields` includes `'<field>__truncated'`.
- *Edge case:* Invalid UTF-8 in payload → rejected at write time (raise BEFORE insert).
- Covers AE8.

**Verification:** Unit tests pass; running an integration test that calls `emitAuditEvent` in a `db.transaction` shows the row in `compliance.audit_outbox`.

---

- U4. **Outbox drainer Lambda**

**Goal:** Single-writer Lambda (reserved concurrency = 1) that drains `compliance.audit_outbox` rows, computes per-tenant hash chain, writes `compliance.audit_events`. Idempotent on `outbox_id`. SQS DLQ for poison rows.

**Requirements:** R5, R6, R12.

**Dependencies:** U1, U2.

**Files:**
- Create: `packages/lambda/compliance-outbox-drainer.ts`
- Modify: `scripts/build-lambdas.sh` (add `compliance-outbox-drainer` to allowlist; pgcrypto + pg client may need bundle flags)
- Modify: `terraform/modules/app/lambda-api/handlers.tf` (new handler, reserved-concurrency=1, DLQ, EventBridge schedule `rate(1 minute)`)
- Test: `packages/api/test/integration/compliance-drainer.test.ts`

**Approach:**
- Lambda polls `SELECT * FROM compliance.audit_outbox WHERE drained_at IS NULL ORDER BY recorded_at LIMIT N FOR UPDATE SKIP LOCKED` (N small, e.g., 50, to keep iteration latency low).
- For each row: read `prev_hash` = chain head for `tenant_id` (SELECT MAX(occurred_at) lookup, or maintain `compliance.tenant_chain_head` summary table — implementer chooses).
- Canonicalize payload (sorted-keys JSON serialization, no whitespace).
- Compute `event_hash = encode(digest(prev_hash || canonical_json::bytea, 'sha256'), 'hex')` via pg-side `digest()` or app-side Node `crypto.createHash('sha256')`.
- `INSERT INTO compliance.audit_events (... outbox_id ...) ON CONFLICT (outbox_id) DO NOTHING; UPDATE compliance.audit_outbox SET drained_at = NOW() WHERE outbox_id = $1`.
- Idempotency: `audit_events.outbox_id` UNIQUE constraint guarantees replay-safety.
- MaximumRetryAttempts=0 on async invokes (per `project_async_retry_idempotency_lessons`); SQS DLQ catches poison rows (e.g., outbox row with payload that fails redaction post-insert).

**Execution note:** Land structurally (drains outbox → writes audit_events) but run only in dev for U4. Production scheduling activates after U10's admin UI lets the team observe rows landing.

**Patterns to follow:**
- `packages/lambda/job-trigger.ts` (scheduled Lambda + Postgres connection + structured logging)
- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md` (already structurally live; no inert step here)

**Test scenarios:**
- *Happy path:* Insert 3 outbox rows for tenant T → drainer runs → 3 audit_events rows with chained `prev_hash`/`event_hash`; outbox rows marked `drained_at`.
- *Edge case:* Two tenants' rows interleaved in outbox → each tenant's chain is independent and correctly linked.
- *Error path:* Outbox row with malformed payload → drainer logs, marks row with `error` field, moves on (does not block other rows).
- *Edge case:* Replay of already-drained outbox row → `ON CONFLICT (outbox_id) DO NOTHING` prevents duplicate audit_events insert.
- *Integration:* End-to-end: Yoga resolver calls `emitAuditEvent` → outbox row visible → drainer triggers → audit_events row visible → chain verifies.

**Verification:** Integration test inserts outbox rows, invokes drainer, asserts audit_events shape including chain integrity; CloudWatch logs show structured drain output; reserved-concurrency=1 visible in Terraform plan.

---

- U5. **10-event slate writers in existing resolvers + handlers**

**Goal:** Wire `emitAuditEvent` calls into the resolvers and handlers backing the 10-event SOC2 starter slate.

**Requirements:** R6, R10.

**Dependencies:** U3.

**Files (modify, all in `packages/api/src/`):**
- `graphql/resolvers/auth/*` — `auth.signin.success`, `auth.signin.failure`, `auth.signout` (telemetry tier — async write, drop OK)
- `graphql/resolvers/core/*invite*`, `*createUser*`, `*disableUser*`, `*deleteUser*` — `user.invited`, `user.created`, `user.disabled`, `user.deleted` (control-evidence tier)
- `graphql/resolvers/agents/*` — `agent.created`, `agent.deleted`, `agent.skills_changed` (control-evidence tier)
- `graphql/resolvers/mcp/*` or wherever MCP server registration lives — `mcp.added`, `mcp.removed` (control-evidence tier)
- `lib/workspace-files.ts` (or the actual workspace-governance-edit handler — implementer locates) — `workspace.governance_file_edited` for AGENTS/GUARDRAILS/CAPABILITIES (control-evidence tier)
- `graphql/resolvers/exports/*` (or wherever data export initiates) — `data.export_initiated` (control-evidence tier)
- Test: integration tests adjacent to each resolver verifying the audit row lands

**Approach:**
- Telemetry tier (auth.signin.*, auth.signout): wrap `emitAuditEvent` in try/catch with `void` and log on failure; do NOT fail originating action.
- Control-evidence tier (everything else in the slate): call `emitAuditEvent` inside the same `db.transaction` as the primary write. If audit insert throws → tx rolls back → originating mutation fails with user-facing error message. Covers AE2a.
- `agent.skills_changed`: hooks into `derive-agent-skills.ts` which already runs on AGENTS.md put — emit alongside that derivation (already in workspace-files.ts flow). One place captures both AGENTS.md edits AND skill recomputation.
- `workspace.governance_file_edited`: payload includes `{file: 'AGENTS.md'|'GUARDRAILS.md'|'CAPABILITIES.md', content_sha256, diff_preview: first 2 KB}`. Covers AE4.
- For each resolver: identify actor via `resolveCallerFromAuth(ctx.auth)`; use `resolveCallerTenantId(ctx)` fallback for Google-federated users.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/core/updateTenantPolicy.mutation.ts:73-100` (in-tx audit emit)
- `packages/api/src/graphql/resolvers/core/resolve-auth-user.ts:16-50,80` (actor resolution)
- `packages/api/src/lib/derive-agent-skills.ts` (on-AGENTS.md-put pattern)

**Test scenarios:**
- *Integration (covers AE2a):* Tenant admin changes `agent_skills`; database is unreachable from drainer; the `compliance_writer` user can still INSERT into `audit_outbox`; the originating mutation succeeds (because outbox is the durability tier, not audit_events).
  - Subcase where outbox itself is unreachable: mutation fails with "action could not be safely audited"; agent skills NOT changed.
- *Integration (covers AE2b):* User signs in successfully even when `audit_outbox` is unreachable (telemetry-tier path); operator alert fires.
- *Integration (covers AE4):* Tenant admin saves AGENTS.md edit; `workspace.governance_file_edited` row appears with diff preview, content_sha256, actor identity, file name.
- *Edge case:* Sign-in failure with wrong password → `auth.signin.failure` row with redacted payload (no password leak).
- *Error path:* `agent.skills_changed` mutation called by Google-federated user (ctx.auth.tenantId null) → `resolveCallerTenantId` fallback resolves correctly; audit row has correct `tenant_id`.

**Verification:** Per-resolver integration tests assert audit row presence and shape; redaction tests assert no secrets leak; tenant isolation tests confirm `tenant_id` correctness across both Cognito-direct and Google-federated callers.

---

- U6. **Strands runtime emit path: `POST /api/compliance/events` + Python client**

**Goal:** Cross-runtime emit path for the Python Strands agent runtime to fire control-evidence audit events back to Yoga.

**Requirements:** R6, R10.

**Dependencies:** U3, U4.

**Files:**
- Create: `packages/api/src/handlers/compliance.ts` (new REST handler `POST /api/compliance/events` mounted by graphql-http Lambda)
- Modify: `terraform/modules/app/api-gateway/` (route + auth)
- Create: `packages/agentcore-strands/agent-container/container-sources/compliance_client.py`
- Modify: `packages/agentcore-strands/agent-container/container-sources/server.py` (call sites for tool-execution audit + workspace-file-edit signals from Strands; env-snapshot at coroutine entry)
- Test: `packages/api/src/handlers/__tests__/compliance.test.ts`
- Test: `packages/agentcore-strands/agent-container/test_compliance_client.py`

**Approach:**
- REST handler authenticates via `Authorization: Bearer ${API_AUTH_SECRET}`; payload = `{tenantId, actorUserId, eventType, payload, occurredAt, requestId?, threadId?, agentId?, resourceType?, resourceId?, action?, outcome?}`; handler validates `actorUserId` belongs to `tenantId` (cross-tenant guard); calls `emitAuditEvent` inside a transaction.
- Idempotency-Key header = `event_id` (UUIDv7); handler upserts on conflict (event already in outbox = 200 OK without duplicate insert).
- Python `compliance_client.py`: stdlib `urllib.request` (no httpx dep — keep parity with existing server.py:972-994 `_log_invocation` template) OR adopt `httpx.AsyncClient` if other Phase 3 work needs async patterns; implementer picks at implementation time. 3-second timeout; 3-attempt retry with exponential backoff on 5xx/429; idempotent via Idempotency-Key.
- Env snapshot: capture `THINKWORK_API_URL` + `API_AUTH_SECRET` at agent-coroutine entry (NEVER re-read `os.environ` inside retry loop) — per `feedback_completion_callback_snapshot_pattern`.
- Initial Strands call sites: workspace-file-edit S3 event handler that bridges to compliance (when an agent edits its AGENTS.md, the S3-event-driven processor also calls `compliance_client.emit_event('workspace.governance_file_edited', ...)`).

**Patterns to follow:**
- `packages/api/src/handlers/skills.ts` (narrow REST endpoint w/ API_AUTH_SECRET auth)
- `packages/agentcore-strands/agent-container/container-sources/server.py:972-994` (urllib pattern, 3s timeout, exception swallow for telemetry; Phase 3 control-evidence variant raises so the originating tool call fails)
- `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md`
- `docs/solutions/workflow-issues/agentcore-completion-callback-env-shadowing-2026-04-25.md`

**Test scenarios:**
- *Happy path:* Strands runtime POSTs `agent.skills_changed` event → 202 Accepted; outbox row visible; drainer writes audit_events row.
- *Edge case:* Same Idempotency-Key replayed → 200 OK, no duplicate outbox row.
- *Error path:* Wrong `API_AUTH_SECRET` → 401; nothing inserted.
- *Error path:* `actorUserId` not in `tenantId` → 403; nothing inserted (cross-tenant guard).
- *Edge case:* `THINKWORK_API_URL` env-shadowed mid-turn → snapshot held at coroutine entry still resolves correctly (regression test for env-shadowing).
- *Integration:* Mock-Yoga test asserts request shape; real-Yoga integration test (run via `uv run pytest`) asserts end-to-end with actual Aurora dev DB.

**Verification:** Both vitest and pytest test files green; deployed dev test shows `compliance.audit_events` rows attributable to a Strands-initiated action; CloudWatch logs from Yoga show "compliance event accepted" for each Strands POST.

---

### Phase C — Anchor + verify

- U7. **S3 Object Lock anchor bucket Terraform module**

**Goal:** New Terraform module for the per-stage anchor bucket: Object Lock enabled (Governance mode in dev/staging, Compliance in prod), KMS key, IAM policies for anchor Lambda, server access logging.

**Requirements:** R13.

**Dependencies:** None (parallel with Phase A/B).

**Files:**
- Create: `terraform/modules/data/compliance-audit-bucket/main.tf`, `variables.tf`, `outputs.tf`, `README.md`
- Modify: `terraform/modules/thinkwork/main.tf` (call new module; thread bucket name + KMS key ARN through to `lambda-api`)

**Approach:**
- Bucket name: `thinkwork-${stage}-compliance-anchors`. Versioning required for Object Lock. Object Lock mode variable: default `GOVERNANCE` for dev/staging, `COMPLIANCE` for prod (string variable; switch-flip in tfvars at audit time).
- Default retention: 365 days (12 months).
- KMS key with separate alias `alias/thinkwork-${stage}-compliance-anchors`; rotation enabled.
- Server access logging to a separate logging bucket prefix `compliance-anchor-access-logs/`.
- IAM policy template for the anchor Lambda: `s3:PutObject`, `s3:PutObjectRetention` on `${bucket}/anchors/*` only. **Explicitly deny** `s3:BypassGovernanceRetention` and `s3:PutObjectLegalHold` (only break-glass human role gets those, separately).
- Bucket policy: deny `s3:DeleteObject` from any principal.
- A separate non-Object-Lock prefix `proofs/` for per-tenant slice bundles (slices are derivable; not regulator-grade WORM).
- Terraform `precondition` validating `retain_until_date` is in the future (defense against typo accidents).

**Patterns to follow:**
- `terraform/modules/data/s3-buckets/main.tf:29-91` (bucket + policy + outputs)
- Per-stage tfvars pattern in `terraform/examples/greenfield/terraform.tfvars`

**Test scenarios:**
- *Happy path:* `terraform plan` shows new bucket + KMS + IAM policy; mode = GOVERNANCE in dev; retention = 365 days.
- *Error path:* Variable misconfigured to retention = 0 → `precondition` fails plan.
- *Manual smoke:* After apply in dev, attempt `aws s3 rm s3://thinkwork-dev-compliance-anchors/anchors/test.json --bypass-governance-retention` → fails because Lambda role lacks the bypass permission. With break-glass role: succeeds (Governance allows it).
- *Manual smoke:* Verify mode switches to COMPLIANCE when prod tfvars sets `compliance_anchor_mode = "COMPLIANCE"`. Covers AE7.

**Verification:** `aws s3api get-object-lock-configuration --bucket thinkwork-dev-compliance-anchors` shows `ObjectLockEnabled: Enabled`, `Mode: GOVERNANCE`, `Days: 365`; Lambda role policy lists only the expected actions.

---

- U8. **Anchor Lambda (inert→live) + EventBridge Scheduler + watchdog alarm**

**Goal:** Periodic Lambda computing global Merkle tree from un-anchored audit events, writing per-tenant proof slices, anchoring the global root to S3 Object Lock. Inert→live seam swap across two PRs.

**Requirements:** R13.

**Dependencies:** U1, U4 (drained audit_events to read), U7 (bucket).

**Files:**
- Create: `packages/lambda/compliance-anchor.ts`
- Modify: `scripts/build-lambdas.sh` (allowlist entry; needs `@aws-sdk/client-s3` and `@aws-sdk/client-scheduler` — likely standard externalize, no bundle flag)
- Modify: `terraform/modules/app/lambda-api/handlers.tf` (anchor Lambda + EventBridge Scheduler `rate(15 minutes)` + watchdog Lambda + CloudWatch alarm)
- Create: `packages/lambda/compliance-anchor-watchdog.ts` (separate Lambda checking S3 LastModified)
- Test: `packages/api/test/integration/compliance-anchor.test.ts`

**Approach:**
- Two-PR delivery (per inert→live seam-swap pattern):
  - **U8a (inert PR):** Anchor Lambda computes global Merkle root + per-tenant slices; calls `_anchor_fn_inert(merkle_root, tenant_slices) → {anchored: false, dispatched: true, merkle_root, tenant_count, anchored_event_count, ...}`. EventBridge schedule active. Watchdog alarm wired against the inert anchor's LastModified — but watchdog doesn't check S3 yet (returns `anchored: false`). Smoke surface: response-payload `dispatched: true` is what deploy smoke pins (per `feedback_smoke_pin_dispatch_status_in_response`).
  - **U8b (live PR):** Replace `_anchor_fn_inert` with real `_anchor_fn_live` that PutObject's the anchor JSON to `s3://thinkwork-${stage}-compliance-anchors/anchors/cadence-{cadence_id}.json` with `ObjectLockMode={GOVERNANCE|COMPLIANCE}`, `ObjectLockRetainUntilDate=now+365days`. Per-tenant slices PutObject to `proofs/tenant-{tenant_id}/cadence-{cadence_id}.json` (no Object Lock). Body-swap safety test asserts the S3 SDK was actually called.
- Cadence ID: monotonically increasing integer or UUIDv7 — implementer chooses.
- Merkle tree: leaves = chain heads per tenant since last anchor; node hash = sha256(left || right). Verifier needs only the leaf + path + root.
- Watchdog Lambda: runs every 5 min; checks `LastModified` of `anchors/cadence-*.json` newest object; if gap > 30 min, emits CloudWatch metric `ComplianceAnchorGap`; alarm at threshold = 1.

**Execution note:** U8a + U8b are two separate PRs. U8a soaks for at least one full deploy cycle (24h) before U8b ships, so the inert path is observable in dev before WORM bytes start landing.

**Patterns to follow:**
- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md`
- `packages/lambda/job-trigger.ts` (scheduled Lambda boot pattern)

**Test scenarios:**
- *Happy path U8a:* Lambda runs → reads N audit_events since last cadence_id → computes Merkle root → returns `{anchored: false, dispatched: true, merkle_root: 'abc...', tenant_count: 3, anchored_event_count: 42}` → deploy smoke asserts `dispatched: true`.
- *Happy path U8b:* Lambda runs → S3 SDK PutObject called with correct ObjectLockMode + RetainUntilDate; per-tenant slice files written to `proofs/`; response includes anchor S3 key.
- *Edge case:* No new events since last anchor → Lambda returns `{anchored: 'skipped', reason: 'no events'}` (don't write empty anchors).
- *Error path:* S3 PutObject 403 (e.g., KMS misconfig) → Lambda raises; CloudWatch alarm fires after watchdog gap detection.
- *Integration (covers AE7):* After anchor write in U8b dev, run `aws s3api delete-object` → fails with retention policy block.
- *Body-swap safety:* Test fails if `_anchor_fn` is replaced with a hardcoded `{anchored: true}` stub that doesn't actually call S3 (asserts S3 client was invoked).

**Verification:** U8a: dev deploy + 1 hour wait → CloudWatch logs show 4 invocations of anchor Lambda with `dispatched: true`; watchdog Lambda runs but `Mode: inert` flag prevents alarm. U8b: same + actual anchor JSON visible in S3 console; deletion attempt blocked.

---

- U9. **Standalone verifier CLI**

**Goal:** Open-source-compatible Python CLI auditor can run against anchor + slice bundles + chain CSV to verify chain integrity and anchor consistency, without DB credentials.

**Requirements:** R13.

**Dependencies:** U8 (anchor bundle format finalized).

**Files:**
- Create: `tools/audit-verifier/pyproject.toml`, `README.md`, `LICENSE` (Apache-2.0)
- Create: `tools/audit-verifier/audit_verifier/cli.py`, `verify.py`, `merkle.py`
- Create: `tools/audit-verifier/tests/test_verify.py`
- Modify: top-level `pnpm-workspace.yaml` and `pyproject.toml` if `tools/` needs uv workspace registration (likely yes).

**Approach:**
- CLI: `audit-verifier --anchor anchor.json --slice slice.json --chain chain.csv` → `OK` (exit 0) or `FAIL: <diagnostic>` (exit non-zero).
- `verify.py`: re-derive Merkle leaf from chain.csv tenant rows, walk proof_path[] to compute root, compare to anchor.global_root.
- `merkle.py`: standalone Merkle tree implementation (no AWS deps).
- Pin verifier version in anchor metadata field (`verifier_version: "v1.0.0"`); CLI refuses to verify anchors with newer version (forces auditor-side update).
- Reproducibility hint: anchor includes `hash_algorithm: "sha256"` so future algo changes are explicit.

**Patterns to follow:**
- AWS CLI / kubectl for argument parsing patterns (`argparse`).
- `tools/` as a sibling to `apps/`, `packages/` if not already conventional in this repo (verify and add to monorepo registration).

**Test scenarios:**
- *Happy path:* `audit-verifier --anchor a.json --slice s.json --chain c.csv` returns OK on a clean bundle.
- *Edge case:* Anchor + slice + chain from different cadence_ids → FAIL with clear diagnostic.
- *Error path:* Tampered chain row (modified payload) → FAIL: chain break at row {N}.
- *Error path:* Tampered anchor (modified global_root) → FAIL: anchor mismatch.
- *Error path:* Mismatched verifier version → CLI error before verification runs.

**Verification:** Pytest passes; manual run against U8b dev anchor + admin-exported slice + chain CSV returns OK; manual tamper test (edit one chain row) returns FAIL.

---

### Phase D — Admin UI

- U10. **Admin "Compliance" nav, routes, GraphQL read resolver, Events list + drawer**

**Goal:** Admin SPA Manage-group entry "Compliance"; route tree under `/compliance`; GraphQL types + read resolver using `compliance_reader` connection; Events list view (paginated, filterable) + per-event detail drawer.

**Requirements:** R7, R8, R11.

**Dependencies:** U2 (reader role), U4 (events to display).

**Files:**
- Modify: `apps/admin/src/components/Sidebar.tsx:249-256` (insert "Compliance" entry between People and Settings; icon = `FileCheck` from `lucide-react` to differentiate from Security Center's `Shield`)
- Create: `apps/admin/src/routes/_authed/_tenant/compliance/index.tsx` (Events list)
- Create: `apps/admin/src/routes/_authed/_tenant/compliance/$eventId.tsx` (detail drawer route)
- Modify: `apps/admin/src/routeTree.gen.ts` (regenerated by codegen)
- Create: `packages/database-pg/graphql/types/compliance.graphql` (types: `ComplianceEvent`, `ComplianceEventConnection`, `ComplianceEventFilter`, `Query.complianceEvents`, `Query.complianceEvent(id)`)
- Modify: `packages/api/src/graphql/resolvers/compliance/*.ts` (new resolver dir; uses dedicated `complianceReaderDb` Drizzle client connected via the read-only RDS Proxy endpoint)
- Modify: GraphQL codegen in `apps/cli`, `apps/admin`, `apps/mobile`, `packages/api` (regenerate after adding compliance.graphql)
- Run: `pnpm schema:build` (regenerates `terraform/schema.graphql` if subscriptions touch compliance — they don't in v1)
- Test: `apps/admin/src/__tests__/compliance-list.test.tsx`
- Test: `packages/api/src/graphql/resolvers/compliance/__tests__/events.test.ts`

**Approach:**
- Filters per origin P1: filter-by-event-type (multi-select prefix-grouped: `auth.*`, `agent.*`, `workspace.*`, `mcp.*`, `data.*`, `user.*`); filter-by-actor (typeahead resolving to actor_id via pseudonym lookup); filter-by-tenant (fixed to caller's tenant; not user-selectable in v1 single-tenant admin); filter-by-date-range (default last 7 days).
- Pagination: cursor-based on `(occurred_at, event_id)` for stable pagination at high volumes; default 50 rows per page.
- Default sort: newest-first (`occurred_at DESC`).
- Empty state: "No events match these filters" with link to docs explaining the starter slate; for new tenants with zero rows: "No events yet — events appear here when admins, users, or agents perform tracked actions."
- Loading state: skeleton rows.
- Error state: "Could not load events (request id: X)" with retry button.
- Detail drawer: 22-field envelope + payload viewer (collapsible JSON). `payload_redacted_fields` highlighted prominently. S3-spilled payloads fetched on demand (drawer shows "Loading large payload..." until fetch resolves). Verification status section showing this row's `event_hash` + chain position + last anchor reference.
- Resolver: every read derives `tenantId` from queried row; never trusts `ctx.auth.tenantId` (per `every-admin-mutation-requires-requiretenantadmin-2026-04-22` learning).

**Patterns to follow:**
- `apps/admin/src/routes/_authed/_tenant/threads/index.tsx` and `$threadId.tsx` (canonical list+drawer with urql)
- `packages/api/src/graphql/resolvers/core/resolve-auth-user.ts` (tenant resolution)
- `apps/admin/src/components/Sidebar.tsx:249-256` (Manage group insertion point)

**Test scenarios:**
- *Happy path (covers AE3):* Admin filters by `event_type=agent.skills_changed` over last 7 days → list shows only matching events; click row → drawer shows actor identity + full payload.
- *Edge case:* New tenant with zero events → empty state copy renders.
- *Edge case:* Filter combinations — `event_type=auth.signin.failure AND actor=jane@acme.com AND date_range=last_24h` → correct subset.
- *Error path:* Cross-tenant read attempt (admin from tenant A queries event from tenant B by direct GraphQL call) → resolver rejects with permission denied (covers tenant-isolation invariant).
- *Edge case:* Event with S3-spilled payload → drawer fetches signed URL on open; loading + error states render.
- *Integration:* End-to-end with real urql + GraphQL → list, filter, drilldown all work in dev.

**Verification:** Admin SPA dev (`pnpm --filter @thinkwork/admin dev`) shows new "Compliance" entry; clicking through to a real event from U5/U6 writers confirms full envelope renders.

---

- U11. **Async export job: tables, mutation, runner Lambda, admin Exports page**

**Goal:** Async CSV/JSON export of filtered audit events; presigned-URL delivery; admin Exports page.

**Requirements:** R9.

**Dependencies:** U10.

**Files:**
- Modify: `packages/database-pg/graphql/types/compliance.graphql` (add `Mutation.createAuditExport(filter, format)`, `Query.auditExports`, `Subscription.auditExportStatus(jobId)`)
- Modify: `packages/api/src/graphql/resolvers/compliance/exports.ts` (new mutation + query + subscription wiring through AppSync if subscription added; otherwise polling-only in v1)
- Create: `packages/lambda/compliance-export-runner.ts` (paginates Aurora cursor, streams CSV/NDJSON to S3 multipart, updates `export_jobs.status`)
- Modify: `scripts/build-lambdas.sh` (allowlist entry)
- Modify: `terraform/modules/app/lambda-api/handlers.tf` (handler + SQS trigger + IAM)
- Create: `terraform/modules/data/compliance-exports-bucket/` (separate S3 bucket for export artifacts; lifecycle rule deletes after 7 days; not Object Lock)
- Create: `apps/admin/src/routes/_authed/_tenant/compliance/exports/index.tsx`
- Modify: GraphQL codegen consumers
- Test: `packages/api/test/integration/compliance-exports.test.ts`
- Test: `apps/admin/src/__tests__/compliance-exports.test.tsx`

**Approach:**
- Mutation `createAuditExport(filter, format)`: validates filter (max 90-day range), checks rate limit (10/hour per admin), inserts `compliance.export_jobs` row in 'queued' state, sends SQS message, returns `jobId`.
- Runner Lambda: receives SQS message, opens cursor for filter, streams rows to S3 multipart upload, updates `status = 'running' → 'complete'` with final `s3_key`. On completion: generates 15-min presigned URL, stores in `presigned_url` column.
- Admin Exports page: list of jobs (status, requested_at, format, filter summary, download button when complete), polls every 3 seconds for in-flight jobs.
- Each export emits its own `data.export_initiated` audit event with the filter as payload.
- 4 KB hard cap on filter string length to prevent payload-balloon attacks.
- Rate limit: 10 exports/hour per admin user, enforced at mutation entry via Redis-or-DB-based counter (implementer chooses; existing rate-limit pattern in repo if any).

**Patterns to follow:**
- `apps/admin/src/routes/_authed/_tenant/threads/index.tsx` (table + polling pattern)
- Existing presigned-URL surfaces (none yet in compliance, find adjacent example)
- `docs/solutions/design-patterns/audit-existing-ui-and-data-model-before-parallel-build-2026-04-28.md` (renderer-branch pattern for typed payloads, if useful for export rendering)

**Test scenarios:**
- *Happy path:* Admin requests CSV export of `event_type=agent.skills_changed` last 30 days → job appears in list with status `queued` → progresses to `running` → `complete`; download link works; CSV opens with full envelope.
- *Edge case:* Filter date range = 91 days → mutation rejects with "max 90 day range".
- *Edge case:* 11th export request in an hour → rate-limit error.
- *Error path:* Aurora connection drops mid-stream → job marked `failed` with error message; admin sees failure in UI.
- *Edge case:* JSON format produces NDJSON (one event per line, valid JSON object each); CSV format quotes/escapes fields with newlines correctly.
- *Integration:* End-to-end on dev — filter + create + poll + download → CSV opens in spreadsheet correctly.

**Verification:** Admin SPA dev shows Exports page; trigger one export end-to-end; downloaded file contains expected rows in expected format; `data.export_initiated` audit event row visible for the export request.

---

## System-Wide Impact

- **Interaction graph:** Every resolver/handler in the 10-event slate now invokes `emitAuditEvent` inside its primary transaction. Strands runtime gains a new HTTP outbound call site. EventBridge Scheduler adds a 15-min anchor cadence; watchdog Lambda runs every 5 min. The graphql-http Lambda gains a new REST handler + a new GraphQL subtree.
- **Error propagation:** Control-evidence audit failures roll back originating mutations and surface user-visible errors ("action could not be safely audited"). Telemetry audit failures log + emit operator alerts but do not block originating actions. Outbox drainer Lambda failures land rows in SQS DLQ; backlog grows in `audit_outbox` until drainer recovers.
- **State lifecycle risks:** Outbox + drained rows could grow unbounded; Phase 4 retention enforcement will cap. For Phase 3, monitor `audit_outbox` row count + `audit_events` size in CloudWatch; add alarms if growth exceeds X rows/hour. Anchor objects in Object Lock cannot be deleted — every regression requiring re-anchoring leaves the prior cadence anchor in place.
- **API surface parity:** GraphQL Compliance types added across 4 codegen consumers; REST `POST /api/compliance/events` added; admin Sidebar gains one entry. No CLI changes (admin-only feature).
- **Integration coverage:** Every audit event emit must land an actual outbox row (not just a unit-tested call); the drainer must process it and the row must appear in `audit_events` with valid chain. Cross-runtime: Strands → Yoga → outbox → drainer → events. End-to-end integration tests exercise the full chain, not unit-level mocks.
- **Unchanged invariants:** `activity_log` writers and `tenant_policy_events` writers continue to work unchanged; their consumers continue to read from `public.*` tables. Cognito + Google OAuth federation paths unchanged. Strands runtime + AgentCore Evaluations unchanged. Routines + scheduled_jobs orchestration paths unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Hand-rolled migration for `compliance.*` not applied to dev before merge → drift gate fails the deploy (PR-833/#835 precedent) | U1 execution note explicitly mandates psql apply before PR open; verify exit 0 manually |
| Outbox grows unbounded if drainer Lambda fails for extended period | CloudWatch alarm on `audit_outbox` row count; SQS DLQ catches poison rows; reserved concurrency = 1 means recovery is naturally serial |
| S3 Object Lock Compliance mode irreversibly bricks future bucket migration | Use Governance mode in dev/staging; flip to Compliance only at audit time per Decision #2; document the one-way-ness in U7 README |
| Cross-tenant data leak via misconfigured admin resolver | Resolver derives `tenantId` from row, never `ctx.auth`; dedicated test scenarios verify cross-tenant rejection |
| Strands runtime audit emits failing silently due to env shadowing | Snapshot env at coroutine entry (U6 execution note); regression test verifies snapshot |
| Allow-list redaction registry drifts from actual event-type vocabulary | Each new event type requires a PR to `redaction.ts`; reviewer sign-off is the gate; unknown event types throw at write time |
| Anchor Lambda failure goes undetected (attacker disables job) | Watchdog Lambda + CloudWatch alarm on anchor-gap > 30 min (U8 design); verifier CLI also reports anchor-gap for any tenant report |
| Verifier CLI bundled with thinkwork code creates auditor-trust concern | Standalone repo or `tools/` subdirectory with own LICENSE (Apache-2.0); auditor reads source themselves |
| Per-event allow-list migration burden when adding new event types post-Phase-3 | Pattern is intentional — every new event type is a deliberate review-time decision; Phase 4 may codify a registry tool |
| Phase 5 AI-specific events (tool calls, memory recall) flood the log | Schema reserves `policy.*` + `approval.recorded` event types; volume questions are Phase 5's to answer; Phase 3 builds the substrate, not the volume controls |
| GDPR RTBF erasure breaks chain verification | Chain hashes opaque actor_id only; pseudonym table erasure leaves chain intact; document in DPIA (Phase 4) |
| Async export Lambda runs >15 min for very large filters | Hard 90-day max range + future Glue/Athena fallback; monitor 90th-percentile export duration in CloudWatch |
| First Compliance audit deploy includes 11 implementation units shipped over multiple PRs; integration regressions possible | Each unit ships with integration tests; ce-work serial dispatch by default; deploy.yml drift gate catches schema-Lambda mismatches |

---

## Documentation / Operational Notes

- **Runbooks:** Document the dev → audit-time mode flip for S3 Object Lock (Governance → Compliance) in `docs/runbooks/compliance-audit-prep.md` (create at U7).
- **DPIA placeholder:** `docs/compliance/dpia-actor-pseudonym.md` documenting Decision #5 — for Phase 4 auditor engagement.
- **Verifier README:** Setup, usage, sample anchor + slice + chain bundle for auditors to test against.
- **CloudWatch dashboards:** New section in operator dashboard for `audit_outbox` row count, drainer Lambda invocations, anchor cadence count, watchdog alarm state.
- **Memory updates after Phase 3 ships:** Update `project_system_workflows_revert_compliance_reframe.md` to mark Phase 3 complete; capture any new institutional learnings (cross-schema migration patterns, S3 Object Lock first-use, GDPR pseudonymization first-use) in `docs/solutions/`.
- **Phase 4 readiness gate:** Before engaging an auditor, complete the dev → prod stage chain for compliance migrations (per scope-boundary deferral on auto-staging) and validate Compliance mode flip on a non-prod sacrificial stage first.

---

## Phased Delivery

### Phase A — Foundation (U1, U2)
Schema + roles. Two PRs. U1 must apply to dev BEFORE merge per drift gate. U2 follows immediately.

### Phase B — Write path (U3, U4, U5, U6)
Helper + drainer + slate writers + Strands cross-runtime path. Four PRs. U3 unblocks U5/U6; U4 is independent but needed for end-to-end visibility. Recommend ce-work serial dispatch within this phase.

### Phase C — Anchor + verify (U7, U8a, U8b, U9)
S3 bucket + anchor Lambda inert + anchor Lambda live + verifier CLI. Four PRs. U7 is independent (parallel-able with B). U8a soaks ≥ 24h before U8b. U9 lands after U8b finalizes anchor format.

### Phase D — Admin UI (U10, U11)
Nav + list + drawer + exports. Two PRs. U10 first; U11 follows.

Total: **12 PRs across 4 phases**. Ship-pace target: Phase A within 1 day of /ce-work start; Phase B within 3 days; Phase C within 2 days (gated by U8 soak); Phase D within 2 days. End-to-end ≈ 8-10 working days, with parallelization opportunities in Phase B.

---

## Sources & References

- **Origin document:** `docs/brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md`
- **Parent reframe memory:** `~/.claude/projects/-Users-ericodom-Projects-thinkwork/memory/project_system_workflows_revert_compliance_reframe.md`
- **Sibling future-phase memory:** `~/.claude/projects/-Users-ericodom-Projects-thinkwork/memory/project_soc2_type2_ai_strategic_horizon.md`
- **Phase 2 progression PRs (recently merged):** #845 (Phase 1), #847, #848 (Phase 2 U1-U2), #851/#853 (U3), #855/#857 (U4), #871/#872 (U5), #873/#878 (U6)
- **Repo learnings:**
  - `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`
  - `docs/solutions/workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md`
  - `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md`
  - `docs/solutions/workflow-issues/agentcore-completion-callback-env-shadowing-2026-04-25.md`
  - `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md`
  - `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md`
  - `docs/solutions/runtime-errors/lambda-web-adapter-in-flight-promise-lifecycle-2026-05-06.md`
- **External:**
  - AWS Prescriptive Guidance: Transactional outbox — https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html
  - S3 Object Lock — https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html
  - Aurora PostgreSQL RBAC — https://aws.amazon.com/blogs/database/amazon-aurora-postgresql-database-authorization-using-role-based-access-control/
  - Trillian / verifiable data structures — https://transparency.dev/verifiable-data-structures/
  - Drizzle pgSchema — https://orm.drizzle.team/docs/schemas

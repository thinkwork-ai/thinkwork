---
title: "feat(compliance): U3 — Compliance write helper + redaction allow-list (focused execution overlay)"
type: feat
status: active
date: 2026-05-07
origin: docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md
---

# feat(compliance): U3 — Compliance write helper + redaction allow-list

## Summary

Focused execution overlay for U3 of the master Phase 3 plan. Ships the in-process write helper + redaction allow-list registry that resolvers and Lambda handlers will eventually call inside their existing `db.transaction` blocks (U5 wires the consumers). Structurally inert PR per the master plan's "Ship inert pattern" — full unit + integration test coverage proves the helper inserts correctly into `compliance.audit_outbox`, but no production code path calls it yet.

---

## Problem Frame

Phase 3 needs a single, well-tested entry point for control-evidence and telemetry audit writes. The helper's job is small but load-bearing: redact-before-insert (allow-list per event type), generate UUIDv7 `event_id`, build the canonical envelope, INSERT into `compliance.audit_outbox` inside the caller's transaction so audit + business write are atomic. The U4 drainer Lambda then chains the hash and copies to `compliance.audit_events` — but the helper itself has no awareness of chaining or anchoring; it just lands a redacted, validated row in the outbox.

(See origin: `docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md` U3 + Decisions #1, #5, #6.)

---

## Requirements

Carried from master plan U3 (origin doc):

- R5. Append-only audit-event log with the canonical envelope; oversized payloads spill to S3.
- R6. Two-tier write semantics. The helper itself doesn't pick the tier; the call-site pattern does. Helper provides the same surface for both.
- R10. 10-event SOC2 Type 1 starter slate. The 14 string constants (10 starter + already-in-`compliance.ts` reservations) are imported, not redeclared.
- R14. Schema reserves Phase 6 governance event types. Helper accepts these types but no production code emits them.
- R15. Redaction-before-write with field-level sanitization; `payload_redacted_fields` records what was suppressed.

---

## Scope Boundaries

- **Wiring resolvers / handlers to call `emitAuditEvent`** — that's U5. This PR ships the helper + tests with zero call sites in production code.
- **Outbox drainer Lambda** — U4. Helper writes to outbox; drainer (separate unit) chains hash + copies to events.
- **Strands runtime emit path** — U6. Cross-runtime path uses a different REST endpoint, not this helper.
- **S3 spillover for oversize payloads** — defer the actual S3 PutObject. Helper accepts a `payload_oversize_s3_key` field passthrough but doesn't upload anything itself; consumers can pass a pre-uploaded key.
- **Anchoring + verifier** — U7-U9.

### Deferred to Follow-Up Work

- **Field-level PII classification** beyond secret regex matching — defer to Phase 4 (auditor engagement). U3's redaction is allow-list-driven (deny-by-default per event type); secret patterns are an additional defense-in-depth layer matching the existing `sandbox-log-scrubber.ts` precedent. Full PII classification taxonomy (HIPAA / GDPR-grade) waits for Phase 4 auditor input.
- **Oversize payload S3 spillover implementation** — schema field already exists; actual upload behavior ships when a real call site needs it (U5 or later).

---

## Context & Research

### Relevant Code and Patterns

- **Canonical in-transaction event insert pattern** — `packages/api/src/graphql/resolvers/core/updateTenantPolicy.mutation.ts:73-100`. The shape `db.transaction(async (tx) => { tx.insert(events).values([...]) })` is what `emitAuditEvent(tx, payload)` must integrate cleanly with.
- **Existing redaction precedent** — `packages/lambda/sandbox-log-scrubber.ts:39-58`. Secret-pattern set (Authorization Bearer, JWT, gh*_, xox*-, ya29.*). U3 extends with allow-list per event type; falls back to secret-pattern scrub on fields that pass the allow-list but match a secret regex.
- **Existing event-type constants** — `packages/database-pg/src/schema/compliance.ts` already exports `COMPLIANCE_EVENT_TYPES` (14 entries: 10 Phase 3 starter + 5 Phase 6 reservations) + `COMPLIANCE_ACTOR_TYPES` (3 entries) + the `auditOutbox` Drizzle table. Import — do not redeclare.
- **Auth + tenant resolution (caller-side, NOT inside the helper)** — `packages/api/src/graphql/resolvers/core/resolve-auth-user.ts` provides `resolveCallerFromAuth(ctx.auth)` and `resolveCallerTenantId(ctx)`. Helper takes `tenantId` + `actorId` as params; caller resolves them. Per CLAUDE.md, `ctx.auth.tenantId` is null for Google-federated users until the Cognito pre-token trigger lands.
- **Test infrastructure** — `packages/api/src/**/*.test.ts` for unit (vitest), `packages/api/test/integration/**/*.test.ts` for integration. Integration tests reach the dev Aurora cluster via the master `thinkwork_admin` role (compliance role separation from U2 won't apply until U2 PR #887 merges + the bootstrap CI step runs).

### Institutional Learnings

- `feedback_oauth_tenant_resolver` (memory) — `resolveCallerTenantId` fallback for Google-federated users. The helper takes `tenantId` from the caller; the caller resolves it correctly.
- `project_async_retry_idempotency_lessons` (memory) — Helper sits in transactional context; no retry needed at the helper layer. The caller's transaction commits as a unit; outbox row is durable on commit.
- `feedback_smoke_pin_dispatch_status_in_response` (memory) — The helper returns the inserted `event_id` so callers (and smoke tests) can pin successful dispatch.
- `feedback_communication_style` — Brief, direct.

### External References

- UUIDv7 spec (RFC 9562) — https://datatracker.ietf.org/doc/rfc9562/
- `uuidv7` npm package — https://www.npmjs.com/package/uuidv7 (stable, time-ordered, 100ns precision)

---

## Key Technical Decisions

1. **Helper takes the caller's `tx` as a parameter; never opens its own transaction.** Signature: `emitAuditEvent(tx, payload) → Promise<{ eventId: string; outboxId: string; redactedFields: string[] }>`. **Why:** the master plan's Decision #1 commits to "same-transaction outbox; control-evidence action fails if outbox insert fails." Opening a nested transaction would break that semantic — the caller's primary mutation could commit while the audit failed silently. The caller controls the transactional boundary; the helper just inserts.

2. **UUIDv7 via the `uuidv7` npm package, not hand-rolled.** Adds one runtime dependency. **Why:** RFC 9562 UUIDv7 has subtle correctness traps (clock skew, monotonic sub-millisecond ordering, embedded random bits). The library has been audited; rolling our own would be cargo-culted code. Time-ordered UUIDs make `audit_outbox` poll-ordering natural for the U4 drainer.

3. **Redaction allow-list per event type, defined in `redaction.ts` as a static const map.** Each event type maps to an `allowedFields: ReadonlySet<string>` plus a `payloadShape` discriminator (used for type narrowing in TypeScript callers). Unknown event types throw at write time — review-time gate, not runtime. **Why:** matches master plan Decision #6. Allow-list catches "new event type with secret-like field" cases at PR review time. Block-list / regex would fail open on novel field names like `apiKey_v2` or `secret_token`. Per the security review of U2 (SEC-009 advisory), the registry is the architectural cornerstone of redaction.

4. **Field-level sanitization layered on top of allow-list:** for any field that passes the allow-list AND has type `string`, apply: cap length at 4096 bytes, strip control chars except `\n` and `\t`, JSON-encode (never raw concat in any downstream renderer), reject invalid UTF-8 with replacement char `�`. Governance file diff payloads (R10's `workspace.governance_file_edited`) use a special shape: `{ file, content_sha256, preview: first 2 KB }` — never raw full content. **Why:** allow-list catches structural leakage; sanitization catches injection / oversize / control-char attacks even on permitted fields.

5. **Source field is a typed enum: `'graphql' | 'lambda' | 'strands' | 'scheduler' | 'system'`.** The helper validates the source at runtime against this set; unknown values throw. **Why:** the master plan's envelope (R5) calls source out as a required field. Constraining it at the helper layer prevents callers from inventing variant strings that auditors would later have to reconcile.

6. **The helper does not consult `actor_pseudonym`.** Caller passes `actorId` (already resolved to opaque UUID via the `actor_pseudonym` table); helper trusts it. **Why:** resolution is a different concern (the U10 admin reader resolves actorId → user; the U3 emit path just records the opaque ID). Mixing resolution into the helper would create a write-path read dependency on a table the writer role won't have permission to SELECT (per U2's GRANT matrix: `compliance_writer` has INSERT-only).

7. **Helper returns `{ eventId, outboxId, redactedFields }` for caller smoke pinning.** Callers can assert `redactedFields.length === 0` for unredacted payloads, or include the eventId in their response payload for downstream verification. **Why:** matches `feedback_smoke_pin_dispatch_status_in_response`. The smoke surface is the response shape, not a CloudWatch log filter.

8. **Module structure:** `packages/api/src/lib/compliance/{emit.ts, redaction.ts, event-schemas.ts, index.ts}`. `emit.ts` has the helper. `redaction.ts` has the per-event-type allow-list and sanitization functions. `event-schemas.ts` has the per-event-type payload TS interfaces (one per event type). `index.ts` re-exports the public API. **Why:** matches the existing `packages/api/src/lib/<feature>/` convention (e.g., `lib/derive-agent-skills.ts`, `lib/workspace-files.ts`). Co-located unit tests in `__tests__/`.

9. **Integration test connects via `thinkwork_admin` (master role)** for U3, not `compliance_writer`. **Why:** until U2 PR #887 merges + the deploy CI bootstrap runs, the writer role doesn't exist in dev. The test asserts the helper's transactional behavior + redaction correctness; role-permission boundaries are exercised in U5's integration tests (when callers actually use the writer secret).

---

## Open Questions

### Resolved During Planning

- *UUIDv7 source: hand-roll vs library*: library (`uuidv7` npm package) per Decision #2.
- *Allow-list registry shape: const map vs zod schemas vs custom DSL*: const map of `{ allowedFields: ReadonlySet<string>, sanitize?: (raw: object) => object }` per event type. Zod adds runtime parse overhead for what is structurally a name-set check.
- *Redaction order vs canonicalization*: redact first (drop disallowed fields, sanitize string values), then canonicalize for the drainer's hashing. The drainer (U4) handles canonicalization + hash; helper just stores the redacted payload.
- *Source field constraint*: typed enum (Decision #5).
- *Helper return shape*: `{ eventId, outboxId, redactedFields }` per Decision #7.

### Deferred to Implementation

- Exact TypeScript narrowing strategy for event-type-discriminated payload types — implementer chooses between discriminated unions (clean ergonomics, TS-friendly), generic indexed access (less verbose, more type assertions needed), or `as const` on individual schemas. Functional outcome is the same.
- Whether to bundle `uuidv7` into the graphql-http Lambda esbuild output (likely yes; it's small and pure-JS — no native deps that would force `BUNDLED_AGENTCORE_ESBUILD_FLAGS`).
- Fixture data shape for redaction tests — start with literal object literals; if they balloon, extract to a `__fixtures__/` subdirectory.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Caller (resolver or Lambda handler) — same transaction                  │
└─────────────────────────────────────────────────────────────────────────┘

    db.transaction(async (tx) => {
      // primary business write
      const result = await tx.update(...).where(...).returning();

      // audit write — same tx, fail-closed
      await emitAuditEvent(tx, {
        eventType: 'agent.skills_changed',
        tenantId,                          // resolved by caller
        actorId,                           // opaque, resolved by caller
        source: 'graphql',
        payload: { agentId, skillIds },    // raw — helper redacts
        controlIds: ['CC8.1'],             // optional, per starter slate map
      });

      return result;
    });

┌─────────────────────────────────────────────────────────────────────────┐
│ emit.ts — what happens inside the helper                                │
└─────────────────────────────────────────────────────────────────────────┘

    1. Validate eventType against COMPLIANCE_EVENT_TYPES (throw if unknown).
    2. Validate source against the typed enum.
    3. Generate event_id = uuidv7().
    4. Look up redaction schema for eventType in redaction.ts.
       → If event-type has no schema entry: throw (forces PR review).
    5. Apply redaction:
         → Drop fields not in allowedFields; record in redactedFields[].
         → For each remaining string field: sanitize (length cap, control
           chars, UTF-8, JSON-encode safety).
         → Run secret-pattern scrub on retained string values; replace
           matches with `<REDACTED:secret>`; record in redactedFields[].
    6. Build envelope (22 fields per R5 + outbox_id passthrough).
    7. tx.insert(auditOutbox).values(envelope) — fails the caller's tx
       if it errors (control-evidence semantics).
    8. Return { eventId, outboxId, redactedFields }.

┌─────────────────────────────────────────────────────────────────────────┐
│ redaction.ts — registry shape                                           │
└─────────────────────────────────────────────────────────────────────────┘

    EVENT_REDACTION_SCHEMAS: Record<EventType, RedactionSchema>
      where RedactionSchema = {
        allowedFields: ReadonlySet<string>;
        // Optional pre-redaction transform (e.g., for governance file diffs:
        // replace raw `content` with `content_sha256` + 2 KB `preview`).
        preTransform?: (raw: object) => object;
      }

    Example:
      'agent.skills_changed': {
        allowedFields: new Set(['agentId', 'skillIds', 'previousSkillIds']),
      },
      'workspace.governance_file_edited': {
        allowedFields: new Set(['file', 'content_sha256', 'preview']),
        preTransform: (raw) => ({
          file: raw.file,
          content_sha256: sha256(raw.content),
          preview: raw.content.slice(0, 2048),
        }),
      },
```

---

## Implementation Units

- U1. **Event-type schemas + redaction allow-list registry**

**Goal:** Define per-event-type payload TS interfaces (one per event type in `COMPLIANCE_EVENT_TYPES`) and the redaction allow-list registry that drives the helper's drop-field logic.

**Requirements:** R10, R14, R15.

**Dependencies:** None (depends only on already-merged `compliance.ts` constants).

**Files:**
- Create: `packages/api/src/lib/compliance/event-schemas.ts` (TS interfaces per event type, discriminated union by `eventType`)
- Create: `packages/api/src/lib/compliance/redaction.ts` (registry + `redactPayload(eventType, raw) → { redacted, redactedFields }`, sanitization helpers)
- Test: `packages/api/src/lib/compliance/__tests__/redaction.test.ts`

**Approach:**
- `event-schemas.ts` exports `EVENT_PAYLOAD_SHAPES` const map keyed by event type. Each entry has the allow-list (`ReadonlySet<string>`) and an optional `preTransform`.
- `redaction.ts` exports `redactPayload(eventType, raw)` and `sanitizeStringField(value)` helpers. The function:
  1. Looks up the schema for the eventType. Throws if missing.
  2. Applies `preTransform` if defined (governance file diffs use this).
  3. Iterates raw object keys; drops any not in `allowedFields`; appends to `redactedFields[]`.
  4. For each retained string value, applies `sanitizeStringField` (length cap 4096 bytes, strip control chars except `\n\t`, replace invalid UTF-8 with `�`).
  5. Runs secret-pattern scrub on retained string values via the same regex set as `sandbox-log-scrubber.ts:39-58`. Replaced values get `<REDACTED:secret>` placeholder + name added to `redactedFields[]`.
  6. Returns `{ redacted: object, redactedFields: string[] }`.
- The 14 event types from `COMPLIANCE_EVENT_TYPES` each get an allow-list. Unknown event types in the registry throw.

**Patterns to follow:**
- `packages/lambda/sandbox-log-scrubber.ts:39-58` — secret-pattern set; can be imported or copied.
- `packages/database-pg/src/schema/compliance.ts` — `COMPLIANCE_EVENT_TYPES` constant; import + use as the TypeScript `EventType` union.

**Test scenarios:**
- *Happy path:* `redactPayload('agent.skills_changed', { agentId: 'a1', skillIds: ['s1'] })` returns `{ redacted: { agentId, skillIds }, redactedFields: [] }`.
- *Edge case (extra field dropped):* `redactPayload('agent.skills_changed', { agentId: 'a1', skillIds: ['s1'], apiKey: 'sk-...' })` drops `apiKey`, returns `redactedFields: ['apiKey']`.
- *Edge case (secret pattern in allowed field):* `redactPayload('user.invited', { email: 'a@b.com', token: 'ya29.abc' })` (where `token` is in allow-list) — secret regex matches, value replaced with `<REDACTED:secret>`, field added to `redactedFields` with `:scrubbed` suffix.
- *Edge case (governance file diff preTransform):* `redactPayload('workspace.governance_file_edited', { file: 'AGENTS.md', content: '<10 KB>' })` — preTransform replaces with `{ file, content_sha256, preview: 2 KB }`. Asserts `content` is gone, `content_sha256` is 64 hex chars, `preview.length === 2048`.
- *Edge case (string sanitization — length cap):* string field exceeding 4096 bytes is truncated to 4096; `redactedFields` records `<field>:truncated`.
- *Edge case (string sanitization — control chars):* string with `\x00`, `\x01`, `\x1F` interior chars has them stripped; `\n` and `\t` retained.
- *Edge case (invalid UTF-8):* a buffer with invalid byte sequences is normalized to `�`; payload remains valid JSON.
- *Error path (unknown event type):* `redactPayload('foo.bar' as EventType, {})` throws with a clear "no redaction schema for event type" error.
- *Error path (Phase 6 reserved type):* `redactPayload('policy.evaluated', {})` — schema entry exists with empty allow-list (R14 reservation); raw payload's fields are all dropped; doesn't throw.

**Verification:** Vitest 12+ assertions cover each scenario; redaction is purely functional + side-effect free; no DB or network access.

---

- U2. **`emitAuditEvent` helper**

**Goal:** The transactional in-process write helper. Takes the caller's `tx`, builds the envelope, redacts the payload via U1, inserts into `compliance.audit_outbox`. Returns identifiers for caller smoke pinning.

**Requirements:** R5, R6, R10, R14, R15.

**Dependencies:** U1 (uses `redactPayload`).

**Files:**
- Create: `packages/api/src/lib/compliance/emit.ts`
- Create: `packages/api/src/lib/compliance/index.ts` (re-exports `emitAuditEvent`, `redactPayload`, types)
- Modify: `packages/api/package.json` (add `uuidv7` dependency — recent stable version)
- Test: `packages/api/src/lib/compliance/__tests__/emit.test.ts`

**Approach:**
- Function signature (TS): takes `tx` (Drizzle PgTransaction or PgDatabase — accept both via union since callers might pass `db` directly for one-off writes), plus a `payload` object with the input envelope fields. Returns `Promise<EmitResult>`.
- Validation order:
  1. Validate `eventType` is in `COMPLIANCE_EVENT_TYPES`. Throw if not.
  2. Validate `source` is in the typed enum. Throw if not.
  3. Validate `actorType` is in `COMPLIANCE_ACTOR_TYPES`. Throw if not.
  4. Validate required fields present: `tenantId`, `actorId`, `eventType`, `actorType`, `source`. Optional with sensible defaults: `occurredAt = now()`, `payload = {}`, `controlIds = []`.
- Generate `eventId = uuidv7()` and `outboxId = uuidv7()`.
- Call `redactPayload(eventType, payload)` to get `{ redacted, redactedFields }`.
- Build the row using the Drizzle `auditOutbox` schema export from `packages/database-pg`. Map: `payload → redacted`, `payload_redacted_fields → redactedFields`, etc.
- `await tx.insert(auditOutbox).values(row)`. Failure propagates to caller's tx (rollback) — control-evidence semantics.
- Return `{ eventId, outboxId, redactedFields }`.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/core/updateTenantPolicy.mutation.ts:73-100` — canonical in-tx insert pattern.
- `packages/database-pg/src/schema/compliance.ts` — `auditOutbox` Drizzle table for `tx.insert()` typing.

**Test scenarios:**
- *Happy path:* Mock `tx` with a spy `insert` chain; call `emitAuditEvent(tx, valid payload)`. Assert: `insert` called with `auditOutbox`, values include `event_id` (UUIDv7 format), `outbox_id`, redacted payload, `redactedFields[]`. Return shape matches `{ eventId, outboxId, redactedFields }`.
- *Edge case (UUIDv7 monotonic):* call helper 100 times in tight loop; assert event_ids are sortable lexicographically and chronologically.
- *Edge case (occurredAt default):* payload omitting `occurredAt` defaults to current time; envelope's `occurred_at` is set within ±100ms of test start.
- *Error path (unknown eventType):* throws before any tx interaction.
- *Error path (invalid source):* throws before any tx interaction.
- *Error path (missing tenantId):* throws with field-name in error.
- *Error path (tx insert fails):* mock `tx.insert` throws; emitAuditEvent re-throws; assert no swallowing.
- *Edge case (Phase 6 reserved type passthrough):* `eventType: 'policy.evaluated'` — accepted; payload empty (registry has empty allow-list); row lands in outbox with `redactedFields` listing all input fields as dropped.

**Verification:** Vitest 8+ assertions; helper has zero side effects beyond the `tx.insert` call; happy-path call returns within 5ms (UUIDv7 + redaction + envelope build, no I/O).

---

- U3. **Integration test against dev `compliance.audit_outbox`**

**Goal:** End-to-end test that calls `emitAuditEvent` inside a real `db.transaction` against the dev Aurora cluster, asserts the row lands in `compliance.audit_outbox`, then rolls back to keep dev clean.

**Requirements:** R5, R6.

**Dependencies:** U1, U2.

**Files:**
- Create: `packages/api/test/integration/compliance-emit.test.ts`

**Approach:**
- Use the existing test infrastructure for connecting to dev Aurora (looks up master DB credentials via the same path the drift gate uses; existing integration tests like `packages/api/test/integration/skill-runs/critical-failure.test.ts` are the template).
- For each test, open a `db.transaction` that wraps the helper call + the assertion, then deliberately rolls back at the end so no real audit data persists in dev.
- Tests connect as `thinkwork_admin` (master role); compliance_writer/reader role boundaries are exercised in U5's integration tests, not here.

**Patterns to follow:**
- `packages/api/test/integration/skill-runs/critical-failure.test.ts` — transactional test with rollback.

**Test scenarios:**
- *Integration (covers R5, R6):* `db.transaction` calls `emitAuditEvent` with a Phase 3 starter slate event; SELECT inside the same tx finds the row in `compliance.audit_outbox` with all envelope fields populated correctly. Tx rolls back; row is gone post-test.
- *Integration (caller-tx failure → audit rollback):* `db.transaction` calls helper successfully, then deliberately throws an error in the same tx; assert the audit_outbox row is NOT persisted (rollback covers it). This is the control-evidence "fail-closed" semantic.
- *Integration (drainer-shape compatibility):* the row's columns match what the U4 drainer Lambda will SELECT (`event_id`, `tenant_id`, `event_type`, `payload`, `control_ids`, `payload_redacted_fields`, `enqueued_at`, `drained_at IS NULL`). Asserts the helper writes the column names that the drainer's poll query expects.

**Execution note:** Integration test only — no production code wires the helper. U5 ships the resolver + handler integration that exercises end-to-end audit writes against real mutations.

**Verification:** Test runs against dev (`pnpm --filter @thinkwork/api test test/integration/compliance-emit.test.ts`); zero rows persist post-run; assertions pass.

---

- U4. **Public API + index re-export**

**Goal:** Clean public surface for consumers to import. Single `import { emitAuditEvent } from '@thinkwork/api/lib/compliance'` path.

**Requirements:** R5, R6.

**Dependencies:** U1, U2.

**Files:**
- Modify: `packages/api/src/lib/compliance/index.ts` (re-exports `emitAuditEvent`, `redactPayload`, `EVENT_PAYLOAD_SHAPES`, types)
- No tests — pure re-export; covered by U2 + U1 tests.

**Approach:**
- `index.ts` exports the public API. Keep internal helpers (`sanitizeStringField`, internal type guards) un-exported — consumers don't need them.
- Update any downstream `import` paths the team agrees on. (No call sites today; this just establishes the import convention for U5.)

**Test expectation:** none — pure re-export boilerplate, no behavioral change. Covered by U1 + U2 tests.

**Verification:** TypeScript compilation passes; `pnpm --filter @thinkwork/api typecheck` clean.

---

## System-Wide Impact

- **Interaction graph:** Helper inserts into `compliance.audit_outbox`. No callbacks, observers, or cross-table writes. The U4 drainer Lambda reads from outbox but is a separate process; no in-process coupling.
- **Error propagation:** Helper throws on validation failure; throws on `tx.insert` failure. Callers catch only for telemetry-tier writes; control-evidence callers let it propagate to their tx, which rolls back. No silent swallowing.
- **State lifecycle risks:** None. Helper is pure write; no caching; no retry. Outbox row is durable on caller-tx commit.
- **API surface parity:** The Strands runtime emit path (U6) is a separate REST endpoint, not this helper. The helper is in-process Node-only.
- **Integration coverage:** U3 integration test asserts the helper integrates with Drizzle transactions correctly. U5's tests will assert the full resolver-or-handler-to-outbox-to-drainer-to-audit_events chain.
- **Unchanged invariants:** No GraphQL types change. No SQL schema change (audit_outbox already exists from U1). No Lambda handler changes. No CLAUDE.md changes.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Helper validates eventType but registry doesn't enforce all 14 types have schemas | U1 test enumerates `COMPLIANCE_EVENT_TYPES` and asserts each has a registry entry. Build-time gate. |
| `uuidv7` dependency adds bundle size to graphql-http Lambda | Library is small (~5 KB minified); pure JS; standard esbuild treeshaking applies. Verify post-build dist size hasn't regressed. |
| Caller passes a `db` instead of `tx` (accidentally bypasses transactional semantics) | TypeScript signature accepts both via union. Helper logs a warning when invoked with a non-transaction handle (test asserts the warning). |
| Phase 6 reserved event types (R14) accepted by helper but no production emitter exists | Empty allow-list registry entry rejects all payload fields. If a Phase 6 emitter accidentally ships before its registry update, the row lands with `redactedFields` containing every input field (loud failure). |
| Redaction missed a sensitive field (e.g., `apiKey_v2`) and it lands in audit_outbox | Allow-list is deny-by-default — any unknown field is dropped. The risk is over-permissive *positive* allow-list entries. Code review of `event-schemas.ts` is the gate. |
| Integration test against dev pollutes data | Test uses transaction rollback explicitly; no row persists post-test. CI runs same test against dev on every deploy. |
| U2 PR #887 hasn't merged yet — compliance_writer role doesn't exist | Helper takes `tx` from caller; doesn't care about role. Integration test uses `thinkwork_admin`. U5 (when consumers wire) is when the writer role actually matters. |

---

## Documentation / Operational Notes

- **README in `packages/api/src/lib/compliance/`** documenting the public API and the call-site pattern: how a resolver wraps the audit emit in its existing `db.transaction`. Mention that this is the in-process path; Strands runtime uses `POST /api/compliance/events` (U6).
- **Update `project_system_workflows_revert_compliance_reframe.md`** memory after merge to record U3 progress.

---

## Sources & References

- **Origin document (master plan):** `docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md`
- **Master plan U3 spec:** see master plan §"Implementation Units / Phase B — Write path / U3"
- **Decision #1 (outbox semantics):** master plan §"Key Technical Decisions / 1. Hash chain linearization"
- **Decision #6 (redaction):** master plan §"Key Technical Decisions / 6. Redaction"
- **Phase 3 progression:** PR #880 (U1, merged), PR #887 (U2, open + CI bootstrap step added 2026-05-07)
- **Patterns:** `packages/api/src/graphql/resolvers/core/updateTenantPolicy.mutation.ts:73-100`, `packages/lambda/sandbox-log-scrubber.ts:39-58`, `packages/database-pg/src/schema/compliance.ts`.
- **External:** `uuidv7` npm package, RFC 9562.

# SOC2 Type 1 walkthrough

The auditor sits next to an operator and walks through the compliance module's evidence layer-by-layer. This doc is the script — read it top-to-bottom alongside the live admin SPA + a terminal session running the verifier CLI.

For the architecture this walkthrough exercises, see [architecture.md](./architecture.md). For the operator-side procedures referenced inline, see [operator-runbook.md](./operator-runbook.md).

## Pre-engagement

Before the walkthrough begins:

- The operator's email is in `THINKWORK_PLATFORM_OPERATOR_EMAILS` on the graphql-http Lambda. (Confirm via `aws lambda get-function-configuration --function-name thinkwork-{stage}-api-graphql-http --query 'Environment.Variables.THINKWORK_PLATFORM_OPERATOR_EMAILS'`.)
- For a production engagement, the anchor bucket's Object Lock mode is COMPLIANCE (irreversible). For a non-prod rehearsal, GOVERNANCE is acceptable. See [operator-runbook.md → GOVERNANCE → COMPLIANCE flip](./operator-runbook.md#flip-s3-object-lock-governance--compliance-for-an-audit-engagement).
- The `audit-verifier` CLI is installed locally on the auditor's laptop or a shared workstation. Install: `npm install -g @thinkwork/audit-verifier`. CLI README: [`packages/audit-verifier/README.md`](../../packages/audit-verifier/README.md).
- Both auditor and operator can see the admin SPA (operator drives; auditor follows on a second monitor or shared screen).

## Walkthrough script

Each step has a "what the auditor sees" line + a "why it proves something" line. Capture the listed screenshots into `auditor-walkthrough-evidence-{date}.zip` for the engagement deliverable — placeholders are listed at the bottom; populate during the U11.U5 rehearsal.

### 1. Sign in to admin

**See:** Admin SPA loaded; sidebar shows **Compliance** between Settings and Billing.

**Why it matters:** The Compliance entry is operator-tier only; non-operators do not see it. Permission gating is enforced server-side by `requireComplianceReader` ([`packages/api/src/lib/compliance/resolver-auth.ts`](../../packages/api/src/lib/compliance/resolver-auth.ts)) — the sidebar is the visible signal.

### 2. Open `/compliance`

**See:** The events list with a default 7-day window and the 14-event filter dropdown.

**Why it matters:** The 14 event types are the SOC2 starter slate the platform commits to recording. Source: [`packages/database-pg/src/schema/compliance.ts`](../../packages/database-pg/src/schema/compliance.ts) `COMPLIANCE_EVENT_TYPES`. The list of types is in [architecture.md](./architecture.md#event-type-slate); reference it during the explanation.

### 3. Filter to a specific event type

**See:** Set `event_type = agent.created` for the last 7 days. The list narrows to creation events; rows are sorted `occurred_at DESC` with cursor pagination (50/page, **Load more** button).

**Why it matters:** Demonstrates that querying is fast and stable across pagination — the cursor is a `(occurred_at, event_id)` tuple, not a row offset, so concurrent inserts don't shift the page.

### 4. Open an event detail page

**See:** Click any row. The detail page shows event metadata (id / occurred_at / actor / source), three panels:

- **Chain position:** event_hash + prev_hash, both 64-char hex SHA-256 digests.
- **Anchor status:** ANCHORED with a `cadence_id` (the 15-minute cadence whose Merkle anchor includes this event), or PENDING with "Will be anchored at the next 15-minute cadence."
- **Payload:** the redacted payload pretty-printed (large payloads (>256 KB) show a 1 KB preview + Download).

**Why it matters:** Every event has a chain link backward (`prev_hash`) and a forward proof (`anchor_status` once the next cadence runs). Tampering with any event would require recomputing every subsequent hash AND changing every anchor going forward — auditor's intuition for the integrity guarantee.

### 5. Walk back through the chain

**See:** Click the `prev_hash` value in the chain-position panel. The page navigates to the previous event. Click **Walk back 10 events** to see a vertical strip of the prior 10 events (event-type + recorded-at + hash prefix). Stops at GENESIS (the first event in the tenant chain) or 10 hops, whichever comes first.

**Why it matters:** Visual proof of append-only history. Each backward step uses `complianceEventByHash` ([`packages/api/src/graphql/resolvers/compliance/query.ts`](../../packages/api/src/graphql/resolvers/compliance/query.ts)) which is hash-keyed — no way to "skip" an event without changing its hash.

### 6. Request an export

**See:** Back to the events list. Click **Export this view** in the page header. The Exports dialog opens pre-filled with the current filter; format defaults to CSV. Click **Queue export**.

**Why it matters:** Exports are themselves audited — submitting one writes a `data.export_initiated` event with the filter as payload. The export trail is itself part of the chain.

Hard caps the dialog enforces server-side: 90-day window, 4 KB filter byte cap, 10 exports/hour per operator.

### 7. Watch the export complete

**See:** Browser navigates to `/compliance/exports/`. The new job appears with status `Queued`. Within ~3 seconds (polling interval), it transitions to `Running`, then to `Complete`. Status badges use icon + color (CheckCircle / Loader2 / AlertCircle).

**Why it matters:** Async pipeline (SQS → runner Lambda → S3 multipart → presigned URL) but operator never leaves the page. The 3-second polling pauses automatically once no jobs are active.

### 8. Download and inspect the artifact

**See:** Click **Download** in the action column. Browser downloads `compliance-event-{jobId}.csv` directly from S3 via a 15-minute presigned URL.

Open the CSV. Every row contains the full envelope: `event_id, tenant_id, occurred_at, recorded_at, actor, actor_type, source, event_type, event_hash, prev_hash, payload_json`. The CSV is RFC 4180-compliant (quoting around values with commas, newlines, or quotes).

**Why it matters:** Auditor can take this artifact off-platform and verify it independently. The presigned URL expires in 15 minutes; download promptly. If the URL expires, the operator re-exports (the original event row stays for traceability).

### 9. Verify with the audit-verifier CLI

**See:** Operator (or auditor) runs the CLI:

```bash
audit-verifier verify \
  --bucket thinkwork-{stage}-compliance-anchors \
  --since 2026-05-01T00:00:00Z \
  --until 2026-05-08T23:59:59Z \
  --check-retention \
  --check-chain
```

**Why it matters:** The verifier independently:
1. Lists all anchor objects under `anchors/cadence-*.json` in the WORM bucket.
2. Verifies each anchor's S3 Object Lock retention is at or beyond the configured retention floor (`--check-retention`).
3. Walks each per-tenant chain in `compliance.audit_events` and recomputes per-event hashes; rejects on chain breaks (`--check-chain`).
4. Recomputes the global Merkle root from the per-tenant chain heads using RFC 6962 domain-separated hashing and confirms byte-exact agreement with the anchor objects.

CLI source + README: [`packages/audit-verifier/`](../../packages/audit-verifier/).

### 10. (Optional, prod) Show Object Lock retention in the S3 console

**See:** AWS Console → S3 → `thinkwork-{stage}-compliance-anchors` → click any anchor object → properties → Object Lock retention. Mode reads `COMPLIANCE`, retention until `<future date>`.

**Why it matters:** The auditor's external clock — even AWS root cannot delete or shorten the retention window until it expires. This is the irreversibility property the SOC2 walkthrough is grounded in.

## Hash-chain explainer

The audit log uses a per-tenant SHA-256 chain. For each new event:

```
event_hash = sha256(canonical_event_envelope || prev_hash)
```

Chain breaks are detectable because changing any event's payload changes its hash, which changes every subsequent event's hash, which changes the per-tenant chain head, which changes the Merkle root, which mismatches the published anchor.

The Merkle anchor uses RFC 6962 domain separation:

- Leaf: `sha256(0x00 || tenant_id_bytes || event_hash_bytes)`
- Inner node: `sha256(0x01 || left_child_hash || right_child_hash)`

The leading byte (`0x00` for leaves, `0x01` for inner nodes) prevents second-preimage forgery on the Merkle proof path. Reference: RFC 6962 §2.1. Implementation: [`packages/lambda/compliance-anchor.ts`](../../packages/lambda/compliance-anchor.ts) (`computeLeafHash`, `combineNodes`, `buildMerkleTree`).

## Event-type slate

The 14 Phase 3 events the platform commits to recording are listed in [architecture.md → Event-type slate](./architecture.md#event-type-slate). 5 Phase 6 reservations exist for future policy events.

## Redaction allow-list

Each event type has an explicit allow-list of payload fields that survive into the audit row; everything else is redacted at write time by the `emitAuditEvent` helper before the INSERT into `audit_outbox`. A new event type cannot land without a corresponding redaction rule — the allow-list registry is the gate. Source: [`packages/api/src/lib/compliance/redaction.ts`](../../packages/api/src/lib/compliance/redaction.ts).

The auditor doesn't need this most days; it matters when an auditor asks "could a sensitive field accidentally end up in the audit log?" — the answer is no, because every persisted field is on a per-event-type allow-list reviewed at PR time.

## Dual-runtime emit path

Audit events flow from two runtimes through the same outbox:

1. **Yoga TypeScript resolvers** — call `emitAuditEvent(tx, ...)` inside their existing `db.transaction` block. Audit failure rolls back the originating mutation (control-evidence tier). Source: [`packages/api/src/lib/compliance/emit.ts`](../../packages/api/src/lib/compliance/emit.ts).

2. **Strands Python runtime** — uses `ComplianceClient` to POST `/api/compliance/events` with bearer `API_AUTH_SECRET` and a UUIDv7 `event_id` generated client-side. The REST handler ([`packages/api/src/handlers/compliance.ts`](../../packages/api/src/handlers/compliance.ts)) validates and inserts into the outbox. The `audit_outbox.uq_audit_outbox_event_id` unique constraint makes retries idempotent — if the network drops mid-call, the Strands client retries with the same `event_id` and the second insert is a no-op.

Both paths land in the same `audit_outbox` table and are drained by the same single-writer Lambda into the same per-tenant chain. The auditor sees one audit log, regardless of which runtime emitted.

## Screenshot list (capture during U11.U5 rehearsal)

These captures populate the engagement-deliverable evidence ZIP. None are inlined here yet — they're produced during the SOC2 walkthrough rehearsal in deployed dev:

- **TODO: capture during U11.U5 rehearsal** — Step 1: Admin sidebar showing the Compliance entry with the operator signed in.
- **TODO: capture during U11.U5 rehearsal** — Step 2: `/compliance` events list with default 7-day window populated.
- **TODO: capture during U11.U5 rehearsal** — Step 3: filter set to `event_type = agent.created`; rows narrowed.
- **TODO: capture during U11.U5 rehearsal** — Step 4: event detail page with all three panels (chain / anchor / payload) visible.
- **TODO: capture during U11.U5 rehearsal** — Step 5: walk-back-10-events strip populated.
- **TODO: capture during U11.U5 rehearsal** — Step 6: Export dialog with filter pre-filled, CSV format selected.
- **TODO: capture during U11.U5 rehearsal** — Step 7: Exports table mid-transition (one job RUNNING, one COMPLETE).
- **TODO: capture during U11.U5 rehearsal** — Step 8: downloaded CSV opened in a spreadsheet showing column headers + a few rows.
- **TODO: capture during U11.U5 rehearsal** — Step 9: terminal showing `audit-verifier` output (Merkle root + retention check + chain walk all PASS).
- **TODO: capture during U11.U5 rehearsal (prod only)** — Step 10: AWS Console S3 anchor object properties showing COMPLIANCE retention mode.

## Verifier CLI usage

The verifier CLI is the auditor's independent verification tool — it does not read from the platform's GraphQL API; it reads from S3 (anchor bucket) + Aurora (chain) directly using read-only credentials. Full CLI reference: [`packages/audit-verifier/README.md`](../../packages/audit-verifier/README.md).

## Open questions

These items surfaced during plan-write that the U11.U5 rehearsal will validate. Until then, treat them as known gaps:

- The exact CLI output format (PASS/FAIL framing, summary table) needs a sample run to lock in. Update this doc with a real verifier output snippet after the rehearsal.
- Step 10 (S3 console screenshot) is prod-only. For dev/staging rehearsals, document GOVERNANCE mode as the rehearsal-acceptable equivalent and call out that prod must flip to COMPLIANCE before a real engagement.

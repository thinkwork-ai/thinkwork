# @thinkwork/audit-verifier

Standalone CLI + programmatic API that verifies the WORM-locked audit
evidence written by Thinkwork's compliance-anchor Lambda. Re-derives
every Merkle root from scratch (RFC 6962); never imports the writer.
Designed so an internal CI gate or external SOC2 auditor can run it
against the S3 bucket and get a structured pass/fail report.

## What this verifies

For every cadence object under `anchors/` in the bucket, the verifier:

1. Downloads the anchor body and validates it against the v1 schema.
2. Downloads each named `proof_keys[]` slice in parallel.
3. Recomputes each tenant's leaf hash from `tenant_id` + `latest_event_hash`
   using the RFC 6962 leaf-hash construction (`sha256(0x00 || ...)`).
4. Replays each slice's `proof_path` against its leaf and asserts the
   recomputed root equals the anchor's claimed `merkle_root`.
5. Cross-checks each slice's own `global_root` claim against the anchor.
6. For empty cadences (`proof_keys: []`), independently verifies that
   `merkle_root === sha256(0x00)` (the RFC 6962 empty-tree sentinel).
7. _(--check-retention)_ Confirms each anchor has Object Lock
   retention configured with a future `RetainUntilDate`.
8. _(--check-chain)_ Walks `compliance.audit_events` per tenant,
   asserting each row's `prev_hash` matches the previous row's
   `event_hash` and that the genesis row has `prev_hash = NULL`.

### What this does NOT verify

- **The writer ran on schedule.** Cadence_id is a deterministic
  fingerprint of chain heads, not a wall clock. If the writer was down
  but no new events were emitted, the verifier cannot detect the gap.
  Liveness is the watchdog Lambda's job (`ComplianceAnchorGap` metric).
- **GOVERNANCE-mode bypass.** A principal holding
  `s3:BypassGovernanceRetention` can mutate locked objects in
  GOVERNANCE-mode buckets. The verifier reports retention metadata but
  cannot prove the lock was never bypassed. COMPLIANCE-mode (audit
  engagement time) closes this gap.
- **Audit-event chain integrity** without `--check-chain`. Anchor-only
  verification proves the slices the writer named are internally
  consistent; it does NOT prove the chain those slices summarize is
  unbroken. Use `--check-chain` for the end-to-end picture.
- **The writer chose to anchor the right events.** That's enforced by
  the Aurora schema + `audit_events_block_delete` trigger, not by the
  verifier.

## Install

```bash
npm install -g @thinkwork/audit-verifier
```

After publish, verify the npm provenance attestation before trusting
the binary:

```bash
npm audit signatures @thinkwork/audit-verifier
```

## Usage

### Anchor-only verification (default)

```bash
audit-verifier --bucket thinkwork-prod-compliance-anchors --region us-east-1
```

### Time-windowed verification (one calendar month)

```bash
audit-verifier \
  --bucket thinkwork-prod-compliance-anchors \
  --region us-east-1 \
  --since 2026-04-01T00:00:00Z \
  --until 2026-05-01T00:00:00Z
```

The `--since` / `--until` window is `[since, until)` — inclusive start,
exclusive end. Sequential audit runs with adjacent windows are exact:
no overlap, no gaps.

### Full verification (retention + chain)

```bash
export AUDIT_DB_URL='postgres://compliance_reader:...@aurora-cluster.amazonaws.com:5432/thinkwork?sslmode=require'

audit-verifier \
  --bucket thinkwork-prod-compliance-anchors \
  --region us-east-1 \
  --check-retention \
  --check-chain \
  --db-url-env AUDIT_DB_URL
```

The connection string is read from the named environment variable;
**never put it on the argv**. Passing `--db-url <connstr>` directly
would leak the credentials via `ps`, shell history, and CI logs.

## Output

Output is a JSON object on stdout. Exit code is the primary signal:

| Exit | Meaning                                                       |
|------|---------------------------------------------------------------|
| 0    | Verified — every cadence reproduced cryptographically         |
| 1    | At least one mismatch / failure / schema drift recorded       |
| 2    | Unrecoverable error (S3 access denied, bucket missing, etc.)  |

### JSON shape

```json
{
  "verified": true,
  "cadences_checked": 96,
  "anchors_verified": 96,
  "merkle_root_mismatches": [],
  "retention_failures": [],
  "chain_failures": [],
  "parse_failures": [],
  "schema_drift": [],
  "first_anchor_at": "2026-04-01T00:00:00.000Z",
  "last_anchor_at": "2026-04-30T23:45:00.000Z",
  "elapsed_ms": 28341,
  "flags": {
    "check_retention": true,
    "check_chain": true,
    "concurrency": 8,
    "since": "2026-04-01T00:00:00.000Z",
    "until": "2026-05-01T00:00:00.000Z",
    "tenant_id": null
  }
}
```

### Mismatch reasons

`merkle_root_mismatches[]` entries carry one of:

| Reason                       | Meaning                                                                   |
|------------------------------|---------------------------------------------------------------------------|
| `leaf_drift`                 | Recomputed leaf hash != slice's claimed `leaf_hash`                       |
| `root_mismatch`              | Replayed proof path didn't reconstruct the anchor's `merkle_root`         |
| `slice_root_drift`           | Slice's `global_root` field disagrees with anchor's `merkle_root`         |
| `slice_missing`              | Anchor named a `proof_key` that's absent from S3                          |
| `empty_tree_root_mismatch`   | Empty cadence (`proof_keys=[]`) but `merkle_root != sha256(0x00)`         |

`retention_failures[]` entries carry one of:

| Reason          | Meaning                                                           |
|-----------------|-------------------------------------------------------------------|
| `missing`       | No Object Lock retention configured                               |
| `expired`       | `RetainUntilDate` has passed                                       |
| `invalid_mode`  | Mode is not GOVERNANCE or COMPLIANCE                              |
| `fetch_error`   | GetObjectRetention itself failed (transient — retry the run)      |

`chain_failures[]` entries carry one of:

| Reason                 | Meaning                                                              |
|------------------------|----------------------------------------------------------------------|
| `prev_hash_mismatch`   | Row's `prev_hash` != previous row's `event_hash`                     |
| `non_null_genesis`     | First row's `prev_hash` is non-null (chain doesn't start fresh)      |
| `query_error`          | SQL query against `compliance.audit_events` itself failed            |

`schema_drift[]` entries carry the offending key + the `schema_version`
value the verifier didn't recognize. The run continues across other
cadences.

`parse_failures[]` entries carry the offending key + the parser error
message for malformed v1 bodies. The run continues across other
cadences.

## Required AWS permissions

Default invocation:

```
s3:ListBucket             on  arn:aws:s3:::<bucket>
s3:GetObject              on  arn:aws:s3:::<bucket>/anchors/*
s3:GetObject              on  arn:aws:s3:::<bucket>/proofs/*
kms:Decrypt               on  the bucket's CMK
```

Add `s3:GetObjectRetention` for `--check-retention`.

### Permissions you must NOT grant

The verifier is read-only by design. Do not run it under a profile
that holds any of these (defense-in-depth — even though the verifier
never calls them):

```
s3:PutBucketPolicy
s3:DeleteObject*
s3:BypassGovernanceRetention
kms:ScheduleKeyDeletion
```

Run `aws sts get-caller-identity` before invoking against production
to confirm you're under a least-privilege auditor profile.

## Database access (--check-chain)

`--check-chain` connects to Aurora using a Postgres connection string
read from the env var named via `--db-url-env`. The Aurora role
should grant only `SELECT` on `compliance.audit_events`. The
`compliance_reader` role provisioned by Terraform U2 has exactly
this scope.

## Algorithm reference

The verifier re-implements RFC 6962 §2.1 leaf-hash and node-hash
constructions:

```
leaf  =  sha256(0x00 || tenant_id_bytes || event_hash_bytes)
node  =  sha256(0x01 || left_hash_bytes || right_hash_bytes)
empty =  sha256(0x00)                                          (sentinel root)
```

UUIDs are decoded as 16-byte network-byte-order buffers. Hash inputs
are 32-byte SHA-256 digests. Odd leaves are duplicated (Bitcoin-style)
so the tree is always balanced.

### Locked test vector (cross-implementation byte agreement)

If you write a parallel verifier in another language (Java, Python,
Rust) the following input pair MUST produce the exact output below.
Verify your implementation against this fixture before trusting
its output:

| Input              | Value                                                              |
|--------------------|--------------------------------------------------------------------|
| `tenant_id`        | `11111111-1111-7111-8111-111111111111`                             |
| `event_hash` (hex) | `aa` repeated 32 times (64 hex chars)                              |
| **Expected leaf**  | `701e2479c1ad3506b53c1355562082b44dd68112b018e73e4c39a869e680bcb3` |

This vector is published in the Thinkwork monorepo at
`packages/lambda/__tests__/integration/compliance-anchor.integration.test.ts:165-191`
and asserted in this verifier's `__tests__/merkle.test.ts`.

## License

Apache-2.0.

## Author / Maintainer

Thinkwork — see https://thinkwork.ai. Issues and contributions at
https://github.com/thinkwork-ai/thinkwork.

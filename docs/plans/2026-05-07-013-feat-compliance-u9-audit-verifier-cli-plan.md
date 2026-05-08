---
title: U9 — Standalone audit-verifier CLI
type: feat
status: active
date: 2026-05-07
origin: docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md
---

# U9 — Standalone audit-verifier CLI

## Summary

Build `packages/audit-verifier`, a TypeScript CLI + programmatic API that reads the WORM-locked anchors U8b is now writing, recomputes every Merkle root from scratch (RFC 6962 leaf + node domain separation), and emits a structured JSON pass/fail report. The package re-implements the leaf-hash and tree-build math from scratch — zero `@thinkwork/*` runtime imports — so a SOC2 auditor or third party can `npm install -g @thinkwork/audit-verifier` and verify our audit evidence without trusting the writer they're auditing. Optional flags add chain-walk verification against Aurora (`--check-chain`) and per-object Object Lock retention checks (`--check-retention`).

---

## Problem Frame

U7 + U8a + U8b shipped the WORM evidence substrate: every 15 minutes the anchor Lambda PutObjects an anchor JSON to `anchors/cadence-{cadence_id}.json` and per-tenant slices to `proofs/tenant-{tenant_id}/cadence-{cadence_id}.json`. The anchor body claims a `merkle_root` over a list of `proof_keys`. **Today nothing actually checks the claim.** A bug in the writer's Merkle math, a corrupted SSE-KMS roundtrip, or a malicious operator could publish anchors whose `merkle_root` doesn't actually match the slices it names — and we'd discover it only when an external auditor showed up with their own implementation.

U9 closes the loop. The verifier is the *external* checker, written and tested as if a third party were going to audit us with it (because eventually one will). It must be installable from npm, run on stock Node 20 with only an AWS profile in the environment, produce a machine-readable verdict, and re-derive the cryptographic identities from the byte-level test vector U8a published — never from a shared library.

---

## Requirements

- R1. Verify the per-cadence Merkle root claim end-to-end: download `anchors/cadence-{id}.json`, fetch every key in `proof_keys[]`, recompute each leaf (`sha256(0x00 || tenant_id_bytes || event_hash_bytes)`), replay each slice's `proof_path` against its leaf, assert the recomputed global root equals the anchor's `merkle_root`. Any mismatch is a verification failure.
- R2. **Cross-implementation byte agreement** — the verifier hardcodes the locked leaf-hash fixture: input `tenant_id = "11111111-1111-7111-8111-111111111111"`, `event_hash = "aa".repeat(32)` must produce exactly `"701e2479c1ad3506b53c1355562082b44dd68112b018e73e4c39a869e680bcb3"`. Source of truth: `packages/lambda/__tests__/integration/compliance-anchor.integration.test.ts:165-191`. The hex literal is the contract; the test file is the publication site.
- R3. Zero `@thinkwork/*` runtime dependencies. Allowed runtime deps: `@aws-sdk/client-s3`, `commander`, `zod`, plus `node:crypto` from the Node stdlib. Dev deps may use `vitest`, `tsx`, `esbuild`, `@types/node`.
- R4. CLI defaults to anchor-only verification. `--check-retention` adds per-object `s3:GetObjectRetention` checks. `--check-chain` adds per-tenant Aurora chain walks (lazy-loaded `pg` + raw SQL — no Drizzle import).
- R5. Time-range scoping via `--since` / `--until` (ISO8601). Bounds are `[since, until)` — inclusive start, exclusive end. Example: `--since 2026-05-01T00:00:00Z --until 2026-06-01T00:00:00Z` includes all cadences anchored in May but excludes June 1 00:00. Tenant scoping via `--tenant-id` for chain checks. Concurrency cap via `--concurrency` (default 8).
- R6. Paginated `ListObjectsV2` via `ContinuationToken` — must NOT silently truncate. At 365-day retention the bucket carries ~35k anchor objects.
- R7. Forward-compat schema handling — accept additional unknown JSON fields (not breaking on minor schema growth) but reject unknown `schema_version` values with a structured error pointing at the offending key.
- R8. Structured JSON output with these fields: `verified` (bool), `cadences_checked`, `anchors_verified`, `merkle_root_mismatches[]`, `retention_failures[]`, `chain_failures[]`, `first_anchor_at`, `last_anchor_at`, `elapsed_ms`, `flags` (echo of activated check flags). Exit codes: 0 = verified, 1 = mismatch found, 2 = unrecoverable error.
- R9. Programmatic API — same verifier core that the CLI calls is exported so a future admin Compliance UI (U10) or CI gate can call `verifyBucket({bucket, region, ...})` directly without spawning the CLI.
- R10. Decoupled credentials — the verifier uses standard AWS SDK creds resolution (`AWS_PROFILE`, instance role, env vars). No assume-role logic baked in; an auditor with their own readonly profile must Just Work.
- R11. README documents one-line install, three example invocations, JSON output shape, exit codes, and the threat model the verifier proves against (writer bug, SSE-KMS corruption, malicious operator).

---

## Scope Boundaries

- Anchor diff visualization (compare two cadences across time) — separate follow-up.
- Generating Merkle proofs for individual events on demand (forensic mode) — U10+.
- Push notifications / paging integration on verification failure — JSON output IS the integration surface.
- HSM-signed anchors — post-SOC2-Type-2 frontier, not U9.
- Integration into the admin Compliance UI — U10's job; U9 ships only the programmatic API surface that U10 will consume.
- Verifier-mode Bedrock/LLM verification — no AI in the verifier path; cryptographic checks only.
- Cross-region replication or multi-bucket federation — single bucket per run.
- Performance optimization beyond `--concurrency=8` baseline — overnight auditor runtime is acceptable for v1.

---

## Context & Research

### Relevant Code and Patterns

- `apps/cli/src/index.ts` and `apps/cli/package.json` — closest reference for commander.js setup, esbuild bin entry, esm output, and `bin: { ... }` package.json wiring. Mirror the structure but stay in `packages/audit-verifier` since this is publishable.
- `packages/lambda/compliance-anchor.ts` — the writer this verifies. **Read for algorithm reference, NEVER import.** Key functions to mirror in independent re-implementation: `computeLeafHash`, `buildMerkleTree`, `deriveProofPath`, `deriveCadenceId` (verifier doesn't compute cadence IDs, only validates them).
- `packages/lambda/__tests__/integration/compliance-anchor.integration.test.ts` lines 152-264 — RFC 6962 Merkle test vectors (leaf prefix, node prefix, empty tree, single leaf, two leaves, three-leaf odd duplication, proof path verification). The verifier's own test suite re-derives every one of these.
- `packages/api/src/__smoke__/compliance-anchor-smoke.ts` — JSON output shape conventions (UUIDV7_RE, SHA256_HEX_RE, ISO8601_RE) match the verifier's output validators.

### Institutional Learnings

- `feedback_smoke_pin_dispatch_status_in_response` — surface verification status in the response payload; downstream JSON consumers (CI gates, audit logs) parse the JSON, not the human-readable text.
- `feedback_pnpm_in_workspace` — use pnpm not npm for any workspace install. The CLI's `bin` field will still be installable globally from npm by external auditors after publish.
- `feedback_ship_inert_pattern` — does NOT apply to U9. This is a greenfield package with no inert/live cutover; the package either verifies correctly or it doesn't.
- `feedback_completion_callback_snapshot_pattern` — env reads at module load, not inside the verify loop, so a long-running verifier doesn't pick up shifting `AWS_REGION` mid-run.

### External References

- RFC 6962 "Certificate Transparency" §2.1 (Merkle Tree Hash) — the spec our 0x00/0x01 prefix bytes implement. The verifier's leaf and node hash functions are byte-identical to the spec.
- AWS S3 Object Lock retention modes (GOVERNANCE vs COMPLIANCE) — `--check-retention` distinguishes mode + checks `RetainUntilDate > now`.
- Cohasset Associates SOC2 Compliance Assessment — what an auditor looks for when validating tamper-evident retention; the JSON output schema covers their checklist.

---

## Key Technical Decisions

- **Package layout — `packages/audit-verifier` (programmatic API + bin shim).** Rejected `apps/audit-verifier` because the package needs both: (a) a callable JS API for U10's admin UI to embed, and (b) a `bin/` shim for `npm install -g`. Apps in this repo are leaf consumers; packages are reusable. Programmatic-API-first dictates `packages/`.
- **Re-implement, never import.** The verifier copies the algorithm but not the code. The 30-line re-implementation is the entire point — it forces the algorithm description to be byte-exact in two independent codepaths. Master plan U7-U9 sequence treats this as the structural defense against single-point-of-failure Merkle bugs.
- **`zod` for schema validation, not hand-rolled.** zod's discriminated-union support handles `schema_version: 1` cleanly and gives forward-compat for free (additional fields are silently accepted by default). Hand-rolled validators in 2026 read as a 2018 anti-pattern; zod is 12kB and worth the runtime weight for an audit tool.
- **`commander` for CLI parsing.** Same as `apps/cli`; mature, well-typed, sub-command-friendly even though we don't have sub-commands today.
- **`pg` (raw `pg.Client`), not Drizzle, for `--check-chain`.** Drizzle pulls in `@thinkwork/database-pg` patterns and the verifier must be standalone. Raw `pg` + parameterized SQL is auditable in 50 lines; Drizzle would need its own publish-ready sub-package.
- **Lazy-load `pg`.** Anchor-only audits (the default) must not require the auditor to install Postgres client deps. Use dynamic `import("pg")` inside the chain-walk codepath only.
- **Concurrency = `p-limit(8)`.** Mirrors the writer's slice concurrency, gives auditors predictable wall-clock, parallel enough to chew through 35k anchors overnight without saturating S3 GetObject quota.
- **No `--bucket-prefix` flag.** Hardcoded `anchors/` and `proofs/tenant-*/` prefixes. The bucket layout is part of the audit contract; if the writer ever changes prefixes, the verifier MUST be updated in lockstep — a configurable prefix would let drift accumulate.
- **No retention enforcement, only retention reporting.** `--check-retention` reports objects with missing/expired retention; the verifier never tries to PutObjectRetention. Auditors observe; they don't remediate.
- **Exit codes 0/1/2 are the contract.** 0 = verified, 1 = at least one mismatch found (the JSON details where), 2 = unrecoverable run failure (S3 access denied, bucket missing). A CI gate can `audit-verifier ... && deploy_release` safely.
- **Date today is 2026-05-07.** All examples in the README use a current date so paste-into-shell works without guesswork.

---

## Open Questions

### Resolved During Planning

- **Where does `schema_version: 0` go?** Resolved — never shipped. Anchor JSON emits `schema_version: 1` from the U8b live cutover forward; pre-U8b objects don't exist (U8a was inert). Verifier rejects `schema_version != 1` for now.
- **Should we offer a `--watch` mode that polls?** Resolved — out of scope for v1. The watchdog Lambda already monitors the gap; the verifier's role is the deep cryptographic check, not continuous monitoring.
- **JSON output to stdout or file?** Resolved — stdout by default; `--out=path.json` flag if needed (deferred to follow-up since CI piping handles stdout fine).
- **What happens if `proof_keys[]` references a slice that's missing from S3?** Resolved — recorded in `merkle_root_mismatches[]` with reason `"slice_missing"` and the offending tenant's expected key. The cadence as a whole is a verification failure.
- **What if a slice's claimed `global_root` disagrees with the anchor's `merkle_root`?** Resolved — recorded in `merkle_root_mismatches[]` with reason `"slice_root_drift"`. This catches a writer bug where the anchor and slices were computed against different leaf sets.

### Deferred to Implementation

- **Exact zod schema field-by-field** — implementer reads the writer's emit code and matches keys exactly; resolving this in the plan would just be transcribing.
- **Whether to use `@aws-sdk/client-s3` v3.1028 (matches monorepo) or pin a stable LTS version for the published package** — implementer decides at package.json time. Stable LTS is preferred for an external-facing package.
- **Whether `--check-chain` walks the chain forward (genesis → head) or backward (head → genesis)** — both verify the same invariant; implementer picks the simpler SQL.

---

## Output Structure

    packages/audit-verifier/
    ├── package.json                   # publishConfig, bin, deps
    ├── tsconfig.json
    ├── README.md                      # operator surface + threat model
    ├── src/
    │   ├── index.ts                   # programmatic API exports
    │   ├── merkle.ts                  # leaf hash + tree build + proof replay
    │   ├── schema.ts                  # zod schemas for anchor + slice
    │   ├── s3.ts                      # paginated enumeration + body fetch
    │   ├── verify.ts                  # orchestrator + JSON reporter
    │   ├── retention.ts               # --check-retention path
    │   ├── chain.ts                   # --check-chain path (lazy pg import)
    │   └── bin/
    │       └── audit-verifier.ts      # commander entrypoint
    ├── __tests__/
    │   ├── merkle.test.ts             # RFC 6962 byte agreement
    │   ├── schema.test.ts             # forward-compat + version reject
    │   ├── s3.test.ts                 # paginated enumeration
    │   ├── verify.test.ts             # orchestrator happy + mismatch paths
    │   ├── retention.test.ts          # GetObjectRetention path
    │   └── chain.test.ts              # --check-chain Aurora walk
    ├── vitest.config.ts
    └── tsup.config.ts                 # or esbuild script (matches apps/cli)

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
flow: verifyBucket({ bucket, region, since?, until?, tenantId?, checkRetention?, checkChain?, dbUrl?, concurrency=8 })
  │
  ├─ Phase 1 — enumerate
  │   ├─ ListObjectsV2(Prefix: "anchors/", paginate via ContinuationToken)
  │   ├─ filter by --since/--until on Key.match(/cadence-(<id>)\.json/) → cadence_id
  │   │   (cadence_id is deterministic UUIDv7-shape but not a wall clock; use S3 LastModified for time scoping)
  │   └─ yield anchorKeys[] sorted by LastModified ASC
  │
  ├─ Phase 2 — verify each anchor (p-limit(concurrency))
  │   ├─ GetObject(anchorKey)
  │   ├─ parse via zod (reject schema_version != 1)
  │   ├─ for each key in proof_keys[]: GetObject in parallel, parse via zod
  │   ├─ for each tenant slice:
  │   │   ├─ recompute leaf = sha256(0x00 || tenant_id_bytes || event_hash_bytes)
  │   │   ├─ assert leaf === slice.leaf_hash (catches slice-vs-anchor drift)
  │   │   └─ replay proof_path → recomputed root
  │   ├─ assert all recomputed roots === anchor.merkle_root
  │   ├─ if --check-retention: GetObjectRetention(anchorKey) → assert RetainUntilDate > now
  │   └─ on any failure: append to mismatches[] / retention_failures[]
  │
  ├─ Phase 3 (optional) — chain walk per tenant
  │   ├─ lazy import("pg")
  │   ├─ for each tenant in scope (or --tenant-id): SELECT event_id, event_hash, prev_hash
  │   │   FROM compliance.audit_events ORDER BY recorded_at ASC
  │   ├─ walk: assert each row's prev_hash === previous row's event_hash
  │   └─ on chain break: append to chain_failures[]
  │
  └─ Phase 4 — emit JSON report to stdout, exit 0/1/2
```

The key invariant the verifier checks: for every anchor object, the global Merkle root claimed inside the body must be reproducible from the slices the body itself names. A writer bug, a corrupted SSE-KMS roundtrip, or an after-the-fact tampering attempt all break this invariant in detectable ways.

---

## Implementation Units

- U1. **Package skeleton + build wiring**

**Goal:** Lay down `packages/audit-verifier` as a publishable pnpm workspace member with TypeScript, vitest, esbuild bin output, and the right `package.json` shape (publishConfig, bin, exports map). Verify `pnpm install` resolves it from the monorepo root.

**Requirements:** R3, R9.

**Dependencies:** None.

**Files:**
- Create: `packages/audit-verifier/package.json`
- Create: `packages/audit-verifier/tsconfig.json`
- Create: `packages/audit-verifier/vitest.config.ts`
- Create: `packages/audit-verifier/tsup.config.ts` (or `scripts/build-bin.sh` if mirroring apps/cli's esbuild flow)
- Create: `packages/audit-verifier/src/index.ts` (placeholder export)
- Create: `packages/audit-verifier/src/bin/audit-verifier.ts` (placeholder entry)
- Modify: `pnpm-workspace.yaml` if `packages/*` glob is not already comprehensive

**Approach:**
- `package.json` `name: "@thinkwork/audit-verifier"`, `version: "0.1.0"`, `type: "module"`, `bin: { "audit-verifier": "dist/bin/audit-verifier.mjs" }`, `main: "dist/index.mjs"`, `types: "dist/index.d.ts"`, `publishConfig: { "access": "public" }`.
- Runtime deps: `@aws-sdk/client-s3`, `commander`, `zod`, `p-limit`. Dev deps: `vitest`, `@types/node`, `tsup` (or esbuild + @types/node), `typescript`. **No `@thinkwork/*` deps.**
- TypeScript strict mode; `target: "ES2022"`, `module: "Node16"`, `moduleResolution: "Node16"`.
- Build emits two artifacts: `dist/index.mjs` (programmatic API) + `dist/bin/audit-verifier.mjs` (CLI shim with `#!/usr/bin/env node` shebang).

**Patterns to follow:**
- `apps/cli/package.json` — bin field shape, esbuild script wiring, ESM output.
- `packages/database-pg/package.json` — workspace member with publishConfig.

**Test scenarios:**
- *Test expectation: none — pure scaffolding. The verifier core lands in U2 with full coverage.*

**Verification:**
- `pnpm install` from repo root succeeds and creates `node_modules/@thinkwork/audit-verifier` symlink.
- `pnpm --filter @thinkwork/audit-verifier build` produces `dist/bin/audit-verifier.mjs` with executable shebang.
- `node packages/audit-verifier/dist/bin/audit-verifier.mjs --version` prints `0.1.0`.

---

- U2. **Merkle core (RFC 6962 byte-exact re-implementation)**

**Goal:** Re-implement leaf hashing, tree building, and proof-path replay from scratch (no `@thinkwork/lambda` import). Lock the test vector from `compliance-anchor.integration.test.ts:165-191` as the authoritative cross-implementation byte-agreement check.

**Requirements:** R1, R2, R3.

**Dependencies:** U1.

**Files:**
- Create: `packages/audit-verifier/src/merkle.ts`
- Create: `packages/audit-verifier/__tests__/merkle.test.ts`

**Approach:**
- Export `computeLeafHash(tenantId: string, eventHashHex: string): string` — `sha256(0x00 || uuid_bytes || hex_bytes)` returning 64-char hex.
- Export `buildMerkleTree(leaves: string[]): { root: string; levels: string[][] }` — empty tree returns `sha256(0x00)`; single leaf is its own root; odd leaves duplicate Bitcoin-style.
- Export `verifyProofPath(leafHash: string, proofPath: Array<{hash: string; position: "left"|"right"}>): string` — replays the path and returns the recomputed root.
- All hashing via `node:crypto` `createHash("sha256")`. No external crypto libs.
- Use `Buffer.from([0x00])` and `Buffer.from([0x01])` as the prefix bytes — match the writer's bytes exactly.

**Execution note:** Test-first. Write the test vector assertion before the implementation; the test failing in the right way (wrong digest) is the proof the algorithm is correct.

**Patterns to follow:**
- Read `packages/lambda/compliance-anchor.ts` lines 39-202 for algorithm reference. **Do not import.** Re-implement.
- `packages/lambda/__tests__/integration/compliance-anchor.integration.test.ts` lines 152-264 for the exact test vectors to mirror.

**Test scenarios:**
- Happy path: `computeLeafHash("11111111-1111-7111-8111-111111111111", "aa".repeat(32))` produces exactly `"701e2479c1ad3506b53c1355562082b44dd68112b018e73e4c39a869e680bcb3"` — the locked U8a fixture. **If this assertion fails, every cadence ever written is unverifiable.**
- Edge case: `buildMerkleTree([])` returns `{ root: sha256(0x00), levels: [[]] }`.
- Edge case: `buildMerkleTree([leaf])` returns the leaf as the root unchanged.
- Happy path: `buildMerkleTree([a, b])` returns `sha256(0x01 || a || b)` as the root.
- Edge case: `buildMerkleTree([a, b, c])` duplicates `c` — root = `sha256(0x01 || sha256(0x01||a||b) || sha256(0x01||c||c))`.
- Happy path: 4-leaf tree → `verifyProofPath(b, deriveProofPath_equivalent(1))` recomputes the root.
- Edge case (single-leaf cadence — common in early production): `verifyProofPath(leaf, [])` returns `leaf` unchanged. Without this test, every single-tenant cadence verification could silently break. Locks the empty-proof-path identity invariant.
- Edge case (sibling-side semantic): the test fixture for the 4-leaf tree must lock the convention that `proof_path[i].position` names the *sibling*'s side, not the leaf's. Replay snippet must mirror `compliance-anchor.integration.test.ts` lines 254-266 byte-for-byte to avoid the orientation flip.
- Error path: `computeLeafHash("not-a-uuid", ...)` throws (or returns deterministic error — implementer decides).
- Error path: `computeLeafHash(uuid, "not-64-char-hex")` throws with a clear message.

**Verification:**
- All test scenarios pass with `pnpm --filter @thinkwork/audit-verifier test`.
- The U8a fixture assertion passes byte-exactly.

---

- U3. **Schema validators (zod, schema_version forward-compat)**

**Goal:** Define zod schemas for the anchor body and slice body; reject unknown `schema_version` with a structured error; accept additional unknown fields silently for forward compatibility.

**Requirements:** R1, R7, R8.

**Dependencies:** U1.

**Files:**
- Create: `packages/audit-verifier/src/schema.ts`
- Create: `packages/audit-verifier/__tests__/schema.test.ts`

**Approach:**
- Export `AnchorSchemaV1` with fields: `schema_version: z.literal(1)`, `cadence_id: z.string().regex(UUIDV7_RE)`, `recorded_at: z.string().datetime()`, `merkle_root: z.string().regex(SHA256_HEX_RE)`, `tenant_count: z.number().int().nonnegative()`, `anchored_event_count: z.number().int().nonnegative()`, `recorded_at_range: z.union([z.null(), z.object({min: z.string().datetime(), max: z.string().datetime()})])`, `leaf_algorithm: z.literal("sha256_rfc6962")`, `proof_keys: z.array(z.string())`.
- Export `SliceSchemaV1` with fields matching the writer: `schema_version: z.literal(1)`, `tenant_id: z.string().uuid()`, `latest_event_hash: z.string().regex(SHA256_HEX_RE)`, `latest_recorded_at: z.string().datetime()`, `latest_event_id: z.string()`, `leaf_hash: z.string().regex(SHA256_HEX_RE)`, `proof_path: z.array(z.object({hash: z.string(), position: z.enum(["left", "right"])}))`, `global_root: z.string().regex(SHA256_HEX_RE)`, `cadence_id: z.string()`.
- Default `.passthrough()` (or omit `.strict()`) so unknown fields don't fail validation — forward compat per R7.
- Export `parseAnchor(json: unknown): AnchorV1` and `parseSlice(json: unknown): SliceV1` — they delegate to a discriminated union by `schema_version` and throw a structured error (`SchemaVersionUnsupportedError`) when `schema_version` is not 1.

**Patterns to follow:**
- Define `UUIDV7_RE`, `SHA256_HEX_RE`, `ISO8601_RE` as local constants inside `packages/audit-verifier/src/schema.ts`. **Do not import from `@thinkwork/api`** — `packages/api/src/__smoke__/compliance-anchor-smoke.ts` is a regex-value reference only, not a runtime import target. R3's zero-`@thinkwork/*`-deps rule applies.

**Test scenarios:**
- Happy path: `parseAnchor(validAnchorBody)` returns a typed object.
- Forward compat: `parseAnchor({...validAnchorBody, future_field: "ignored"})` succeeds without dropping the known fields.
- Error path: `parseAnchor({...validAnchorBody, schema_version: 999})` throws `SchemaVersionUnsupportedError` with `version: 999` on the error.
- Error path: `parseAnchor({...validAnchorBody, merkle_root: "not-hex"})` throws zod ValidationError.
- Happy path: `parseSlice(validSliceBody)` returns a typed object with `proof_path` typed correctly.
- Edge case: `parseSlice({...validSlice, proof_path: []})` succeeds (single-tenant cadence has empty proof path).

**Verification:**
- Schema tests pass.
- TypeScript inference produces `AnchorV1` / `SliceV1` types from `z.infer<typeof AnchorSchemaV1>` — no manual interface duplication.

---

- U4. **S3 enumerator (paginated ListObjectsV2 + body fetch + scoping)**

**Goal:** Page through `anchors/` keys with `ContinuationToken`, filter by `--since` / `--until` against object `LastModified`, and provide a `getJsonBody(key)` helper for downloading + parsing JSON object bodies. Bound concurrency via `p-limit`.

**Requirements:** R1, R5, R6, R10.

**Dependencies:** U1.

**Files:**
- Create: `packages/audit-verifier/src/s3.ts`
- Create: `packages/audit-verifier/__tests__/s3.test.ts`

**Approach:**
- Export `enumerateAnchors({s3, bucket, since?, until?}): AsyncIterable<{key: string; lastModified: Date}>` — paginated via `ContinuationToken`; yields objects in S3-returned order. Caller sorts.
- Export `getJsonBody(s3, bucket, key): Promise<unknown>` — `GetObjectCommand`, decodes via `TextDecoder`, `JSON.parse`. Throws on non-JSON or non-2xx.
- Construct `S3Client` from caller-provided config: `{ region, requestHandler: { requestTimeout: 30000, connectionTimeout: 5000 } }`. Bound timeouts: 30s per request gives a sluggish auditor S3 response slack but doesn't hang the whole run.
- `--since` / `--until` filter: `lastModified >= since && lastModified < until`. Both bounds optional. Comparison is `Date.getTime()`.

**Patterns to follow:**
- `packages/lambda/compliance-anchor-watchdog.ts` — pagination shape (single-page with truncation warning). U9 must do the FULL pagination loop, not stop at 1000 keys.
- `packages/lambda/compliance-anchor.ts:251-262` — `S3Client` config shape with timeouts.

**Test scenarios:**
- Happy path: mocked S3Client returns 2 keys; enumerator yields both.
- Pagination: mocked S3Client returns `IsTruncated: true` + `NextContinuationToken: "abc"` on first call, second call returns final page; enumerator yields ALL keys across pages. **This is the critical test — failure means a 35k-anchor bucket is silently truncated.**
- Edge case: empty bucket → enumerator yields nothing, no error.
- Edge case: `since=2026-04-01, until=2026-05-01` filters out objects with LastModified outside the window.
- Edge case: `since` only (no until) yields everything from `since` forward.
- Error path: S3Client throws AccessDenied → enumerator surfaces as a structured error (verifier orchestrator catches and exits with code 2).
- Happy path: `getJsonBody` parses a valid anchor body.
- Error path: `getJsonBody` on a non-JSON object body throws with the offending key in the error message.

**Verification:**
- All test scenarios pass.
- Pagination test specifically: the mock asserts ListObjectsV2 was called twice with the right `ContinuationToken`.

---

- U5. **Verifier orchestrator + JSON reporter**

**Goal:** Glue U2 + U3 + U4 together into the `verifyBucket(opts)` programmatic API. Produce the structured JSON report. Bound per-cadence verification concurrency.

**Requirements:** R1, R8, R9.

**Dependencies:** U2, U3, U4.

**Files:**
- Create: `packages/audit-verifier/src/verify.ts`
- Modify: `packages/audit-verifier/src/index.ts` (export `verifyBucket`, types)
- Create: `packages/audit-verifier/__tests__/verify.test.ts`

**Approach:**
- Export `verifyBucket(opts): Promise<VerificationReport>`. `opts: { bucket, region, since?, until?, tenantId?, concurrency?, checkRetention?, checkChain?, dbUrl? }`.
- For each cadence (output of U4 enumerator), under `p-limit(concurrency)`:
  1. Fetch anchor body, parse via `parseAnchor` (U3).
  2. Fetch each slice in `proof_keys[]` in parallel, parse via `parseSlice` (U3).
  3. For each slice: recompute `leaf_hash` from `tenant_id` + `latest_event_hash` (U2's `computeLeafHash`); assert equal to `slice.leaf_hash`. On mismatch → push to `merkle_root_mismatches` with reason `"leaf_drift"`.
  4. For each slice: replay `proof_path` from `slice.leaf_hash` via U2's `verifyProofPath`; assert recomputed root === anchor's `merkle_root`. On mismatch → push to `merkle_root_mismatches` with reason `"root_mismatch"`.
  5. Confirm `slice.global_root === anchor.merkle_root` (slice-anchor consistency check). On mismatch → push to `merkle_root_mismatches` with reason `"slice_root_drift"`.
  6. If a key in `proof_keys[]` 404s in S3, push to `merkle_root_mismatches` with reason `"slice_missing"`.
- Aggregate counts: `cadences_checked`, `anchors_verified` (cadences with zero mismatches).
- Compute `first_anchor_at` / `last_anchor_at` from the min/max `LastModified` over enumerated keys.
- Emit `verified: merkle_root_mismatches.length === 0 && retention_failures.length === 0 && chain_failures.length === 0`.

**Patterns to follow:**
- The U8b s3-spy test pattern (`packages/lambda/__tests__/compliance-anchor-s3-spy.test.ts`) for mocking S3Client in tests.

**Test scenarios:**
- Empty-cadence path (Decision-#5a writer behavior): cadence with `proof_keys: []` → orchestrator must independently recompute the empty-tree sentinel `sha256(0x00)` and assert `anchor.merkle_root === sentinel`. A tampered anchor that swaps in arbitrary hex when `proof_keys.length === 0` must be detected as a `merkle_root_mismatches[]` entry with reason `"empty_tree_root_mismatch"`.
- Happy path: synthetic 1-cadence bucket with 2 tenants → `verified: true`, `cadences_checked: 1`, `anchors_verified: 1`, no mismatches.
- Mutation detection: same bucket but anchor's `merkle_root` is mutated to a wrong hex → `verified: false`, `merkle_root_mismatches.length === 1`, reason `"root_mismatch"`.
- Slice drift: a slice's `leaf_hash` is mutated → `verified: false`, reason `"leaf_drift"`.
- Slice-root drift: slice's `global_root` differs from anchor's `merkle_root` → `verified: false`, reason `"slice_root_drift"`.
- Missing slice: anchor names a `proof_key` that S3 returns 404 → `verified: false`, reason `"slice_missing"`.
- Empty bucket: enumerator yields nothing → `verified: true` (vacuous), `cadences_checked: 0`, `anchors_verified: 0`. No false positive.
- Schema version reject: cadence with `schema_version: 999` → run halts on that cadence with a structured error; report's `verified: false` and the offending key is logged.
- Forward compat: cadence with extra unknown field → succeeds.
- Concurrency cap: 16 cadences with `concurrency: 4` → never more than 4 in-flight (covered via mock counter).

**Verification:**
- All test scenarios pass against mocked S3Client.
- `verifyBucket` returns a `VerificationReport` whose JSON matches R8's documented shape exactly.
- TypeScript types for `VerificationReport` exported from `src/index.ts`.

---

- U6. **CLI entry (commander) + README + publishConfig polish**

**Goal:** Wire the CLI shim around `verifyBucket`, emit JSON to stdout, and document operator surface. The bin script is the third-party install target; the README is the auditor-facing artifact.

**Requirements:** R5, R8, R10, R11.

**Dependencies:** U5 (orchestrator must exist before the CLI can call it).

**Files:**
- Modify: `packages/audit-verifier/src/bin/audit-verifier.ts`
- Create: `packages/audit-verifier/README.md`
- Modify: `packages/audit-verifier/package.json` (add `keywords`, `description`, `repository`, `license`, `homepage` for npm publish discovery)

**Approach:**
- Commander shape:
  ```
  audit-verifier
    --bucket <name>           # required
    --region <region>         # default us-east-1
    --since <iso>             # optional, default = beginning of time
    --until <iso>             # optional, default = now
    --tenant-id <uuid>        # optional, scopes chain check only
    --concurrency <n>         # default 8
    --check-retention         # bool flag
    --check-chain             # bool flag
    --db-url <url>            # required if --check-chain
    --version
    --help
  ```
- Flow: parse args → `await verifyBucket(opts)` → `console.log(JSON.stringify(report, null, 2))` → `process.exit(report.verified ? 0 : 1)`. Catch unrecoverable errors (S3 access denied, bucket missing) → log to stderr → `process.exit(2)`.
- README sections:
  1. **What this verifies** — the threat model (writer bug, SSE-KMS corruption, malicious operator).
  2. **Install** — `npm install -g @thinkwork/audit-verifier` (post-publish).
  3. **Three example invocations** — full bucket, time-windowed, retention + chain.
  4. **JSON output schema** — annotated example showing every field.
  5. **Exit codes** — table: 0 verified, 1 mismatch, 2 unrecoverable.
  6. **AWS permissions required** — `s3:ListBucket`, `s3:GetObject`, `s3:GetObjectRetention` (if `--check-retention`).
  7. **Database access for `--check-chain`** — readonly Postgres connection string with `compliance_reader` role privileges; explicit example connection-string format.
  8. **Algorithm reference** — RFC 6962 link + the locked test vector from U8a so an external reviewer can verify our hash function in their own language.

**Patterns to follow:**
- `apps/cli/src/index.ts` — commander setup pattern.
- `apps/cli/README.md` — README structure.

**Test scenarios:**
- Happy path: `audit-verifier --bucket test --region us-east-1` against a mocked S3 bucket prints JSON to stdout, exits 0.
- Mismatch: same bucket with a poisoned anchor → JSON shows `verified: false`, exits 1.
- Unrecoverable: bucket doesn't exist → stderr message, exits 2.
- Required arg: `--bucket` missing → commander prints usage and exits non-zero.
- `--check-chain` without `--db-url` → commander rejects with a clear error.

**Verification:**
- README renders correctly on GitHub (tables, code fences).
- `pnpm --filter @thinkwork/audit-verifier build` produces a runnable bin.
- Manual: `node packages/audit-verifier/dist/bin/audit-verifier.mjs --help` prints the full flag list and example.

---

- U7. **--check-retention flag (S3 GetObjectRetention)**

**Goal:** When `--check-retention` is set, after each anchor's Merkle verification, fetch the object's retention metadata and assert mode ∈ {GOVERNANCE, COMPLIANCE} and `RetainUntilDate > now`. Failures land in `retention_failures[]`.

**Requirements:** R4, R8.

**Dependencies:** U5 (orchestrator), U4 (S3 client).

**Files:**
- Create: `packages/audit-verifier/src/retention.ts`
- Modify: `packages/audit-verifier/src/verify.ts` (call retention check when flag set)
- Create: `packages/audit-verifier/__tests__/retention.test.ts`

**Approach:**
- Export `checkRetention(s3, bucket, key): Promise<{ ok: true } | { ok: false; reason: string; mode?: string; retain_until_date?: string }>` — uses `GetObjectRetentionCommand`.
- Failure reasons: `"missing"` (no retention configured), `"expired"` (RetainUntilDate < now), `"invalid_mode"` (not GOVERNANCE or COMPLIANCE).
- Wired into U5's per-cadence loop only when `opts.checkRetention === true`.
- Each failure pushed to report's `retention_failures[]` with `{ key, mode, retain_until_date, reason }`.

**Patterns to follow:**
- AWS SDK v3 `GetObjectRetentionCommand` shape (different from `GetObject`'s).

**Test scenarios:**
- Happy path: anchor with `Mode: COMPLIANCE`, `RetainUntilDate: 2027-05-07` → ok.
- Happy path: anchor with `Mode: GOVERNANCE`, `RetainUntilDate: 2027-05-07` → ok.
- Failure: anchor with no retention configuration → push `reason: "missing"`.
- Failure: anchor with `RetainUntilDate: 2025-05-07` (past) → push `reason: "expired"`.
- Failure: anchor with `Mode: "BOGUS"` → push `reason: "invalid_mode"`.
- Default-off: `--check-retention` not set → no GetObjectRetention calls fired (covered by mock counter).

**Verification:**
- Tests pass.
- Verified the retention check NEVER calls PutObjectRetention or anything mutating — read-only S3 surface.

---

- U8. **--check-chain flag (lazy pg + per-tenant chain walk)**

**Goal:** When `--check-chain` is set, lazy-load `pg`, connect to Aurora via `--db-url`, and for each tenant in scope (or `--tenant-id` if specified) walk `compliance.audit_events` ordered by `recorded_at ASC` and assert each row's `prev_hash === previous row's event_hash`. Chain breaks land in `chain_failures[]`.

**Requirements:** R4, R5, R8.

**Dependencies:** U5.

**Files:**
- Create: `packages/audit-verifier/src/chain.ts`
- Modify: `packages/audit-verifier/src/verify.ts`
- Modify: `packages/audit-verifier/package.json` (`peerDependenciesOptional` or `devDependencies` for `pg`; users opt in by installing it themselves OR we ship it as a regular dep — implementer's call)
- Create: `packages/audit-verifier/__tests__/chain.test.ts`

**Approach:**
- `chain.ts` lazy-imports `pg` via dynamic `import("pg")` inside the function. Auditors who only need anchor verification never trigger the import.
- SQL: `SELECT event_id, event_hash, prev_hash, recorded_at FROM compliance.audit_events WHERE tenant_id = $1 ORDER BY recorded_at ASC, event_id ASC`. Tie-break on `event_id` for equal-microsecond timestamps.
- Walk: `prev_hash` of row N must equal `event_hash` of row N-1. First row's `prev_hash` must be NULL (genesis).
- Tenants in scope: if `--tenant-id` given, just that one. Otherwise: `SELECT DISTINCT tenant_id FROM compliance.audit_events`.
- Connection: single `pg.Client`, parameterized SQL, `await client.end()` on finish.
- Lazy-import is the operator-experience win — `npm install -g @thinkwork/audit-verifier` doesn't pull `pg` if you only audit anchors.

**Patterns to follow:**
- `packages/lambda/compliance-anchor.ts:264-321` — Aurora connection shape (lazy db client, error invalidation). U9 simplifies (no warm-cache reuse — single-shot CLI run).

**Test scenarios:**
- Happy path: mocked `pg.Client.query` returns 3 rows with valid prev_hash chain → no chain failures.
- Chain break: row 2's `prev_hash` doesn't match row 1's `event_hash` → push `{ tenant_id, broken_at_event_id: row2.event_id, reason: "prev_hash_mismatch" }`.
- Genesis violation: first row's `prev_hash` is non-null → push `{ tenant_id, broken_at_event_id: row0.event_id, reason: "non_null_genesis" }`.
- `--tenant-id` scope: only the named tenant's rows queried (mock asserts SQL parameter).
- Multi-tenant: 2 tenants × 3 events each = 2 chain walks, each independent.
- Lazy import: `--check-chain` not set → `pg` import never fires (covered by mock asserting dynamic-import wasn't called).
- Error path: `--check-chain` set without `--db-url` → CLI rejects at U6's commander layer (already covered there; chain.ts can assume `dbUrl` is non-empty).
- Error path: connection fails (bad URL) → orchestrator catches, exits with code 2.

**Verification:**
- Tests pass.
- Tree-shake / lazy-import verified: building the bin without `pg` installed doesn't fail unless `--check-chain` is exercised.

---

## System-Wide Impact

- **Interaction graph:** U9 is read-only. It calls S3 GetObject, S3 ListObjectsV2, S3 GetObjectRetention, and (optionally) Postgres SELECT on `compliance.audit_events`. It writes nothing to AWS or Aurora. No callbacks or middleware are involved.
- **Error propagation:** Verification mismatches are data, not errors — they accumulate in the report and the CLI exits 1. Unrecoverable infrastructure errors (S3 AccessDenied, bucket missing, DB connection failure) are real exceptions, surface to stderr, exit 2.
- **State lifecycle risks:** None — verifier is single-shot. No partial-write concerns; no cache; no long-lived connections beyond the single CLI run.
- **API surface parity:** The programmatic `verifyBucket(opts)` API and the CLI must stay in lockstep. Both consume the same opts shape; the CLI's commander config is just a parser into that shape. Shared tests would be ideal — implementer should add at least one CLI-shape test that runs the bin and asserts JSON output matches programmatic-API output for the same inputs.
- **Integration coverage:** Cross-implementation byte agreement with U8a/U8b is the highest-stakes integration. The fixture in U2's test scenarios is the structural defense; if U2's fixture passes, the entire bucket can be verified against any future re-implementation in another language.
- **Unchanged invariants:** U9 changes nothing in the writer (`packages/lambda/compliance-anchor.ts`), the watchdog, the IAM roles, the bucket policy, or any deployed Lambda. The verifier is purely additive — a new package the auditor or an internal CI gate runs out-of-band.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Verifier's leaf math drifts from writer's, every cadence becomes unverifiable. | U2's locked test vector from U8a (`701e2479c1ad3506b53c1355562082b44dd68112b018e73e4c39a869e680bcb3`) is the byte-exact contract. Test fails loudly the moment drift occurs. |
| `@aws-sdk/client-s3` version drift between writer and verifier could cause checksum or chunked-encoding interop bugs. | Verifier pins a stable LTS S3 SDK version independent of the monorepo's pin (verified at U1 package.json). External auditors trust the verifier's pin, not ours. |
| zod schema is too strict and rejects an emitted-but-not-yet-documented field. | `.passthrough()` mode for forward compat per R7. Test scenario explicitly covers the unknown-field case. |
| Pagination silently truncates, verifier reports `verified: true` for a partial bucket. | U4's pagination test asserts ContinuationToken is exercised. Failure mode is loud — the truncation test fails before any real bucket runs. |
| `--check-chain` Aurora connection floods with too many parallel queries on a multi-tenant scope. | Single-connection serial chain walk per tenant; auditor's read-only role rate-limits naturally. Concurrency cap is for S3, not DB. |
| Auditor uses a profile that lacks `s3:GetObjectRetention` and `--check-retention` silently no-ops. | Failure is captured as `retention_failures[]` entry with `reason: "missing"` for every anchor — won't silently pass. README documents the IAM permissions required. |
| Verifier's schema rejects a future U10/U11 schema_version bump as part of a backwards-compatible change. | R7 + the schema test scenario cover this — additional fields are accepted; only `schema_version` itself is hard-gated. U10 must coordinate version bump with verifier release. |
| External auditor installs from npm and runs against a stale binary that doesn't know about new schema version. | `package.json` `version` is bumped per release; README explicitly documents which `schema_version` values each verifier release supports. CI gate can `audit-verifier --version` to assert minimum. |

---

## Documentation / Operational Notes

- **Public README** at `packages/audit-verifier/README.md` is the canonical operator-facing doc. Should be readable cold by an external SOC2 auditor with no prior context.
- **Threat model section in the README** is load-bearing — it tells auditors what the verifier proves AND what it does NOT prove (it doesn't prove the writer is correct in the absence of WORM; it doesn't prove the bucket policy is correct; it doesn't prove the Aurora chain is unbroken without `--check-chain`).
- **CHANGELOG.md** at `packages/audit-verifier/CHANGELOG.md` — track schema version compat, breaking flag changes. Initial entry: `0.1.0 — supports schema_version: 1 (U7-U8b emit format)`.
- **Publish process** is deferred to a follow-up — initial PR ships the package, a separate PR handles `npm publish` workflow + 2FA + GitHub Action. Don't block U9 on publish automation.
- **Internal CI use** — once shipped, `deploy.yml`'s `compliance-anchor-smoke` job can additionally invoke the verifier in a sampled mode (last 24h of cadences) as a deeper post-deploy check. Out of scope for U9; surface as a follow-up issue.

---

## Sources & References

- **Origin master plan:** `docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md` (U9 entry).
- **Predecessor plans:** `docs/plans/2026-05-07-009-feat-compliance-u7-anchor-bucket-plan.md` (bucket), `docs/plans/2026-05-07-010-feat-compliance-u8a-anchor-lambda-inert-plan.md` (inert seam), `docs/plans/2026-05-07-012-feat-compliance-u8b-anchor-lambda-live-plan.md` (live writer).
- **Algorithm spec:** [RFC 6962 §2.1 Merkle Tree Hash](https://datatracker.ietf.org/doc/html/rfc6962#section-2.1).
- **Locked test vector:** `packages/lambda/__tests__/integration/compliance-anchor.integration.test.ts:165-191`.
- **Writer reference (do not import):** `packages/lambda/compliance-anchor.ts`.
- **CLI pattern reference:** `apps/cli/`.

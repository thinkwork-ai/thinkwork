# THINK-193 U1 dogfood evidence — deployed dev, 2026-07-11

Real authorized Twenty CRM data processed into the shared Tenant Bank through
canonical Workflow executions on the deployed dev stack (account
487219502366). Companion fixture: `think-193-u1-twenty-dossier-fixture.json`
(synthetic probe company only — no customer records). Inspector:
`packages/api/scripts/memory-sources/inspect-run.ts`.

## Identifiers

| Thing                  | Value                                                                      |
| ---------------------- | -------------------------------------------------------------------------- |
| Tenant                 | `0015953e-aa13-4cab-8398-2e70f73dda63` (sleek-squirrel-230)                |
| Processor config       | `0eb1c5c1-4acf-4bd1-b404-304b071d660e` (shared/tenant)                     |
| Source config          | `44a5684b-f236-4f87-8336-6373c2e926da` (twenty)                            |
| Workflow               | `c842fd57-41f1-456f-90c5-7ea6f5d4c40d` "Memory: Twenty proving slice (U1)" |
| Target bank            | `tenant_0015953e-aa13-4cab-8398-2e70f73dda63`                              |
| Worker Lambda          | `thinkwork-dev-api-memory-stage-worker` (deploy run 29175254162)           |
| Probe company (Twenty) | `6bb03870-cd00-44ba-b945-b11001e2ca68` "Acme Probe (THINK-193 U1)"         |

## Runs (workflow_runs; all `succeeded`, all four memory_stage tokens consumed per run)

1. **Bootstrap** `2e3a84a7-e5dc-4cf3-a4e8-8f6488fae0bd` — acquire changed=5,
   project 5, retain 5 (five active derivations with stable
   `external:<sourceConfigId>:company:<twentyId>` document ids), compound →
   `brain_dream_runs` `c999201c…` applied {consolidate: 1}. Checkpoint
   `companies` v1. Recall: "Acme Probe is a company with 42 employees."
2. **Replay** `8219e6b4-23b2-4974-a370-3952006443f4` — visible no-op:
   acquire changed=0/seen=0, project/retain noop, compound applied. No
   duplicate evidence rows or Hindsight documents.
3. **Change** `40134eb9-8e65-4cc6-9b5d-634864f3aabd` — after PATCHing the
   probe company employees 42→77: acquire changed=1 (only the changed
   record), old evidence version marked `superseded`, ONE active derivation
   updated in place (same document id, new source version), checkpoint CAS →
   v2, dream `328de5ab…` applied. Recall: "Acme Probe is a company with 77
   employees, identified as THINK-193 U1." — the replaced dossier, not an
   appended duplicate.

## Scenario coverage

- Bootstrap / replay / change: live above.
- Nil/empty: run 2 is the zero-changed-records visible no-op.
- Scope: worker rejects `user_*`/personal processors (unit-tested R11/AE7
  guard; shared-scope check runs before any source read or bank write).
- Error: 5xx retain surfaces retryable failure before checkpoint advance
  (contract test); acquire checkpoint advances only in the evidence-page
  transaction.
- Contract: Hindsight 0.8.4 replace/delete/orphan probe recorded in
  `docs/solutions/tooling-decisions/hindsight-084-document-lifecycle-probe-2026-07-11.md`.

## Fixture shape note for U2

The committed fixture is the synthetic probe company, whose depth-1 relations
(people/opportunities/notes) are empty. Real dev companies carried the same
envelope with `domainName`, `address`, `annualRecurringRevenue` composites;
U2's claim fingerprint/effective-date review should also exercise a
relation-bearing snapshot (re-run the inspector against a real company id in
dev — not committed here to keep customer data out of the repo).

---

## U2 dogfood evidence (2026-07-12, dev, post-merge deploy of PR #3611)

Stack: main commit 88569af74 deployed by run 29194746506 (memory-stage-worker 13:46Z,
memory-retraction-drainer 13:54Z under dedicated role `thinkwork-dev-memory-retraction-drainer-role`,
schedule `rate(5 minutes)` ENABLED). Migrations 0232–0238 applied; amended 0237 re-run proved
idempotent (repair no-op inside one lock-guarded transaction, index CREATE skipped).

IDs: tenant `0015953e-…da63`, processor `0eb1c5c1`, source `44a5684b`, workflow `c842fd57`,
probe company `6bb03870` ("Acme Probe (THINK-193 U1)"), bank `tenant_0015953e-…da63`.

### Pre-fix pilot-data backfill (deterministic repair, independently verified)
1. Active edges to non-active evidence retracted (3); duplicate identical active claims superseded
   keeping earliest (2); duplicate supports repointed to keepers via insert-or-activate (2).
2. Temporal closure: superseded single-valued rows closed at successor `effective_from`
   (employees 77 → 2026-07-12T10:42:41.287Z); identical-value duplicate editions closed zero-length.
3. Verifier `packages/api/scripts/memory-sources/verify-claim-invariants.sql`: **all five invariants 0**
   (identical duplicates, single-valued duplicates, active edges→non-active evidence [quiescent],
   zero-support active claims, unclosed superseded single-valued).

### Change run c9b55ec8 (probe employees 91→103, updatedAt 14:10:09.437Z)
- acquire: 1 changed / 4 seen (content-sensitive editions; recipe change caused no spurious re-registration)
- project: claims=3, **claimsCreated=1** (employees only — name/address REUSED active claims;
  duplication bug dead in production), claimsSwept=0, claimsSupported=3
- Temporal ledger: `77 [01:55:56→10:42:41] superseded · 91 [10:42:41→14:10:09] superseded ·
  103 [14:10:09→) active` — every ended interval closed
- Recall: "Acme Probe (THINK-193 U1) is a company with 103 employees."
- Verifier: all five invariants 0.

### Revocation (fail-closed, per-page revalidation deployed)
All grants revoked (status=revoked, grant_version bumped) → run 3fc194d1 FAILED at acquire with
persisted result: "the memory-source authorization … is revoked — re-grant access before ingestion
runs"; no provider page read; checkpoint version/cursor unchanged. Re-grant (5df3e168, boundary
`{maxRecords:200, objects:["companies","relations"]}`) restored acquisition.

### Retraction saga round-trip (attempt bdbb5f4c, derivation c4dbec96)
- Enqueued 14:13:22Z; **scheduled drainer** (no manual invoke) processed it: status `retracted`,
  attempt_count=1 (provider delete FIRST, then atomic internal finalize).
- Hindsight document GET → 404; derivation lifecycle `retracted`; zero active claims for the subject.
- **Zero recall residue**: recall for "Acme Probe employees" returns no Acme Probe units (document
  delete cascaded derived observations, matching the 0.8.4 lifecycle probe).
- Idempotent replay: re-enqueue for the already-retracted derivation returns null (no-op, no new attempt).

### Source erase (durable aggregate, one operator initiation)
- `beginSourceErase` (atomic: pin + disable + erase_generation bump + marker) + `runSourceErase`:
  4 children retracted inline via Hindsight deletes; destructive S3 cleanup DEFERRED to the drainer
  ("dedicated-role destructive S3 work"); aggregate `pending`.
- Next scheduled tick self-finalized cleanup: marker → `retracted` (phases through snapshots →
  evidence purge → checkpoints LAST). Drainer metric:
  `{"metric":"memory_retraction_drainer", …, "eraseAggregatesCompleted":1, "errors":0}`.
- **S3 versioned-bucket proof**: `list-object-versions` on
  `evidence-snapshots/<tenant>/<source>/` → `versions: 0, deleteMarkers: 0`.
- DB: evidence_not_deleted=0, payload_residue=0, checkpoints=0, active_claims=0, active_derivations=0.

### Notes
- One-time evidence re-registration from the extraction-recipe change (depth+objects recorded) was
  expected; in practice the content hash stayed stable for unchanged rows (4 seen), so no churn.
- U4 design probe: `<!-- claim:id -->` markers do NOT survive into Hindsight-synthesized
  observations; `world` units carry `document_id` — claim-support propagation joins out-of-band
  (unit → document → derivation → evidence → claim edges).
- Dev DB credential rotation is pending (exposed in local process args during a drift check).

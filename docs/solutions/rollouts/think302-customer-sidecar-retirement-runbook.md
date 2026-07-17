# THINK-302 Customer Rollout Runbook — Sidecar Retirement (TEI → McPherson)

**Status:** ready to execute; requires a **customer-stage-authenticated session** (this was authored from a dev-only session). Dev is fully cut over and verified (2026-07-16): backfill applied, sidecars deleted, 31 active / 0 withheld, eval 114/119 ≥ 112/119 baseline.

**Do NOT skip the ordering or the dry-run review.** Each customer stage is production. TEI must be fully proven before McPherson starts.

## Preconditions (all must hold before touching a customer stage)

1. **Customer API deployed to a THINK-302 version.** TEI + McPherson are pinned at **v364**, which predates THINK-302. They must first deploy to **≥ `v0.1.0-canary.366`** (the release that carries the registry-trust key fix #3873, the U8 writers #3869, and the space-folder render #3877). Until then their `graphql-http` compile emits the *old* sidecar path and the registry-trust path is broken (see [[project_registry_binding_key_mismatch]]).
   - Verify: `thinkwork me -s <stage>` resolves, and the deployed `graphql-http` is on the canary.366+ artifact per the customer deploy runner ledger.
2. **#3873 specifically must be live** on the customer API — this is the fix that made the registry-trust path work end-to-end. Without it, flipping the flag + retiring sidecars strands every grant as an "unsigned proposal" (the exact regression caught on dev).
3. **Dev soak observed.** Let dev run on the registry-trust path with the loud-log fallback active long enough to confirm no straggler agents trigger `sidecar_fallback` logs. Dev cut over 2026-07-16 — give it real soak time before customer production.
4. **Delete UUID husk folders first** (per the U18 rollout record) so the mover doesn't backfill dead husks.

## Per-stage sequence (run for TEI first; McPherson only after TEI is proven)

Let `STAGE` ∈ {`tei`, `mcpherson`} and `TENANT` = the customer's tenant slug (must equal the claimed domain name — see [[project_customer_domain_namespace]]).

### 1. Authenticate + confirm version
```bash
thinkwork login --stage <STAGE>
thinkwork me -s <STAGE>          # confirm tenant + that API is canary.366+
```

### 2. Flip the per-tenant trust flag ON
`tenants.capability_registry_trust = true` for `TENANT` (the established opt-in flag). Flip ONLY the tenant being migrated — not the whole stage.

### 3. Mover DRY-RUN → review (read-only, writes nothing)
```bash
thinkwork sidecar-retirement-mover -s <STAGE> -t <TENANT> --dry-run
```
Review the clean-vs-drift report **with Eric**:
- Clean signed pair → binding at POST-merge sha (provenance preserved).
- Drifted marker → NO binding, stays withheld (expected; investigate any surprises).
- Confirm the count of folders ≈ expected grants; no unexplained "unsigned" drops.

### 4. Mover APPLY (destructive — only after the dry-run is reviewed + explicitly approved)
```bash
thinkwork sidecar-retirement-mover -s <STAGE> -t <TENANT> --apply
```
Deletes `.assignment.json` sidecars and writes `capability_approvals` bindings.

### 5. Verify (must match the dev cutover result)
- S3: `0` remaining `.assignment.json` under `tenants/<TENANT>/agents/**`.
- DB: binding count == distinct installed folder count (one per folder).
- Live manifest: query `workspacePreview`/`capabilities.json` for a rich agent → **N active, 0 withheld**, no `unsigned` proposals. (Mirror the dev check: `Space/CONTEXT.md` etc. render; connection/tool grants ACTIVE with `source_scope=agent:<id>`.)
- Regenerate workspace maps (CLI writes don't trigger map regen).

### 6. Only if TEI verifies clean → repeat 1–5 for McPherson.

## Rollback
The trust flag is the kill switch: setting `capability_registry_trust = false` reverts the compile to the sidecar path — but the mover has already **deleted** the sidecars on `--apply`, so rollback after apply requires restoring sidecars from the pre-apply state. Therefore: **the dry-run review IS the safety gate.** Do not `--apply` until the report is clean and approved.

## Related
[[project_sidecars_being_killed_think302]] · [[project_think302_dev_cutover_verified]] · [[project_customer_deploy_runner_migration_ledger]] · [[feedback_migration_deploy_ordering]]

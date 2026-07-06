---
module: skill-catalog-distribution
date: 2026-07-05
problem_type: integration_issue
component: service_object
severity: high
symptoms:
  - "Updated packages/workspace-defaults skill content (document-composer plate templates with tw-plate marker) shipped in canary.319 and deployed to dev + customer stacks, yet agents on every stack kept the old plates"
  - "Deploy-time default-skill seeder ran but never republished the changed skill to tenant catalogs"
  - "Republishing the catalog still left agents stale — installCatalogSkill returned already_installed and skipped the materialized workspace copy"
  - "Path-gated workspace_defaults Bootstrap job never ran: the PR's own deploy run was cancelled by GitHub Actions concurrency supersession and the succeeding run's paths-filter only saw its own commit's changes"
  - "Near-miss: with the new server-side PLATE gate live, the stale unmarked workspace plate would fail its own validation gate — document emission would have soft-bricked on customer stacks"
root_cause: missing_workflow_step
resolution_type: code_fix
related_components:
  - skill-trust-seeder
  - catalog-install
  - catalog-reinstall
  - github-actions-deploy
  - workspace-defaults
tags:
  - default-skills
  - skill-catalog
  - seed-default-skills
  - reinstall-catalog-skill
  - workspace-materialization
  - github-actions-concurrency
  - paths-filter
  - workflow-dispatch
---

# Default-skill content updates never reach agents — seeder allowlist + install-skip + deploy supersession

## Problem

Updating a default skill's content in `packages/workspace-defaults` and deploying everywhere did not update what agents actually read. During the THINK-177 rollout (2026-07-05), document-composer's plate templates gained a `tw-plate` marker that a new server-side DocSpector PLATE gate enforces. The plate change shipped through the dev pipeline and the canary.319 controller deploys to the TEI and McPherson customer stacks — every deploy succeeded — yet the S3 catalog copies and the materialized workspace copies of `skills/document-composer/references/plate-*.html` still held the old, unmarked content on all three stacks.

This was a near-miss with real teeth: the PLATE gate rejects any render not authored on a marked plate. With stale unmarked plates in the workspace, the agent would copy the plate faithfully and _still_ be rejected — document emission would have been soft-bricked on customer stacks. The content gate shipped, but the content it validates against never did.

## Symptoms

- `tenants/<slug>/skill-catalog/document-composer/references/plate-*.html` in S3 kept old timestamps/content after successful deploys on dev, tei-e2e, and mcpherson.
- Materialized workspace copies under `tenants/<slug>/agents/<agent-slug>/skills/document-composer/` were equally stale — the runtime's `workspace_skill` tool reads these, so agents saw old plates.
- Deploy-time seeder output reported `defaultSkillsPublished: 2`, which looked like success but never included document-composer.
- New DocSpector PLATE gate would reject documents authored from the stale (unmarked) plates the agent was still reading.

## What Didn't Work

- **Assuming the customer release deploy reseeds skills.** The controller-driven customer deploy (canary.319) updates lambdas, terraform, and web — it runs no skill seeding at all.
- **Trusting `defaultSkillsPublished: 2` in seeder output.** Those two were artifact-builder and automation-loop-designer, the only slugs in the allowlist. The number said nothing about document-composer.
- **Running the one-off tsx script from the repo root.** esbuild compiled it as CJS and top-level await failed with `Top-level await is currently not supported with the cjs output format`. Moving the script inside `packages/api` (which has `"type": "module"`) fixed it.
- **Setting `STAGE` alone for the seeder.** Outside the deploy workflow it errors with `SkillSpector is not configured (no skill-trust-runner)`; `SKILL_TRUST_RUNNER_FUNCTION_NAME=thinkwork-<stage>-skill-trust-runner` must be exported explicitly.

## Root Cause

Three stacked causes, each sufficient to keep agents on stale content:

1. **Seeder allowlist gap.** `document-composer` was not in `DEFAULT_CATALOG_SKILLS` in `packages/api/src/lib/skill-trust/seed-default-skills.ts`. The deploy-time seeder only republishes listed skills (artifact-builder, automation-loop-designer). Its sha-based idempotency is irrelevant when the slug is never even considered.
2. **Install skips existing.** `installCatalogSkill` (`packages/api/src/lib/catalog-install.ts`) returns `already_installed` when the workspace folder exists. Since the runtime reads the _materialized_ copy under `tenants/<slug>/agents/<agent-slug>/skills/<slug>/`, even a successfully republished + re-trusted + re-signed catalog leaves agents on stale content. `reinstallCatalogSkill` (`packages/api/src/lib/catalog-reinstall.ts`) re-materializes from the catalog and is the required second step.
3. **Concurrency supersession skips path-gated CI.** The PR's own `deploy.yml` run was cancelled by concurrency supersession; the next run's `dorny/paths-filter` only saw its own commit's paths, so the `workspace_defaults`-gated Bootstrap job (`seed-workspace-defaults.ts`) never executed for the plates change. `gh workflow run deploy.yml` (workflow_dispatch) forces the Bootstrap job unconditionally.

## Solution

Per stack (dev / tei-e2e / mcpherson) — customer Aurora clusters are reachable from a laptop:

```bash
PASS=$(aws secretsmanager get-secret-value --secret-id thinkwork-<stage>-db-credentials --query SecretString --output text | jq -r .password)
export DATABASE_URL="postgresql://thinkwork_admin:${PASS}@<cluster-endpoint>:5432/thinkwork?sslmode=no-verify"
export WORKSPACE_BUCKET=thinkwork-<stage>-storage STAGE=<stage> AWS_REGION=us-east-1
export SKILL_TRUST_RUNNER_FUNCTION_NAME=thinkwork-<stage>-skill-trust-runner
npx tsx packages/api/<oneoff>.ts
```

The one-off script must live **inside `packages/api`** (ESM, so top-level await works) and performs both halves of the fix:

```ts
await seedDefaultCatalogSkills({
  s3,
  bucket,
  tenantId,
  tenantSlug,
  skills: [{ slug: "document-composer", autoGrant: true }],
});
// republish + re-trust the catalog is NOT enough — re-materialize the workspace copy:
await reinstallCatalogSkill({
  s3,
  bucket,
  tenantSlug,
  targetPrefix: "tenants/<slug>/agents/<agent-slug>/",
  slug: "document-composer",
});
```

Verification: the workspace copy of `plate-report.html` contains the `tw-plate` marker on all three stacks (dev, TEI, McPherson) — confirmed live.

## Why This Works

Skill content has two hops between the repo and the agent: repo → tenant S3 catalog (seeder publish + trust + sign), then catalog → materialized workspace folder (install). The fix addresses both hops explicitly. `seedDefaultCatalogSkills` with an explicit `skills` list bypasses the `DEFAULT_CATALOG_SKILLS` allowlist gap and republishes the catalog copy; `reinstallCatalogSkill` bypasses `installCatalogSkill`'s already-installed short-circuit and re-materializes the workspace copy the runtime actually reads. Running the script from `packages/api` keeps it in ESM output so top-level await compiles, and exporting `SKILL_TRUST_RUNNER_FUNCTION_NAME` gives the seeder the SkillSpector trust runner it normally gets from the deploy workflow environment. Nothing here depends on CI path filters, so the supersession failure mode is sidestepped entirely.

## Prevention

Done:

- #3387 added document-composer to `DEFAULT_CATALOG_SKILLS` in `packages/api/src/lib/skill-trust/seed-default-skills.ts`, so future deploys republish it.

Remaining:

- ~~The seeder should **reinstall, not skip**, when the catalog `content_sha` changed~~ — **fixed in #3408 (2026-07-06)**: `ensurePlatformAgentInstall`'s already-installed path now runs `reinstallCatalogSkill`, which no-ops when the installed ref sha matches the catalog sha and re-materializes (+ regenerates the manifest) when it doesn't. Live-proven during the THINK-154 customer cutover: the seeder logged "workspace copy was stale — re-materialized 9 files" on both customer stacks.
- **New gotcha (THINK-154 cutover, 2026-07-06):** the manual seed one-off publishes from the LOCAL checkout's inlined workspace-defaults canon. Run it from a **stale checkout** and it silently reports "already current" while comparing old content to old content — the update never ships and nothing errors. Always run the one-off from a checkout at (or past) the commit that changed the skill content.
- Supersession-cancelled runs need a sticky/dispatch mechanism for path-gated jobs (a superseding run's `dorny/paths-filter` only sees its own commit's paths). Until then, `gh workflow run deploy.yml` after a cancelled run whose paths mattered.
- **Design rule:** any future "validate against skill asset X" gate must confirm X's distribution path exists and actually delivers updated content _before_ the gate ships. Content gates and content distribution must ship together — a gate that outruns its content soft-bricks the feature it guards.

## References

- `docs/solutions/runbooks/publish-default-skill-to-tenant-catalog-2026-07-04.md` — the manual publish+trust+install runbook this incident re-ran; note it predates the deploy seeder (#3372) and its install step shares the skip-if-exists gotcha (use `reinstallCatalogSkill` for content updates).
- `docs/solutions/integration-issues/merged-terraform-iam-grant-silently-unapplied-targeted-apply-gap.md` — the terraform/IAM instance of the same supersession + paths-filter gap; this doc is the Bootstrap/workspace_defaults instance.
- `docs/solutions/diagnostics/skill-trust-gate-silently-drops-skills-2026-07-04.md` — the downstream trust/signature gate a republished skill must still pass.
- `docs/solutions/architecture-patterns/workspace-skills-load-from-copied-agent-workspace-2026-04-28.md` — why the materialized workspace copy is what agents read.
- PRs: #3381 (the PLATE gate whose rollout surfaced this), #3387 (allowlist fix), #3372 (the deploy seeder itself).

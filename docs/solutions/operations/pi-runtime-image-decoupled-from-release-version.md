---
module: terraform/modules/app
date: 2026-07-25
last_updated: 2026-08-09
category: operations
problem_type: deployment_issue
component: agentcore_pi
severity: high
supersedes: pi-runtime-image-decoupled-from-release-version-2026-07-25.md
related_components:
  - deployment
  - ecr
  - step_functions
  - database
applies_when:
  - "Deploying a release version to a customer environment (Release Cutover)"
  - "A change touches packages/agentcore-pi and must reach the running agent"
  - "Verifying that a customer environment's agent runtime matches its reported release"
  - "A hand-rolled drizzle migration landed in a release a customer environment has not yet taken"
tags:
  - deployment
  - agentcore-pi
  - ecr
  - release-version
  - pi-image-pin
  - release-mirror
  - customer-environments
---

# A release-version bump does NOT update the Pi runtime image

## Context

A customer Stage's deployment input carries **two independent pins** that advance
on separate cadences:

```json
{
  "releaseVersion": "v0.1.0-canary.411",
  "agentcorePiSourceImageUri": "<acct>.dkr.ecr.<region>.amazonaws.com/thinkwork-<env>-agentcore:<tag>@sha256:<digest>"
}
```

In `apps/cli/src/commands/release/helpers.ts`, `buildControllerUpdateInput`
(~lines 313–345) constructs the `releasePin` object fresh from the target
release, while `agentcorePiSourceImageUri` is **carried forward** from the prior
successful execution unless explicitly changed. Bumping `releaseVersion` updates
lambdas, Terraform, and the web bundle; the agent runtime keeps running whatever
image the Pi Image Pin names.

## The trap: the skew is invisible

The version reported by `/thinkwork-runtime-config.json` is `releaseVersion` —
so **the environment looks current while its agent is not**. Real incident: TEI
was on release **canary.406** while its Pi image was pinned to **canary.345** —
an agent runtime months behind the release it appeared to be on, with no error
anywhere, because nothing user-visible compares the two pins.

## What keeps the pins honest now

The manual procedures the original version of this doc prescribed have been
automated (see History below). Today:

- **CI mirrors the image**: release.yml's `mirror-customer-images` job copies
  the arm64 Pi image by digest into every customer ECR listed in
  `.github/release-mirror-targets.json` under tag `<releaseVersion>-pi-arm64`
  (`.github/workflows/release.yml` ~339–392, THINK-616). The Release Mirror is
  arm64 — the old "must build amd64" advice does not apply to this path.
- **`thinkwork release deploy <tag> -s <stage> -y`** recovers the last
  SUCCEEDED controller input and swaps only the release pin
  (`helpers.ts` `recoverPriorControllerInput` ~258–307) — no hand-edited
  payloads.
- **The runner refuses unpinned foundations**: customer foundation updates
  without a customer-ECR Pi pin raise
  `RuntimeError("Customer foundation updates require an explicit customer-ECR agentcorePiSourceImageUri; refusing to fall back to the release registry.")`
  (`terraform/modules/app/deployment-control-plane/runner.py`
  `resolve_agentcore_pi_source_image_uri` ~3306–3334).
- **The runner reconciles the runtime**: after a successful apply it pins the
  Pi AgentCore Runtime to the mirrored image's digest
  (`runner.py` `reconcile_agentcore_pi_runtime` ~3345, invoked ~7227,
  THINK-584 U5). Note: it prints a SKIPPED message and does nothing when the
  release bundle predates `reconcile_pi_runtime.js` — a skip means the runtime
  was NOT updated.

## What an operator still owns

### Verify adoption, not just the build

`imagePushedAt` proves the image was built; **`lastRecordedPullTime` inside the
deploy window** proves the runtime adopted it:

```bash
aws ecr describe-images --repository-name thinkwork-<env>-agentcore \
  --image-ids imageTag=<tag> \
  --query 'imageDetails[0].{pushed:imagePushedAt,pulled:lastRecordedPullTime}'
```

After a deploy, verify the served `releaseVersion` **and** the ECR
`lastRecordedPullTime` — not the Step Functions status alone.

### Migration idempotency

The runner's Migration Ledger sweep applies every unrecorded migration
unattended during customer deploys (`runner.py`: `ensure_migration_ledger`
~3768, `recorded_platform_migrations` ~3781,
`backfill_platform_migration_ledger` ~3880). The residual obligation: any
hand-rolled migration must be **idempotent and input-free**
(`IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`), because the sweep will replay
it on environments in unknown states. See
[manually-applied drizzle migrations drift from dev](../workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md).

## History

Earlier revisions of this doc (dated 2026-07-25) prescribed three manual
procedures, all since superseded:

1. **Manual `docker buildx --platform linux/amd64` build+push into customer
   ECR** → replaced by the CI Release Mirror (PR #4209 / THINK-616,
   2026-08-05), which mirrors arm64 by digest.
2. **Hand-cloning the last SUCCEEDED Step Functions payload and editing
   fields** → replaced by `thinkwork release deploy`, plus the runner's
   Pi-pin guard (PR #3650, 2026-07-13).
3. **Manual migration pre-check/apply on the customer DB** → replaced by the
   Migration Ledger sweep; only the idempotency caution above survives.

The enduring lesson is unchanged: the two pins are independent by construction,
and an environment's reported version tells you nothing about its agent runtime.

## Related

- [Customer updates use release deploy, not the deploy controller](../workflow-issues/customer-updates-use-release-deploy-not-deploy-controller-2026-07-12.md) — current procedure
- `docs/runbooks/customer-release-cutover.md` — authoritative runbook for Release Cutover
- [Manually-applied drizzle migrations drift from dev](../workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md)

---
title: "Customer stage updates go through `release deploy`, not `deploy --controller`"
date: 2026-07-12
last_updated: 2026-08-09
category: docs/solutions/workflow-issues/
module: release-engineering
problem_type: workflow_issue
component: deployment_controller
severity: high
applies_when:
  - Rolling a release out to TEI, McPherson, or any customer-owned stage
  - "A customer deploy fails in the runner CodeBuild with \"RuntimeError: Customer foundation updates require an explicit customer-ECR agentcorePiSourceImageUri; refusing to fall back to the release registry.\""
  - "The CLI refuses with \"A full customer release update requires a customer-ECR AgentCore Pi image pin\""
  - Wondering how the Pi runtime image reaches a customer account (it is mirrored by release.yml, not by hand)
  - Onboarding a new enterprise account into the release pipeline
  - Following any operational runbook whose "proven" date predates recent platform hardening
tags: [deploy, controller, customers, tei, mcpherson, ghcr, agentcore, release, canary, supply-chain, runbook-drift]
---

# Customer stage updates go through `release deploy`, not `deploy --controller`

## The command

```bash
AWS_REGION=us-east-1 AWS_PROFILE=tei       thinkwork release deploy v0.1.0-canary.<N> -s tei-e2e   -y
AWS_REGION=us-east-1 AWS_PROFILE=mcpherson thinkwork release deploy v0.1.0-canary.<N> -s mcpherson -y
```

(First-time installs are `thinkwork enterprise bootstrap`, not this. `--web-only` syncs only the web static bundle — no terraform, no Pi pin needed. `--no-wait` prints the Step Functions ARN and returns.)

Verify per stack:

```bash
aws ssm get-parameter --name /thinkwork/<stage>/deployment/selected-release-version \
  --profile <p> --region us-east-1
```

## Why the other path looks like it should work, and doesn't

`thinkwork deploy --controller --controller-action update …` also starts the
customer's Step Functions orchestrator, so it *appears* to be the same thing.
It is not: it builds the controller payload **from scratch**, while
`release deploy` builds it by reading the stage's **prior successful deployment
evidence** and carrying forward the fields a customer stack depends on — most
importantly the customer-ECR Pi image pin. `recoverPriorControllerInput`
(`apps/cli/src/commands/release/helpers.ts`) takes the newest successful input
as the baseline and back-fills customer-owned facts (the Pi pin, AgentCore
Harness config) from older successes, restricted to the same environment,
account, and region; `buildControllerUpdateInput` then refuses a full update
when no valid pin exists anywhere in history:

```
A full customer release update requires a customer-ECR AgentCore Pi image pin. ...
mirror the approved Pi image into this customer account and bootstrap the pin before retrying.
```

**Since PR #3650 (2026-07-13), the raw path fails loudly by design.** The
runner's `resolve_agentcore_pi_source_image_uri`
(`terraform/modules/app/deployment-control-plane/runner.py`) classifies
`action == "update"` / `kind == "foundation"` as a customer update, requires
any explicit pin to sit under `{account_id}.dkr.ecr.{region}.amazonaws.com/`,
and with no pin raises — in the runner CodeBuild, before any terraform, leaving
the stack untouched:

```
RuntimeError: Customer foundation updates require an explicit customer-ECR
agentcorePiSourceImageUri; refusing to fall back to the release registry.
```

If you hit this, the fix is **"use the other entrypoint"** — rerun with
`thinkwork release deploy`; no cleanup is needed. (Verified live 2026-08-09
shipping v0.1.0-canary.449: the raw path failed both customer stacks on this
guard; the release command then converged both in ~10 minutes.)

*Historical note (pre-#3650):* the runner used to silently default a missing
pin to the release manifest's GHCR image, and the deploy died later on an
anonymous pull of the private package
(`Get "https://ghcr.io/v2/…": unauthorized`). PR #3650 replaced that late,
confusing failure with the early guard above. The right response was never
"make the GHCR package public" — that "fixes" the symptom by exposing the
runtime image.

## The Pi image mirror is CI's job now

The pin can only reference the customer's own ECR, so something must put the
image there. Since PR #4209 / THINK-616 (2026-08-05), `release.yml`'s
`mirror-customer-images` job copies the arm64 Pi image by digest into every
customer ECR listed in `.github/release-mirror-targets.json` (tag
`<releaseVersion>-pi-arm64`) when the release tag is cut. The old manual
`docker tag`/`docker push` pre-mirror is obsolete.

Onboarding a new enterprise account is one edit to that file:

```json
{ "stage": "newcustomer", "accountId": "111122223333", "region": "us-east-1",
  "repository": "thinkwork-newcustomer-agentcore" }
```

If the CLI-side "requires a customer-ECR AgentCore Pi image pin" error fires,
the mirror never landed for that account — check the release run's
`Mirror arm64 Pi image (<stage>)` job and the targets file before retrying.

## Manifest digests (historical trap, hand-built payloads only)

`release deploy` resolves the manifest URL and digest itself. Hand-built
payloads used to hit `Release manifest digest mismatch` when the SHA-256 was
taken between `release.yml` and the (since-retired) desktop release workflow
re-uploading the manifest. If you ever pin a manifest by hand, download it
after every release workflow touching the tag is green.

## What the guardrails got right

Every one of these failures stopped the deploy cleanly: the runner refused
before terraform, the customer stacks stayed on their previous release, and
failure evidence landed in their evidence buckets. Nothing half-deployed.

## The meta-lesson: proven-once runbooks drift

`docs/runbooks/customer-release-cutover.md` was "proven end-to-end 2026-07-06"
— and broken by design seven days later when #3650 landed, then further
obsoleted by #4209. A proof date is a freshness stamp, not a warranty:
operational runbooks sit outside the test suite, so platform hardening breaks
them silently. Two habits keep them honest (both applied in the PR #4260
refresh):

- After any guard trips an operator, refresh the runbook **quoting the guard's
  exact error text verbatim** — guards should be greppable, and the runbook
  should be the top hit for its own error message.
- When a runbook step becomes CI's job or a dedicated command, delete the step
  and say what replaced it (a "What changed" section), rather than leaving two
  plausible paths.

## Related

- `docs/runbooks/customer-release-cutover.md` — the authoritative current procedure (refreshed in PR #4260)
- [Pi runtime image is decoupled from the release version](../operations/pi-runtime-image-decoupled-from-release-version-2026-07-25.md) — the two-pins model; its manual-mirror section predates #4209
- [Runner guardrail preconditions need a bootstrap fallback](runner-guardrail-preconditions-need-bootstrap-fallback-2026-07-04.md) — same pattern: runner guards that read prior-deployment state
- [Canary releases: manual v* tags](canary-release-tagging-web-desktop-2026-06-11.md) — how the release the cutover ships is cut
- [Release manifest + deployment status contract](../architecture-patterns/release-manifest-deployment-status-contract-2026-06-11.md) — the evidence store `release deploy` recovers the pin from

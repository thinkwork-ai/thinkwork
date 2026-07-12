---
title: "Customer stage updates go through `release deploy`, not `deploy --controller`"
date: 2026-07-12
last_updated: 2026-07-12
category: docs/solutions/workflow-issues/
module: release-engineering
problem_type: workflow_issue
component: deployment_controller
severity: high
applies_when:
  - Rolling a release out to TEI, McPherson, or any customer-owned stage
  - A customer deploy fails pulling `ghcr.io/thinkwork-ai/thinkwork-agentcore` with `unauthorized`
  - A customer deploy fails with "Release manifest digest mismatch"
  - Wondering how the Pi runtime image reaches a customer account
tags: [deploy, controller, customers, tei, mcpherson, ghcr, agentcore, release, canary]
---

# Customer stage updates go through `release deploy`, not `deploy --controller`

## The command

```bash
AWS_PROFILE=tei AWS_REGION=us-east-1 \
  pnpm --dir apps/cli dev release deploy v0.1.0-canary.<N> --stage tei-e2e --yes

AWS_PROFILE=mcpherson AWS_REGION=us-east-1 \
  pnpm --dir apps/cli dev release deploy v0.1.0-canary.<N> --stage mcpherson --yes
```

(First-time installs are `thinkwork enterprise bootstrap`, not this.)

## Why the other path looks like it should work, and doesn't

`thinkwork deploy --controller --controller-action update …` also starts the
customer's Step Functions orchestrator, so it *appears* to be the same thing.
It is not: it builds the controller payload **from scratch**, while
`release deploy` builds it by reading the stage's **prior successful deployment
evidence** and carrying forward the fields a customer stack depends on — most
importantly:

```ts
// apps/cli/src/commands/release/helpers.ts
...(prior.agentcorePiSourceImageUri
  ? { agentcorePiSourceImageUri: prior.agentcorePiSourceImageUri }
  : {}),
```

`agentcorePiSourceImageUri` is the Pi runtime image the customer stack pulls.
In practice it points at the **customer's own ECR** (e.g.
`637423202447.dkr.ecr…/thinkwork-tei-e2e-agentcore:v0.1.0-canary.345-pi-amd64@sha256:…`),
where the image was mirrored previously — and it is updated on its own cadence,
not on every platform release.

The runner defaults it to the release manifest's image when the payload omits
it (`terraform/modules/app/deployment-control-plane/runner.py`):

```python
"agentcore_pi_source_image_uri": safe_get(
    payload, "agentcorePiSourceImageUri",
    default=release_runtime_image("agentcore-pi-amd64"),   # ← ghcr.io/...
)
```

…and `seed_pi_image` (terraform/modules/app/agentcore-pi/main.tf) only
`docker login`s to **ECR** before pulling. So a payload without the override
tries an **anonymous** pull from a **private** GHCR package and dies with:

```
Error response from daemon: Get "https://ghcr.io/v2/thinkwork-ai/thinkwork-agentcore/manifests/sha256:…": unauthorized
ERROR: could not pull pinned Pi release image …
```

The right response to that error is **"I used the wrong entrypoint"**, not
"the package must be public." (Making the package public "fixes" the symptom
and needlessly exposes the runtime image.)

## Second trap: hash the manifest AFTER both release workflows finish

`release.yml` (tag `v0.1.0-canary.N`) publishes `thinkwork-release.json`, then
`release-desktop.yml` (tag `desktop-v0.1.0-canary.N`) **re-uploads the manifest**
with the desktop assets appended. A SHA-256 taken between the two runs is stale,
and the runner rejects it:

```
RuntimeError: Release manifest digest mismatch: expected <stale>, got <live>
```

`release deploy` resolves the manifest URL and digest itself, so this only bites
hand-built payloads. If you ever do pin one by hand, download the manifest
*after* both workflows are green.

## What the guardrails got right

Every one of these failures stopped the deploy cleanly: Terraform refused to
proceed, the runner refused to "retain an older runtime while reporting this
release as deployed," and the customer stacks stayed on their previous release
with failure evidence written to their evidence bucket. Nothing half-deployed.

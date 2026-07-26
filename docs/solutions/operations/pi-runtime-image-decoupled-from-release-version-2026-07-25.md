---
module: terraform/modules/app
date: 2026-07-25
last_updated: 2026-07-25
category: operations
problem_type: deployment_issue
component: agentcore_pi
severity: high
related_components:
  - deployment
  - ecr
  - step_functions
  - database
applies_when:
  - "Deploying a release version to a customer environment via the deployment orchestrator"
  - "A change touches packages/agentcore-pi and must reach the running agent"
  - "Bumping a customer environment across several releases at once"
  - "A hand-rolled drizzle migration landed in a release that a customer environment has not yet taken"
tags:
  - deployment
  - agentcore-pi
  - ecr
  - release-version
  - migration-drift
  - customer-environments
---

# A release-version bump does NOT update the Pi runtime image

## Context

Customer environments (McPherson, TEI) deploy through
`thinkwork-<env>-deployment-orchestrator` (Step Functions), with a payload that
carries **two independent version pins**:

```json
{
  "releaseVersion": "v0.1.0-canary.411",
  "agentcorePiSourceImageUri": "<acct>.dkr.ecr.<region>.amazonaws.com/thinkwork-<env>-agentcore:<tag>@sha256:<digest>"
}
```

These are **not linked**. Bumping `releaseVersion` updates lambdas, Terraform,
and the web bundle. The agent runtime keeps running whatever image
`agentcorePiSourceImageUri` names.

## The trap

TEI was on `releaseVersion` **v0.1.0-canary.406** while its Pi image was pinned
to **canary.345** — a runtime months behind the release it appeared to be on.
Deploying 411 there would have shipped new lambdas and a new web bundle against
a stale agent: no hybrid retrieval, no page-aware citations, and no error
anywhere, because nothing in the deploy validates that the two pins agree.

The version reported by `/thinkwork-runtime-config.json` is
`releaseVersion` — so **the environment looks current while its agent is not.**

This differs from `dev`, which deploys from `main` via `deploy.yml`
(`STAGE: dev`) and rebuilds/pushes its Pi image on every merge. Dev is
self-consistent; pinned customer environments are not, by construction.

## What to do

Before deploying a release to a customer environment, answer: **does this
release change `packages/agentcore-pi`?**

```bash
git diff --name-only v0.1.0-canary.<prev> v0.1.0-canary.<next> \
  | grep '^packages/agentcore-pi/' || echo "web/lambda only — reuse the existing Pi image"
```

- **No change** → reuse the current `agentcorePiSourceImageUri` unchanged. This
  is the common case and keeps the deploy to a single ~10 minute step.
- **Change** → build the image **into that environment's own ECR** and pin it
  by digest. The orchestrator requires a customer-ECR image; a ghcr or shared
  registry reference will be refused.

```bash
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin <acct>.dkr.ecr.us-east-1.amazonaws.com
docker buildx build --platform linux/amd64 \
  -f packages/agentcore-pi/agent-container/Dockerfile \
  -t <acct>.dkr.ecr.us-east-1.amazonaws.com/thinkwork-<env>-agentcore:<version>-pi-amd64 \
  --push .
```

`--platform linux/amd64` is required — an arm64 image built on an Apple Silicon
machine will push successfully and fail at runtime.

### Verify the image before deploying it

Check that the change you care about is in the **compiled** output, not just
the source tree, then confirm the container starts:

```bash
docker run --rm --platform linux/amd64 --entrypoint sh $IMG \
  -c 'grep -rc "HYBRID" /app/packages/agentcore-pi/dist/ | grep -v ":0"'
docker run -d --name smoke --platform linux/amd64 -p 18080:8080 -e AWS_REGION=us-east-1 $IMG
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18080/ping   # expect 200
```

### Confirm the runtime actually took it

`imagePushedAt` proves you built it; **`lastRecordedPullTime` inside the deploy
window** proves the runtime adopted it:

```bash
aws ecr describe-images --repository-name thinkwork-<env>-agentcore \
  --image-ids imageTag=<tag> \
  --query 'imageDetails[0].{pushed:imagePushedAt,pulled:lastRecordedPullTime}'
```

## Second trap: migrations do not travel with the release either

TEI's database was missing **every column** from
`0278_kb_page_transcription.sql` — a hand-rolled migration not registered in
`meta/_journal.json`, and therefore outside `db:push`'s scope. Deploying a
release whose code depends on those columns would have failed the Migration
Drift Check gate (or worse, half-worked).

Check the target database before deploying, not after:

```sql
select column_name from information_schema.columns
where table_name = '<table>' and column_name in (<the new columns>);
```

Hand-rolled migrations are idempotent by convention (`IF NOT EXISTS`,
`DROP CONSTRAINT IF EXISTS`), so applying one to a lagging environment is safe.
See [manually-applied drizzle migrations drift from dev](../workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md).

## Pre-deploy checklist for a pinned environment

1. Does the diff touch `packages/agentcore-pi`? → build + push to that env's ECR, smoke it.
2. Does the diff add a hand-rolled migration? → verify/apply it on that env's DB first.
3. Clone the payload from the **last SUCCEEDED execution** and change only
   `releaseVersion`, `releaseManifestUrl`, `releaseManifestSha256`, and (if
   step 1 applied) `agentcorePiSourceImageUri`.
4. After it succeeds, verify the served `releaseVersion` **and** the ECR
   `lastRecordedPullTime` — not the Step Functions status alone.

## Related

- `packages/agentcore-pi/agent-container/Dockerfile`
- `.github/workflows/deploy.yml` — the dev path, which does keep the two in sync
- [Bedrock KB custom ingestion silent failures](../integration-issues/bedrock-kb-custom-ingestion-silent-failures-2026-07-25.md)

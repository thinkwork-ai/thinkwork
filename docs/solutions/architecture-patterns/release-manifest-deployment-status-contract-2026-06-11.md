---
title: "Release manifests plus S3 deployment status are the install/update contract"
date: "2026-06-11"
category: architecture-patterns
module: deployment-release-management
problem_type: architecture_pattern
component: development_workflow
severity: high
applies_when:
  - "The first-party ThinkWork environment should deploy automatically from GitHub Actions"
  - "Customer environments should choose when to update from published releases"
  - "The UI needs to show what platform release an environment is actually running"
  - "The desktop or web bundle version can differ from the deployed backend/platform version"
  - "Deployment evidence must survive browser refreshes, cached bundles, and Lambda environment changes"
related_components:
  - tooling
  - database
  - documentation
  - authentication
tags:
  - release-manifest
  - deployment-status
  - github-actions
  - customer-deployments
  - s3-evidence
  - step-functions
  - codebuild
  - tei
---

# Release manifests plus S3 deployment status are the install/update contract

## Context

ThinkWork now has two valid deployment authorities with different product
semantics:

- The first-party ThinkWork `dev` environment is still owned by the ThinkWork
  repo. Merges and releases can deploy automatically through GitHub Actions.
- Customer environments such as TEI are owned by the customer AWS account. They
  should not auto-update just because `main` changed; operators choose a release
  from Settings and the customer deployment controller applies it.

The confusion during the TEI proving run came from treating build-time values as
deployment truth. The app bundle could say `v0.1.0-dev` or `unknown`, while TEI
was actually deployed to `v0.1.0-canary.164` and ThinkWork dev later deployed to
`v0.1.0-canary.169`. Environment variables and bundled frontend metadata could
not answer the operator's real question: "What ThinkWork platform release is
this environment currently running?"

The corrected model separates artifact publication from deployment state.
Published releases expose the install/update contract. Each environment records
its selected deployed release as operational state in its own deployment
evidence bucket.

Session history reinforced the arc: the June 6 GitHub-free deployment plan
already selected release manifests, Step Functions, CodeBuild, and customer AWS
as the steady-state authority. The later debugging sessions added the missing
operational-status lesson: the release manifest is the input contract, but
`deployment/status/current.json` is the environment's current-state contract
(session history).

## Guidance

Use a two-part contract for ThinkWork deployment and updates.

### 1. Release manifest is the install/update input

Every deployable platform release should publish a manifest and a compact
machine artifact bundle:

```text
GitHub Release
├── desktop installers and updater metadata
├── thinkwork-release.json
└── platform-artifacts.tar.gz
```

The release manifest coordinates the platform version, commit, artifact URLs,
artifact hashes, static bundles, Lambda bundles, runtime images, and the
deployment-runner inputs needed by customer controllers. Customer environments
deploy from the manifest, not from GitHub workflow internals.

This keeps GitHub Releases human-readable. Desktop installers, updater
metadata, the release manifest, and one platform artifact bundle belong in the
release asset list; dozens of backend Lambda zip files do not.

### 2. S3 deployment status is the deployed-version source of truth

Each environment owns a durable status pointer:

```text
s3://<deployment-evidence-bucket>/deployment/status/current.json
s3://<deployment-evidence-bucket>/deployment/status/history/<timestamp-or-session>.json
```

That object records the active release selected for the environment:

```json
{
  "schemaVersion": 1,
  "stage": "tei-e2e",
  "status": "succeeded",
  "source": "deployment-controller",
  "activeRelease": {
    "version": "v0.1.0-canary.164",
    "manifestUrl": "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.164/thinkwork-release.json",
    "manifestSha256": "7151443fcc4b8054678501ddeb1439614020ab99b79254232053a0284ad74e7c..."
  },
  "lastSuccessfulDeployment": {
    "executionArn": "arn:aws:states:us-east-1:637423202447:execution:thinkwork-tei-e2e-deployment-orchestrator:...",
    "terraformExitCode": 0,
    "evidenceBucket": "thinkwork-tei-e2e-637423202447-deploy-evidence",
    "evidenceKey": "sessions/.../deployment-evidence.json"
  }
}
```

The UI should display the deployed release from this object, not the frontend
bundle version. The bundle version can remain useful for debugging cache issues,
but it is not the product-facing deployed platform version.

### ThinkWork dev path

ThinkWork dev stays GitHub-managed:

```text
merge or release tag
  -> GitHub Actions
  -> Terraform/app/static deploy for ThinkWork dev
  -> write deployment/status/current.json to the ThinkWork dev evidence bucket
  -> Settings reads deploymentStatus and shows the active deployed release
```

The implementation added `scripts/release/write-deployment-status.sh` and wired
it into the GitHub deployment/release workflows. The important implementation
detail is that the workflow must resolve the root Terraform output
`deployment_evidence_bucket_name`; otherwise the status writer has nowhere to
publish. That missing output caused the first successful release-status attempt
to skip the pointer write.

Current verified ThinkWork dev status on 2026-06-11:

```text
bucket:  thinkwork-dev-487219502366-deploy-evidence
key:     deployment/status/current.json
release: v0.1.0-canary.169
source:  github-actions-release
sha:     1c10e6401def046f28613e71bc8b2ec5f522e19bac024ef549e6e6f036f12c8b
```

The deployed `https://app.thinkwork.ai` web bundle also contained
`v0.1.0-canary.169`, proving the visible app shell had picked up the release
metadata. A later docs job failure in the normal main deploy pipeline did not
invalidate the release-status pointer, but full deploy health should still be
tracked separately from release publication.

### TEI/customer path

TEI uses the customer-owned controller:

```text
Settings -> Releases -> Deploy
  -> GraphQL mutation starts TEI Step Functions execution
  -> Step Functions starts the TEI CodeBuild deployment runner
  -> CodeBuild reads the selected release manifest and platform artifacts
  -> Terraform applies inside the TEI AWS account
  -> evidence and deployment/status/current.json are written to the TEI bucket
  -> Settings reads deploymentStatus and shows the active deployed release
```

Current verified TEI status on 2026-06-11:

```text
bucket:  thinkwork-tei-e2e-637423202447-deploy-evidence
key:     deployment/status/current.json
release: v0.1.0-canary.164
source:  deployment-controller
url:     https://d1eqjv7ijcmtqz.cloudfront.net
status:  succeeded
```

TEI requires the `tei` AWS profile to read the customer evidence bucket. Reading
it with the ThinkWork AWS identity correctly fails with `403 Forbidden`; that is
a feature of the ownership boundary, not a broken status object.

## Why This Matters

This avoids coupling three different concepts:

- **Published release**: immutable artifacts available for install/update.
- **App bundle build**: the JavaScript/Electron/mobile bundle currently running
  on a device or CDN edge.
- **Deployed platform release**: the backend/platform release selected and
  successfully applied to an environment.

When these are blurred together, operators get misleading UI:

- A desktop app can be `canary.142` while TEI backend is `canary.152`.
- A web bundle can show `v0.1.0-dev` even after the environment deployed
  `canary.164`.
- A customer can click Deploy and see no feedback because no durable deployment
  status is being queried.
- GitHub Actions can publish a release while a customer environment remains on
  an older version by design.

The S3 pointer makes the environment answerable. Support can ask one stable
question: "What does `deployment/status/current.json` say?" The answer survives
frontend cache, browser refresh, Lambda env churn, local desktop installs, and
GitHub workflow log retention.

It also preserves the intended authority split:

- ThinkWork dev can keep the fast GitHub Actions path.
- External environments can update only when an operator chooses a release.
- Both surfaces use the same release manifest and the same status shape.

## When to Apply

- You need ThinkWork-owned environments to auto-deploy from the repo, but
  customer-owned environments to update deliberately.
- Settings, support, or desktop/mobile clients need to show the deployed
  platform version.
- A release consists of multiple coordinated artifacts: web bundle, docs bundle,
  Lambda bundles, AgentCore images, Terraform module content, and updater
  metadata.
- Deployment success must be auditable after the GitHub Actions run or
  Step Functions execution is no longer on screen.
- The frontend can be cached independently from backend deployment.

Do not replace this with Lambda-only environment variables. Env vars are good
for static endpoints and configuration required to boot the process; they are a
poor source of truth for mutable deployment state.

## Examples

### Before

```text
Settings reads app build/env metadata
  -> shows v0.1.0-dev or unknown
  -> operator cannot tell whether TEI is on canary.152, .160, or .164
```

```text
GitHub Release
  -> desktop installers
  -> 100+ Lambda zip files
  -> no clean human/machine boundary
```

```text
Customer deploy
  -> Step Functions/CodeBuild succeeds
  -> evidence exists
  -> UI still has no stable deployed-version field
```

### After

```text
Settings queries deploymentStatus
  -> API reads deployment/status/current.json from the evidence bucket
  -> UI shows Deployed release: v0.1.0-canary.164
  -> Settings menu footer shows the deployed release
```

```text
GitHub Release
  -> desktop installers/updater metadata
  -> thinkwork-release.json
  -> platform-artifacts.tar.gz
```

```text
ThinkWork dev release workflow
  -> writes s3://thinkwork-dev-487219502366-deploy-evidence/deployment/status/current.json
```

```text
TEI deployment controller
  -> writes s3://thinkwork-tei-e2e-637423202447-deploy-evidence/deployment/status/current.json
```

## Lessons Learned

- **Deployment state is operational state.** Do not infer it from a bundled app
  version or static Lambda environment value.
- **The evidence bucket needs a stable pointer.** Historical session evidence is
  valuable, but the UI also needs one current object that can be read quickly.
- **Root Terraform outputs matter.** Composite modules can expose a value while
  the deploy workflow still cannot see it if the greenfield root fails to
  forward the output.
- **Customer AWS ownership should remain visible in tooling.** TEI's bucket is
  readable with `--profile tei`, not with the ThinkWork dev credentials.
- **Release asset hygiene matters.** Human-facing GitHub Releases should not
  drown operators in backend zip files; bundle platform artifacts behind the
  manifest.
- **UI feedback must be tied to controller state.** A successful click should
  show submission, controller start, Terraform progress, evidence recording,
  and final deployed release; otherwise operators cannot tell whether a deploy
  is running or ignored.

## Related

- [`github-free-customer-deployments-aws-control-plane-pattern-2026-06-06.md`](./github-free-customer-deployments-aws-control-plane-pattern-2026-06-06.md)
  - original AWS-native customer deployment control-plane pattern.
- [`../workflow-issues/deploy-silent-arch-mismatch-took-a-week-to-surface-2026-04-24.md`](../workflow-issues/deploy-silent-arch-mismatch-took-a-week-to-surface-2026-04-24.md)
  - why green infrastructure is not enough without deployed behavior/evidence.
- [PR #2366](https://github.com/thinkwork-ai/thinkwork/pull/2366)
  - added the deployment status writer and GitHub Actions release-status
    updates.
- [PR #2370](https://github.com/thinkwork-ai/thinkwork/pull/2370)
  - exposed greenfield Terraform root deployment-controller outputs so the
    GitHub Actions writer could find the evidence bucket.
- [`scripts/release/write-deployment-status.sh`](../../../scripts/release/write-deployment-status.sh)
  - status writer used by GitHub-managed environments.
- [`packages/api/src/graphql/resolvers/core/deploymentStatus.query.ts`](../../../packages/api/src/graphql/resolvers/core/deploymentStatus.query.ts)
  - API read path that feeds Settings.
- [`apps/web/src/components/settings/SettingsGeneral.tsx`](../../../apps/web/src/components/settings/SettingsGeneral.tsx)
  - UI surface that shows deployed release and release actions.

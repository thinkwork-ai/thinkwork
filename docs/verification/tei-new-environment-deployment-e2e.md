---
title: "TEI new environment deployment end-to-end verification"
date: 2026-06-09
status: active
---

# TEI New Environment Deployment End-to-End Verification

This runbook proves a fresh ThinkWork deployment path against the `tei` AWS
profile using the release manifest/controller contract that backs the browser
Releases flow. It records each gate so failures are either fixed before moving
on or captured as product gaps with exact evidence.

Known scope boundary: the lower-level enterprise bootstrap command still labels
the generated CodeBuild project as an inert deployment runner. Treat any
control-plane execution that does not run Terraform as a product gap for this
TEI proof; do not paper over it with AWS console fixes.

## Test Envelope

- AWS profile: `tei`
- AWS account: `637423202447`
- Principal observed in preflight:
  `arn:aws:iam::637423202447:user/eric@homecareintel.com`
- Region: `us-east-1`
- Stage: `tei-e2e`
- Customer slug: `tei`
- Release under test: `v0.1.0-canary.137`
- Release manifest URL:
  `https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.137/thinkwork-release.json`
- Release manifest SHA-256:
  `7d94e58847fc2cc830b07d06f747c6727c007c9bd1f5b31a63981daf314efe3f`
- Repo checkout: `/Users/ericodom/Projects/thinkwork`
- Isolated deploy root: `/tmp/thinkwork-tei-e2e-greenfield`
- Isolated enterprise bootstrap root: `/tmp/thinkwork-tei-e2e-bootstrap`

The `tei` profile currently has no configured default region, so every command
in this runbook pins `AWS_REGION=us-east-1`.

## Preflight Already Verified

Run from the repository root:

```bash
export AWS_PROFILE=tei
export AWS_REGION=us-east-1
export THINKWORK_STAGE=tei-e2e
export THINKWORK_CUSTOMER=tei
export THINKWORK_RELEASE_VERSION=v0.1.0-canary.137
export THINKWORK_MANIFEST_URL=https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.137/thinkwork-release.json
export THINKWORK_MANIFEST_SHA256=7d94e58847fc2cc830b07d06f747c6727c007c9bd1f5b31a63981daf314efe3f
export THINKWORK_ACCOUNT_ID=637423202447
```

Safe identity and doctor checks:

```bash
aws sts get-caller-identity --profile "$AWS_PROFILE" --output json
pnpm --dir apps/cli dev doctor -s "$THINKWORK_STAGE" --profile "$AWS_PROFILE"
```

Observed result on 2026-06-09:

- AWS identity resolved to account `637423202447`.
- Terraform CLI resolved to `v1.9.8`.
- AWS CLI resolved to `aws-cli/2.34.52`.
- Bedrock access check for `anthropic.claude-3-haiku` passed.
- Doctor passed only after `AWS_REGION=us-east-1` was set.
- `v0.1.0-canary.137` release manifest downloaded successfully and hashed to
  `7d94e58847fc2cc830b07d06f747c6727c007c9bd1f5b31a63981daf314efe3f`.

Dry-run the top-level bootstrap path:

```bash
pnpm --dir apps/cli dev deploy \
  --bootstrap \
  --customer "$THINKWORK_CUSTOMER" \
  --stage "$THINKWORK_STAGE" \
  --profile "$AWS_PROFILE" \
  --release-version "$THINKWORK_RELEASE_VERSION" \
  --manifest-url "$THINKWORK_MANIFEST_URL" \
  --manifest-sha256 "$THINKWORK_MANIFEST_SHA256" \
  --dry-run \
  --no-wait \
  --no-run-smokes
```

Expected: `Enterprise deploy bootstrap prepared tei tei-e2e`.

Dry-run the lower-level AWS-native bootstrap substrate:

```bash
rm -rf /tmp/thinkwork-tei-e2e-bootstrap
pnpm --dir apps/cli dev enterprise bootstrap /tmp/thinkwork-tei-e2e-bootstrap \
  --customer "$THINKWORK_CUSTOMER" \
  --stage "$THINKWORK_STAGE" \
  --region "$AWS_REGION" \
  --account-id "$THINKWORK_ACCOUNT_ID" \
  --release-version "$THINKWORK_RELEASE_VERSION" \
  --manifest-url "$THINKWORK_MANIFEST_URL" \
  --manifest-sha256 "$THINKWORK_MANIFEST_SHA256" \
  --identity-provider none \
  --dry-run
```

Expected planned resources:

- Terraform state bucket
- Terraform lock table
- Release artifact bucket
- Deployment evidence bucket for `tei-e2e`
- Deployment orchestrator Step Functions state machine for `tei-e2e`
- Deployment runner CodeBuild project for `tei-e2e`
- Deployment SSM/AppConfig profile pointers for `tei-e2e`
- No GitHub repository configured

Observed result on 2026-06-09: both dry-runs passed with
`v0.1.0-canary.137`, proving the previous missing-manifest blocker is resolved.

## Phase 1: Bootstrap GitHub-Free Substrate

This phase mutates AWS resources. Run only when ready to create the GitHub-free
deployment substrate in the `tei` account.

```bash
pnpm --dir apps/cli dev enterprise bootstrap /tmp/thinkwork-tei-e2e-bootstrap \
  --customer "$THINKWORK_CUSTOMER" \
  --stage "$THINKWORK_STAGE" \
  --region "$AWS_REGION" \
  --account-id "$THINKWORK_ACCOUNT_ID" \
  --release-version "$THINKWORK_RELEASE_VERSION" \
  --manifest-url "$THINKWORK_MANIFEST_URL" \
  --manifest-sha256 "$THINKWORK_MANIFEST_SHA256" \
  --identity-provider none \
  --yes
```

Verify the substrate without printing secret values:

```bash
aws stepfunctions list-state-machines \
  --query 'stateMachines[?contains(name, `tei-e2e`) == `true`].[name,stateMachineArn]' \
  --output table

aws codebuild list-projects \
  --query 'projects[?contains(@, `tei-e2e`)]' \
  --output table

aws ssm get-parameters-by-path \
  --path /thinkwork/tei-e2e \
  --recursive \
  --query 'Parameters[].Name' \
  --output table
```

Pass criteria:

- The Step Functions state machine exists.
- The CodeBuild runner project exists.
- SSM/AppConfig profile pointers exist.
- No secret values are printed into the terminal or copied into evidence.

Expected limitation:

- Starting the state machine currently exercises an inert CodeBuild stub, not a
  live Terraform deploy runner. Record that as a known product gap, not a test
  failure for this phase.

## Phase 2: Deploy A Fresh ThinkWork Environment

This phase proves the actual application stack can deploy into a clean
environment without relying on a customer GitHub fork.

Create an isolated generated Terraform root:

```bash
export DEPLOY_ROOT=/tmp/thinkwork-tei-e2e-greenfield
rm -rf "$DEPLOY_ROOT"

pnpm --dir apps/cli dev init \
  -s "$THINKWORK_STAGE" \
  -d "$DEPLOY_ROOT" \
  --defaults
```

Plan the stack:

```bash
THINKWORK_TERRAFORM_DIR="$DEPLOY_ROOT/terraform" \
AWS_PROFILE="$AWS_PROFILE" \
AWS_REGION="$AWS_REGION" \
pnpm --dir /Users/ericodom/Projects/thinkwork/apps/cli dev plan \
  -s "$THINKWORK_STAGE" \
  --profile "$AWS_PROFILE"
```

Deploy the stack:

```bash
THINKWORK_TERRAFORM_DIR="$DEPLOY_ROOT/terraform" \
AWS_PROFILE="$AWS_PROFILE" \
AWS_REGION="$AWS_REGION" \
pnpm --dir /Users/ericodom/Projects/thinkwork/apps/cli dev deploy \
  -s "$THINKWORK_STAGE" \
  --profile "$AWS_PROFILE" \
  --yes
```

Pass criteria:

- Terraform completes all selected tiers.
- Outputs include `api_endpoint`, `app_url`, `auth_domain`,
  `deployment_control_plane_enabled`, `deployment_state_machine_name`,
  `deployment_runner_project_name`, and `deployment_evidence_bucket_name`.
- The generated app URL loads over HTTPS.
- The GraphQL endpoint is reachable.
- No customer-specific GitHub repository is required.

## Phase 3: Foundation Bootstrap Smoke

Run the read-only foundation smoke against the generated Terraform directory:

```bash
mkdir -p "$DEPLOY_ROOT/deploy-artifacts"

SMOKE_ENABLE_FOUNDATION_BOOTSTRAP=1 \
SMOKE_TERRAFORM_DIR="$DEPLOY_ROOT/terraform" \
SMOKE_EVIDENCE_FILE="$DEPLOY_ROOT/deploy-artifacts/foundation-smoke.json" \
AWS_PROFILE="$AWS_PROFILE" \
AWS_REGION="$AWS_REGION" \
node /Users/ericodom/Projects/thinkwork/scripts/smoke/foundation-bootstrap-smoke.mjs
```

Pass criteria:

- Spaces app endpoint check passes.
- GraphQL/AppSync endpoint checks pass.
- Cognito/auth-domain check passes.
- Deployment profile check passes when profile JSON fields are available.
- Deployment control-plane output check passes.
- Evidence is written to
  `/tmp/thinkwork-tei-e2e-greenfield/deploy-artifacts/foundation-smoke.json`.

## Phase 4: First Admin Bootstrap And Login

This is the highest-risk unknown in the current GitHub-free flow. The test must
prove how a human reaches the new environment after infrastructure deploy.

Preferred path when the deployment is configured with a supported identity
provider:

```bash
pnpm --dir /Users/ericodom/Projects/thinkwork/apps/cli dev login \
  --stage "$THINKWORK_STAGE" \
  --region "$AWS_REGION"

pnpm --dir /Users/ericodom/Projects/thinkwork/apps/cli dev me \
  --stage "$THINKWORK_STAGE"
```

Pass criteria:

- Hosted UI opens for the `tei-e2e` Cognito domain.
- The first admin can authenticate.
- `thinkwork me` returns the expected user and tenant context.
- The Spaces app opens against the newly deployed `tei-e2e` endpoints.

Gap to record if this fails:

- `enterprise bootstrap --identity-provider none` proves the substrate but may
  not provide a complete human first-admin login path. If login cannot complete
  without manually creating a Cognito user or injecting an OAuth provider secret,
  capture that as a bootstrap-product blocker.

## Phase 5: Managed Application Smokes

Use the deployed Spaces UI first:

1. Open the `app_url` Terraform output.
2. Sign in as the first admin.
3. Open Settings -> Managed Applications.
4. Confirm Cognee and Twenty are visible as optional managed applications.
5. Trigger a plan for one app.
6. Confirm the UI shows a deployment request, evidence, status, and teardown
   affordance.

Then run read-only smokes where their live-mode prerequisites are available.

Twenty CRM:

```bash
SMOKE_ENABLE_TWENTY_MANAGED_APP=1 \
SMOKE_TERRAFORM_DIR="$DEPLOY_ROOT/terraform" \
SMOKE_EVIDENCE_FILE="$DEPLOY_ROOT/deploy-artifacts/twenty-smoke.json" \
AWS_PROFILE="$AWS_PROFILE" \
AWS_REGION="$AWS_REGION" \
node /Users/ericodom/Projects/thinkwork/scripts/smoke/twenty-managed-app-smoke.mjs
```

Cognee Knowledge Graph, after choosing a tenant and thread:

```bash
SMOKE_ENABLE_KNOWLEDGE_GRAPH=1 \
SMOKE_TENANT_ID="<tenant-id>" \
SMOKE_KG_THREAD_ID="<thread-id>" \
SMOKE_EVIDENCE_FILE="$DEPLOY_ROOT/deploy-artifacts/cognee-smoke.json" \
AWS_PROFILE="$AWS_PROFILE" \
AWS_REGION="$AWS_REGION" \
node /Users/ericodom/Projects/thinkwork/scripts/smoke/knowledge-graph-thread-ingest-smoke.mjs
```

Pass criteria:

- Twenty smoke either reports running health or explicitly skips because Twenty
  is unprovisioned/parked.
- Cognee smoke can start or inspect a graph ingest when tenant/thread
  prerequisites exist.
- Managed-app UI does not depend on GitHub Actions.
- Any deployment request routed to Step Functions is clearly marked as the
  current inert-runner behavior until live orchestration ships.

## Phase 6: Desktop And Mobile Configuration

After the deployment profile exists, prove clients can point at `tei-e2e`.

Desktop:

1. Install a build that includes the deployment-profile packaging fix
   (`v0.1.0-canary.116` or newer for Canary).
2. Import or select the generated `tei-e2e` deployment profile.
3. Launch the desktop app.
4. Confirm it opens the `tei-e2e` login/app URL and does not reference the
   shared ThinkWork deployment.

Mobile:

1. Configure the mobile profile/environment to the generated `tei-e2e` profile.
2. Launch the app.
3. Confirm auth, API, AppSync, and Spaces traffic hit `tei-e2e` endpoints.

Pass criteria:

- Desktop and mobile can be configured without rebuilding for a hard-coded main
  deployment.
- The profile includes app URL, API URL, Cognito, AppSync, region, stage, and
  customer identity fields required by clients.

## Cleanup

Cleanup destroys cloud resources and should be run only after saving evidence.

Destroy the local Terraform deployment:

```bash
THINKWORK_TERRAFORM_DIR="$DEPLOY_ROOT/terraform" \
AWS_PROFILE="$AWS_PROFILE" \
AWS_REGION="$AWS_REGION" \
pnpm --dir /Users/ericodom/Projects/thinkwork/apps/cli dev destroy \
  -s "$THINKWORK_STAGE" \
  --profile "$AWS_PROFILE" \
  --yes
```

Then verify there are no remaining test resources:

```bash
aws stepfunctions list-state-machines \
  --query 'stateMachines[?contains(name, `tei-e2e`) == `true`].[name,stateMachineArn]' \
  --output table

aws codebuild list-projects \
  --query 'projects[?contains(@, `tei-e2e`)]' \
  --output table

aws ssm get-parameters-by-path \
  --path /thinkwork/tei-e2e \
  --recursive \
  --query 'Parameters[].Name' \
  --output table
```

If Phase 1 created bootstrap-substrate resources outside the generated
Terraform root, remove them through the matching enterprise bootstrap cleanup
path once implemented, or record the exact remaining resource names as a manual
cleanup blocker.

## Final Pass/Fail Record

Use this table during the run:

| Gate                                 | Result             | Evidence                                                  |
| ------------------------------------ | ------------------ | --------------------------------------------------------- |
| AWS profile and Bedrock doctor       | PASS on 2026-06-09 | Doctor output for account `637423202447`                  |
| Release manifest asset and digest    | PASS on 2026-06-09 | `v0.1.0-canary.137` manifest SHA-256                      |
| GitHub-free bootstrap dry-run        | PASS on 2026-06-09 | CLI dry-run output for top-level and enterprise bootstrap |
| GitHub-free substrate live bootstrap | Not run            | Awaiting live AWS mutation step                           |
| Local new-environment plan           | Not run            | Terraform plan                                            |
| Local new-environment deploy         | Not run            | Terraform apply + outputs                                 |
| Foundation bootstrap smoke           | Not run            | `foundation-smoke.json`                                   |
| First admin login                    | Not run            | `thinkwork me` + browser proof                            |
| Managed-app UI smoke                 | Not run            | Browser proof + smoke evidence                            |
| Desktop profile selection            | Not run            | Desktop launch proof                                      |
| Mobile profile selection             | Not run            | Mobile launch proof                                       |
| Cleanup                              | Not run            | Empty resource queries                                    |

The deployment is not fully accepted until every non-stub gate passes or is
explicitly recorded as a product gap with a follow-up issue.

## 2026-06-08 Step 2 Blocker - Resolved 2026-06-09

Live Step 2 was attempted with:

```bash
pnpm --dir apps/cli dev enterprise bootstrap /tmp/thinkwork-tei-e2e-bootstrap \
  --customer tei \
  --stage tei-e2e \
  --region us-east-1 \
  --account-id 637423202447 \
  --release-version 0.1.0-canary.116 \
  --identity-provider none \
  --yes
```

The CLI failed before AWS mutation:

```text
Release manifest SHA-256 is required before mutating bootstrap. Pass --manifest-sha256 or use `thinkwork enterprise deploy --bootstrap` so the CLI fetches the manifest digest.
```

Follow-up checks showed that `v0.1.0-canary.116`, latest
`v0.1.0-canary.123`, and CLI default `v0.12.13` do not expose
`thinkwork-release.json` as a GitHub Release asset. The canary releases
currently contain desktop app assets, not the enterprise deployment release
manifest required by this bootstrap guard.

No `tei-e2e` Step Functions state machines, CodeBuild projects, SSM parameters,
or obvious TEI bootstrap buckets were present after the failed attempt.

Next action: publish or identify a real ThinkWork release manifest asset, then
rerun Step 2 using either the release version or explicit `--manifest-url` and
`--manifest-sha256`.

Resolution: `v0.1.0-canary.137` now exposes both `thinkwork-release.json` and
`platform-artifacts.tar.gz` on the shared GitHub Release. The manifest SHA-256
is recorded in this runbook, and the safe dry-run gates pass with explicit
manifest URL and digest.

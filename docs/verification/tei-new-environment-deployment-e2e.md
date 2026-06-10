---
title: "TEI new environment deployment end-to-end verification"
date: 2026-06-10
status: active
---

# TEI New Environment Deployment End-to-End Verification

This runbook proves the GitHub-free ThinkWork deployment path against the `tei`
AWS profile using the release manifest/controller contract that backs the
browser Releases flow. The current TEI environment is controller-managed: Step
Functions starts the CodeBuild runner, the runner consumes a pinned
`thinkwork-release.json` plus `platform-artifacts.tar.gz`, runs Terraform,
publishes runtime config/static assets, initializes required database defaults,
and writes deployment evidence to the customer evidence bucket.

Current scope boundary: TEI has proved release update, runtime config, login,
model catalog, and Settings/Agents recovery through the controller. Full
destructive teardown is intentionally deferred while TEI remains live for demo
validation. Treat teardown evidence as the remaining U9 proof gap, not as a
reason to destroy the demo environment prematurely.

## Test Envelope

- AWS profile: `tei`
- AWS account: `637423202447`
- Principal observed in preflight:
  `arn:aws:iam::637423202447:user/eric@homecareintel.com`
- Region: `us-east-1`
- Stage: `tei-e2e`
- Customer slug: `tei`
- Release under test: `v0.1.0-canary.148`
- Release manifest URL:
  `https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.148/thinkwork-release.json`
- Release manifest SHA-256:
  `5b154f800b8754d00d0b252772005bd02fc1dbbf6096036597efd700d4d6df93`
- Platform bundle SHA-256:
  `1ed207c7aa92801629b2b7e5572220261f97f16fbe6f26c257d4ad523b92f5b9`
- Deployed app URL:
  `https://d1eqjv7ijcmtqz.cloudfront.net`
- Runtime config URL:
  `https://d1eqjv7ijcmtqz.cloudfront.net/thinkwork-runtime-config.json`
- GraphQL HTTP endpoint:
  `https://8puq24dl63.execute-api.us-east-1.amazonaws.com/graphql`
- Repo checkout: `/Users/ericodom/Projects/thinkwork`
- Isolated deploy root: `/tmp/thinkwork-tei-e2e-greenfield`
- Isolated enterprise bootstrap root: `/tmp/thinkwork-tei-e2e-bootstrap`

The `tei` profile currently has no configured default region, so every command
in this runbook pins `AWS_REGION=us-east-1`.

## 2026-06-10 Controller Proof

The current accepted controller update is:

- Step Functions execution:
  `arn:aws:states:us-east-1:637423202447:execution:thinkwork-tei-e2e-deployment-orchestrator:tw-update-148-current-sha-20260610053146`
- Step Functions status: `SUCCEEDED`
- Step Functions duration: 2026-06-10 00:31:46 CT to 00:40:00 CT
- CodeBuild run:
  `thinkwork-tei-e2e-deployment-runner:8e1857eb-0b8e-4b08-a69f-fff5d3d76788`
- CodeBuild status: `SUCCEEDED`
- CodeBuild `BUILD` phase duration: 438 seconds
- Evidence prefix:
  `s3://thinkwork-tei-e2e-637423202447-deploy-evidence/sessions/a015f5fb-60a3-457c-8c31-e73caf93f37a/update/`
- Evidence `deployment-evidence.json`: `status=succeeded`,
  `terraformExitCode=0`, `release=v0.1.0-canary.148`
- Evidence artifacts present:
  `controller-input-summary.json`, `controller-release-selection.json`,
  `redacted-terraform-vars.json`, `terraform-plan.json`,
  `terraform-outputs.json`, and `deployment-evidence.json`
- Release trust evidence: `policy=allow_unsigned_canary`,
  `signatureRequired=false`, `unsignedCanaryAllowed=true`
- Controller selected-release SSM status parameters now report:
  `selected-release-version=v0.1.0-canary.148`,
  `selected-release-manifest-sha256=5b154f800b8754d00d0b252772005bd02fc1dbbf6096036597efd700d4d6df93`,
  `selected-release-trust-policy=allow_unsigned_canary`,
  `selected-release-trusted-keys-json=[]`,
  `terraform-module-source=thinkwork-ai/thinkwork/aws`, and
  `terraform-module-version=0.1.0-canary.148`

Runtime smoke evidence:

- `curl -I https://d1eqjv7ijcmtqz.cloudfront.net/sign-in` returned HTTP 200
  with `last-modified: Wed, 10 Jun 2026 05:39:48 GMT`.
- `thinkwork-runtime-config.json` reports release
  `v0.1.0-canary.148`, manifest SHA-256
  `5b154f800b8754d00d0b252772005bd02fc1dbbf6096036597efd700d4d6df93`,
  API endpoint `https://8puq24dl63.execute-api.us-east-1.amazonaws.com/`, and
  Cognito domain `https://thinkwork-tei-e2e.auth.us-east-1.amazoncognito.com`.
- The deployed runtime config includes the customer-owned controller ARN,
  CodeBuild project ARN/name, evidence bucket, SSM prefix, stage, account,
  region, Cognito user pool/client, GraphQL HTTP endpoint, AppSync endpoint,
  AppSync realtime endpoint, and release manifest URL/SHA fields.
- GitHub Release `v0.1.0-canary.148` exposes the human desktop assets
  (`.dmg`, arm64 zip, updater YAML/blockmaps) plus the machine assets
  `thinkwork-release.json` and `platform-artifacts.tar.gz`.
- First-admin browser login completed against TEI.
- Settings -> Model Catalog rendered Claude Haiku 4.5, Claude Opus 4.6, and
  Claude Sonnet 4.6 in the integrated browser.
- TEI GraphQL logs after remediation showed `SettingsTenantModelCatalog`,
  `SettingsBedrockModelImportCandidates`, and `SettingsAgentProfiles` returning
  `errorCode:null`, `ok:true`.

Manifest digest note:

- A proof execution named `tw-update-148-controller-proof-20260610052719`
  failed closed before mutation when the runner fetched the current `.148`
  manifest and found digest
  `5b154f800b8754d00d0b252772005bd02fc1dbbf6096036597efd700d4d6df93`
  instead of the stale pre-finalization pin
  `fb65303178080f55a9cc39a8b5ecde6d502e237e867740402e98d5b75fa9e7db`.
  The controller was repinned through the enterprise bootstrap path, then the
  accepted proof execution above succeeded with the current digest.

Database remediation finding:

- Initial `.141` UI verification exposed `relation "tenant_model_catalog" does
not exist` for model-catalog-backed GraphQL queries.
- `packages/database-pg/drizzle/0155_tenant_model_catalog.sql` was applied
  manually to TEI as a short-term remediation.
- Post-remediation database proof:
  `tenant_model_catalog_rows=3`, `enabled_rows=3`, `agent_profiles=4`,
  `model_catalog_available=3`.
- Follow-up PR
  [#2305](https://github.com/thinkwork-ai/thinkwork/pull/2305) fixes the
  controller runner so existing DBs apply required idempotent platform
  migrations during future updates.

Invite email finding:

- Settings -> Users can create Cognito users; TEI invitees appear in Cognito as
  `FORCE_CHANGE_PASSWORD`, which proves `inviteMember` reached
  `AdminCreateUser`.
- TEI Cognito currently reports `EmailSendingAccount=COGNITO_DEFAULT`.
- TEI SES in `us-east-1` currently has no configured identities,
  `SentLast24Hours=0`, and `ProductionAccessEnabled=false`.
- Therefore customer invite mail is not yet deployed as a controlled
  customer-owned SES sender. The Terraform fix is to configure Cognito with a
  verified SES identity through `cognito_email_source_arn` plus the ThinkWork
  invite template, then redeploy TEI through the controller.
- A follow-up API retry gap was also found: retrying an invite for an existing
  pending Cognito user returned success without sending another invitation.
  The follow-up fix is to call `AdminCreateUser` with `MessageAction=RESEND`
  for `FORCE_CHANGE_PASSWORD` or `UNCONFIRMED` users.

## Preflight Already Verified

Run from the repository root:

```bash
export AWS_PROFILE=tei
export AWS_REGION=us-east-1
export THINKWORK_STAGE=tei-e2e
export THINKWORK_CUSTOMER=tei
export THINKWORK_RELEASE_VERSION=v0.1.0-canary.148
export THINKWORK_MANIFEST_URL=https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.148/thinkwork-release.json
export THINKWORK_MANIFEST_SHA256=5b154f800b8754d00d0b252772005bd02fc1dbbf6096036597efd700d4d6df93
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
- `v0.1.0-canary.148` release manifest downloaded successfully and hashed to
  `5b154f800b8754d00d0b252772005bd02fc1dbbf6096036597efd700d4d6df93`.

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

Observed result on 2026-06-10: both dry-runs passed with a real canary manifest
asset, proving the previous missing-manifest blocker is resolved.

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

Current behavior:

- Starting the state machine exercises the live CodeBuild Terraform runner. The
  accepted `.148` update proof above demonstrates Step Functions -> CodeBuild
  -> Terraform -> runtime config/static sync -> evidence.

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
- Any deployment request routed to Step Functions records the job, plan/apply
  evidence, and smoke/status result without relying on GitHub Actions.

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

| Gate                                 | Result                 | Evidence                                                                                         |
| ------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------ |
| AWS profile and Bedrock doctor       | PASS on 2026-06-09     | Doctor output for account `637423202447`                                                         |
| Release manifest asset and digest    | PASS on 2026-06-10     | `v0.1.0-canary.148` manifest SHA-256                                                             |
| GitHub-free bootstrap dry-run        | PASS on 2026-06-09     | CLI dry-run output for top-level and enterprise bootstrap                                        |
| GitHub-free substrate live bootstrap | PASS on 2026-06-09     | TEI Step Functions + CodeBuild controller exists                                                 |
| Controller release update            | PASS on 2026-06-10     | `.148` execution and CodeBuild run succeeded                                                     |
| Controller selected-release status   | PASS on 2026-06-10     | SSM status params + `controller-release-selection.json`                                          |
| Foundation runtime smoke             | PASS on 2026-06-10     | `/sign-in` 200 + runtime config release/digest                                                   |
| First admin login                    | PASS on 2026-06-09     | Browser login to TEI completed                                                                   |
| Model catalog / Agents UI smoke      | PASS after remediation | Browser proof + GraphQL `ok:true` logs                                                           |
| Managed-app UI smoke                 | Partial                | Optional apps disabled in base install; Cognee/Twenty full smoke remains                         |
| Desktop profile selection            | Partial                | Universal runtime profile is published; desktop `.148` assets are available for user launch test |
| Mobile profile selection             | Not run                | Mobile launch proof                                                                              |
| Cleanup / teardown                   | Deferred               | TEI kept live for demo; run after evidence is saved                                              |

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

Resolution: current canary releases expose both `thinkwork-release.json` and
`platform-artifacts.tar.gz` on the shared GitHub Release. The `.148` manifest
SHA-256 is recorded in this runbook, and the safe dry-run gates pass with
explicit manifest URL and digest.

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
model catalog, Settings/Agents recovery, strict managed-app deploy readiness,
and read-only teardown readiness through the controller. Full optional-app
creation and destructive teardown are intentionally deferred while TEI remains
live for demo validation. Treat final Cognee/Twenty deploy smoke and final
destroy evidence as the remaining U9 proof gaps, not as a reason to mutate the
demo environment prematurely.

## Test Envelope

- AWS profile: `tei`
- AWS account: `637423202447`
- Principal observed in preflight:
  `arn:aws:iam::637423202447:user/eric@homecareintel.com`
- Region: `us-east-1`
- Stage: `tei-e2e`
- Customer slug: `tei`
- Release under test: `v0.1.0-canary.150`
- Release manifest URL:
  `https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.150/thinkwork-release.json`
- Release manifest SHA-256:
  `8645040c1645fddecc5e34649c1bda91124777fb3368776a2ddefd04c8259bfe`
- Platform bundle SHA-256:
  `ac0c8c988f3adfc013ba45843bd8e571cba1acccaf0271ed95808b61a2f7390c`
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

## 2026-06-10 Controller Reconcile Proof - v0.1.0-canary.150

The current accepted controller update is the final manifest reconcile run:

- Step Functions execution:
  `arn:aws:states:us-east-1:637423202447:execution:thinkwork-tei-e2e-deployment-orchestrator:tw-tei-e2e-update-v150-final-20260610103343`
- Step Functions status: `SUCCEEDED`
- Step Functions duration: 2026-06-10 05:33:43 CT to 05:41:50 CT
- CodeBuild run:
  `thinkwork-tei-e2e-deployment-runner:1067b856-2661-482b-b49d-2e282e08ec33`
- CodeBuild status: `SUCCEEDED`
- Evidence prefix:
  `s3://thinkwork-tei-e2e-637423202447-deploy-evidence/sessions/tei-e2e-update-v150-final-20260610103343/update/`
- Evidence objects present:
  `controller-input-summary.json`, `redacted-terraform-vars.json`,
  `terraform-plan.json`, `terraform-outputs.json`,
  `controller-release-selection.json`, and `deployment-evidence.json`
- Release manifest SHA-256:
  `8645040c1645fddecc5e34649c1bda91124777fb3368776a2ddefd04c8259bfe`
- Platform bundle SHA-256:
  `ac0c8c988f3adfc013ba45843bd8e571cba1acccaf0271ed95808b61a2f7390c`
- App CloudFront invalidation `IBJHWAN2QEMY7R0BA6SH2K3Q52`: created for
  `/*` at 2026-06-10 10:41:41 UTC.
- Controller selected-release SSM status parameters now report:
  `selected-release-version=v0.1.0-canary.150`,
  `selected-release-manifest-sha256=8645040c1645fddecc5e34649c1bda91124777fb3368776a2ddefd04c8259bfe`,
  `selected-release-manifest-url=https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.150/thinkwork-release.json`,
  and `selected-release-trust-policy=allow_unsigned_canary`.

Runtime smoke evidence:

- `thinkwork-runtime-config.json` reports release
  `v0.1.0-canary.150`, manifest SHA-256
  `8645040c1645fddecc5e34649c1bda91124777fb3368776a2ddefd04c8259bfe`,
  GraphQL HTTP endpoint
  `https://8puq24dl63.execute-api.us-east-1.amazonaws.com/graphql`, and
  Cognito domain
  `https://thinkwork-tei-e2e.auth.us-east-1.amazoncognito.com`.
- `curl -fsSI https://d1eqjv7ijcmtqz.cloudfront.net/` returned HTTP 200 with
  `last-modified: Wed, 10 Jun 2026 10:41:40 GMT`.
- `curl -fsSI https://d1eqjv7ijcmtqz.cloudfront.net/sign-in` returned HTTP
  200 through the SPA fallback.
- `node scripts/smoke/managed-app-controller-readiness-smoke.mjs` passed in
  strict read-only mode on 2026-06-10 with evidence written to
  `/tmp/thinkwork-tei-smoke-proof-150/managed-app-controller-readiness-final.json`:
  - the selected TEI release manifest URL/SHA from SSM matched the downloaded
    `v0.1.0-canary.150` manifest;
  - Cognee and Twenty CRM descriptors exist in `managedApps`;
  - both descriptors point at their Terraform module source/version and required
    smoke command paths;
  - both smoke command paths exist in this checkout;
  - `descriptorReady=true`, `deployReady=true`, and
    `strictDeployReadyRequired=true`;
  - Cognee resolved
    `ghcr.io/thinkwork-ai/thinkwork-cognee:v0.1.0-canary.150-cognee-amd64@sha256:be910a950a31ec6b7e070927f6143b244fbec8b8d66fa3b84f047ee43b996680`;
  - Twenty resolved
    `twentycrm/twenty@sha256:37380b56aa86c6949f6e9f00e21f6e2a2a19bfa94c9e86f5e3202304367c7510`.

Manifest digest note:

- The first `.150` controller run pinned manifest digest
  `dc1bcd1adbb792a00b7b377fe4ce7c6ba7d2235f697f359fa94c50ec2c6ccafb`.
  The release asset later finalized to
  `8645040c1645fddecc5e34649c1bda91124777fb3368776a2ddefd04c8259bfe`
  with platform bundle digest
  `ac0c8c988f3adfc013ba45843bd8e571cba1acccaf0271ed95808b61a2f7390c`.
  TEI was rerun through the customer deployment controller pinned to the final
  digest above so runtime config, selected-release SSM, and the GitHub release
  manifest are coherent.

## 2026-06-10 Previous Controller Proof - v0.1.0-canary.150

The previous `.150` controller update was:

- Step Functions execution:
  `arn:aws:states:us-east-1:637423202447:execution:thinkwork-tei-e2e-deployment-orchestrator:tw-update-150-20260610095036`
- Step Functions status: `SUCCEEDED`
- Step Functions duration: 2026-06-10 04:50:36 CT to 05:00:08 CT
- CodeBuild run:
  `thinkwork-tei-e2e-deployment-runner:6e0f4b92-0f23-4f7a-92fa-982453ba1ade`
- CodeBuild status: `SUCCEEDED`
- Evidence prefix:
  `s3://thinkwork-tei-e2e-637423202447-deploy-evidence/sessions/5eed2926-cb8c-47f6-bf66-700f04a1b5e5/update/`
- Evidence objects present:
  `controller-input-summary.json`, `redacted-terraform-vars.json`,
  `terraform-plan.json`, `terraform-outputs.json`,
  `controller-release-selection.json`, and `deployment-evidence.json`
- Terraform apply result: `1 added, 100 changed, 1 destroyed`
- App CloudFront invalidation `I4BVXPJJ1KJCO8BQ1ZVUTVIE36`: `Completed`
- Release workflow rerun
  `https://github.com/thinkwork-ai/thinkwork/actions/runs/27267228876`:
  `success` on attempt 2 after the first attempt hit a Docker Hub BuildKit
  timeout.
- Controller selected-release SSM status parameters now report:
  `selected-release-version=v0.1.0-canary.150`,
  `selected-release-manifest-sha256=dc1bcd1adbb792a00b7b377fe4ce7c6ba7d2235f697f359fa94c50ec2c6ccafb`,
  `selected-release-manifest-url=https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.150/thinkwork-release.json`,
  and `selected-release-trust-policy=allow_unsigned_canary`.

Runtime smoke evidence:

- `thinkwork-runtime-config.json` reports release
  `v0.1.0-canary.150`, manifest SHA-256
  `dc1bcd1adbb792a00b7b377fe4ce7c6ba7d2235f697f359fa94c50ec2c6ccafb`,
  API endpoint `https://8puq24dl63.execute-api.us-east-1.amazonaws.com/`,
  GraphQL HTTP endpoint
  `https://8puq24dl63.execute-api.us-east-1.amazonaws.com/graphql`, AppSync
  endpoint
  `https://zp7lxyesvnci7gnhfkqbiye3nm.appsync-api.us-east-1.amazonaws.com/graphql`,
  and Cognito domain
  `https://thinkwork-tei-e2e.auth.us-east-1.amazoncognito.com`.
- `curl -fsSI https://d1eqjv7ijcmtqz.cloudfront.net/` returned HTTP 200 with
  the freshly uploaded `index.html`; `/settings/general` also returned HTTP
  200 through the SPA fallback.
- `node scripts/smoke/foundation-bootstrap-smoke.mjs` passed in live
  runtime-config mode on 2026-06-10 with clean evidence written to
  `/tmp/thinkwork-tei-smoke-proof-150/foundation-smoke-150-clean.json`:
  - Spaces endpoint returned HTTP 200.
  - AppSync `{ __typename }` returned HTTP 200 with
    `{"data":{"__typename":"Query"}}`.
  - Cognito domain validation passed.
  - Runtime-config-derived deployment profile included all required v1 client
    binding fields.
- `node plugins/company-brain/smoke/cognee-managed-app-smoke.mjs` passed with evidence at
  `/tmp/thinkwork-tei-smoke-proof-150/cognee-smoke-150.json`; it explicitly
  skipped live Cognee probing because Cognee is not enabled for this base TEI
  stage.
- `node plugins/twenty/smoke/twenty-managed-app-smoke.mjs` passed with evidence at
  `/tmp/thinkwork-tei-smoke-proof-150/twenty-smoke-150.json`; it explicitly
  skipped live Twenty probing because Twenty CRM is not provisioned for this
  base TEI stage.

## 2026-06-10 Previous Controller Proof - v0.1.0-canary.149

The previous accepted controller update was:

- Step Functions execution:
  `arn:aws:states:us-east-1:637423202447:execution:thinkwork-tei-e2e-deployment-orchestrator:tw-update-149-final-manifest-20260610083636`
- Step Functions status: `SUCCEEDED`
- Step Functions duration: 2026-06-10 03:36:37 CT to 03:45:29 CT
- CodeBuild run:
  `thinkwork-tei-e2e-deployment-runner:2065409f-b2fa-4b07-a418-bc9f36811259`
- CodeBuild status: `SUCCEEDED`
- Evidence prefix:
  `s3://thinkwork-tei-e2e-637423202447-deploy-evidence/sessions/9b3b550c-2826-4f4a-ac54-bbc0aa718cd8/update/`
- Evidence `deployment-evidence.json`: `status=succeeded`,
  `terraformExitCode=0`, manifest SHA-256
  `f25c6a05d42578acd6f4696d678b19af831c6e19a23e227e07a6db9559f47532`
- Controller selected-release SSM status parameters now report:
  `selected-release-version=v0.1.0-canary.149`,
  `selected-release-manifest-sha256=f25c6a05d42578acd6f4696d678b19af831c6e19a23e227e07a6db9559f47532`,
  `selected-release-manifest-url=https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.149/thinkwork-release.json`,
  and `terraform-module-version=0.1.0-canary.149`.

Runtime smoke evidence:

- `thinkwork-runtime-config.json` reports release
  `v0.1.0-canary.149`, manifest SHA-256
  `f25c6a05d42578acd6f4696d678b19af831c6e19a23e227e07a6db9559f47532`,
  API endpoint `https://8puq24dl63.execute-api.us-east-1.amazonaws.com/`, and
  Cognito domain `https://thinkwork-tei-e2e.auth.us-east-1.amazoncognito.com`.
- GitHub Release `v0.1.0-canary.149` exposes the human desktop assets
  (`.dmg`, arm64 zip, updater YAML/blockmaps) plus the machine assets
  `thinkwork-release.json` and `platform-artifacts.tar.gz`.
- `platform-artifacts.tar.gz` is recorded in the release manifest with SHA-256
  `b463b44094d60e94ee068881343deab53bb65d6d081b69757dcc04afb181aad8`.
- The final release manifest includes pinned runtime images for
  `agentcore-pi-amd64`, `agentcore-pi-arm64`, `cognee`, `kestra`, and `twenty`.
- `node scripts/smoke/foundation-bootstrap-smoke.mjs` passed in live
  runtime-config mode on 2026-06-10 with evidence written to
  `/tmp/thinkwork-tei-smoke-proof/foundation-smoke-149.json`:
  - Spaces endpoint returned HTTP 200.
  - Cognito domain validation passed.
  - Runtime-config-backed control-plane validation passed for state machine
    `thinkwork-tei-e2e-deployment-orchestrator`, CodeBuild project
    `thinkwork-tei-e2e-deployment-runner`, and evidence bucket
    `thinkwork-tei-e2e-637423202447-deploy-evidence`.
- `node scripts/smoke/deployment-profile-binding-smoke.mjs` passed against live
  TEI `v0.1.0-canary.149` on 2026-06-10 with evidence written to
  `/tmp/thinkwork-tei-smoke-proof/deployment-profile-binding-149.json`.
  It confirmed the web, desktop, and mobile binding snapshots target
  `deploymentId=thinkwork-tei-e2e`, `stage=tei-e2e`, `region=us-east-1`, and
  the TEI Cognito/API/AppSync endpoints. The profile SHA-256 is
  `56001f6d02087be21b47a83d17798523065b58b2f0ab6c2ecdec28e0ca0fee0b`, and
  the evidence contained no API keys, passwords, AWS keys, tokens, credential
  material, or secret payload fields.
- `node scripts/smoke/managed-app-controller-readiness-smoke.mjs` passed in
  strict read-only mode on 2026-06-10 with evidence written to
  `/tmp/thinkwork-tei-smoke-proof/managed-app-controller-readiness-149-final.json`:
  - the selected TEI release manifest URL/SHA from SSM matched the downloaded
    `v0.1.0-canary.149` manifest;
  - Cognee and Twenty CRM descriptors exist in `managedApps`;
  - both descriptors point at their Terraform module source/version and required
    smoke command paths;
  - both smoke command paths exist in this checkout;
  - `descriptorReady=true`, `deployReady=true`, and
    `strictDeployReadyRequired=true`;
  - Cognee resolved
    `ghcr.io/thinkwork-ai/thinkwork-cognee:v0.1.0-canary.149-cognee-amd64@sha256:be910a950a31ec6b7e070927f6143b244fbec8b8d66fa3b84f047ee43b996680`;
  - Twenty resolved
    `twentycrm/twenty@sha256:37380b56aa86c6949f6e9f00e21f6e2a2a19bfa94c9e86f5e3202304367c7510`.

Manifest digest note:

- The first `.149` deploy attempt used an early release manifest digest
  `b97c013a0ac60cb391c50037dbb536563255bed40a4fac1bc8f7e97ebc0a55ff`.
  The release asset later finalized to
  `f25c6a05d42578acd6f4696d678b19af831c6e19a23e227e07a6db9559f47532`.
  TEI was rerun through the customer deployment controller pinned to the final
  digest above. A follow-up hardening item should make release finalization
  atomic so deployable releases cannot be selected before the final manifest is
  stable.

## 2026-06-10 Previous Controller Proof - v0.1.0-canary.148

The previous accepted controller update was:

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
- `node scripts/smoke/foundation-bootstrap-smoke.mjs` passed in live
  runtime-config mode on 2026-06-10 with evidence written to
  `/tmp/thinkwork-tei-smoke-proof/foundation-smoke-148.json`:
  - Spaces endpoint returned HTTP 200.
  - AppSync GraphQL `{ __typename }` returned HTTP 200 with `Query`.
  - Cognito domain validation passed.
  - Deployment profile v1 shape validation passed with profile SHA-256
    `03ec3bf5d805cab2fc4f06a60b84a78e43f0392c60d3f4ec7c118e1358bbc2c1`.
  - Runtime-config-backed control-plane validation passed for state machine
    `thinkwork-tei-e2e-deployment-orchestrator`, CodeBuild project
    `thinkwork-tei-e2e-deployment-runner`, and evidence bucket
    `thinkwork-tei-e2e-637423202447-deploy-evidence`.
- `node plugins/company-brain/smoke/cognee-managed-app-smoke.mjs` passed in live mode as an
  explicit skip because Cognee is not enabled for this base TEI stage; local
  evidence:
  `/tmp/thinkwork-tei-smoke-proof/cognee-smoke-148.json`.
- `node plugins/twenty/smoke/twenty-managed-app-smoke.mjs` passed in live mode as an
  explicit skip because Twenty CRM is not provisioned for this base TEI stage;
  local evidence:
  `/tmp/thinkwork-tei-smoke-proof/twenty-smoke-148.json`.
- `node scripts/smoke/managed-app-controller-readiness-smoke.mjs` passed in
  live read-only diagnostic mode on 2026-06-10 with evidence written to
  `/tmp/thinkwork-tei-smoke-proof/managed-app-controller-readiness-148.json`:
  - the selected TEI release manifest URL/SHA from SSM matched the downloaded
    `v0.1.0-canary.148` manifest;
  - Cognee and Twenty CRM descriptors exist in `managedApps`;
  - both descriptors point at their Terraform module source/version and required
    smoke command paths;
  - both smoke command paths exist in this checkout;
  - `descriptorReady=true`, but `deployReady=false` because the `.148`
    `runtimeImages` list does not include the required `cognee` or `twenty`
    image entries.
- Strict deploy-ready mode failed closed as expected:
  `SMOKE_REQUIRE_MANAGED_APP_DEPLOY_READY=1` reported
  `cognee: required image cognee is not present in runtimeImages` and
  `twenty: required image twenty is not present in runtimeImages`.
- `node scripts/smoke/deployment-teardown-readiness-smoke.mjs` passed in live
  read-only mode on 2026-06-10 with evidence written to
  `/tmp/thinkwork-tei-smoke-proof/deployment-teardown-readiness-148.json`:
  - selected release pins in SSM match `v0.1.0-canary.148` and manifest
    SHA-256 `5b154f800b8754d00d0b252772005bd02fc1dbbf6096036597efd700d4d6df93`;
  - the customer Step Functions state machine is `ACTIVE`;
  - the customer CodeBuild runner project is readable;
  - the Terraform state bucket `tei-thinkwork-terraform-state` is readable;
  - the DynamoDB lock table `tei-thinkwork-terraform-locks` is `ACTIVE`;
  - the evidence bucket contains prior controller session evidence;
  - the generated destroy input preview has `action=destroy`,
    `destroyExecutionStarted=false`, and no credential, token, password,
    API-key, or AWS-key fields.

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

Invite email remediation status (2026-06-10):

- Root-cause addendum: the `cognito_email_source_arn` /
  `cognito_from_email_address` / `cognito_reply_to_email_address` Terraform
  variables shipped in `v0.1.0-canary.150`, but the controller runner's
  `vars_json` allowlist never threaded them, so no controller-managed
  deployment could set them. Fixed in this change
  (`terraform/modules/app/deployment-control-plane/runner.py`): the runner now
  reads `cognitoEmailSourceArn`, `cognitoFromEmailAddress`, and
  `cognitoReplyToEmailAddress` from the runner secrets payload with a
  controller-input fallback, mirroring `platform_operator_emails`.
- TEI SES provisioning executed 2026-06-10 against account `637423202447`
  (`us-east-1`):
  - SES domain identity `lastmile-tei.com` created; 3 DKIM CNAMEs upserted in
    Route53 zone `Z00506522C7M1WRQADH0` (change `C03185053JTTIRWH1J8RP`).
  - Sending-authorization policy `CognitoUserPoolSend` attached to the
    identity, allowing `email.cognito-idp.amazonaws.com` to send for user pool
    `us-east-1_YlRAfXsE9` (required for `EmailSendingAccount=DEVELOPER`).
  - SES production-access request submitted via `put-account-details`
    (transactional, low volume). Until AWS grants it, the account is
    sandboxed: SES-backed sends reach verified recipients only.
- Deliberately NOT yet done (sequencing): the user pool stays on
  `COGNITO_DEFAULT` until production access is granted — flipping to
  `DEVELOPER` while sandboxed would hard-fail invites to unverified
  recipients. After approval, redeploy TEI through the controller with
  `cognitoEmailSourceArn=arn:aws:ses:us-east-1:637423202447:identity/lastmile-tei.com`
  and `cognitoFromEmailAddress=ThinkWork <noreply@lastmile-tei.com>` in the
  controller input (or runner secrets), on a release containing this runner
  fix.
- Correction (2026-06-10, found during ce-compound verification): the #2341
  vars_json threading was necessary but NOT sufficient. The runner's generated
  root module (`main.tf` template in `write_runner_files`) must also declare
  each variable and pass it into `module "thinkwork"` — Terraform drops
  `terraform.auto.tfvars.json` values for undeclared variables with only a
  warning. `platform_operator_emails` has all three wiring points; the five
  new vars had only vars_json. Fixed by adding the declarations + module
  arguments, and the threading test now asserts the generated `main.tf`
  carries all three points. The TEI redeploy must pin the release containing
  THIS fix (v0.1.0-canary.159+), not canary.158.

Custom app domain (2026-06-10):

- Decision: the TEI app moves from the raw CloudFront URL
  (`https://d1eqjv7ijcmtqz.cloudfront.net`) to `https://tw.lastmile-tei.com`.
  Setting `app_domain` also fixes the Cognito callback URLs and the invite
  email sign-in link, which currently hardcode the CloudFront URL.
- The controller runner had the same allowlist gap for `app_domain` /
  `app_certificate_arn`; this change threads `appDomain` /
  `appCertificateArn` the same way as the Cognito email vars.
- TEI provisioning executed 2026-06-10:
  - ACM certificate requested in `us-east-1`:
    `arn:aws:acm:us-east-1:637423202447:certificate/4c53e8c5-3f62-41db-baf8-7bd030d80499`,
    DNS validation CNAME upserted in zone `Z00506522C7M1WRQADH0`.
  - Route53 A/AAAA aliases `tw.lastmile-tei.com` ->
    `d1eqjv7ijcmtqz.cloudfront.net` created (CloudFront returns 403 for the
    new Host until the distribution alias lands via redeploy — expected).
- Next controller redeploy of TEI should therefore carry:
  `appDomain=tw.lastmile-tei.com`,
  `appCertificateArn=arn:aws:acm:us-east-1:637423202447:certificate/4c53e8c5-3f62-41db-baf8-7bd030d80499`,
  plus the `cognitoEmailSourceArn` / `cognitoFromEmailAddress` values above.
  Note: once `app_domain` is set, the raw CloudFront URL is no longer in the
  Cognito callback list; use the custom domain for sign-in.

## Preflight Already Verified

Run from the repository root:

```bash
export AWS_PROFILE=tei
export AWS_REGION=us-east-1
export THINKWORK_STAGE=tei-e2e
export THINKWORK_CUSTOMER=tei
export THINKWORK_RELEASE_VERSION=v0.1.0-canary.149
export THINKWORK_MANIFEST_URL=https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.149/thinkwork-release.json
export THINKWORK_MANIFEST_SHA256=f25c6a05d42578acd6f4696d678b19af831c6e19a23e227e07a6db9559f47532
export THINKWORK_ACCOUNT_ID=637423202447
```

Safe identity and doctor checks:

```bash
aws sts get-caller-identity --profile "$AWS_PROFILE" --output json
pnpm --dir apps/cli dev doctor -s "$THINKWORK_STAGE" --profile "$AWS_PROFILE"
```

Observed result on 2026-06-09 and 2026-06-10:

- AWS identity resolved to account `637423202447`.
- Terraform CLI resolved to `v1.9.8`.
- AWS CLI resolved to `aws-cli/2.34.52`.
- Bedrock access check for `anthropic.claude-3-haiku` passed.
- Doctor passed only after `AWS_REGION=us-east-1` was set.
- `v0.1.0-canary.149` release manifest downloaded successfully and hashed to
  `f25c6a05d42578acd6f4696d678b19af831c6e19a23e227e07a6db9559f47532`.

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

For the current TEI controller-managed runtime, the accepted smoke was run from
published runtime config instead of local Terraform state:

```bash
SMOKE_ENABLE_FOUNDATION_BOOTSTRAP=1 \
SMOKE_TERRAFORM_DIR=/tmp/thinkwork-tei-smoke-proof/no-local-terraform-root \
SMOKE_SPACES_URL=https://d1eqjv7ijcmtqz.cloudfront.net \
SMOKE_GRAPHQL_URL=https://zp7lxyesvnci7gnhfkqbiye3nm.appsync-api.us-east-1.amazonaws.com/graphql \
SMOKE_GRAPHQL_WS_URL=wss://zp7lxyesvnci7gnhfkqbiye3nm.appsync-realtime-api.us-east-1.amazonaws.com/graphql \
SMOKE_COGNITO_DOMAIN=https://thinkwork-tei-e2e.auth.us-east-1.amazoncognito.com \
SMOKE_REQUIRE_CONTROL_PLANE=1 \
SMOKE_STEP_FUNCTIONS_STATE_MACHINE_ARN=arn:aws:states:us-east-1:637423202447:stateMachine:thinkwork-tei-e2e-deployment-orchestrator \
SMOKE_CODEBUILD_PROJECT=thinkwork-tei-e2e-deployment-runner \
SMOKE_EVIDENCE_BUCKET=thinkwork-tei-e2e-637423202447-deploy-evidence \
SMOKE_RELEASE_VERSION=v0.1.0-canary.149 \
SMOKE_MANIFEST_SHA256=f25c6a05d42578acd6f4696d678b19af831c6e19a23e227e07a6db9559f47532 \
SMOKE_EVIDENCE_FILE=/tmp/thinkwork-tei-smoke-proof/foundation-smoke-149.json \
node /Users/ericodom/Projects/thinkwork/scripts/smoke/foundation-bootstrap-smoke.mjs
```

The accepted local run also passed `SMOKE_DEPLOYMENT_PROFILE_JSON`,
`SMOKE_DEPLOYMENT_PROFILE_SHA256`, and `APPSYNC_API_KEY` from
`thinkwork-runtime-config.json`. Do not paste the raw API key into docs or
evidence; the evidence records only endpoint status and profile SHA-256.

Pass criteria:

- Spaces app endpoint check passes.
- GraphQL/AppSync endpoint checks pass.
- Cognito/auth-domain check passes.
- Deployment profile check passes when profile JSON fields are available.
- Deployment control-plane output check passes.
- Evidence is written to
  `/tmp/thinkwork-tei-e2e-greenfield/deploy-artifacts/foundation-smoke.json`.

## Phase 3A: Deployment Profile Binding Smoke

Run the read-only profile-binding smoke after the runtime config is published:

```bash
pnpm --filter @thinkwork/deployment-profile build

SMOKE_ENABLE_DEPLOYMENT_PROFILE_BINDING=1 \
SMOKE_SPACES_URL=https://d1eqjv7ijcmtqz.cloudfront.net \
SMOKE_EVIDENCE_FILE=/tmp/thinkwork-tei-smoke-proof/deployment-profile-binding-149.json \
node /Users/ericodom/Projects/thinkwork/scripts/smoke/deployment-profile-binding-smoke.mjs
```

The accepted `v0.1.0-canary.149` run produced profile SHA-256
`56001f6d02087be21b47a83d17798523065b58b2f0ab6c2ecdec28e0ca0fee0b` and
confirmed that the web, desktop, and mobile binding snapshots all target
`deploymentId=thinkwork-tei-e2e`, `stage=tei-e2e`, `region=us-east-1`, and the
TEI Cognito/API/AppSync endpoints. The smoke failed closed if the generated
profile or evidence contained API keys, passwords, AWS keys, tokens, credential
material, or secret payload fields.

This proves the universal profile contract that web, desktop, and mobile
consume. It does not replace the human desktop/mobile launch proof in Phase 8.

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

Before enabling either app, prove the selected release has deployable managed
app descriptors and images:

```bash
SMOKE_ENABLE_MANAGED_APP_CONTROLLER_READINESS=1 \
AWS_PROFILE="$AWS_PROFILE" \
AWS_REGION="$AWS_REGION" \
SMOKE_STAGE="$THINKWORK_STAGE" \
SMOKE_RELEASE_VERSION="$THINKWORK_RELEASE_VERSION" \
SMOKE_MANIFEST_SHA256="$THINKWORK_MANIFEST_SHA256" \
SMOKE_EVIDENCE_FILE=/tmp/thinkwork-tei-smoke-proof/managed-app-controller-readiness-148.json \
node /Users/ericodom/Projects/thinkwork/scripts/smoke/managed-app-controller-readiness-smoke.mjs
```

For final optional-app acceptance, rerun with strict deploy readiness:

```bash
SMOKE_ENABLE_MANAGED_APP_CONTROLLER_READINESS=1 \
SMOKE_REQUIRE_MANAGED_APP_DEPLOY_READY=1 \
AWS_PROFILE="$AWS_PROFILE" \
AWS_REGION="$AWS_REGION" \
SMOKE_STAGE="$THINKWORK_STAGE" \
node /Users/ericodom/Projects/thinkwork/scripts/smoke/managed-app-controller-readiness-smoke.mjs
```

Current `.148` result: descriptors are ready, but strict mode fails because the
release manifest does not include `cognee` or `twenty` runtime image entries.
Publish a release with those required images before treating Cognee/Twenty as
deployable through the controller.

Twenty CRM:

```bash
SMOKE_ENABLE_TWENTY_MANAGED_APP=1 \
SMOKE_TERRAFORM_DIR="$DEPLOY_ROOT/terraform" \
SMOKE_EVIDENCE_FILE="$DEPLOY_ROOT/deploy-artifacts/twenty-smoke.json" \
AWS_PROFILE="$AWS_PROFILE" \
AWS_REGION="$AWS_REGION" \
node /Users/ericodom/Projects/thinkwork/plugins/twenty/smoke/twenty-managed-app-smoke.mjs
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

Base TEI optional-app smoke evidence on 2026-06-10:

- `cognee-managed-app-smoke.mjs` returned `ok:true`, `skippedLive:true`,
  `reason:"Cognee is not enabled for this stage."`
- `twenty-managed-app-smoke.mjs` returned `ok:true`, `skippedLive:true`,
  `reason:"Twenty CRM is not provisioned for this stage."`

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
- The profile-binding smoke passes against the published runtime config and
  records no credential, token, password, API-key, or AWS-key fields in the
  generated profile/evidence.

## Cleanup

Cleanup destroys cloud resources and should be run only after saving evidence.

Before running destructive cleanup, prove that the customer-owned controller has
the state/evidence pointers it needs for destroy:

```bash
SMOKE_ENABLE_DEPLOYMENT_TEARDOWN_READINESS=1 \
AWS_PROFILE="$AWS_PROFILE" \
AWS_REGION="$AWS_REGION" \
SMOKE_STAGE="$THINKWORK_STAGE" \
SMOKE_RELEASE_VERSION="$THINKWORK_RELEASE_VERSION" \
SMOKE_MANIFEST_SHA256="$THINKWORK_MANIFEST_SHA256" \
SMOKE_EVIDENCE_FILE=/tmp/thinkwork-tei-smoke-proof/deployment-teardown-readiness-148.json \
node /Users/ericodom/Projects/thinkwork/scripts/smoke/deployment-teardown-readiness-smoke.mjs
```

This smoke is intentionally read-only. It must pass before final teardown, but
it is not a substitute for the final destroy proof.

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

| Gate                                 | Result                 | Evidence                                                                             |
| ------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------ |
| AWS profile and Bedrock doctor       | PASS on 2026-06-09     | Doctor output for account `637423202447`                                             |
| Release manifest asset and digest    | PASS on 2026-06-10     | `v0.1.0-canary.150` manifest SHA-256                                                 |
| GitHub-free bootstrap dry-run        | PASS on 2026-06-09     | CLI dry-run output for top-level and enterprise bootstrap                            |
| GitHub-free substrate live bootstrap | PASS on 2026-06-09     | TEI Step Functions + CodeBuild controller exists                                     |
| Controller release update            | PASS on 2026-06-10     | `.150` execution and CodeBuild run succeeded                                         |
| Controller selected-release status   | PASS on 2026-06-10     | SSM status params + `controller-release-selection.json`                              |
| Foundation runtime smoke             | PASS on 2026-06-10     | `/sign-in` 200 + runtime config release/digest + live smoke evidence                 |
| Deployment profile contract smoke    | PASS on 2026-06-10     | Web/desktop/mobile binding snapshots target TEI from runtime config profile          |
| First admin login                    | PASS on 2026-06-09     | Browser login to TEI completed                                                       |
| Model catalog / Agents UI smoke      | PASS after remediation | Browser proof + GraphQL `ok:true` logs                                               |
| Managed-app descriptor readiness     | PASS on 2026-06-10     | Cognee/Twenty descriptors and smoke contracts exist in `.150` release manifest       |
| Managed-app deploy readiness         | PASS on 2026-06-10     | `.150` manifest resolves required `cognee` and `twenty` runtime images               |
| Managed-app UI smoke                 | Partial                | Cognee/Twenty `.150` skip evidence captured; full optional-app deploy smoke remains  |
| Desktop profile selection            | Partial                | Profile contract passes; desktop `.150` assets are available for user launch test    |
| Mobile profile selection             | Partial                | Profile contract passes; mobile launch proof remains                                 |
| Teardown readiness                   | PASS on 2026-06-10     | Read-only controller/backend/evidence smoke passed; no destroy execution was started |
| Cleanup / teardown                   | Deferred               | TEI kept live for demo; run final destroy after evidence is saved                    |

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

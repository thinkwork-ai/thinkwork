---
title: "Settings release upgrade runbook"
date: 2026-06-14
status: active
---

# Settings Release Upgrade Runbook

Use this runbook when upgrading an external AWS-native customer environment
from **Settings -> General -> Releases**. This is the canonical operator path
for healthy customer control planes. Manual AWS CLI remediation is the escape
hatch, not the happy path.

## Scope

The Settings workflow is for customer environments that already have the
deployment control plane installed:

- Step Functions deployment orchestrator
- CodeBuild deployment runner
- deployment evidence bucket
- selected-release status pointer
- GraphQL API with the release-update job mutations enabled

Do not use this workflow to bootstrap a brand-new customer, recover from broken
AWS credentials, or apply an unreviewed production mutation. Use the bootstrap
and incident runbooks for those cases.

## Before You Start

Confirm the environment is the one you intend to update:

1. Open `/settings/general`.
2. Check **Stage**, **Region**, **Account ID**, **Deployed release**,
   **Manifest SHA**, **Deployment controller**, **Runner**, and
   **Evidence bucket**.
3. Confirm the target release row shows the expected version and manifest
   SHA-256.
4. Do not click **Run Preflight** unless you intend to create a release-update
   job for that environment.

## Happy Path

1. In **Settings -> General -> Releases**, click **Review** on the target
   release.
2. Verify the dialog shows the target release, manifest URL, and SHA-256.
3. Click **Run Preflight**.
4. Review the workflow panel:
   - current and target release
   - manifest trust posture
   - runner compatibility
   - IAM status
   - customer domain and delegation flags
   - SES sender settings
   - platform operator emails
   - Google OAuth status
   - optional app flags
   - evidence bucket/prefix and status pointer
5. If the panel says **Release ready for dispatch**, click **Start Update**.
6. Watch the panel for the Step Functions execution ARN, CodeBuild build ARN,
   evidence prefix, and final status.
7. Treat the update as accepted only after Settings reports success and the
   deployed release matches the target release.

## Runner Refresh

If preflight reports a runner mismatch and shows **Refresh Runner**:

1. Confirm the target release is the intended release.
2. Click **Refresh Runner**.
3. Wait for Settings to report the runner refresh as complete.
4. Confirm evidence records both the previous runner object and the selected
   release runner digest.
5. Continue with **Start Update** only after the workflow panel returns to
   **Release ready for dispatch**.

The refresh path backs up the frozen S3 runner before uploading the selected
release runner. It should not change Terraform state or customer application
resources.

## Blocking Checks

If the workflow panel shows **Release checks need attention**, do not dispatch.
Use the blocker and recovery text in Settings as the source of truth.

Common blockers:

| Blocker                  | Meaning                                                                                                             | Operator action                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runner compatibility     | The frozen S3 runner does not match the selected release runner metadata.                                           | Use **Refresh Runner** if offered. Otherwise use the manual runner escape hatch below.                                                           |
| IAM drift                | The live CodeBuild role is missing actions required by the selected release class.                                  | Do not manually patch unless an incident commander authorizes it. Ship the Terraform/IAM fix or use the documented customer-domain escape hatch. |
| Manifest trust           | The manifest is unsigned, signed by an unknown key, has the wrong digest, or violates the environment trust policy. | Pick a trusted release or fix release signing. Do not dispatch.                                                                                  |
| Missing preserved config | The API could not recover customer-specific settings needed for a safe payload.                                     | Stop and inspect runner secrets, SSM parameters, and prior evidence before retrying.                                                             |

## Failure Triage

When dispatch starts but the controller fails:

1. Copy the Step Functions execution ARN from Settings.
2. Copy the CodeBuild build ARN/id if one exists.
3. Copy the evidence bucket/prefix and `deployment/status/current.json`
   pointer.
4. Read the failure message and recovery action in Settings.
5. Inspect the controller evidence before retrying. Do not submit a second
   update until the root cause is understood.

Useful evidence objects:

- `controller-input-summary.json`
- `redacted-terraform-vars.json`
- `terraform-plan.json`
- `terraform-outputs.json`
- `controller-release-selection.json`
- `deployment-evidence.json`
- `deployment/status/current.json`

## Manual Escape Hatch

Manual AWS CLI commands are allowed only for incident recovery when the Settings
path cannot make progress and the action is already authorized.

Runner skew escape hatch:

```bash
aws s3 cp \
  s3://thinkwork-<stage>-<account>-deploy-evidence/runner/thinkwork-runner.py \
  s3://thinkwork-<stage>-<account>-deploy-evidence/runner/thinkwork-runner.py.bak-pre-<release>

aws s3 cp \
  terraform/modules/app/deployment-control-plane/runner.py \
  s3://thinkwork-<stage>-<account>-deploy-evidence/runner/thinkwork-runner.py
```

IAM drift escape hatch:

- Prefer a reviewed Terraform/module fix.
- For existing frozen control planes, an additive live inline policy may be the
  only recovery path. Record the policy name, JSON, operator, timestamp, and
  why Settings could not remediate it.
- Never use manual IAM changes to bypass a manifest trust failure.

## Completion Record

For every customer release update, record:

- source and target release versions
- target manifest URL and SHA-256
- preflight job id
- runner remediation job/event id, if used
- Step Functions execution ARN
- CodeBuild build ARN/id
- evidence bucket/prefix
- final `deployment/status/current.json` status
- whether customer domain, SES sender, OAuth, operator emails, and optional
  app flags were preserved

## Related Docs

- `docs/verification/settings-release-upgrade-safety.md`
- `docs/src/content/docs/deploy/release-manifests.mdx`
- `docs/solutions/integration-issues/customer-control-plane-frozen-bootstrap-incompatibility.md`
- `docs/runbooks/customer-domain-claim-runbook.md`

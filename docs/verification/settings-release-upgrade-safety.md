---
title: "Settings release upgrade safety verification"
date: 2026-06-14
status: active
---

# Settings Release Upgrade Safety Verification

This checklist verifies the Settings release upgrade path for external
customer environments. It documents what must be covered before treating the
browser flow as the normal replacement for an agent-run upgrade runbook.

## Scope

The verification target is the `Settings -> General -> Releases` workflow:

- release manifest selection
- release-update preflight job creation
- runner compatibility detection and remediation
- IAM drift detection
- preserved customer configuration review
- reviewed dispatch into the deployment controller
- execution/evidence/final-status visibility

Do not use this checklist to authorize production deployment from a local
checkout. Use it to validate the behavior before or after the normal
merge/deploy pipeline has delivered the code.

## Automated Coverage

| Area                      | Required coverage                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Release manifest metadata | Manifest generation tests include deployment runner script path, SHA-256, and bundle staging.                                              |
| Release job substrate     | Resolver tests cover release-update job creation, event persistence, and job lookup.                                                       |
| Preflight                 | API tests cover manifest validation, runner hash compatibility, preserved config summary, IAM drift detection, and blocked/ready statuses. |
| Runner remediation        | API tests cover backup, selected-release runner upload, evidence writes, and remediated job status.                                        |
| Reviewed dispatch         | API tests cover job-required dispatch, preserved config payload, controller execution metadata, and terminal status reconciliation.        |
| Settings UI               | Web tests cover preflight-first review, preserved config display, runner refresh, reviewed dispatch, and execution evidence display.       |

## Manual Browser Check

Use a non-production stage unless the production change is already approved.

1. Start the web app with deployed-stage config.
2. Open `/settings/general`.
3. Confirm **Deployment** shows deployed release, manifest SHA, stage,
   controller, runner, and evidence bucket.
4. Scroll to **Releases**.
5. Confirm release rows use **Review**, not a direct deploy action.
6. Open a release review dialog.
7. Confirm the dialog shows release version, manifest URL, manifest SHA-256,
   and **Run Preflight**.
8. Stop before **Run Preflight** unless creating a live preflight job is part
   of the test plan.

## Live Preflight Acceptance

When a live preflight job is authorized, capture:

- target release version and manifest SHA-256
- preflight job id
- manifest trust policy
- runner status
- IAM status
- preserved customer domain/delegation fields
- SES sender settings
- platform operator emails
- OAuth configured flag
- optional app flags
- evidence prefix and status pointer

Expected ready state:

- `status = preflight_ready` or `status = runner_remediated`
- no blockers
- Settings shows **Release ready for dispatch**
- **Start Update** is enabled

Expected blocked state:

- `status = preflight_blocked`
- Settings shows **Release checks need attention**
- **Start Update** is not available
- blocker text includes a precise recovery action

## Runner Mismatch Case

To verify runner remediation without mutating production:

1. Use a stage with a known older S3 runner or a controlled test evidence
   bucket.
2. Run preflight for a release whose manifest includes
   `components.deploymentRunner.script.sha256`.
3. Confirm Settings reports runner refresh required.
4. Click **Refresh Runner** only if the test authorizes the S3 runner write.
5. Confirm the job records the backup key, target runner digest, and
   `runner_remediated` status.
6. Confirm **Start Update** is available only after remediation clears the
   blocker.

## IAM Drift Case

To verify IAM drift detection:

1. Use a non-production customer control plane whose CodeBuild role is missing
   a known release-required action, such as Route53 actions for a
   customer-domain release class.
2. Run preflight.
3. Confirm Settings blocks dispatch with an IAM drift message.
4. Confirm no Settings action silently patches IAM at v1.
5. Record the missing actions and recovery text.

## Reviewed Dispatch Case

When dispatch is authorized:

1. Start from a ready/remediated preflight job.
2. Click **Start Update**.
3. Confirm the mutation uses the release-update job id rather than raw manifest
   fields.
4. Confirm Settings displays Step Functions execution ARN.
5. Confirm Settings displays CodeBuild build ARN/id once available.
6. Confirm the evidence bucket/prefix is present.
7. Confirm terminal success updates deployed release and final status.
8. Confirm terminal failure shows failure cause and recovery action.

## Regression Guardrails

- Do not reintroduce a direct Settings release dispatch button.
- Do not dispatch from raw manifest URL/SHA alone.
- Do not hide preserved customer config before dispatch.
- Do not allow runner or IAM blockers to show **Start Update**.
- Do not treat manual AWS CLI remediation as the default operator path.
- Do not remove evidence pointers from successful or failed jobs.

## Related Docs

- `docs/runbooks/settings-release-upgrades.md`
- `docs/src/content/docs/applications/admin/settings.mdx`
- `docs/src/content/docs/deploy/release-manifests.mdx`
- `docs/solutions/integration-issues/customer-control-plane-frozen-bootstrap-incompatibility.md`

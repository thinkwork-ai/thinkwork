---
title: "Cognito invite emails never sent: controller runner drops SES wiring vars (allowlist + generated root module), customer SES unprovisioned"
date: 2026-06-10
category: integration-issues
module: terraform/modules/app/deployment-control-plane
problem_type: integration_issue
component: email_processing
severity: high
symptoms:
  - "New-user invite emails never arrive in a controller-managed customer (TEI) deployment, while AdminCreateUser succeeds and invitees sit in FORCE_CHANGE_PASSWORD"
  - "User pool shows EmailSendingAccount=COGNITO_DEFAULT even though cognito_email_source_arn shipped in the thinkwork module (cde7bed24, v0.1.0-canary.150)"
  - "Setting cognitoEmailSourceArn in the controller input has no effect — the runner never threads it to Terraform"
  - "Customer account SES has zero identities and ProductionAccessEnabled: false (sandbox)"
  - "Re-inviting an existing user reports success but sends nothing"
root_cause: config_error
resolution_type: code_fix
related_components:
  - authentication
  - tooling
  - development_workflow
tags:
  - cognito
  - ses
  - email-invites
  - deployment-control-plane
  - terraform-vars-allowlist
  - ses-sandbox
  - admin-create-user
  - sending-authorization-policy
  - two-place-wiring
---

# Cognito invite emails never sent: controller runner drops SES wiring vars, customer SES unprovisioned

## Problem

Controller-managed customer deployments (the TEI environment) could not deliver Cognito invite emails. The Terraform support for SES-backed Cognito email had existed since `v0.1.0-canary.150` — `cognito_email_source_arn` / `cognito_from_email_address` / `cognito_reply_to_email_address` in `terraform/modules/thinkwork/variables.tf`, wired into the pool's `email_configuration` block in `terraform/modules/foundation/cognito/main.tf`:

```hcl
email_configuration {
  email_sending_account  = var.email_source_arn != "" ? "DEVELOPER" : "COGNITO_DEFAULT"
  source_arn             = var.email_source_arn != "" ? var.email_source_arn : null
  from_email_address     = var.from_email_address != "" ? var.from_email_address : null
  reply_to_email_address = var.reply_to_email_address != "" ? var.reply_to_email_address : null
}
```

But the deployment controller's runner (`terraform/modules/app/deployment-control-plane/runner.py`, `write_runner_files`) never carried the values to Terraform — at **two separate wiring points** (see Root Cause). Every controller-managed pool silently stayed on `COGNITO_DEFAULT`: the shared `no-reply@verificationemail.com` sender, 50 emails/day, poor deliverability to corporate mail gateways, and zero delivery observability. The same gaps existed for `app_domain` / `app_certificate_arn`, stranding the deployed app on its raw CloudFront URL (which the Cognito callback URLs and the invite-email sign-in link hardcode).

## Symptoms

- Invitees never receive Cognito invite emails from the deployment.
- `AdminCreateUser` succeeds; invitees exist in the pool in `FORCE_CHANGE_PASSWORD` — the API path looks healthy.
- `aws cognito-idp describe-user-pool` shows `EmailSendingAccount: COGNITO_DEFAULT`; the customer account's SES has zero identities and is sandboxed.
- Re-inviting the same user reports success but sends nothing.
- Setting `cognitoEmailSourceArn` in the controller deployment input has no effect on the deployed pool.

## What Didn't Work

**Diagnostic trap 1 — the "email was sent" illusion.** `AdminCreateUser` succeeding and users sitting in `FORCE_CHANGE_PASSWORD` looks exactly like a successful invite; it proves nothing about delivery. `COGNITO_DEFAULT` delivery is unobservable — no CloudWatch logs, no SES metrics, no bounce visibility. The only delivery probe available was resending an invite to an address we controlled:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <pool-id> \
  --username probe@ourdomain.example \
  --message-action RESEND
```

**Diagnostic trap 2 — retries silently mask the problem.** Re-inviting an existing user no-ops: `inviteMemberCore` in `packages/api/src/graphql/resolvers/core/inviteMember.mutation.ts` catches `UsernameExistsException`, looks up the existing sub, and returns success **without resending the invite email**. So "just invite them again" appeared to work and sent nothing. (Follow-up: call `AdminCreateUser` with `MessageAction=RESEND` for `FORCE_CHANGE_PASSWORD`/`UNCONFIRMED` users.)

**Diagnostic trap 3 — "the Terraform support exists, so configuration must work."** The variables, the module plumbing, and even a prior-day diagnosis in `docs/verification/tei-new-environment-deployment-e2e.md` all existed. The blocker was a layer up, in the controller runner.

**Diagnostic trap 4 — tests that cover two of three wiring points.** The first fix (PR #2341) threaded the vars into `vars_json` with tests asserting `vars_json` and `terraform.auto.tfvars.json` content — and those tests passed while the vars still never reached Terraform, because the runner's *generated root module* didn't declare them (caught later during a `/ce-compound` verification pass; fixed in PR #2357).

**Sequencing hazard (avoided):** flipping the pool to `EmailSendingAccount=DEVELOPER` before SES production access is granted makes things *worse* — a sandboxed SES account hard-fails sends to unverified recipients, whereas `COGNITO_DEFAULT` at least attempts delivery. Also `aws sesv2 put-account-details` returns `ConflictException` while a production-access review case is pending — that means "request in flight," not an error to fix.

**Interim mitigation used** (onboarding unblocked without email): admin-set temporary passwords shared out-of-band — the web app handles the `NEW_PASSWORD_REQUIRED` challenge:

```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id <pool-id> \
  --username invitee@customer.com \
  --password '<temp-password>' \
  --no-permanent
```

## Solution

**Code fix, part 1 (PR #2341):** thread all five vars through the runner's `vars_json`, mirroring the `platform_operator_emails` pattern (runner secrets win, controller payload is the fallback, empty-string default):

```python
"cognito_email_source_arn": safe_get(
    runner_secrets,
    "cognitoEmailSourceArn",
    default=safe_get(payload, "cognitoEmailSourceArn", default=""),
),
# ... cognito_from_email_address, cognito_reply_to_email_address,
#     app_domain, app_certificate_arn — same shape
```

**Code fix, part 2 (PR #2357):** declare each variable in the runner's generated root module and pass it into `module "thinkwork"`. Terraform drops `terraform.auto.tfvars.json` values for undeclared variables with only a warning, so without this the values dead-ended one step later:

```hcl
variable "cognito_email_source_arn" {
  type = string
}
# ... + 4 more declarations

module "thinkwork" {
  # ...
  cognito_email_source_arn       = var.cognito_email_source_arn
  cognito_from_email_address     = var.cognito_from_email_address
  cognito_reply_to_email_address = var.cognito_reply_to_email_address
  app_domain          = var.app_domain
  app_certificate_arn = var.app_certificate_arn
}
```

**Test (after both parts):** `test_runner_bundle.py::test_write_runner_files_threads_cognito_email_vars_from_payload` asserts **all three wiring points** — the returned `vars_json`, the written `terraform.auto.tfvars.json`, and the generated `main.tf` containing `variable "<name>"` plus `= var.<name>` for each var. A companion test pins runner-secrets precedence and empty defaults. Each part was verified to fail against its respective unfixed runner.

**Ops remediation (customer account) — strict order:**

1. Create the SES domain identity and DKIM-verify via Route53:

```bash
aws sesv2 create-email-identity --email-identity <customer-domain>
# UPSERT the 3 DKIM CNAMEs (<token>._domainkey.<domain> -> <token>.dkim.amazonses.com)
aws sesv2 get-email-identity --email-identity <customer-domain> \
  --query 'DkimAttributes.Status'   # wait for SUCCESS
```

2. Attach a sending-authorization policy so Cognito may send from the identity — **required for `EmailSendingAccount=DEVELOPER`**:

```bash
aws sesv2 create-email-identity-policy \
  --email-identity <customer-domain> \
  --policy-name CognitoUserPoolSend \
  --policy '{"Version":"2012-10-17","Statement":[{
    "Effect":"Allow",
    "Principal":{"Service":"email.cognito-idp.amazonaws.com"},
    "Action":["ses:SendEmail","ses:SendRawEmail"],
    "Resource":"arn:aws:ses:<region>:<account>:identity/<customer-domain>",
    "Condition":{
      "StringEquals":{"aws:SourceAccount":"<account>"},
      "ArnLike":{"aws:SourceArn":"arn:aws:cognito-idp:<region>:<account>:userpool/<pool-id>"}
    }}]}'
```

3. Request SES production access (accounts start sandboxed; approval ~24h):

```bash
aws sesv2 put-account-details --production-access-enabled \
  --mail-type TRANSACTIONAL --website-url https://<customer-domain> \
  --use-case-description "Cognito user-pool invitation and recovery emails, low volume" \
  --contact-language EN
# ConflictException = a review case is already pending; wait, don't retry.
aws sesv2 get-account --query 'ProductionAccessEnabled'
```

4. **Only after `ProductionAccessEnabled` is `true`**, redeploy through the controller with `cognitoEmailSourceArn` / `cognitoFromEmailAddress` (plus `appDomain` / `appCertificateArn`) on a release containing **both** runner fixes (`v0.1.0-canary.159+`).

## Why This Works

The runner is the only bridge between controller input and Terraform, and it has **three wiring points per variable**: the `vars_json` allowlist (serialized to `terraform.auto.tfvars.json`), a `variable` declaration in the generated root module, and a module argument into `module "thinkwork"`. A variable missing any point silently dead-ends — `vars_json` omission means the value never leaves the payload; a missing root-module declaration means Terraform discards the tfvars value with a warning nobody reads. The empty-string defaults keep the fix inert for existing deployments (`""` ⇒ `COGNITO_DEFAULT` in the cognito module), so deployments opt in via controller input.

The ops sequencing works because Cognito's `DEVELOPER` mode delegates entirely to the customer account's SES: it needs (a) a verified identity, (b) a sending-authorization policy trusting `email.cognito-idp.amazonaws.com`, and (c) an out-of-sandbox account — missing (c) converts every invite to an unverified recipient into a hard failure, which is why the pool flip must come last.

## Prevention

- **The three-wiring-points rule.** Adding a `variable` to `terraform/modules/thinkwork/variables.tf` does NOT make it controller-configurable. Every customer-settable var must also be added to (1) the runner's `vars_json` allowlist, (2) the generated root module's `variable` declarations, and (3) the `module "thinkwork"` arguments — all in `write_runner_files` (`terraform/modules/app/deployment-control-plane/runner.py`). This is the controller-runner instance of the repo's recurring "two-place wiring" family (Lambda handlers need `handlers.tf` + `build-lambdas.sh`; AppSync subscriptions need `@aws_subscribe` + `notification_mutations`): the wiring point you forget fails silently.
- **Test the full chain, not the first hop.** PR #2341's tests asserted `vars_json`/tfvars and passed while the value still never reached Terraform. The guard that works asserts the *last* artifact in the chain — the generated `main.tf` carries `variable "<name>"` and `= var.<name>` (see `test_write_runner_files_threads_cognito_email_vars_from_payload`). Write it first; it fails with `KeyError`/`AssertionError` against an unwired runner.
- **SES-backed Cognito email sequencing checklist** (per customer account): identity created + DKIM `SUCCESS` → sending-auth policy for `email.cognito-idp.amazonaws.com` scoped to the pool ARN → production-access requested (`ConflictException` = pending, wait) → `ProductionAccessEnabled: true` → only then redeploy with the email vars. Never flip to `DEVELOPER` while sandboxed.
- **Don't trust invite "success" as delivery.** `COGNITO_DEFAULT` has no delivery telemetry; probe with `admin-create-user --message-action RESEND` to a controlled address. Re-inviting an existing user is a silent no-op until the `MessageAction=RESEND` follow-up lands in `inviteMember`. Interim unblock: `admin-set-user-password --no-permanent` + out-of-band share (web app handles `NEW_PASSWORD_REQUIRED`).
- **Post-deploy smoke for invite email** — `docs/solutions/integration-issues/twenty-crm-email-ses-config-2026-06-06.md` reached the same conclusion for Twenty CRM four days earlier: login + healthz is insufficient; send a real invite.

## Related Issues

- PR [#2341](https://github.com/thinkwork-ai/thinkwork/pull/2341) — vars_json threading (part 1) + TEI SES/ACM provisioning evidence
- PR [#2357](https://github.com/thinkwork-ai/thinkwork/pull/2357) — generated root-module declarations (part 2, found via `/ce-compound` verification)
- PR [#2345](https://github.com/thinkwork-ai/thinkwork/pull/2345) — companion: branded email/password sign-in with inline `NEW_PASSWORD_REQUIRED` handling
- `docs/solutions/integration-issues/twenty-crm-email-ses-config-2026-06-06.md` — same failure class (email config missing from the deployment contract), different email path; its "deployment-runner pass-through fixture test" prevention did not generalize to the Cognito vars — this doc is the recurrence
- `docs/solutions/architecture-patterns/github-free-customer-deployments-aws-control-plane-pattern-2026-06-06.md` — the controller architecture this gap lives in
- `docs/solutions/patterns/apply-invocation-env-field-passthrough-2026-04-24.md` — same lesson shape in another layer: an allowlist/subset dict silently drops fields a downstream consumer needs
- `docs/verification/tei-new-environment-deployment-e2e.md` — TEI remediation evidence and redeploy runbook

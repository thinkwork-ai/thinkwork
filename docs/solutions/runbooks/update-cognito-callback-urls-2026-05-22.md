---
problem_type: runbook
severity: medium
module: terraform/modules/foundation/cognito
tags:
  - cognito
  - oauth
  - desktop
  - callback-urls
date: 2026-05-22
---

# Update Cognito Callback URLs

`ThinkworkAdmin` is the Cognito app client used by the admin web app, the
Spaces web app, and the desktop shell. Desktop OAuth requires custom-scheme
callback URLs on that same client:

- `thinkwork://oauth/callback`
- `thinkwork-dev://oauth/callback`
- `thinkwork-canary://oauth/callback`

The canonical Terraform path is `terraform/modules/thinkwork` variable
`desktop_callback_urls`, forwarded to
`terraform/modules/foundation/cognito`. Do not edit callback URLs manually in
the AWS console except as an emergency rollback note.

## Prerequisites

- GitHub CLI authenticated against `thinkwork-ai/thinkwork`.
- AWS credentials for the target stage.
- Terraform or OpenTofu installed.
- Access to the stage's ignored `terraform/examples/greenfield/terraform.tfvars`
  when running local plan commands.

## Steps

### 1. Snapshot the current app client

```bash
STAGE=dev
USER_POOL_ID=$(terraform -chdir=terraform/examples/greenfield output -raw user_pool_id)
CLIENT_ID=$(terraform -chdir=terraform/examples/greenfield output -raw admin_client_id)

aws cognito-idp describe-user-pool-client \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "$CLIENT_ID" \
  --query 'UserPoolClient.{CallbackURLs:CallbackURLs,LogoutURLs:LogoutURLs}' \
  --output json
```

Save the output in the incident notes or release notes for the change. It is
the rollback reference.

### 2. Update Terraform

For the standard desktop schemes, the module defaults already include the URLs.
If a future channel needs another scheme, add it to
`desktop_callback_urls` in `terraform/modules/thinkwork/variables.tf` or pass a
stage-specific override from the root module.

The `ThinkworkAdmin` client receives the desktop URLs through both:

- `admin_callback_urls`
- `admin_logout_urls`

Keeping both lists aligned avoids Cognito-hosted UI redirect failures during
sign-in and sign-out.

### 3. Plan through the normal pipeline

Prefer the repository workflow or CLI planning path for the target stage:

```bash
thinkwork plan -s "$STAGE"
```

For local Terraform-only validation:

```bash
terraform -chdir=terraform/modules/foundation/cognito init -backend=false
terraform -chdir=terraform/modules/foundation/cognito validate
terraform -chdir=terraform/modules/thinkwork init -backend=false
terraform -chdir=terraform/modules/thinkwork validate
terraform -chdir=terraform/examples/greenfield init -backend=false
terraform -chdir=terraform/examples/greenfield validate
```

The expected plan changes are only the additive callback/logout URL entries on
the `ThinkworkAdmin` Cognito app client.

### 4. Apply through the merge/deploy pipeline

Do not run ad hoc production mutations for normal rollout. Merge the Terraform
PR to `main` and let the standard deploy workflow apply the change.

Watch the deploy:

```bash
gh run list --workflow deploy.yml --limit 5
gh run watch <run-id> --exit-status
```

### 5. Verify

After deploy, re-run the `describe-user-pool-client` query from step 1 and
confirm the three desktop callback URLs are present.

Then perform a desktop OAuth smoke against the updated stage:

1. Install or run the matching desktop channel.
2. Click sign in.
3. Complete Cognito hosted UI in the system browser.
4. Confirm the desktop app receives the custom-scheme callback and lands in the
   authenticated Spaces surface.

## Rollback

Rollback is another Terraform change that removes the problematic callback URL
and merges through the same deploy pipeline. If the deployed client is broken
and users cannot authenticate, restore the snapshot from step 1 by reverting the
callback URL change and re-running deploy.

## Related

- `apps/desktop/README.md`
- `terraform/modules/thinkwork/variables.tf`
- `terraform/modules/foundation/cognito/main.tf`
- `docs/solutions/spikes/2026-05-21-electron-oauth-cold-start-validation.md`

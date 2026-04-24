---
problem_type: runbook
severity: high
module: terraform/examples/greenfield
tags:
  - rotation
  - api-auth-secret
  - secrets-manager
  - lambda-env
date: 2026-04-24
---

# Rotate API_AUTH_SECRET

`API_AUTH_SECRET` is the platform-operator apikey that every backend Lambda accepts via `Authorization: Bearer <secret>` or `x-api-key: <secret>`. The CLI, CI pipelines, and the Strands agentcore container all use it for service-to-service calls. It is NOT a tenant credential — anyone holding it can call any handler on behalf of any tenant (apikey bypasses `requireTenantMembership`).

Rotate when:

- The value has ever been included in a public artifact (e.g., the pre-#522 era admin JS bundle embedded it — first rotation performed 2026-04-24).
- An operator with access has left.
- Routine hygiene (every N months).

This runbook was validated end-to-end on the dev stage on 2026-04-24; future rotations should match the same shape unless the IAM-signed-internal-requests follow-up has landed.

## Prerequisites

- GitHub CLI (`gh`) authenticated against the thinkwork-ai repo with permission to set repo secrets.
- AWS credentials with `secretsmanager:GetSecretValue` and `lambda:UpdateFunctionConfiguration` in the target account (used indirectly via terraform-apply).
- Local checkout of `terraform/examples/greenfield/terraform.tfvars` (not committed; edited in-place).

## Steps

### 1. Generate a new value

```bash
NEW_SECRET=$(openssl rand -base64 48 | tr -d '=/+' | cut -c1-40)
echo "$NEW_SECRET" > /tmp/new-api-auth-secret.txt
chmod 600 /tmp/new-api-auth-secret.txt
```

40 characters, base64url-safe after stripping `=/+`. Durably save the value somewhere outside `/tmp` if you need it beyond this session — the source of truth after step 4 is GitHub Secrets + Secrets Manager.

### 2. Update the CI secret

```bash
gh secret set API_AUTH_SECRET --body "$NEW_SECRET"
```

Every `${{ secrets.API_AUTH_SECRET }}` reference in `.github/workflows/` reads this value at **step-run time**. Any deploy triggered after this command uses the new value.

### 3. Update `terraform.tfvars`

Edit `terraform/examples/greenfield/terraform.tfvars` locally to replace the `api_auth_secret = "..."` line with the new value. This file is in `.gitignore` and must never be committed.

Local `thinkwork deploy` uses the tfvars line; CI uses `-var "api_auth_secret=${{ secrets.API_AUTH_SECRET }}"` from step 2. Keeping both in sync matters when you alternate between CI and local deploys.

### 4. Trigger a deploy

```bash
gh workflow run deploy.yml
```

The `terraform-apply` step pushes the new value into:

- Every Lambda's environment variable (`API_AUTH_SECRET`).
- AWS Secrets Manager at `/thinkwork/<stage>/api/auth-secret` (if present — the Strands container reads it from there at boot).

Watch the run:

```bash
gh run watch <run-id> --exit-status
```

The deploy is done when `Terraform Apply` goes green; later jobs (`Migration Drift Check`, `Build & Deploy Admin/Docs/Www`, `Bootstrap`) are independent of the rotation.

### 5. Verify

After `Terraform Apply` completes:

```bash
# Old value should be rejected
curl -sSI -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer tw-dev-secret" \
  https://<api-gateway-id>.execute-api.us-east-1.amazonaws.com/api/tenants
# → 401

# New value should be accepted
curl -sSI -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $(cat /tmp/new-api-auth-secret.txt)" \
  https://<api-gateway-id>.execute-api.us-east-1.amazonaws.com/api/tenants
# → 200
```

The `api-gateway-id` is the `api_endpoint` output from terraform. For dev, it is `ho7oyksms0`.

## Ripple effects to handle

- **`~/.thinkwork/config.json`** — any operator with the old secret cached in their CLI config will start hitting 401. Refresh with `thinkwork doctor -s <stage>` (or re-run `thinkwork init`).
- **Strands agentcore container** — picks up the new `API_AUTH_SECRET` env var on Lambda cold start. Warm containers may 401 for up to ~15 minutes before the reconciler flushes them. See `docs/solutions/best-practices/agentcore-lambda-env-injection-race.md` (if present) for the class.
- **MCP admin-ops `tkm_` tokens** — these are separate per-tenant credentials stored by hash in `tenant_mcp_admin_keys`. They are NOT invalidated by rotating `API_AUTH_SECRET`; they continue to work. Rotate them individually via `thinkwork mcp key revoke` + `thinkwork mcp key create` if needed.
- **Admin SPA** — the admin browser no longer holds `API_AUTH_SECRET` after PR #522 (the Cognito id token replaced it). SPA users feel no change from rotation.

## Rollback

If step 5's verification fails (new value returns 401 too), something downstream — Lambda env push, Secrets Manager write — didn't take effect:

1. Check the `Terraform Apply` step's log for `aws_lambda_function` resource errors.
2. If terraform claims success but the Lambda env still has the old value: `aws lambda get-function-configuration --function-name thinkwork-<stage>-api-graphql-http --query 'Environment.Variables.API_AUTH_SECRET'` — compare. If old, something else is setting it; investigate overrides.
3. If you need to roll back the value: run steps 2-4 again with the old value (`tw-dev-secret` in the 2026-04-24 case). No data is lost in a rollback — the old secret simply becomes the accepted one again.

## Related

- `docs/solutions/patterns/mcp-custom-domain-setup-2026-04-23.md` — related CF-sync flow; same deploy cadence applies.
- PR #522 (secret-out-of-bundle + Cognito bridge) — removed the need for the admin SPA to know `API_AUTH_SECRET`.
- PR #541 (tenant-membership sweep) — narrowed the trust posture around cognito callers; apikey path remains platform-root by design.
- Longer-term follow-up: replace the apikey bypass with IAM-signed internal requests (SigV4), eliminating the shared-secret class entirely.

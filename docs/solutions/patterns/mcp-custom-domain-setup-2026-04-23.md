---
problem_type: runbook
severity: medium
module: terraform/modules/app/lambda-api
tags:
  - mcp
  - dns
  - cloudflare
  - acm
  - api-gateway
date: 2026-04-23
---

# MCP custom domain setup (Cloudflare DNS + ACM + API Gateway v2)

Steps to bring `mcp.thinkwork.ai` (or any subdomain of a Cloudflare-managed zone) online as the public URL for the admin-ops MCP server. Workflow requires **two Terraform applies** because ACM validates via DNS before `aws_apigatewayv2_domain_name` can bind the cert.

## Why two applies

1. `aws_acm_certificate` creates immediately but enters `pending_validation` state.
2. ACM won't issue the cert until a DNS CNAME proves domain ownership.
3. `aws_apigatewayv2_domain_name` refuses an unvalidated cert.
4. So the first apply creates the cert + outputs validation records; an out-of-band step (`pnpm cf:sync-mcp`) writes those records to Cloudflare; then a second apply creates the domain + mapping after validation completes.

The `mcp_custom_domain_ready` Terraform variable is the explicit gate between the two passes.

## Prerequisites

- The MCP Lambda is deployed (merged PR #480 + #482).
- An active `tenant_mcp_admin_keys` row exists for at least one tenant (created via `thinkwork mcp key create`).
- A Cloudflare API token with **Zone.DNS:Edit** on the zone (e.g., `thinkwork.ai`). Token scope should be limited to the zone, not global. Set as `CLOUDFLARE_API_TOKEN` env var when running `pnpm cf:sync-mcp`.

## Steps

### 1. First apply — create the ACM cert

In `terraform.tfvars` for the target stage:

```hcl
mcp_custom_domain       = "mcp.thinkwork.ai"
mcp_custom_domain_ready = false   # default; stays false for the first apply
```

Then:

```bash
thinkwork deploy -s prod   # runs `terraform apply` under the hood
```

Output includes:

- `mcp_custom_domain_cert_arn` — the ACM cert ARN (pending validation)
- `mcp_custom_domain_validation` — list of `{ name, type, value }` CNAMEs to add

### 2. Sync validation records to Cloudflare

```bash
export CLOUDFLARE_API_TOKEN=...   # Zone.DNS:Edit on thinkwork.ai
pnpm cf:sync-mcp -- --terraform-dir $THINKWORK_TERRAFORM_DIR
```

The script:
- Finds the `thinkwork.ai` zone ID via Cloudflare's zone list API.
- Upserts each ACM validation CNAME (idempotent: PUTs existing, POSTs new).
- Does NOT add the final `mcp.thinkwork.ai` record yet — that's `--finalize`.

### 3. Wait for ACM to validate

~5 minutes typical. Poll:

```bash
aws acm describe-certificate --certificate-arn "$(terraform output -raw mcp_custom_domain_cert_arn)" \
  --query 'Certificate.Status' --output text
```

Wait for `ISSUED`.

### 4. Second apply — create the API Gateway custom domain + mapping

Flip the flag in `terraform.tfvars`:

```hcl
mcp_custom_domain       = "mcp.thinkwork.ai"
mcp_custom_domain_ready = true   # ← second-pass toggle
```

```bash
thinkwork deploy -s prod
```

Output now includes `mcp_custom_domain_target` with the regional target domain.

### 5. Finalize — add the production CNAME

```bash
pnpm cf:sync-mcp -- --terraform-dir $THINKWORK_TERRAFORM_DIR --finalize
```

This adds the final CNAME: `mcp.thinkwork.ai → <regional API Gateway target>`.

### 6. Smoke test

```bash
curl -v -X POST \
  -H "Authorization: Bearer <tenant-mcp-token-from-thinkwork-mcp-key-create>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  https://mcp.thinkwork.ai/mcp/admin
```

Expected: `200` with a JSON-RPC response listing `tenants_get`, `tenants_list`, `tenants_update`.

## Rollback

```hcl
mcp_custom_domain       = ""
mcp_custom_domain_ready = false
```

Then `thinkwork deploy`. Terraform destroys the domain, mapping, and cert. Cloudflare DNS records are left in place — delete manually via the Cloudflare dashboard or a future `--cleanup` flag on the sync script.

## Token hygiene

- The Cloudflare API token is passed only via `CLOUDFLARE_API_TOKEN` env. The sync script never writes it to disk or logs it.
- **Rotate the token after setup** unless ongoing DNS management is expected. Rotation in Cloudflare → Profile → API Tokens.
- For automated deploys, store the token in AWS Secrets Manager and have the deploy CLI fetch it at apply time. Out of scope for this PR.

## Known limitations

- The custom domain is attached to the **same** HTTP API that serves `/graphql` and `/api/*`. So `https://mcp.thinkwork.ai/graphql` works. For strict route isolation (MCP-only surface), create a second `aws_apigatewayv2_api` and attach the custom domain there instead. Not needed for v1 — auth gates access at the handler level regardless of subdomain.
- The sync script walks the ACM validation list once. If ACM rotates validation records (rare), re-run `pnpm cf:sync-mcp` to pick up the new records.
- The CNAME is `proxied: false` — TLS terminates at API Gateway, not Cloudflare. Flipping `proxied: true` would require Cloudflare Universal SSL + origin cert config; out of scope.

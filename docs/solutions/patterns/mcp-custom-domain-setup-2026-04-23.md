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

## How apply happens: CI is the default

Thinkwork's production deploys run through `.github/workflows/deploy.yml`, which invokes `terraform apply` with every variable supplied via explicit `-var` flags — **tfvars files are not read by CI**. The two MCP variables are plumbed from GitHub repository variables:

| Terraform variable         | Source                              |
| -------------------------- | ----------------------------------- |
| `mcp_custom_domain`        | `vars.MCP_CUSTOM_DOMAIN`            |
| `mcp_custom_domain_ready`  | `vars.MCP_CUSTOM_DOMAIN_READY` (default `false`) |

Set these under GitHub → Settings → Secrets and variables → Actions → Variables before the first apply.

Local `thinkwork deploy` still reads `terraform/examples/greenfield/terraform.tfvars`, so hand deploys work identically — set `mcp_custom_domain = "mcp.thinkwork.ai"` and `mcp_custom_domain_ready = false|true` there and run `thinkwork deploy`.

## Prerequisites

- The MCP Lambda is deployed (merged PR #480 + #482).
- An active `tenant_mcp_admin_keys` row exists for at least one tenant (created via `thinkwork mcp key create`).
- A Cloudflare API token with **Zone.DNS:Edit** on the zone (e.g., `thinkwork.ai`). Token scope should be limited to the zone, not global. Set as `CLOUDFLARE_API_TOKEN` env var when running `pnpm cf:sync-mcp`.

## Steps

### 1. First apply — create the ACM cert

In GitHub Actions repo variables:

```
MCP_CUSTOM_DOMAIN       = mcp.thinkwork.ai
MCP_CUSTOM_DOMAIN_READY = false
```

Push to `main` (or run the Deploy workflow manually). The `terraform-apply` job creates the ACM cert in `pending_validation` state and exposes two outputs:

- `mcp_custom_domain_cert_arn` — the ACM cert ARN
- `mcp_custom_domain_validation` — list of `{ name, type, value }` CNAMEs to add

Fetch the ARN from the deployed stack:

```bash
aws acm list-certificates --region us-east-1 \
  --query "CertificateSummaryList[?DomainName=='mcp.thinkwork.ai'].CertificateArn" \
  --output text
```

(Or pull it from terraform outputs if you have local state: `terraform output -raw mcp_custom_domain_cert_arn`.)

### 2. Sync validation records to Cloudflare

**Direct-args mode** (preferred — no local TF state required):

```bash
export CLOUDFLARE_API_TOKEN=...   # Zone.DNS:Edit on thinkwork.ai
pnpm cf:sync-mcp -- \
  --domain mcp.thinkwork.ai \
  --cert-arn arn:aws:acm:us-east-1:<acct>:certificate/<uuid>
```

The script:
- Runs `aws acm describe-certificate` to pull `DomainValidationOptions`.
- Finds the `thinkwork.ai` zone ID via Cloudflare's zone list API.
- Upserts each ACM validation CNAME (idempotent: PUTs existing, POSTs new).
- Does **not** add the final `mcp.thinkwork.ai` record yet — that's `--finalize`.

Use `--verify-only` to preview the plan without writing.

**Terraform-output mode** (back-compat — needs local `terraform init` against the remote state backend):

```bash
pnpm cf:sync-mcp -- --terraform-dir terraform/examples/greenfield
```

### 3. Wait for ACM to validate

~5 minutes typical. Poll:

```bash
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:us-east-1:<acct>:certificate/<uuid> \
  --query 'Certificate.Status' --output text
```

Wait for `ISSUED`.

### 4. Second apply — create the API Gateway custom domain + mapping

Flip the GitHub variable:

```
MCP_CUSTOM_DOMAIN_READY = true
```

Push an empty commit or re-run the Deploy workflow. The second apply creates `aws_apigatewayv2_domain_name.mcp` and the `aws_apigatewayv2_api_mapping.mcp`.

Grab the regional target domain:

```bash
aws apigatewayv2 get-domain-name \
  --domain-name mcp.thinkwork.ai \
  --query 'DomainNameConfigurations[0].TargetDomainName' \
  --output text
```

### 5. Finalize — add the production CNAME

**Direct-args mode:**

```bash
pnpm cf:sync-mcp -- \
  --domain mcp.thinkwork.ai \
  --finalize \
  --target d-abc123.execute-api.us-east-1.amazonaws.com
```

**Terraform-output mode:**

```bash
pnpm cf:sync-mcp -- --terraform-dir terraform/examples/greenfield --finalize
```

Either form writes the final CNAME: `mcp.thinkwork.ai → <regional API Gateway target>`.

### 6. Smoke test

```bash
curl -v -X POST \
  -H "Authorization: Bearer <tenant-mcp-token-from-thinkwork-mcp-key-create>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  https://mcp.thinkwork.ai/mcp/admin
```

Expected: `200` with a JSON-RPC response listing the 29 admin-ops tools.

## Rollback

Unset the GitHub variables (or set `MCP_CUSTOM_DOMAIN = ""`) and redeploy. Terraform destroys the domain, mapping, and cert. Cloudflare DNS records are left in place — delete manually via the Cloudflare dashboard or a future `--cleanup` flag on the sync script.

## Token hygiene

- The Cloudflare API token is passed only via `CLOUDFLARE_API_TOKEN` env. The sync script never writes it to disk or logs it.
- **Rotate the token after setup** unless ongoing DNS management is expected. Rotation in Cloudflare → Profile → API Tokens.
- For automated deploys, store the token in AWS Secrets Manager and have the deploy CLI fetch it at apply time. Out of scope for this PR.

## Known limitations

- The custom domain is attached to the **same** HTTP API that serves `/graphql` and `/api/*`. So `https://mcp.thinkwork.ai/graphql` works. For strict route isolation (MCP-only surface), create a second `aws_apigatewayv2_api` and attach the custom domain there instead. Not needed for v1 — auth gates access at the handler level regardless of subdomain.
- The sync script walks the ACM validation list once. If ACM rotates validation records (rare), re-run `pnpm cf:sync-mcp` to pick up the new records.
- The CNAME is `proxied: false` — TLS terminates at API Gateway, not Cloudflare. Flipping `proxied: true` would require Cloudflare Universal SSL + origin cert config; out of scope.

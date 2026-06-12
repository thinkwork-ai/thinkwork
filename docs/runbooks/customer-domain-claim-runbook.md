---
title: Customer Domain Claim Runbook
date: 2026-06-12
status: active
---

# Customer Domain Claim Runbook

End-to-end operator procedure for giving a deployed customer environment a
`<name>.thinkwork.ai` domain: claim the name in the shared namespace, delegate
it into the customer's AWS account, validate the cert, wire SES send+receive,
cut email over, and — eventually — release the name. Covers plan
`docs/plans/2026-06-12-002-feat-customer-domain-namespace-plan.md` R8/R12 and
the operational halves of R6/R11/KTD8.

Throughout, `<name>` is the namespace label (e.g. `tei`), `<stage>` is the
customer stack's stage, and `<account-id>` is the customer AWS account. All
namespace CLI commands run from a repo checkout (`pnpm install` done) via:

```sh
pnpm --filter @thinkwork/namespace-registry cli -- <subcommand> ...
```

CLI exit codes: `0` = success/available, `1` = taken/refused/API error,
`2` = usage error. The CLI is the **only** writer to the Cloudflare
`thinkwork.ai` zone (R3) — never hand-create or hand-delete records in the
Cloudflare dashboard.

## 1. Preconditions

Work through all four before touching anything.

### 1a. The name MUST equal the customer stack's tenant slug (KTD8)

`email-inbound` resolves the tenant from the subdomain label of the recipient
address (`space@<tenant-slug>.thinkwork.ai`). If the claimed name differs from
the stack's tenant slug, every inbound mail silently hits the not-found branch.
The CLI refuses a mismatched `--tenant-slug`, but you must verify what the
slug actually is — don't guess from the customer's company name.

Read it from the **customer stack's** database (same stage-named resources the
platform uses everywhere):

```sh
# With customer-account AWS credentials:
ENDPOINT=$(aws rds describe-db-clusters \
  --db-cluster-identifier "thinkwork-<stage>-db" \
  --query "DBClusters[0].Endpoint" --output text)
SECRET=$(aws secretsmanager get-secret-value \
  --secret-id "thinkwork-<stage>-db-credentials" \
  --query SecretString --output text)
# Build a postgres URL from $SECRET's username/password and run:
psql "$DATABASE_URL" -c "SELECT slug, name FROM tenants ORDER BY created_at;"
```

The claimed `<name>` must equal the `slug` of the tenant the deployment
serves. If they differ, stop — renaming a tenant slug is its own change, not
something this runbook smuggles in.

### 1b. Cloudflare token

The CLI reads `CLOUDFLARE_API_TOKEN` from the environment. Requirements:

- Scope: **Zone.DNS:Edit on the `thinkwork.ai` zone only** (zone-scoped, not
  account-wide). Create at <https://dash.cloudflare.com/profile/api-tokens>.
- **Blast radius warning:** Cloudflare has no record-prefix scoping, so even a
  zone-scoped DNS:Edit token can rewrite _every_ record in the zone — apex,
  `www`, `mcp`, every tenant delegation. Treat the token like a root
  credential for thinkwork.ai DNS; don't paste it into shared shells or CI
  logs.
- **Cloudflare error 10000 = the token has drifted/expired.** The CLI
  surfaces the error body and exits 1. Remedy: mint a fresh zone-scoped token
  and (if CI also broke) rotate `secrets.CLOUDFLARE_API_TOKEN` in the GitHub
  repo — see `docs/solutions/` history on CI Cloudflare token rotation
  (last rotated 2026-05-08).

### 1c. AWS credentials for the production DB leg

The claim path is dual-source (KTD1): Cloudflare **and** the SaaS production
tenants table. The CLI resolves the DB itself by shelling out to:

- `aws rds describe-db-clusters --db-cluster-identifier thinkwork-prod-db`
- `aws secretsmanager get-secret-value --secret-id thinkwork-prod-db-credentials`

so your shell needs **SaaS production account** AWS credentials (and the right
region) when running `check`/`claim`. Overriding the stage with
`--tenant-db-stage <stage>` or setting `DATABASE_URL` both work but emit loud
warnings — only use them for testing, never for a real claim. `--skip-db`
exists only on `check` and its result must never be used to justify a claim.

### 1d. Apex DMARC invariant

The customer-domain SES identity publishes its own `_dmarc.<name>.thinkwork.ai`
record (`v=DMARC1; p=none`). That only governs the subdomain if no apex DMARC
policy overrides it. **As of 2026-06-12 the `thinkwork.ai` apex publishes no
DMARC record**, so nothing constrains delegated subdomains. Re-check before
every claim:

```sh
dig +short TXT _dmarc.thinkwork.ai
```

Expected: empty output. If a record ever appears, it must keep `sp=` absent or
`sp=none` — an apex `sp=quarantine`/`sp=reject` would override every customer
domain's own policy and break their mail. If you find a stricter record, stop
and escalate before claiming.

## 2. Phase-one claim (TXT reservation)

Check first, then claim with `--dry-run`, then claim for real.

```sh
export CLOUDFLARE_API_TOKEN=...   # zone-scoped DNS:Edit, see 1b

pnpm --filter @thinkwork/namespace-registry cli -- check <name>
```

Expected output for a free name (exit 0):

```
name:    tei
fqdn:    tei.thinkwork.ai
status:  available
sources: cloudflare + tenants table
```

Other statuses (exit 1): `taken-cloudflare` (existing DNS records are listed,
with their claim comments), `taken-tenant` (a tenant row holds the slug),
`reserved` (on `RESERVED_TENANT_SLUGS`), `invalid` (fails the slug pattern).

Then claim — dry-run first:

```sh
pnpm --filter @thinkwork/namespace-registry cli -- \
  claim <name> --tenant-slug <name> --dry-run
pnpm --filter @thinkwork/namespace-registry cli -- \
  claim <name> --tenant-slug <name>
```

Expected output:

```
claim tei: reserved
reserved tei.thinkwork.ai with a TXT placeholder (comment: deployment:tei created:2026-06-12)
```

What this wrote: one TXT record at `<name>.thinkwork.ai` with content
`thinkwork-namespace-reservation` and a comment in the exported format
`deployment:<owner> created:<YYYY-MM-DD>`. The comment is the ownership
contract — all later operations (set-targets, release) match against it.

Notes:

- `--owner` defaults to the tenant slug; leave it defaulted unless you have a
  specific reason.
- Re-running the same claim is idempotent (`claim <name>: noop`).
- `claim <name> REFUSED (taken|lost-race|...)` with exit 1 means the name is
  not yours — the tool also self-releases if it lost a race after writing
  (KTD4). Pick another name or investigate the existing claim.
- The default `--kind` is `deployment`; only the SaaS `ses_tenant_slugs` path
  (section 8) uses `--kind tenant`.

## 3. Controller update: domain set, gate false (zone + CAA)

Thread the domain into the customer deployment with the delegation gate
**false**. The Terraform variables are `customer_domain`,
`customer_domain_delegated`, `customer_domain_legacy_retired`; the controller
envelope field names are `customerDomain`, `customerDomainDelegated`,
`customerDomainLegacyRetired`.

Where to set them (the runner prefers the secret over the payload):

- **Customer-account update runs (e.g. TEI):** add the fields to the runner
  secret JSON — the Secrets Manager secret named
  `/thinkwork/<stage>/deployment/runner-secrets` in the customer account
  (referenced by the execution input's `runnerSecretArn` /
  `deploymentSecretsSecretArn`):

  ```json
  {
    "customerDomain": "<name>.thinkwork.ai",
    "customerDomainDelegated": false,
    "customerDomainLegacyRetired": false
  }
  ```

  (Booleans must be real JSON booleans, not strings.) Then dispatch an
  `update` run on the customer's
  `thinkwork-<stage>-deployment-orchestrator` state machine.

- **Hosted controller sessions:** the values live in the deployment session's
  `session_config` JSON on `customer_deployment_sessions` in the SaaS
  control-plane DB (there is no dedicated column or API field) — set
  `customerDomain` / `customerDomainDelegated` / `customerDomainLegacyRetired`
  there before starting the run.

With `customer_domain` set and both gates false, the apply creates **only**:

- the Route53 hosted zone for `<name>.thinkwork.ai`,
- a `CAA 0 issue "amazon.com"` record (locks the delegated subtree to
  Amazon-issued certs),
- the SES identity + its in-zone DNS records (intentionally pre-delegation;
  see section 6 for the ~72h caveat).

Nothing resolves publicly yet — that's correct.

**Pull the four NS values** (the phase-two claim input):

- Controller path — the runner uploads `terraform output -json` as evidence:

  ```sh
  aws s3 cp "s3://thinkwork-<stage>-<account-id>-deploy-evidence/sessions/<session-id>/<action>/terraform-outputs.json" - \
    | jq -r '.customer_domain_name_servers.value[]'
  ```

- Hand-managed root (terraform run locally against the stack): from the root
  directory,

  ```sh
  terraform output -json customer_domain_name_servers
  ```

  Note: the controller's _generated_ root declares this output. The
  `terraform/examples/greenfield` example root does **not** currently thread
  `customer_domain` or surface the output — if you are driving a greenfield
  root, pass the three `customer_domain*` variables through to
  `module "thinkwork"` and add the output before this step, or read
  `module.thinkwork.customer_domain_name_servers` from state.

While you're in the outputs, confirm `customer_domain` echoes the domain and
`customer_domain_zone_id` is non-empty.

## 4. Phase-two claim (`--set-targets`) and delegation verification

Replace the TXT placeholder with the four NS records:

```sh
pnpm --filter @thinkwork/namespace-registry cli -- \
  claim <name> --tenant-slug <name> \
  --set-targets ns-1.awsdns-XX.org,ns-2.awsdns-YY.co.uk,ns-3.awsdns-ZZ.com,ns-4.awsdns-WW.net \
  --dry-run
# review the planned CREATE NS / DELETE TXT lines, then re-run without --dry-run
```

Expected output:

```
claim tei: targets-set
tei.thinkwork.ai now delegates to: ns-1..., ns-2..., ns-3..., ns-4...
```

Exactly 4 distinct nameservers are required; re-running with identical targets
is `noop`. The tool creates the NS records before deleting the TXT so the name
is never unclaimed mid-operation.

**Delegation verification — the explicit precondition for flipping the gate.**
Do not flip `customerDomainDelegated` until both checks pass from a _public_
resolver:

```sh
# 1. The NS hop itself:
dig NS <name>.thinkwork.ai @1.1.1.1 +short
# Expected: the same 4 awsdns name servers you passed to --set-targets.

# 2. A record served only by the customer zone resolves end-to-end
#    (proves the full resolution path ACM validation will use):
dig TXT _dmarc.<name>.thinkwork.ai @1.1.1.1 +short
# Expected: "v=DMARC1; p=none"
dig CAA <name>.thinkwork.ai @1.1.1.1 +short
# Expected: 0 issue "amazon.com"
```

Implementation note: the ACM certificate and its validation CNAME are created
by the gate-true apply itself (they're gated on `customer_domain_delegated`),
so the CNAME cannot be pre-checked — the in-zone DMARC/CAA checks above are
the equivalent proof. If the gate-true apply's validation stalls, check the
validation CNAME at that point:

```sh
aws acm describe-certificate --region us-east-1 --certificate-arn <arn> \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
dig CNAME <that-record-name> @1.1.1.1 +short
```

Cloudflare NS TTL is 300s, but public-resolver propagation can lag — wait for
the digs, not the clock.

## 5. Gate-true apply

Flip `customerDomainDelegated` to `true` (same injection point as section 3)
and dispatch another update run. Expected new resources in the plan:

- ACM certificate for `<name>.thinkwork.ai` in **us-east-1**, DNS validation
  records written into the customer's own zone, and a validation waiter with a
  **30-minute fail-fast timeout** — if the apply fails on validation timeout,
  the NS hop almost certainly hasn't landed; go back to section 4.
- A/AAAA alias records pointing the domain at the app CloudFront distribution.
- Cognito callback/logout URL **additions** for
  `https://<name>.thinkwork.ai` (+`/auth/callback`) alongside all legacy
  entries — this opens the dual-domain window.

The thinkwork module enforces preconditions (`customer_domain_delegated`
requires `customer_domain`; `customer_domain_legacy_retired` requires both),
so a mis-ordered flip fails the plan with a clear message.

**Partial-apply failure mode:** if the apply dies after the cert/aliases but
before the Cognito callback update lands, login on the new domain fails with a
generic-looking `redirect_mismatch` page. The remedy is to **re-apply** (the
run is convergent) — do not hand-edit the Cognito app client.

**Evidence check (KTD5, runner version skew):** confirm the runner echoed the
domain fields:

```sh
aws s3 cp "s3://thinkwork-<stage>-<account-id>-deploy-evidence/sessions/<session-id>/<action>/deployment-evidence.json" - \
  | jq '.consumedDomainFields'
```

Expected:

```json
{
  "customerDomain": "<name>.thinkwork.ai",
  "customerDomainDelegated": true,
  "customerDomainLegacyRetired": false
}
```

If `consumedDomainFields` is **missing**, the customer is running an outdated
runner script that silently dropped the domain configuration. (For hosted
sessions the control plane detects this itself and fails the session with a
`domain_fields_echo_missing` event.) Remedy: have the deployment take a
runner-updating release first — the runner self-updates its S3 script at the
end of a successful run — then retry the domain update. Do not proceed on a
deployment whose evidence lacks the echo.

#### Version-skew session recovery

When the echo guard fires on a hosted session, `enforceDomainFieldsEchoGuard`
sets the session to `status='failed'` with `error_message` citing
`domain_fields_echo_missing`. There is currently **no operator API to reset a
failed session** — the `/start` endpoint's idempotency guard
(`session_config.deploymentRun.executionArn`) also blocks re-dispatch even if
the status were patched alone. Full recovery requires direct DB surgery against
the SaaS **control-plane** Aurora instance:

1. **Update the runner release** (existing step above) — the outdated runner
   self-updates at the end of a successful run; trigger a plain update run on
   the customer's state machine to complete the self-update before the domain
   retry.

2. **Reset the session** — once the runner is current, patch the session row so
   `/start` can dispatch a new Step Functions execution:

   ```sql
   -- ⚠️  Interim direct-DB surgery. Run against the SaaS control-plane DB.
   -- Verify <session-id> and the before/after state with the SELECT below first.

   SELECT id, status, error_message,
          session_config->>'deploymentRun'   AS deployment_run,
          session_config->>'domainFieldsEcho' AS domain_fields_echo
   FROM   customer_deployment_sessions
   WHERE  id = '<session-id>';

   UPDATE customer_deployment_sessions
   SET
     status        = 'ready_to_deploy',
     error_message = NULL,
     session_config = session_config
       -- Remove the stale execution reference so /start is not idempotency-blocked
       - 'deploymentRun'
       -- Remove the cached echo result so the guard re-runs against fresh evidence
       - 'domainFieldsEcho',
     updated_at    = now()
   WHERE id = '<session-id>';
   ```

   Why both keys must be cleared:
   - `deploymentRun` (specifically `.executionArn`) is the idempotency guard in
     `startDeployment`: if it is present the endpoint returns `deployment_start_reused`
     and never fires a new Step Functions execution.
   - `domainFieldsEcho` (specifically `.verifiedAt`) is checked first by
     `enforceDomainFieldsEchoGuard`: if it is present the guard skips the S3
     evidence check entirely and will not detect a successful echo on the new run.

   After the UPDATE, `credentials_status` must still be `'validated'` or
   `'transferred'` — the start endpoint enforces this. If credentials have
   expired, re-connect the bootstrap credential lease through the UI before
   calling `/start`.

3. **Re-trigger the run** — the browser UI's "Start deployment" button (or a
   POST to `/api/deployment-sessions/<session-id>/start`) dispatches a new
   Step Functions execution and transitions the session back to `'deploying'`.
   Verify the evidence echo in the next poll (see the `jq '.consumedDomainFields'`
   check above).

_Operator reset endpoint is tracked as follow-up work; when shipped it will
supersede the direct-DB step above._

Smoke the web side now (TLS + login):

```sh
curl -sSI https://<name>.thinkwork.ai | head -5
# Expect HTTP/2 200 (or the SPA's normal response) with a valid cert.
```

Log in through the browser on the new domain. The legacy URL keeps working —
both are in the callback list during the dual window.

## 6. SES: verification, production access, then the email-source switch

Email cutover is deliberately decoupled from the web cutover. Order matters:
**verified identity → production access → switch the Cognito email source**
(R11 — the switch is an operator action, never automatic).

### 6a. Identity verification (and the ~72h expiry)

The SES identity and all its DNS records (verification TXT, 3 DKIM CNAMEs,
MAIL FROM MX/SPF, inbound MX, DMARC) were created back in section 3,
pre-delegation. SES's pending verification attempt **expires after ~72
hours** — if more than ~3 days passed between the section-3 apply and
delegation landing, verification will sit in `Failed`/`Pending` forever.

Check:

```sh
aws ses get-identity-verification-attributes \
  --identities <name>.thinkwork.ai \
  --query 'VerificationAttributes."<name>.thinkwork.ai".VerificationStatus'
```

Wait for `"Success"` (SES re-polls DNS on its own; allow up to a few hours
after delegation). If the attempt expired, re-trigger verification by
recreating the identity:

- Root you can run Terraform against:

  ```sh
  terraform apply -replace='module.thinkwork.module.customer_domain.aws_ses_domain_identity.customer[0]'
  ```

- Controller-managed state (no local terraform): delete the identity and let
  the next update run recreate it (Terraform regenerates the token and updates
  the in-zone TXT record automatically):

  ```sh
  aws ses delete-identity --identity <name>.thinkwork.ai
  # then dispatch an update run (section 3 mechanics)
  ```

### 6b. SES sandbox exit (production access)

New customer accounts are in the SES sandbox: sends are limited to verified
addresses, which breaks Cognito invites to arbitrary users. Request production
access in the **customer account**, in the stack's region:

1. Console: SES → Account dashboard → "Request production access" — mail type
   `Transactional`, website `https://<name>.thinkwork.ai`, describe the use
   (workspace notifications + sign-in/invite email for the customer's own
   users, low volume, no marketing). Or via CLI:

   ```sh
   aws sesv2 put-account-details \
     --production-access-enabled \
     --mail-type TRANSACTIONAL \
     --website-url https://<name>.thinkwork.ai \
     --use-case-description "Transactional sign-in/invite and agent notification email for <customer>'s ThinkWork deployment; recipients are the customer's own staff."
   ```

2. Turnaround is manual on AWS's side (typically ~24h, unbounded). Poll:

   ```sh
   aws sesv2 get-account --query ProductionAccessEnabled
   ```

Until this returns `true`, **hold**: the stack serves web on the new domain
while Cognito email stays on its current source (`COGNITO_DEFAULT` or the
legacy identity). This hold state is normal and indefinite-safe.

### 6c. Switch the Cognito email source

Only when 6a shows `Success` **and** 6b shows `true`: point
`cognitoEmailSourceArn` (runner secret / envelope field; Terraform var
`cognito_email_source_arn`) at the new identity. The ARN is the stack output
`customer_domain_ses_identity_arn`:

```sh
aws s3 cp "s3://.../terraform-outputs.json" - | jq -r '.customer_domain_ses_identity_arn.value'
# arn:aws:ses:<region>:<account-id>:identity/<name>.thinkwork.ai
```

Set `cognitoEmailSourceArn` to that ARN (plus `cognitoFromEmailAddress`, e.g.
`no-reply@<name>.thinkwork.ai`) in the runner secret and dispatch an update
run. During a migration off an old domain this opens the email half of the
dual window — both identities stay verified and capable of sending until
retirement (section 9).

## 7. Live probes

All three must pass before declaring the domain live.

**Web TLS:**

```sh
curl -sSv https://<name>.thinkwork.ai -o /dev/null 2>&1 | grep -E "subject:|issuer:|HTTP/"
# subject CN=<name>.thinkwork.ai, issuer Amazon, HTTP 200-class response.
```

Plus a real browser login (exercises the Cognito callback entries).

**Send probe:** trigger a Cognito invite (create a test user) or have the
agent send a mail. In the received message's raw headers verify
`DKIM-Signature: ... d=<name>.thinkwork.ai` and that it passed
(`Authentication-Results: dkim=pass`, `spf=pass` with the
`mail.<name>.thinkwork.ai` Return-Path). Confirm it landed in the inbox, not
spam.

**Receive probe — must confirm the routing path, not just delivery:** send an
external mail to an **existing Space address**,
`<space-slug>@<name>.thinkwork.ai`, then check the email-inbound Lambda's
CloudWatch logs in the customer account:

```sh
aws logs tail /aws/lambda/thinkwork-<stage>-api-email-inbound --since 15m
```

- PASS: `[email-inbound] cold_contact_thread_created tenant=<name> space=<space-slug> ...`
  (or, for a reply-token mail, the reply/wakeup path lines).
- Routing reached but rejected (still proves tenant/Space resolution worked —
  fix the cited reason): `[email-inbound] cold_contact_rejected:<reason> tenant=<name> space=<space-slug> ...`
  (reasons: `space_not_found`, `triggers_disabled`, `sender_not_registered`,
  `not_space_member`).
- FAIL — the silent-drop branch: `[email-inbound] Non-thinkwork.ai recipient: ..., dropping`.
  This means the recipient domain didn't parse as `*.thinkwork.ai` (or the
  claimed name ≠ tenant slug, KTD8) — the mail vanishes with no bounce.
- FAIL — no log entry at all: the mail never reached the Lambda. Check that
  the customer account's receipt rule set
  (`thinkwork-<stage>-customer-domain-email-rules`) is the **active** set
  (`aws ses describe-active-receipt-rule-set`) and the inbound MX resolves
  (`dig MX <name>.thinkwork.ai +short` → `10 inbound-smtp.<region>.amazonaws.com`).

## 8. Namespace rule for SaaS tenants (`ses_tenant_slugs`)

The same namespace governs SaaS tenant email subzones. Any addition to the
greenfield root's `tenant_slugs` tfvars list (threaded into the thinkwork
module as `ses_tenant_slugs`, which mints `cloudflare_record.tenant_email_ns`
NS records) **requires a prior tenant-kind claim** (R3):

```sh
pnpm --filter @thinkwork/namespace-registry cli -- \
  claim <slug> --tenant-slug <slug> --kind tenant
```

A tenant-kind claim where the owner equals the name tolerates the existing
tenant row (the tenant already holds the slug — that's the point); it still
refuses if Cloudflare has foreign records. Claim first, then add the slug to
tfvars and apply. Never add a slug to `tenant_slugs` whose claim was refused.

## 9. Decommission and retirement ordering

### 9a. Legacy-domain retirement (end of a migration's dual window)

When a customer migrated from an old domain (e.g. TEI from
`lastmile-tei.com`): only after (a) the cutover release has **deployed** to
the customer (not merely merged) and (b) a fresh grep finds no remaining
consumers of the old domain, flip `customerDomainLegacyRetired` to `true` and
dispatch an update run. This is deliberately a **reviewable Terraform step**,
not a console edit: the plan must show removal of the legacy app URLs from
the Cognito callback/logout lists and nothing else surprising. Old-identity
deletion follows separately after a bounce-free observation window.

### 9b. Full decommission: release BEFORE destroy

When a customer environment is being torn down, the ordering is load-bearing:

1. **Release the name via the CLI first:**

   ```sh
   pnpm --filter @thinkwork/namespace-registry cli -- \
     release <name> --owner <name> --dry-run
   pnpm --filter @thinkwork/namespace-registry cli -- \
     release <name> --owner <name>
   ```

   Expected: `release <name>: released` with a count of deleted records
   (the 4 NS, or the TXT if delegation never happened). The release matches
   the comment `deployment:<owner> created:...` and deletes **only** those
   records; it refuses (`REFUSED (owned-by-other)`) if the records belong to
   a different claim — investigate, don't force.

2. **Then** run `terraform destroy` / the controller teardown.

   Why this order: if the customer's Route53 zone is destroyed while the
   Cloudflare NS records still point at its (now released) AWS name servers,
   anyone can repeatedly create Route53 zones for `<name>.thinkwork.ai` until
   AWS assigns an overlapping name-server set — a dangling-delegation
   takeover of a `thinkwork.ai` subdomain, including ACM cert issuance
   (the CAA record permits Amazon, which is exactly what the attacker would
   use). Releasing first closes the window completely.

3. **Manual tenant release.** There is no `deleteTenant` mutation — releasing
   the Cloudflare records does **not** free the slug in the tenants table, so
   `check <name>` will keep reporting `taken-tenant` and the name cannot be
   re-claimed by anyone else. If the name must genuinely return to the pool,
   the tenant row's removal is a manual, approved production DB operation
   (follow the normal production-mutation approval path; never run it
   casually). Until a deleteTenant flow exists, document the released-but-
   tenant-held state in the decommission ticket.

For SaaS tenant-kind names: remove the slug from `tenant_slugs` tfvars and
apply (drops the NS records' Terraform management), then
`release <slug> --owner <slug> --kind tenant`.

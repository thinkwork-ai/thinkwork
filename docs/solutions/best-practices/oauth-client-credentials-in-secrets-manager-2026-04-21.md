---
module: oauth-integrations
date: 2026-04-21
problem_type: best_practice
component: authentication
severity: medium
applies_when:
  - Multiple Lambdas need the same sensitive shared credential (OAuth client_secret, third-party API keys)
  - Secret value must not appear in Lambda function configuration, CloudWatch event streams, or tfstate
  - Credential rotation via AWS Console or Secrets Manager managed rotation must survive terraform applies
  - One-time ~20ms cold-start Secrets Manager fetch per provider is acceptable latency
related_components:
  - tooling
  - development_workflow
tags:
  - aws-secrets-manager
  - oauth
  - terraform
  - lambda
  - secrets-hygiene
  - aws-native
  - client-credentials
  - caching
---

# OAuth client credentials in AWS Secrets Manager (typed helper + module-scope cache)

## Context

During the OAuth unblock work (PR #337 on 2026-04-21), Google Workspace OAuth client credentials needed to be plumbed to 4+ Lambda handlers: `oauth-authorize`, `oauth-callback`, and the `oauth-token` callers in `wakeup-processor` and `chat-agent-invoke`.

The original plan was to add `GOOGLE_PRODUCTIVITY_CLIENT_ID` and `GOOGLE_PRODUCTIVITY_CLIENT_SECRET` to every Lambda's environment via the shared `common_env`, populated from plaintext `terraform.tfvars`. During PR review, three reviewer personas (security, scope-guardian, adversarial) converged on the same objection: this broadcasts the client secrets to all 43 Lambdas, and the values are visible via `aws lambda get-function-configuration`, CloudWatch event streams, and `tfstate`.

Combined with two pre-existing constraints from auto memory, this pushed us toward AWS Secrets Manager:
- `project_tfvars_secrets_hygiene` (auto memory [claude]) — `terraform.tfvars` holds plaintext secrets; migrate to SSM when prod lands.
- `feedback_aws_native_preference` (auto memory [claude]) — prefer AWS-native primitives over env-var hacks when functionality is comparable.

**Why Secrets Manager over SSM Parameter Store** (the other candidate the tfvars-hygiene memory mentions): SSM SecureString is a reasonable alternative for static config, but Secrets Manager wins here because (a) it has first-class managed rotation, (b) its JSON `SecretString` shape matches the `{client_id, client_secret}` pair we already need to store together, and (c) per-secret IAM scoping is more expressive than SSM parameter hierarchies. SSM stays the right choice for non-rotating config (URLs, feature flags, API keys for the Google Places wiki-compile path).

The result is a shared pattern for OAuth client credentials that keeps the secret out of every surface that gets grep'd for it, while adding only ~20ms of cold-start latency per provider.

## Guidance

The pattern has five moving parts. Keep them in lockstep.

### 1. Terraform — provision one secret per provider

Put it in a dedicated file (e.g., `terraform/modules/app/lambda-api/oauth-secrets.tf`) so ownership is obvious. Path convention: `thinkwork/${stage}/oauth/<provider-slug>`. Value shape: JSON `{"client_id": "...", "client_secret": "..."}`. Critically, set `lifecycle.ignore_changes = [secret_string]` so AWS Console rotations survive `terraform apply`.

```hcl
resource "aws_secretsmanager_secret" "oauth_google_productivity" {
  name        = "thinkwork/${var.stage}/oauth/google-productivity"
  description = "Google Workspace OAuth client credentials"
  tags = { Stage = var.stage, Provider = "google_productivity" }
}

resource "aws_secretsmanager_secret_version" "oauth_google_productivity" {
  secret_id = aws_secretsmanager_secret.oauth_google_productivity.id
  secret_string = jsonencode({
    client_id     = var.google_oauth_client_id
    client_secret = var.google_oauth_client_secret
  })
  lifecycle {
    ignore_changes = [secret_string]  # AWS Console rotation sticks across applies
  }
}
```

### 2. Lambda env — expose only the ARN

The ARN is not sensitive; the IAM policy gates access. In `common_env`:

```hcl
GOOGLE_PRODUCTIVITY_OAUTH_SECRET_ARN = aws_secretsmanager_secret.oauth_google_productivity.arn
```

### 3. IAM — reuse the broad `thinkwork/*` policy for now

The shared Lambda role already has `secretsmanager:GetSecretValue` on `thinkwork/*` (see `terraform/modules/app/lambda-api/main.tf:128-135`). Since our secret path fits that prefix, no new IAM attachment is needed.

**Caveat to document explicitly:** every Lambda using that shared role can read every `thinkwork/*` secret. True per-secret-per-Lambda scoping requires per-Lambda IAM roles — a larger refactor that was deliberately deferred for PR #337. The win over plain env vars is still real (the secret is no longer in Lambda config/CloudWatch/tfstate); the per-Lambda scoping is a follow-up, not a blocker.

### 4. Helper — typed, module-scope cache

One helper, one source of truth, at `packages/api/src/lib/oauth-client-credentials.ts`. The typed `OAuthProviderName` union + `isSecretsManagerProvider()` guard is the authorization surface — if a provider isn't in the union, it can't be read:

```ts
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

export type OAuthProviderName = "google_productivity" | "microsoft_365";
export interface OAuthClientCredentials { clientId: string; clientSecret: string; }

const cache = new Map<OAuthProviderName, OAuthClientCredentials>();
const SECRET_ARN_ENV: Record<OAuthProviderName, string> = {
  google_productivity: "GOOGLE_PRODUCTIVITY_OAUTH_SECRET_ARN",
  microsoft_365:       "MICROSOFT_OAUTH_SECRET_ARN",
};

let smClient: SecretsManagerClient | null = null;
function getClient(): SecretsManagerClient {
  if (!smClient) {
    smClient = new SecretsManagerClient({ region: process.env.AWS_REGION || "us-east-1" });
  }
  return smClient;
}

export async function getOAuthClientCredentials(
  providerName: OAuthProviderName,
): Promise<OAuthClientCredentials> {
  const cached = cache.get(providerName);
  if (cached) return cached;

  const envVar = SECRET_ARN_ENV[providerName];
  const secretArn = process.env[envVar] || "";
  if (!secretArn) {
    throw new Error(`${envVar} not set — the Lambda environment is missing the OAuth secret ARN.`);
  }

  const res = await getClient().send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!res.SecretString) {
    throw new Error(`Secrets Manager returned empty SecretString for ${secretArn}`);
  }

  const parsed = JSON.parse(res.SecretString) as { client_id?: string; client_secret?: string };
  const clientId = parsed.client_id || "";
  const clientSecret = parsed.client_secret || "";
  if (!clientId || !clientSecret) {
    throw new Error(`OAuth credentials for ${providerName} are incomplete.`);
  }

  const creds: OAuthClientCredentials = { clientId, clientSecret };
  cache.set(providerName, creds);
  console.log(`[oauth-client-credentials] Loaded ${providerName} from Secrets Manager`);
  return creds;
}

export function isSecretsManagerProvider(
  providerName: string,
): providerName is OAuthProviderName {
  return providerName === "google_productivity" || providerName === "microsoft_365";
}
```

### 5. Consumer handlers — branch on the guard

Replace every direct `process.env.X_CLIENT_SECRET` read:

```ts
import {
  getOAuthClientCredentials,
  isSecretsManagerProvider,
} from "../lib/oauth-client-credentials.js";

if (isSecretsManagerProvider(provider.name)) {
  try {
    const creds = await getOAuthClientCredentials(provider.name);
    clientId = creds.clientId;
    clientSecret = creds.clientSecret;
  } catch (err) {
    // Handle missing/malformed secret explicitly — don't let it fall through silently.
  }
} else if (provider.name === "lastmile") {
  // Legacy env-var path kept until opportunistic migration.
}
```

## Why This Matters

- **Client secrets are no longer readable via `aws lambda get-function-configuration`.** Only the ARN is exposed there, and the ARN is not sensitive.
- **Not baked into Lambda-resource `tfstate`.** The secret is its own resource; the Lambda module only references the ARN.
- **Not echoed in CloudWatch event streams** that log env-var changes — those events surface ARNs, not the underlying secret value.
- **Rotation survives `terraform apply`.** The `ignore_changes = [secret_string]` contract lets operators rotate via the AWS Console (or Secrets Manager managed rotation) without needing a tfvars edit and a full apply.
- **Pattern scales.** Any future OAuth provider (Microsoft 365, GitHub, Stripe) mirrors the template: new secret resource, new env-var ARN, add the provider to the `OAuthProviderName` union, and consumer handlers already call the helper.
- **Cold-start cost is bounded and amortized.** ~20ms per provider per cold-start container; every warm invocation hits the module-scope `Map`.
- **Aligns with two team norms.** This is the first concrete migration target for `project_tfvars_secrets_hygiene` (auto memory [claude]), and it validates `feedback_aws_native_preference` (auto memory [claude]) by picking a purpose-built AWS primitive over an env-var workaround.

## When to Apply

Apply this pattern when **all** of the following are true:
- Multiple Lambdas need the same sensitive credential shared across tenants or users.
- The secret must not be visible in Lambda configuration surfaces (`get-function-configuration`, CloudWatch, `tfstate`).
- Rotation needs to be operator-driven (AWS Console or managed rotation) without requiring a tfvars edit + full apply.
- Cold-start latency of ~20ms per provider is acceptable.

Do **not** apply this pattern when:
- The secret is per-user or per-connection. Use the existing `packages/api/src/lib/mcp-configs.ts` pattern instead — one secret per connection, looked up per invocation. That file already does the right thing for per-user MCP tokens.
- The value is non-sensitive (ARNs, URLs, public IDs). Keep those as plain env vars.
- The value is a short-lived auto-refreshed access token. Still use Secrets Manager, but with different update mechanics: the refresh path writes back via `UpdateSecretCommand` (see `oauth-token.ts` refresh path for the template).

## Examples

### Before — env-var broadcast (bad)

```hcl
# terraform/modules/app/lambda-api/handlers.tf — common_env
GOOGLE_PRODUCTIVITY_CLIENT_ID     = var.google_oauth_client_id
GOOGLE_PRODUCTIVITY_CLIENT_SECRET = var.google_oauth_client_secret
```

```ts
// packages/api/src/handlers/oauth-authorize.ts
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_PRODUCTIVITY_CLIENT_ID     || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_PRODUCTIVITY_CLIENT_SECRET || "";
// ↑ visible in get-function-configuration, CloudWatch event streams, tfstate,
//   and pushed to all 43 Lambdas that share common_env
```

### After — Secrets Manager + typed helper (good)

```hcl
# terraform/modules/app/lambda-api/oauth-secrets.tf (new file)
resource "aws_secretsmanager_secret" "oauth_google_productivity" { ... }

resource "aws_secretsmanager_secret_version" "oauth_google_productivity" {
  secret_id = aws_secretsmanager_secret.oauth_google_productivity.id
  secret_string = jsonencode({
    client_id     = var.google_oauth_client_id
    client_secret = var.google_oauth_client_secret
  })
  lifecycle { ignore_changes = [secret_string] }
}

# terraform/modules/app/lambda-api/handlers.tf — common_env
GOOGLE_PRODUCTIVITY_OAUTH_SECRET_ARN = aws_secretsmanager_secret.oauth_google_productivity.arn
```

```ts
// packages/api/src/handlers/oauth-authorize.ts
if (isSecretsManagerProvider(provider.name)) {
  const creds = await getOAuthClientCredentials(provider.name);
  clientId     = creds.clientId;
  clientSecret = creds.clientSecret;
}
```

### Adding a second provider (Microsoft 365)

Demonstrates how the pattern scales without touching handler code:

1. **Terraform** — copy the `oauth_google_productivity` pair, rename to `oauth_microsoft_365`, point at `var.microsoft_oauth_client_id` / `var.microsoft_oauth_client_secret`.
2. **`common_env`** — add `MICROSOFT_OAUTH_SECRET_ARN = aws_secretsmanager_secret.oauth_microsoft_365.arn`.
3. **Helper** — already includes `microsoft_365` in the `OAuthProviderName` union and the `SECRET_ARN_ENV` record. **No code change needed.**
4. **Consumers** — `isSecretsManagerProvider("microsoft_365")` returns true; the existing branch handles it. **No handler edits.**

That four-step pattern is the payoff: once the helper exists, new providers are configuration, not code.

## Related

- **Sibling pattern (per-user tokens, different lifecycle):** `packages/api/src/lib/mcp-configs.ts:87-88` uses `SecretsManagerClient` + `GetSecretValueCommand` (and `UpdateSecretCommand`) to resolve per-user MCP OAuth tokens from Secrets Manager, with refresh-on-expiry. Same AWS primitive, different shape — per-user, per-connection, with a refresh mechanic. Do NOT copy `mcp-configs.ts` as a template for client credentials; it has no module-scope cache because user-token freshness matters.
- **Consumer-side handler bug fixed in the same PR series:** [oauth-authorize-wrong-user-id-binding-2026-04-21](../logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md) — covers a separate logic error in the same `oauth-authorize.ts` handler (user-resolution, not credential loading). The two docs are complementary: one on identity, one on secrets.
- **Source-of-truth plan:** [`docs/plans/2026-04-21-006-fix-oauth-integrations-credentials-locker-plan.md`](../../plans/2026-04-21-006-fix-oauth-integrations-credentials-locker-plan.md) — the plan that drove PR #337 where this pattern was introduced. Includes the review-conversation trail from security/scope-guardian/adversarial reviewers that landed on Secrets Manager as the right primitive.
- **Related memories:** `project_tfvars_secrets_hygiene` (this pattern is the first concrete migration target), `feedback_aws_native_preference` (this pattern validates the preference). Both should be updated after this doc lands to cross-reference it.

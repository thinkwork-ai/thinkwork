---
title: Fix Google + Microsoft per-user OAuth, merge into mobile "Credentials Locker"
type: fix + feat
status: active
date: 2026-04-21
origin: in-session diagnosis (no requirements doc); this plan is the source of truth
---

# Fix OAuth (Google Workspace + Microsoft 365) + Credentials Locker

## Overview

Two work streams, **two sequential PRs** (split per review — different risk profiles, different reviewers, different revert costs):

- **PR #1 — OAuth unblock (Units 1–6, 8).** Fixes the "Connect" buttons that 404 today. Pure infra + backend: Azure registration, Terraform plumbing, Secrets Manager for OAuth client secrets, DB inserts, seed rewrite, error-message improvements, and a mobile-scheme redirect path that actually returns the user to the app.
- **PR #2 — Credentials Locker mobile UX (Unit 7).** Ships after PR #1 merges and is validated end-to-end. Deletes two screens, consolidates into `/settings/credentials`. Strictly mobile code.

**Why PR #1 first:** bundling infra + UX multiplies blast radius. If a terraform apply issue surfaces, we don't want it gating a mobile rebuild; if a screen bug surfaces, we don't want it gating OAuth being fixed. Shipping PR #1 alone means Connect buttons work under the old two-screen nav; PR #2 then consolidates with verified-working credential flows behind it.

**PR #1 diagnosis — three independent reasons OAuth can't complete today:** (a) the `connect_providers` DB rows don't exist, (b) the deployed Lambda-API has **no OAuth env vars at all** — the `google_oauth_client_*` tfvars only flow to the Cognito federated-signin module, never to the oauth-authorize/oauth-callback/oauth-token code paths, and (c) Microsoft 365 has never been registered as an Azure AD app, so no client credentials exist anywhere in the system.

**PR #2 scope — merge "Integrations" and "MCP Servers" into a single "Credentials Locker" screen on mobile.** Per the user's call: both surfaces are about "configuring credentials so agents can use a thing." The implementation split (tenant-integration OAuth vs remote MCP server) is internal plumbing that should not leak into the mobile nav.

**No data migrations. No schema changes.** The DB fix is additive inserts into `connect_providers`. The mobile UX is a screen merge, not a data-model shift.

**Scope explicitly rejected** from this plan (closed by prior conversation): no gogcli migration, no Drive/Docs/Sheets coverage expansion, no bundled-CLI pattern substrate, no retirement of existing `google-email` / `google-calendar` Python skills. Eric explicitly chose "stay put" on the skill implementation surface; this plan only fixes what breaks the current surface and improves the UX wrapper around it.

## Problem Frame

**Symptom (mobile).** Tapping Connect on Google Workspace or Microsoft 365 opens an in-app browser that immediately shows the raw JSON error `{"error":"Unknown provider: google_productivity"}` (or `microsoft_365`) from `${API_GATEWAY}.us-east-1.amazonaws.com/api/oauth/authorize`.

**Root causes (three, all independent, all load-bearing):**

| # | Layer | Fact |
|---|---|---|
| 1 | DB | No row in `connect_providers` with `name='google_productivity'` or `name='microsoft_365'`. Verified via lookup pattern `where(eq(connectProviders.name, providerName))` in `packages/api/src/handlers/oauth-authorize.ts:57`. |
| 2 | Lambda env | Deployed `thinkwork-dev-api-oauth-authorize` has 32 env vars — none of `GOOGLE_PRODUCTIVITY_CLIENT_ID`, `GOOGLE_PRODUCTIVITY_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `OAUTH_CALLBACK_URL` (read by oauth-authorize.ts:23-28, oauth-callback.ts:115-122, oauth-token.ts:234-240). The `common_env` block in `terraform/modules/app/lambda-api/handlers.tf:14-55` never references OAuth client vars. |
| 3 | Azure | `terraform/examples/greenfield/terraform.tfvars` has `google_oauth_client_id` + `_secret` (values present), but **no equivalents for Microsoft**. An Azure AD / Entra app registration has never been created for this environment. |

**Collateral damage:** `scripts/seed-dev.sql:15-19` attempts to seed `connect_providers` using columns that don't exist in the current schema (`slug`, `type`, top-level `scopes`) and config keys that code doesn't read (`authorize_url` vs. `authorization_url`). Running this seed fails with `column "slug" of relation "connect_providers" does not exist` and aborts the transaction before any rows are inserted. This is why a new dev environment will hit the same bug.

**Non-cause (rule out):** The memory note `project_google_oauth_setup` ("Google OAuth is live on the ThinkWork dev stack") refers to **Cognito federated sign-in with Google** (user pool `us-east-1_L4DhLVKis` + Google IdP). That path uses the `google_oauth_client_id` tfvars that flow to `terraform/modules/foundation/cognito/main.tf:175`. It works. The per-user OAuth flow for Gmail/Calendar data access is a different, parallel flow that has never been fully wired.

**Bonus UX problem (user raised).** Mobile has two nav entries (`Integrations`, `MCP Servers`) for what is conceptually one operation ("connect a thing so agents can use its capabilities"). Merge into one "Credentials" entry.

## Scope Boundaries

- **Out of scope:** any skill-layer changes. `google-email` / `google-calendar` Python skills keep running unchanged. No bundled binaries, no coverage expansion to Drive/Docs/Sheets, no consolidation into a `google-workspace` skill. Tracked separately (`docs/brainstorms/2026-04-21-bundled-cli-skills-gogcli-google-workspace-requirements.md` is shelved; do not re-open without new signal).
- **Out of scope:** any changes to Cognito federated sign-in. That flow works; this plan doesn't touch `terraform/modules/foundation/cognito/`.
- **Out of scope:** OAuth scope broadening. Existing Google consent stays at Gmail + Calendar + identity. Microsoft 365 lands with Mail.ReadWrite + Calendars.ReadWrite + User.Read + offline_access — matching what the current skills use, no more.
- **Out of scope:** admin-web-app equivalents of the Credentials Locker screen. Admin keeps its existing AgentConfigSection credential dialogs; this plan is mobile-only.
- **Out of scope:** LastMile-MCP-server or any third-party MCP server catalog changes.
- **Out of scope:** production deployment. This plan only targets the `dev` stage. A prod follow-up plan is needed once dev is green, and it has its own Azure app registration + SSM migration dependencies (see `project_tfvars_secrets_hygiene`).
- **Out of scope:** changing the `connect_providers.name` convention (`google_productivity` / `microsoft_365`). It's inconsistent with the `connect_providers.slug` in the broken seed but consistent with every runtime code path that reads it. Renaming is a bigger refactor that doesn't belong in a bug-fix plan.
- **Out of scope:** deep-link redirect from `/settings/integrations` + `/settings/mcp-servers` after rename to `/settings/credentials`. Mobile has never had captive-audience bookmarks to those paths.

### Deferred to Separate Tasks

- **Prod stage OAuth wiring.** Same work as dev, different Azure app (prod tenants), needs SSM-migration coordination.
- **Microsoft `pre-signup` Lambda equivalent.** Mirrors the known-gap Google pre-signup Lambda (per memory `project_google_oauth_setup`). Not needed for dev testing with fresh Microsoft accounts.
- **Admin-web-app unified Credentials view.** Admin surface redesign; different information density needs.

## Context & Research

### Runtime code expectations (verified)

- `packages/api/src/handlers/oauth-authorize.ts:57` — `SELECT FROM connect_providers WHERE name = ?`. Rejects with 404 `Unknown provider` if missing.
- `packages/api/src/handlers/oauth-authorize.ts:64-66` — `config.authorization_url` required (not `authorize_url`).
- `packages/api/src/handlers/oauth-authorize.ts:94-97` — `config.scopes` is a `Record<string, string>` (name → URL dict), iterated by `requestedScopes` string names.
- `packages/api/src/handlers/oauth-authorize.ts:23-28, 70-76, 103-110` — per-provider env-var branching: `GOOGLE_PRODUCTIVITY_CLIENT_ID`, `MICROSOFT_CLIENT_ID`, `LASTMILE_CLIENT_ID`, `OAUTH_CALLBACK_URL`.
- `packages/api/src/handlers/oauth-callback.ts:45, 156` — reads `config.authorization_url`, `config.token_url`, `config.userinfo_url`.
- `packages/api/src/handlers/oauth-callback.ts:114-123, 243-264` — per-provider secret env-var branching: `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_SECRET`, `LASTMILE_CLIENT_SECRET`.
- `packages/api/src/lib/oauth-token.ts:234-240, 337-349` — refresh path needs `GOOGLE_PRODUCTIVITY_CLIENT_ID`/`SECRET`, `MICROSOFT_CLIENT_ID`/`SECRET`. Called from `wakeup-processor`, `chat-agent-invoke`, `skills`, `memory-retain` (so those Lambdas also need the env vars).

### Lambda deployment reality

- `terraform/modules/app/lambda-api/handlers.tf:14-55` — `common_env` is the single source of truth for env vars shared across the 43 Lambda handlers. No OAuth client vars present today.
- `terraform/modules/app/lambda-api/handlers.tf:150-156` — every handler gets `common_env` merged. Easiest fix point: add OAuth vars to `common_env` and every handler inherits them.
- `terraform/modules/thinkwork/main.tf:75-76` — the `thinkwork` module receives `google_oauth_client_id/secret` today and only forwards to the Cognito module. Need to also forward to the `lambda-api` module.
- `terraform/modules/thinkwork/variables.tf:40-51` — variable declarations; need new `microsoft_oauth_client_id`, `microsoft_oauth_client_secret`, `oauth_callback_url` variables.
- `terraform/examples/greenfield/main.tf:89-95, 215-216` — greenfield example wires tfvars → module. Needs Microsoft var additions.
- `terraform/examples/greenfield/terraform.tfvars:22-24` — live values. Google present; Microsoft and `oauth_callback_url` missing.

### DB reality

- RDS cluster: `thinkwork-dev-db-1.cmfgkg8u8sgf.us-east-1.rds.amazonaws.com`, database `thinkwork`, master user `thinkwork_admin`, publicly accessible.
- Master password: stored plaintext in `terraform/examples/greenfield/terraform.tfvars:12` as `db_password = "<DEV_DB_PASSWORD_ROTATED_2026_05_05>"` and mirrored in AWS Secrets Manager at `thinkwork-dev-db-credentials` (per `aws secretsmanager list-secrets` output).
- Schema: `connect_providers` — columns `id`, `name` (unique), `display_name`, `provider_type`, `auth_type`, `config` (jsonb), `is_available`, timestamps (`packages/database-pg/src/schema/integrations.ts:21-37`).

### Mobile surface

- `apps/mobile/app/settings/integrations.tsx` — current Integrations screen. 260 LOC. Renders connected + available providers (Google Workspace, Microsoft 365). Handles `handleConnectGoogle`, `handleConnectMicrosoft`, `handleReconnect`, `handleDisconnect`. Depends on `useConnections()` from `lib/hooks/use-connections.ts`.
- `apps/mobile/app/settings/mcp-servers.tsx` — current MCP Servers screen. Lists `McpServerRow[]` from `/api/skills/user-mcp-servers`. Each row routes to `/settings/mcp-server-detail`.
- `apps/mobile/app/settings/mcp-server-detail.tsx` — per-server detail with Connect/Disconnect actions; WorkOS DCR + OAuth flow.
- `apps/mobile/app/_layout.tsx` — registers both `settings/integrations` and `settings/mcp-servers` as `<Stack.Screen>`.
- `apps/mobile/app/(tabs)/index.tsx` (or equivalent header menu) — the kebab-menu with nav entries shown in the user's screenshot.

### Applicable Memory

- `project_google_oauth_setup` — **stale as of this plan**; memory claims "Google OAuth is live" but that refers to Cognito federated signin, not per-user Gmail/Calendar OAuth. Update the memory after this plan lands.
- `project_tfvars_secrets_hygiene` — OAuth client secrets in terraform.tfvars; migration to SSM is planned but not for this PR. Microsoft client secret will also land in tfvars per this plan (consistent).
- `feedback_user_opt_in_over_admin_config` — integration setup belongs in mobile self-serve. Credentials Locker is a mobile self-serve screen. ✓
- `feedback_worktree_isolation` — execute in `.claude/worktrees/fix-oauth-credentials-locker/` off `origin/main`.
- `feedback_pnpm_in_workspace` — use pnpm, never npm.
- `feedback_pr_target_main` — PR targets main, never stacked.
- `feedback_avoid_fire_and_forget_lambda_invokes` — not applicable (no Lambda invokes added by this plan).
- `feedback_verify_wire_format_empirically` — after Google connect works end-to-end, `curl` the live callback URL to confirm the token exchange actually succeeded before declaring done.

### External References

- Google OAuth 2.0 scope URLs — `https://developers.google.com/identity/protocols/oauth2/scopes#gmail` (matches `gmail.modify`, `calendar`, `userinfo.email`).
- Microsoft Graph scopes — `https://learn.microsoft.com/en-us/graph/permissions-reference#mail-permissions` (matches `Mail.ReadWrite`, `Calendars.ReadWrite`, `User.Read`).
- Azure App Registration — `https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app`. Required external step for Microsoft 365 support.

## Key Technical Decisions

- **Store OAuth client secrets in Secrets Manager, not Lambda env vars.** Aligns with `feedback_aws_native_preference` and the `project_tfvars_secrets_hygiene` SSM-migration target. Two secrets: `thinkwork/{stage}/oauth/google-productivity` and `thinkwork/{stage}/oauth/microsoft-365`, each holding `{"client_id","client_secret"}`. The 4 Lambda consumers (`oauth-authorize`, `oauth-callback`, `wakeup-processor`, `chat-agent-invoke`) fetch at cold-start and cache in-process. IAM policy scopes `secretsmanager:GetSecretValue` to only these two ARNs. Non-secret env vars (`OAUTH_CALLBACK_URL`, `REDIRECT_SUCCESS_URL`, secret ARN names) stay in `common_env` since they're not sensitive. **Explicitly rejected:** the original `common_env` broadcast to all 43 Lambdas — expands the client-secret exfiltration surface 10x for zero benefit, paints us into the same corner when prod lands, and trips the AWS-native preference.
- **Mobile OAuth return uses the existing `thinkwork://` custom scheme via `openAuthSessionAsync`, threaded through `returnUrl`.** Infrastructure already in place: iOS `Info.plist` registers `thinkwork://`; `apps/mobile/app/settings/mcp-server-detail.tsx:106` and `mcp-servers.tsx:97` already use `WebBrowser.openAuthSessionAsync(url, "thinkwork://mcp-oauth-complete")` for MCP OAuth. `oauth-authorize.ts:47, 140` already accepts `returnUrl` query param and stores it in the state row. **Gap today:** `oauth-callback.ts` ignores the stored `return_url` and always redirects to `REDIRECT_SUCCESS_URL`. This plan closes that gap (see Unit 6b). Mobile passes `returnUrl=thinkwork://settings/credentials` (in PR #1 we pass `thinkwork://settings/integrations` since that screen still exists; PR #2 switches to `credentials`). Web (admin) passes no `returnUrl`, falls through to `REDIRECT_SUCCESS_URL` default.
- **Two-PR split.** PR #1 (OAuth unblock) ships infra + backend + a one-line mobile change to use `openAuthSessionAsync` with the return scheme. PR #2 (Credentials Locker) ships the screen merge. This matches the product-lens/scope-guardian finding that bundling the two multiplies blast radius.
- **Keep the confusing `name` column values.** The DB column `connect_providers.name` holds `google_productivity` / `microsoft_365` / `lastmile` — values the runtime code hard-codes all over. Renaming to a cleaner convention (e.g., `google-workspace`) would touch 20+ code sites across mobile, admin, api, and provider callback logic. Out of scope for a bug-fix PR. The seed's existing `google-workspace` slug attempt was aspirational; delete it.
- **Microsoft 365 Azure registration is an explicit user-owned prerequisite, not a code deliverable.** Eric registers the app in the Azure portal, copies client_id + client_secret into tfvars. The plan lists the steps in Unit 1 but implementation of that unit is manual portal work.
- **Seed file becomes the canonical provider-row recipe.** Rewrite `scripts/seed-dev.sql` with `INSERT ... ON CONFLICT (name) DO UPDATE` using the schema-correct shape. Every future dev env gets correct providers from the committed script. The ON CONFLICT clause makes it idempotent — running twice is a no-op.
- **Credentials Locker is a new parent screen; old screens delete.** No preservation of `/settings/integrations` or `/settings/mcp-servers` as child routes. Legal paths become `/settings/credentials`, `/settings/integration-detail` (existing, unchanged), `/settings/mcp-server-detail` (existing, unchanged). Clean single-nav-entry result.
- **"Credentials" is the nav label, not "Credentials Locker".** Shorter. The screen title / body can use "Credentials Locker" as the conceptual name if the product voice prefers, but nav stays terse per iOS convention.
- **Error-message improvement ships in the same PR.** Tiny code change (`oauth-authorize.ts:60`) and improves the next debugging loop materially. Including it spends ~5 review minutes for lasting diagnostic value.
- **No migration of existing `connections` rows.** If a test tenant ever had a Google connection row from a prior (broken) attempt, the `INSERT ... ON CONFLICT` on `connect_providers` won't touch it. Existing connections FK-refer to the old provider id (if any); new INSERT creates a new id only if no row existed. Safest default — we don't lose dev data.

## Open Questions

### Resolved During Planning

- **Does `oauth-token.ts` need updating for new providers?** No. It already branches on `provider.name === "google_productivity"` / `"microsoft_365"` at lines 234-240, 337-349. Once the DB rows exist and env vars are set, it "just works."
- **Which tfvars variables land the OAuth env vars on the Lambdas?** New variables `microsoft_oauth_client_id`, `microsoft_oauth_client_secret`, `oauth_callback_url` plumbed through `thinkwork` module → `lambda-api` module → `common_env`. Existing `google_oauth_client_id/secret` get the same extra wiring (they currently only flow to Cognito).
- **Does Microsoft need `offline_access` scope for refresh tokens?** Yes. `oauth-authorize.ts:107-110` already appends it if missing. Config just needs to include it in the scopes dict.
- **What's the callback URL?** Constructed from API Gateway ID at terraform-apply time. Current API Gateway URL surfaces in `common_env.THINKWORK_API_URL` at `handlers.tf:32`. `OAUTH_CALLBACK_URL` should be `${THINKWORK_API_URL}/api/oauth/callback` — a new locals expression in `handlers.tf`, not a tfvars variable.
- **Does mobile need deep-link backward compat for `/settings/integrations` and `/settings/mcp-servers`?** No. Per Key Technical Decisions, captive-audience bookmarks are rare on mobile; a hard 404 on those paths is acceptable (matches Expo Router default unmatched-route behavior).

### Deferred to Implementation

- **[Affects Unit 1][User action]** Azure app registration exact step list — redirect URI registration, API permissions selection (delegated vs application), admin-consent flow if needed for the Eric-owned tenant. Non-trivial outside-the-code task; likely 15-30 minutes in Azure portal. Implementation agent should walk Eric through it or have Eric complete it before Unit 2.
- **[Affects Unit 3][Technical]** Whether `THINKWORK_API_URL` always includes the https:// scheme at terraform-apply time. If not, the `OAUTH_CALLBACK_URL` locals expression needs a scheme prefix.
- **[Affects Unit 7][Technical]** Whether `useConnections()` + the `/api/skills/user-mcp-servers` fetch can share a single load state in the merged screen without double-spinner on first render, or if they need a shared skeleton.
- **[Affects Unit 7][UX]** Exact section headers — "Built-in Integrations" + "MCP Servers", or "Managed Connections" + "Custom Servers", or something else. User voice preference; implementer picks and Eric adjusts on review.

## Implementation Units

- [ ] **Unit 1: Azure AD app registration (user-owned prerequisite)**

**Goal:** Obtain Microsoft 365 client_id + client_secret so subsequent units have values to plumb.

**Requirements:** blocks Units 2, 4 for Microsoft. Google-side work in Units 2, 3, 4, 5 can proceed in parallel if Eric defers Unit 1.

**Dependencies:** none (external).

**Files:** none (Azure portal, not repo).

**Approach:**
1. Visit Azure Portal → Microsoft Entra ID → App Registrations → New Registration.
2. Name: `ThinkWork Dev (per-user)`. Supported account types: Accounts in any organizational directory + personal Microsoft accounts (multitenant) so Eric's personal testing accounts work.
3. Redirect URI: Web, `https://<API_GATEWAY_ID>.execute-api.us-east-1.amazonaws.com/api/oauth/callback`. The API Gateway ID is stable and already deployed — retrieve it now via `aws apigatewayv2 get-apis --region us-east-1 --query 'Items[?Name==\`thinkwork-dev-api\`].ApiId' --output text` and use that value directly. No need to wait for Unit 2 apply; the ID does not change.
4. Register → copy Application (client) ID.
5. Certificates & secrets → New client secret → 24 months → copy Value (not Secret ID).
6. API permissions → Microsoft Graph → Delegated → add: `Mail.ReadWrite`, `Calendars.ReadWrite`, `User.Read`, `offline_access`.
7. No admin consent needed for personal Microsoft accounts.

**Patterns to follow:** existing Google OAuth client in Google Cloud Console is the analog; Eric has set up the Google side before.

**Test scenarios:**
- Verify the new app appears in Azure Portal with three delegated Graph permissions.
- Confirm client secret value has been copied before leaving the page (Azure only shows it once).

**Verification:**
- Azure App Registration exists with a client_id and a client_secret value.

---

- [ ] **Unit 2: Create OAuth client Secrets Manager secrets + scoped IAM + non-secret env vars**

**Goal:** Give the 4 OAuth-consuming Lambdas a narrowly-scoped way to fetch Google + Microsoft client credentials at cold-start, without broadcasting secrets to the other 39 handlers.

**Requirements:** blocks Units 4, 6, 6b, 8.

**Dependencies:** Unit 1 complete (need the Microsoft client_id + client_secret values to populate the secret).

**Files:**
- **New terraform module / additions in existing `app/lambda-api`:**
  - Create: two `aws_secretsmanager_secret` resources — `thinkwork-${stage}-oauth-google-productivity` and `thinkwork-${stage}-oauth-microsoft-365`. Each has an `aws_secretsmanager_secret_version` with `secret_string = jsonencode({client_id, client_secret})` populated from new tfvars variables.
  - Modify: `terraform/modules/app/lambda-api/iam.tf` (or equivalent) — attach a new IAM policy to the shared Lambda role: `secretsmanager:GetSecretValue` scoped to exactly the two new secret ARNs. Narrower than any existing Secrets Manager permission on the role.
- **Non-secret env vars (still `common_env` — these aren't sensitive):**
  - Modify: `terraform/modules/app/lambda-api/handlers.tf:14` — extend `common_env` to include:
    - `GOOGLE_PRODUCTIVITY_OAUTH_SECRET_ARN = aws_secretsmanager_secret.google_productivity.arn`
    - `MICROSOFT_OAUTH_SECRET_ARN           = aws_secretsmanager_secret.microsoft_365.arn`
    - `OAUTH_CALLBACK_URL                   = "https://${aws_apigatewayv2_api.main.id}.execute-api.${var.region}.amazonaws.com/api/oauth/callback"`
    - `REDIRECT_SUCCESS_URL                 = var.redirect_success_url` (default `"https://app.thinkwork.ai/settings/credentials"` — used as fallback when no per-request `returnUrl` is provided; mobile will always provide one)
- **Variable declarations — plumb through the tfvars → thinkwork → lambda-api chain:**
  - Modify: `terraform/modules/app/lambda-api/variables.tf` — declare `google_oauth_client_id`, `google_oauth_client_secret`, `microsoft_oauth_client_id`, `microsoft_oauth_client_secret` (all with `default = ""` so Unit 3 can run before or after Unit 2), `redirect_success_url` (with `default = "https://app.thinkwork.ai/settings/credentials"`).
  - Modify: `terraform/modules/thinkwork/variables.tf` — declare Microsoft vars + `redirect_success_url` (google vars already exist).
  - Modify: `terraform/modules/thinkwork/main.tf:73` — pass all OAuth vars + redirect URL to the `lambda-api` module invocation.
  - Modify: `terraform/examples/greenfield/main.tf` — declare + forward Microsoft vars + `redirect_success_url`.
- **Code changes in the 4 consumer handlers (cold-start secret fetch + cache):**
  - Modify: `packages/api/src/handlers/oauth-authorize.ts` — replace `process.env.GOOGLE_PRODUCTIVITY_CLIENT_ID` / `process.env.MICROSOFT_CLIENT_ID` reads at `:23-28, :70-76` with calls to a new helper `getOAuthClientCredentials(providerName)` that fetches from Secrets Manager on first call and caches in a module-level `Map`.
  - Modify: `packages/api/src/handlers/oauth-callback.ts` — same treatment for `:114-123, :243-264`.
  - Modify: `packages/api/src/lib/oauth-token.ts` — same treatment for `:234-240, :337-349`.
  - Create: `packages/api/src/lib/oauth-client-credentials.ts` — new helper. Single `getOAuthClientCredentials(providerName: "google_productivity" | "microsoft_365")` function that reads `GOOGLE_PRODUCTIVITY_OAUTH_SECRET_ARN` or `MICROSOFT_OAUTH_SECRET_ARN` from env, calls `GetSecretValueCommand` once per cold-start per provider, parses `{client_id, client_secret}`, caches.

**Approach:**
- The cache lives in module scope so it survives across invocations of a warm Lambda; cold-start pays the Secrets Manager round-trip once (~20ms).
- `GOOGLE_PRODUCTIVITY_OAUTH_SECRET_ARN` and `MICROSOFT_OAUTH_SECRET_ARN` in `common_env` is fine — secret **ARNs** are not sensitive (only the secret **values** are). The IAM scope is what controls access.
- Giving new terraform vars empty-string defaults matches the existing `terraform/modules/foundation/cognito/variables.tf:67-77` pattern for google_oauth vars. That way Unit 2 terraform can be written + applied before Unit 3's values are populated, producing a Secrets Manager secret with empty client_id/secret strings (OAuth flows error cleanly) rather than blocking apply.
- Terraform manages only the secret container; the value is populated by `aws_secretsmanager_secret_version` driven from tfvars. Rotation can later be moved into Secrets Manager-managed rotation without touching this Terraform.

**Patterns to follow:**
- `packages/api/src/lib/mcp-configs.ts:87-88` already uses `SecretsManagerClient` + `GetSecretValueCommand` — copy the shape.
- `foundation/cognito/variables.tf:67-77` for the `sensitive = true` + default-empty-string pattern.
- `handlers.tf:32` for the URL-from-API-Gateway-ID pattern.

**Test scenarios:**
- Happy path: `terraform plan` shows two new Secrets Manager secrets created, IAM policy attached, and the 4 non-secret env vars added to `common_env`. 43 Lambda functions get the 4 new non-secret env vars; only the shared Lambda role gets the new IAM policy.
- `terraform apply` completes without errors.
- `aws secretsmanager get-secret-value --secret-id thinkwork-dev-oauth-google-productivity` returns `{"client_id":"...","client_secret":"..."}`.
- Code: cold-invoke `oauth-authorize` with a synthetic event — observe one Secrets Manager GetSecretValue call in CloudWatch; second invocation within warm window produces zero additional Secrets Manager calls (cache hit).

**Verification:**
- Post-apply: only the 4 consumer Lambdas have IAM permission to read the two secrets (verified via `aws iam simulate-principal-policy`). Other Lambdas have no access — the least-privilege boundary is enforced.
- `oauth-authorize` cold-start log shows a single `[oauth-client-credentials] Loaded google_productivity from Secrets Manager` line, no repeat on subsequent invocations.

---

- [ ] **Unit 3: Add Microsoft credentials to tfvars**

**Goal:** Supply the actual Microsoft client_id + client_secret values for the dev stack.

**Requirements:** none blocking — Unit 2 uses empty-string defaults so terraform can be applied before or after this unit. However, OAuth flows won't actually work for Microsoft until this unit lands (the Secrets Manager secret will hold empty strings until Unit 3 supplies real values).

**Dependencies:** Unit 1 complete.

**Files:**
- Modify: `terraform/examples/greenfield/terraform.tfvars` — add two lines:
  ```
  microsoft_oauth_client_id     = "<from Unit 1>"
  microsoft_oauth_client_secret = "<from Unit 1>"
  ```
- Modify: `terraform/examples/greenfield/terraform.tfvars.example` — add placeholder lines for both, matching the existing Google pattern.

**Approach:**
- Paste the values from Unit 1 output. Do not commit the real `terraform.tfvars` (already .gitignored per the greenfield directory convention).
- The `.example` file update documents the expected variable names for future deployers.

**Patterns to follow:**
- Existing `google_oauth_client_id` / `google_oauth_client_secret` lines at `terraform.tfvars:22-23`.

**Test scenarios:**
- `terraform plan` in Unit 2 runs either before or after this unit (defaults are empty strings per Unit 2). With values populated, the next `terraform apply` updates the Secrets Manager secret version with real credentials.
- After apply, `aws secretsmanager get-secret-value --secret-id thinkwork-dev-oauth-microsoft-365 --query SecretString --output text | jq` returns a non-empty client_id + client_secret.

**Verification:**
- `grep microsoft_oauth terraform/examples/greenfield/terraform.tfvars` returns two lines with non-empty values.

---

- [ ] **Unit 4: Insert connect_providers rows into the dev DB**

**Goal:** Make `SELECT * FROM connect_providers WHERE name IN ('google_productivity', 'microsoft_365')` return the two rows the runtime expects.

**Requirements:** blocks Unit 8 (end-to-end test).

**Dependencies:** none structurally (can run before or after Units 2-3), but operationally makes sense after Unit 2 so the Lambdas are already primed to actually use the data.

**Files:**
- Execute (not commit): SQL against live dev DB.

**Approach:**
- Fetch the RDS master password from Secrets Manager, export as `PGPASSWORD`, then run psql without the password on the command line (keeps it out of shell history + process listing):
  ```bash
  export PGPASSWORD=$(aws secretsmanager get-secret-value \
    --secret-id thinkwork-dev-db-credentials \
    --region us-east-1 \
    --query SecretString --output text | jq -r '.password // .password_master // .db_password')
  psql "postgresql://thinkwork_admin@thinkwork-dev-db-1.cmfgkg8u8sgf.us-east-1.rds.amazonaws.com:5432/thinkwork?sslmode=require"
  unset PGPASSWORD  # after session ends
  ```
  If the secret's JSON structure uses a different password key, the `jq` path needs adjusting — confirm with `aws secretsmanager get-secret-value --secret-id thinkwork-dev-db-credentials --query SecretString --output text | jq 'keys'` first.
- Run the INSERT below. `ON CONFLICT (name) DO UPDATE` makes this idempotent.

  ```sql
  INSERT INTO connect_providers (name, display_name, provider_type, auth_type, config) VALUES
    ('google_productivity', 'Google Workspace', 'oauth2', 'oauth2', jsonb_build_object(
      'authorization_url', 'https://accounts.google.com/o/oauth2/v2/auth',
      'token_url',         'https://oauth2.googleapis.com/token',
      'userinfo_url',      'https://openidconnect.googleapis.com/v1/userinfo',
      'scopes', jsonb_build_object(
        'gmail',    'https://www.googleapis.com/auth/gmail.modify',
        'calendar', 'https://www.googleapis.com/auth/calendar',
        'identity', 'https://www.googleapis.com/auth/userinfo.email'
      ),
      'extra_params', jsonb_build_object('access_type','offline','prompt','consent')
    )),
    ('microsoft_365', 'Microsoft 365', 'oauth2', 'oauth2', jsonb_build_object(
      'authorization_url', 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      'token_url',         'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      'userinfo_url',      'https://graph.microsoft.com/v1.0/me',
      'scopes', jsonb_build_object(
        'email',          'Mail.ReadWrite',
        'calendar',       'Calendars.ReadWrite',
        'identity',       'User.Read',
        'offline_access', 'offline_access'
      )
    ))
  ON CONFLICT (name) DO UPDATE SET
    display_name  = EXCLUDED.display_name,
    provider_type = EXCLUDED.provider_type,
    auth_type     = EXCLUDED.auth_type,
    config        = EXCLUDED.config,
    updated_at    = NOW();
  ```
- Verify with `SELECT name, display_name, config->>'authorization_url' FROM connect_providers;`.

**Patterns to follow:**
- Column names mapped from `packages/database-pg/src/schema/integrations.ts:21-37`.

**Test scenarios:**
- Happy path: both rows exist after insert; `config->'scopes'` is a jsonb object (not array); `is_available` defaults to true.
- Idempotent: re-running the INSERT produces no errors and no duplicate rows.

**Verification:**
- `psql ... -c "SELECT count(*) FROM connect_providers WHERE name IN ('google_productivity','microsoft_365');"` returns 2.

---

- [ ] **Unit 5: Rewrite scripts/seed-dev.sql**

**Goal:** Make the committed seed script match the current schema so future dev environments work out of the box.

**Requirements:** none structurally; prevents recurrence of this bug.

**Dependencies:** Unit 4 is the source of truth for correct column + config shape; seed mirrors it.

**Files:**
- Modify: `scripts/seed-dev.sql` — replace the broken `INSERT INTO connect_providers (...slug...)` block (lines 15-19) with the schema-correct shape from Unit 4.

**Approach:**
- Keep the existing `model_catalog` INSERT block unchanged (lines 4-12).
- Replace the provider block with `INSERT INTO connect_providers (name, display_name, provider_type, auth_type, config) VALUES ... ON CONFLICT (name) DO UPDATE SET ...`.
- Include `google_productivity`, `microsoft_365`. Skip GitHub and Slack from the old seed for now — they weren't in the current runtime code paths Eric cares about, and their config shape is different enough to warrant a separate follow-up if/when they're needed.
- Update the final SELECT count message accordingly.

**Patterns to follow:**
- Unit 4 SQL verbatim for the provider rows.

**Test scenarios:**
- Happy path: run `psql $DATABASE_URL -f scripts/seed-dev.sql` on a fresh DB → no errors, producer count reports 2 providers.
- Idempotent: run twice → no errors, no duplicates.

**Verification:**
- After running the seed, `SELECT name FROM connect_providers` returns exactly `google_productivity` and `microsoft_365`.

---

- [ ] **Unit 6: Improve the "Unknown provider" error message**

**Goal:** When this breaks again, the error should point at the fix, not at a wall.

**Requirements:** none structurally.

**Dependencies:** none.

**Files:**
- Modify: `packages/api/src/handlers/oauth-authorize.ts:60` — change error string from `Unknown provider: ${providerName}` to `Unknown provider: ${providerName} (check connect_providers table; run scripts/seed-dev.sql if missing)`.
- Modify: `packages/api/src/handlers/oauth-authorize.ts:78` — change `OAuth client not configured for this provider` to `OAuth client not configured for ${providerName} (check the Secrets Manager secret referenced by ${providerName === "google_productivity" ? "GOOGLE_PRODUCTIVITY_OAUTH_SECRET_ARN" : "MICROSOFT_OAUTH_SECRET_ARN"} — value should be JSON with client_id + client_secret)`.

**Approach:**
- Two one-line changes. No test changes needed — the error path is exercised by the existing integration flow.

**Patterns to follow:**
- Other error messages in `handlers/` that include actionable remediation hints (e.g., `oauth-authorize.ts:79-82` already does this for `OAUTH_CALLBACK_URL`).

**Test scenarios:**
- Trigger the missing-provider path with `curl '...?provider=doesnotexist'` → error body contains the remediation hint.

**Verification:**
- `grep "connect_providers table" packages/api/src/handlers/oauth-authorize.ts` returns 1 match.

---

- [ ] **Unit 6b: Make oauth-callback honor per-request `returnUrl` + mobile uses custom scheme**

**Goal:** After successful OAuth, actually return the user to the calling app (mobile deep link OR web URL they arrived from), instead of always redirecting to a single hardcoded `REDIRECT_SUCCESS_URL`.

**Requirements:** critical for mobile — without this, users are stranded in the in-app browser after consent. Blocks Unit 8 end-to-end.

**Dependencies:** none structurally; can be done alongside Unit 6.

**Files:**
- Modify: `packages/api/src/handlers/oauth-callback.ts` — refactor the 6 `redirect(${REDIRECT_SUCCESS_URL}?...)` call sites (lines 70, 74, 96, 106, 143, 366, 369) to use a helper `redirectTo(conn, status, reason)` that reads the `return_url` stored on the pending `connections` row (populated by `oauth-authorize.ts:140`) and falls back to `REDIRECT_SUCCESS_URL` env var when absent. The row is already being `SELECT`ed at `:100-103` for provider lookup; extend that select to include the metadata/state column that holds `return_url`, or add a second small SELECT if the column isn't currently projected.
- Modify: `apps/mobile/app/settings/integrations.tsx` — two changes, both `handleConnectGoogle` and `handleConnectMicrosoft`:
  - Append `&returnUrl=${encodeURIComponent("thinkwork://settings/integrations")}` to the authorize URL.
  - Replace `WebBrowser.openBrowserAsync(url)` with `WebBrowser.openAuthSessionAsync(url, "thinkwork://settings/integrations")` — matches the existing MCP pattern at `mcp-server-detail.tsx:106` and `mcp-servers.tsx:97`.
  - **Do not** pass `preferEphemeralSession:true` (per memory `feedback_mobile_oauth_ephemeral_session`).
  - In PR #2 (Unit 7), these `thinkwork://settings/integrations` references swap to `thinkwork://settings/credentials`.

**Approach:**
- `oauth-authorize.ts:140` already stores `return_url` into the state record via `...(returnUrl ? { return_url: returnUrl } : {})`. The callback's job is just to read it back.
- Add a small HTML interstitial for `thinkwork://...` redirects — some browsers refuse to navigate directly from `https://` to `thinkwork://` via HTTP 302. A minimal `<meta http-equiv="refresh" content="0;url=thinkwork://...">` page handles both Safari iOS and Chrome Android reliably.

**Patterns to follow:**
- `apps/mobile/app/settings/mcp-server-detail.tsx:106` — the exact `openAuthSessionAsync` + custom-scheme shape already in use for MCP OAuth.
- Existing `thinkwork://` schemes registered in `apps/mobile/ios/Thinkwork/Info.plist:28` (`CFBundleURLSchemes`). No new scheme registration needed.

**Test scenarios:**
- Happy path: mobile Connect → consent → in-app browser closes automatically → app receives the deep link. No manual app-reopen.
- Edge case: user taps the close button mid-consent — `openAuthSessionAsync` resolves with `{type: "cancel"}`; tile stays on "Available"; no error logged.
- Edge case: consent denied at Google — callback fires with `error=access_denied`; mobile receives `thinkwork://settings/integrations?status=error&reason=access_denied`; surfaces a toast.
- Edge case: web (admin) OAuth with no `returnUrl` param — callback falls through to `REDIRECT_SUCCESS_URL` env default. Unchanged behavior for admin.
- Edge case: state lookup fails — callback can't read `return_url`; must fall back to env var. Verified explicitly.

**Verification:**
- Trigger Google OAuth from iOS simulator — after consent, the browser session closes automatically and the Credentials screen (or integrations, in PR #1) shows the tile in "Connected" state within ~1 second.
- Trigger Microsoft OAuth from iOS simulator — same behavior.
- `grep -n 'REDIRECT_SUCCESS_URL' packages/api/src/handlers/oauth-callback.ts` shows the env var is now only a fallback, not the unconditional target.

---

- [ ] **Unit 7 (PR #2): Mobile Credentials Locker screen**

**Goal:** Replace two nav entries (Integrations, MCP Servers) with one (Credentials) that renders both concerns on one screen.

**Ships as a separate PR after PR #1 (Units 1–6, 6b, 8) merges and is validated in dev.** Reason: different risk profile (mobile UX change vs. infra + backend); bundling multiplies blast radius; OAuth working with the old two-screen nav is strictly better than both PRs stalled together.

**Requirements:** user-facing UX consolidation.

**Dependencies:** PR #1 merged and verified; no backend change.

**Files:**
- Create: `apps/mobile/app/settings/credentials.tsx` — new parent screen. Sections: "Built-in Integrations" (delegates to the existing integrations-screen rendering logic) + "MCP Servers" (delegates to the existing mcp-servers-screen rendering logic). Both data hooks coexist on one screen.
- Modify: `apps/mobile/app/_layout.tsx` — add `<Stack.Screen name="settings/credentials" />` and remove `<Stack.Screen name="settings/integrations" />`. Note: `settings/mcp-servers` is **not** currently registered in `_layout.tsx` (Expo Router picks it up via file-based routing), so there is no removal step for it — once the file is deleted, the route is gone.
- Delete: `apps/mobile/app/settings/integrations.tsx`. Move its rendering logic into a shared component under `apps/mobile/components/credentials/IntegrationsSection.tsx`.
- Delete: `apps/mobile/app/settings/mcp-servers.tsx`. Move its rendering logic into `apps/mobile/components/credentials/McpServersSection.tsx`.
- Modify: `apps/mobile/app/(tabs)/index.tsx` (or wherever the kebab menu is) — replace the two entries "Integrations" + "MCP Servers" with one entry "Credentials" → `/settings/credentials`. Drop the `Plug` + `Cable` (or whichever) lucide-react-native icons if they become unused.
- Modify: any call-sites that `router.push("/settings/integrations")` or `router.push("/settings/mcp-servers")` — retarget to `/settings/credentials`. Verified via grep: only `apps/mobile/app/settings/integration-detail.tsx:79` has a `router.replace("/settings/connectors")` (already planned for retarget). `mcp-server-detail.tsx` imports `useRouter` but has no `router.push/replace` call-sites — no retarget needed there. A grep sweep for the two settings paths across `apps/mobile/` remains required during implementation in case of other call-sites (help text, deep links, onboarding flows).

**Approach:**
- Create the component-extraction PRs as part of this work. Shared components live under `apps/mobile/components/credentials/` so the screen file stays short (layout + section composition).
- Parent screen title: "Credentials". Optional subtitle/intro: "Authorize ThinkWork to act on your accounts and connect to external MCP servers."
- Sections render as a vertical stack: Built-in Integrations first (more common), MCP Servers second. Each section has a sticky header so the section boundary stays visible on scroll.
- Each section's internal UX (tile Pressable + connect button + connected state) stays identical — this is a nav/layout consolidation, not an interaction redesign.

**Patterns to follow:**
- `apps/mobile/app/settings/integrations.tsx:211-248` for the tile-rendering pattern (keeps identical after extraction).
- `apps/mobile/app/settings/mcp-servers.tsx` full file for the MCP Servers rendering.
- `DetailLayout` wrapper from `@/components/layout/detail-layout` for the parent screen chrome.

**Test scenarios:**
- Happy path: open the kebab menu → one entry "Credentials" instead of two. Tapping it lands on `/settings/credentials` with both sections visible.
- Happy path: tapping "Connect" on Google Workspace tile launches OAuth (Unit 4 + 2 dependency); on success, tile moves from "Available" to "Connected" in the Built-in section — existing logic, unchanged.
- Happy path: tapping an MCP server row lands on `/settings/mcp-server-detail` — unchanged.
- Edge case: deep link `/settings/integrations` → Expo Router default "Unmatched Route" (accepted; mobile bookmarks are rare).
- Integration: mobile typecheck passes with zero imports of the deleted files.

**Verification:**
- `grep -r "settings/integrations\|settings/mcp-servers" apps/mobile/` returns zero matches for the **deleted** file paths (matches for `integration-detail` and `mcp-server-detail` are fine).
- Mobile typecheck passes.

---

- [ ] **Unit 8: End-to-end verification (PR #1 gate)**

**Goal:** Prove both OAuth flows work — including the harder paths (state CSRF, mobile deep-link return, both providers' refresh) — before asking for review.

**Requirements:** all prior PR #1 units complete (1, 2, 3, 4, 5, 6, 6b).

**Dependencies:** Units 1–6b.

**Files:**
- No code changes; this is a gate.

**Approach:**
- **Smoke test 1 (Google end-to-end):** iOS simulator → Settings → Integrations (still exists in PR #1) → Connect Google Workspace. Complete consent with Eric's account. Verify: (a) in-app browser closes automatically via `openAuthSessionAsync`, (b) app receives `thinkwork://settings/integrations?status=connected&provider=google_productivity` deep link, (c) `connections` row appears with `status='active'`, (d) credential row has a non-empty encrypted access token in Secrets Manager.
- **Smoke test 2 (Microsoft end-to-end):** Same, with Microsoft 365.
- **Smoke test 3a (Google refresh):** Force-expire the `expires_at` column on Eric's Google connection credential row (`UPDATE credentials SET expires_at = now() - interval '1 hour' WHERE connection_id = ...`). Invoke an agent using the `google-email` skill (e.g. via wakeup-processor or a mobile chat message). Confirm `oauth-token.ts` refresh path logs success and the refreshed token has a new `expires_at` ~1 hour in the future.
- **Smoke test 3b (Microsoft refresh, direct):** Since there's no `microsoft-email` skill shipped today, validate the Microsoft env-var plumbing directly: `curl -X POST https://login.microsoftonline.com/common/oauth2/v2.0/token -d "grant_type=refresh_token&refresh_token=$(...)&client_id=$(SM fetch)&client_secret=$(SM fetch)"` using the stored refresh_token and the credentials pulled from the new Secrets Manager secret. Confirm a 200 with a fresh `access_token`. This proves the Microsoft client creds are correctly scoped + landed.
- **Smoke test 4 (state CSRF):** Replay the OAuth callback URL with a tampered `state` param (e.g., flip one character): `curl 'https://.../api/oauth/callback?code=fakecode&state=tampered'`. Verify the handler returns a 302 to `${REDIRECT_SUCCESS_URL}?status=error&reason=invalid_state`, not a token exchange. Repeat with a missing `state` param → same behavior. Verify both for `google_productivity` and `microsoft_365` providers (by creating pending authorize rows for each first, then tampering each callback).
- **Smoke test 5 (abandonment):** Tap Connect, consent loads, tap close button mid-flow. `openAuthSessionAsync` resolves `{type: "cancel"}`. Tile stays on "Available". No stray connection row in DB (the pending row exists but `status='pending'`, not `'active'` — verify it expires or is cleaned up).
- **Smoke test 6 (consent denial):** Tap Connect, reach Google/Microsoft consent, click Deny. Callback fires with `error=access_denied`. App receives `thinkwork://settings/integrations?status=error&reason=access_denied`. Tile shows "Available" + a toast/error hint.
- **Regression check:** The existing Cognito federated "Sign in with Google" flow (separate code path) still works from admin + mobile. If this breaks, the diagnosis in the Problem Frame was wrong and we need to pause.
- **Infra check:** `aws lambda get-function-configuration --function-name thinkwork-dev-api-oauth-authorize --query 'Environment.Variables' | jq 'keys[]'` shows `GOOGLE_PRODUCTIVITY_OAUTH_SECRET_ARN`, `MICROSOFT_OAUTH_SECRET_ARN`, `OAUTH_CALLBACK_URL`, `REDIRECT_SUCCESS_URL`. `aws iam simulate-principal-policy` confirms only the 4 consumer Lambdas can `GetSecretValue` on the new secrets.

**Patterns to follow:**
- `feedback_verify_wire_format_empirically` — `curl` the live callback URL with a stale code value and confirm the error message is the new improved one from Unit 6.

**Test scenarios:**
- Each smoke test above is a named scenario with a specific pass/fail criterion. Do not declare PR #1 done without all 7 passing.

**Verification:**
- Both tiles show "Connected" state after smoke tests 1 + 2.
- DB: `SELECT provider_id, status FROM connections WHERE user_id = '<Eric's user id>'` returns two active rows.
- Lambda CloudWatch logs for `oauth-callback` show successful token exchanges for happy paths, invalid-state rejections for CSRF tests.
- No IAM-policy surprises: `simulate-principal-policy` on non-consumer Lambdas returns `implicitDeny` for the new secret ARNs.

## System-Wide Impact

- **Interaction graph (PR #1):** Mobile Integrations screen → `openAuthSessionAsync(url, "thinkwork://settings/integrations")` → `GET /api/oauth/authorize?provider=X&returnUrl=thinkwork://...` (state row stores return_url) → 302 to provider → provider redirect to `/api/oauth/callback` → Lambda fetches client creds from Secrets Manager (cached per warm container) → token exchange → credentials stored → redirect to the `return_url` read from the state row (mobile custom scheme) or `REDIRECT_SUCCESS_URL` fallback (web). Four new Lambda env vars in `common_env`, two new Secrets Manager secrets, IAM policy scoped to 4 consumer Lambdas.
- **Error propagation:** Four user-visible error paths improved (Units 6 + 6b). State-mismatch now explicitly tested (Unit 8 smoke test 4). Consent-deny now surfaces as a mobile toast instead of a silent no-op.
- **State lifecycle risks:** Low. New `connect_providers` rows have `is_available = true` by default — visible to all tenants immediately after insert. The Secrets Manager secrets are tenant-agnostic (single app registration per provider per stage) which matches the single-OAuth-client deployment posture.
- **API surface parity:** None changed.
- **Integration coverage:** Google and Microsoft per-user OAuth move from "broken" to "working." Cognito Google federated sign-in stays working (different code path). LastMile MCP-server OAuth stays working (different code path).
- **Unchanged invariants:** The `connect_providers` `name` column still holds `google_productivity` and `microsoft_365`. All existing code that branches on these values (5 handler files) keeps working. No schema DDL. No migration.
- **Security posture:** Client secrets are no longer readable from process.env of 43 unrelated Lambdas. Only 4 specific handlers can fetch them, via explicit IAM. Rotation is now a 2-step operation (update Azure/Google console + `aws_secretsmanager_secret_version` terraform replace) instead of a tfvars edit + full lambda-api apply.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Azure app registration fails or redirect URI mismatches on first attempt | Unit 1 walks Eric through the exact steps; Unit 8's smoke tests 1 + 2 surface redirect mismatch as a clear failure. API Gateway ID fetched up front (Unit 1 step 3). |
| `terraform apply` modifies all 43 Lambda functions on one shot (env var additions), risking a broad blast radius if one Lambda update fails mid-apply | Narrowed by Secrets Manager decision: only 4 env vars are added to `common_env` (3 non-secret ARN/URL strings + 1 fallback URL), none of them sensitive. Terraform applies Lambda config changes in parallel; failures are per-function and recoverable. |
| Secrets Manager lookup adds cold-start latency to 4 Lambdas | ~20ms single round-trip on first invocation per warm container; cache hits on subsequent calls. Oauth-authorize is user-triggered (not latency-sensitive), and wakeup/chat-agent-invoke already pay comparable DB-connect latency. |
| Code change to `oauth-callback.ts` for return_url handling could break existing callback paths | Refactor preserves the `REDIRECT_SUCCESS_URL` fallback for requests without `return_url` (admin web). Unit 8 includes an explicit smoke-test for both paths. |
| `OAUTH_CALLBACK_URL` as computed from API Gateway ID differs between terraform runs, invalidating the registered Azure redirect URI | The API Gateway ID is stable once created (the `aws_apigatewayv2_api.main` resource). Unit 1's redirect URI is registered against the current value; if it ever changes (Gateway recreation), both Google and Microsoft app registrations need updating. This is pre-existing risk, not a regression. |
| Microsoft refresh tokens don't roll cleanly if `offline_access` scope isn't granted at consent time | Unit 4's config includes `offline_access` in the scopes; oauth-authorize.ts:107-110 already auto-appends it if missing. Verified path. |
| Deleting `/settings/integrations` and `/settings/mcp-servers` routes breaks a rarely-used deep link | Accepted (Key Technical Decisions). Mobile's default 404 is acceptable. |
| Running the Unit 4 INSERT against the wrong DB | `psql` prompt shows hostname; operator verifies `SELECT current_database(), inet_server_addr()` before running. Plan uses fully-qualified hostname string in the command to reduce ambiguity. |
| tfvars secrets leak if accidentally committed | `.gitignore` already covers `terraform.tfvars` (verified by it not being in `git status`). Plan only modifies `.tfvars.example` (safe to commit) and the non-committed `terraform.tfvars`. |
| Uncommitted work in the main checkout collides with this PR | Execute in `.claude/worktrees/fix-oauth-credentials-locker/` off `origin/main` per `feedback_worktree_isolation`. |

## Documentation / Operational Notes

- **No feature-flag / rollout coordination** — this is a pure unblocker; users currently see broken Connect buttons.
- **No customer communication needed** — dev-only stack; no external tenants.
- **Memory to update after merge:**
  - `project_google_oauth_setup` — add note that per-user Google OAuth (as distinct from Cognito federated sign-in) now works as of this PR.
  - New memory: `project_mobile_credentials_locker` — document the merged screen pattern so future work doesn't split it again.
  - New memory: `feedback_tfvars_to_lambda_env_chain` — when adding a new env var consumed by a Lambda handler, it must flow tfvars → greenfield/main.tf → thinkwork/main.tf → thinkwork/variables.tf → lambda-api/variables.tf → lambda-api/handlers.tf `common_env`. Miss any step and the Lambda runs without the var. This plan paid that cost; save the pattern.
  - New memory: `feedback_oauth_secrets_in_secrets_manager` — OAuth client_id/secret pairs belong in Secrets Manager (one secret per provider, JSON blob with client_id+client_secret), not Lambda env vars. Fetched at cold-start by a module-level cache in `packages/api/src/lib/oauth-client-credentials.ts`. IAM scope restricts reads to only the 4 handlers that need them. Don't revert to the common_env pattern for secrets — apply this shape for any future OAuth integrations (LastMile is still env-based as legacy; migrate opportunistically).
- **Tracked follow-ups (separate tasks, not blocking this PR):**
  - **Prod Azure app registration + SSM-migrated secrets.** Prod deployment is a separate plan with its own Azure tenant registration.
  - **Microsoft `pre-signup` Lambda parity** with the existing Google pre-signup gap.
  - **Admin web app Credentials screen unification** (optional; admin currently has a different credential surface).
  - **`scripts/seed-dev.sql` broader audit.** This PR fixes the providers block; other sections (model catalog) look OK but weren't independently verified. Worth a `ce:compound` learning after this PR about verifying seeds against schema at write time.
  - **Azure App Registration redirect URI portability.** If/when a new dev environment spins up with a different API Gateway ID, Azure + Google redirect URIs both need updating. Document the refresh procedure.

## Sources & References

- **Diagnosis trace (this session):**
  - `packages/api/src/handlers/oauth-authorize.ts:57` (name lookup), `:60` (error), `:23-28, 70-76` (env var branching)
  - `packages/api/src/handlers/oauth-callback.ts:114-123, 243-264` (secret env var branching)
  - `packages/api/src/lib/oauth-token.ts:234-240, 337-349` (refresh path)
  - `packages/database-pg/src/schema/integrations.ts:21-37` (actual schema)
  - `terraform/modules/app/lambda-api/handlers.tf:14-55, 150-156` (common_env)
  - `terraform/modules/foundation/cognito/main.tf:175-194` (Cognito path for google_oauth — separate flow)
  - `aws lambda get-function-configuration thinkwork-dev-api-oauth-authorize` (no OAuth env vars)
  - `aws rds describe-db-instances thinkwork-dev-db-1` (cluster endpoint + publicly accessible)
  - `aws secretsmanager list-secrets` (confirmed `thinkwork-dev-db-credentials` exists)
  - `scripts/seed-dev.sql:15-19` (broken seed)
- **Memory consulted:** `project_google_oauth_setup`, `project_tfvars_secrets_hygiene`, `feedback_user_opt_in_over_admin_config`, `feedback_worktree_isolation`, `feedback_pnpm_in_workspace`, `feedback_pr_target_main`, `feedback_verify_wire_format_empirically`.
- **Related shelved brainstorm:** `docs/brainstorms/2026-04-21-bundled-cli-skills-gogcli-google-workspace-requirements.md` — decision was "stay put" on the skill implementation; this plan only fixes the credential wiring around the existing skills.

---
title: Microsoft Teams Install Runbook
description: "Operator runbook for the ThinkWork Microsoft Teams application: Entra/Bot provisioning, app package build, tenant install, account linking, health checks, uninstall, and credential rotation."
---

This runbook covers the THINK-84 U6 install path for the ThinkWork Microsoft Teams app. The messaging (activities) handler ships in U7; U6 ships the install/link endpoints and this packaging path.

## Ownership model

**ThinkWork owns all Azure-side resources.** There is exactly one Entra application registration and one Azure Bot per stage, both in ThinkWork's Azure tenant. Customers never create Azure resources and never supply bot secrets.

- **Entra app registration** — multitenant audience (`AzureADMultipleOrgs` / "Accounts in any organizational directory"), so customer tenants can consent to it.
- **Azure Bot resource** — registered against the Entra app id, with the **Microsoft Teams channel** enabled and messaging endpoint `https://<api>/msteams/activities` (handler ships in U7; the endpoint URL is fixed now so the bot resource never needs to change).
- **Credentials** — client secret (or federated credential, preferred where supported) stored in Secrets Manager under `thinkwork/<stage>/msteams/app` with fields:
  - `app_id` — the Entra application (bot) id
  - `client_secret` — the app client secret (omit if using a federated credential)
  - `tenant_allowlist` — optional; comma-separated Entra tenant ids permitted to complete install

**Endpoints by unit:**

| Endpoint                              | Ships in |
| ------------------------------------- | -------- |
| `POST /msteams/install/start`         | U6       |
| `POST /msteams/install/complete`      | U6       |
| `POST /msteams/account-link/complete` | U6       |
| `POST /msteams/activities`            | U7       |

**The customer admin does only two things:** consent (when their tenant policy requires it) and upload the app package zip to their tenant app catalog (or install from a link).

## Consent: what a pure bot actually needs

The ThinkWork Teams app is a pure bot — it receives @mentions and direct messages and replies in the same conversation. It requests **no Microsoft Graph application permissions, no message-history access, and no resource-specific consent (RSC) permissions**; the manifest's `authorization.permissions.resourceSpecific` section is intentionally absent. Bot scopes (`personal`, `team`, `groupChat`) alone cover receiving messages addressed to the bot.

Consequences:

- In most tenants, **installing the app is itself sufficient consent** — a team owner adding the app to a team, or a user adding it personally, grants everything the bot needs. No admin-consent grant is required for the bot to function.
- Some tenants enforce admin consent for any third-party app sign-in. For those, the customer's Entra admin uses the standard admin-consent URL:

  ```text
  https://login.microsoftonline.com/{entraTenantId}/adminconsent?client_id={appId}
  ```

  where `{entraTenantId}` is the customer's Entra tenant id and `{appId}` is the ThinkWork bot app id. The `/msteams/install/start` response includes this URL pre-filled.

## Step-by-step install

### 1. Operator: create the Entra app + Azure Bot (once per stage)

Reference `az` CLI commands (run in ThinkWork's Azure tenant; portal equivalents are fine):

```bash
# Multitenant Entra app registration
az ad app create \
  --display-name "ThinkWork Teams Bot (dev)" \
  --sign-in-audience AzureADMultipleOrgs
# note the appId from the output

# Client secret (skip if using a federated credential)
az ad app credential reset --id <appId> --append --display-name "dev-2026-07" --years 1

# Azure Bot resource bound to the app id
az bot create \
  --resource-group thinkwork-dev \
  --name thinkwork-teams-dev \
  --app-type MultiTenant \
  --appid <appId> \
  --endpoint "https://<api-base-domain>/msteams/activities"

# Enable the Teams channel
az bot msteams create --resource-group thinkwork-dev --name thinkwork-teams-dev
```

### 2. Operator: store the credentials secret

```bash
aws secretsmanager create-secret \
  --name thinkwork/<stage>/msteams/app \
  --secret-string '{"app_id":"<appId>","client_secret":"<secret>","tenant_allowlist":""}'
```

Leave `tenant_allowlist` empty to allow any tenant to _start_ an install; completion is still gated by the signed state (step 6).

### 3. Operator: build the app package

```bash
npx tsx packages/api/scripts/create-msteams-app.ts \
  --stage dev \
  --bot-app-id <appId> \
  --api-domain <api-base-domain>
```

This substitutes the manifest placeholders, validates (no leaked `${...}` placeholders, UUID bot id, exact `validDomains`, icon dimensions), and writes `dist/msteams/thinkwork-teams-<stage>.zip` containing exactly `manifest.json`, `color.png`, `outline.png`. Flags fall back to `STAGE`, `MSTEAMS_BOT_APP_ID`, and `API_BASE_DOMAIN` env vars.

### 4. Operator: start the install from ThinkWork

Call `POST /msteams/install/start` for the target ThinkWork tenant. It returns:

- a **signed, expiring state token** (single-use nonce) identifying the ThinkWork tenant the install will bind to, and
- the pre-filled **admin-consent URL** for tenants whose policy requires it.

Hand the state token's completion link and the zip (or install link) to the customer admin.

### 5. Customer admin: consent + upload the package

- If the tenant requires admin consent, visit the admin-consent URL from step 4 and accept.
- Upload `thinkwork-teams-<stage>.zip` to the tenant app catalog (Teams admin center → Teams apps → Manage apps → Upload new app), or install from the provided link. Team owners/users then add the app to teams, group chats, or personally.

### 6. Install completion: tenant binding

`POST /msteams/install/complete` (invoked with the signed state from step 4 plus the customer's Entra tenant id) binds the Entra tenant to the ThinkWork tenant.

- **Idempotent** — completing the same binding again succeeds without side effects.
- **Fails closed on cross-tenant conflict** — if the Entra tenant is already bound to a _different_ ThinkWork tenant, or the state token was issued for a different ThinkWork tenant, completion is rejected. No silent rebinding.
- The state nonce is **single-use**; replays are rejected.

### 7. Users: account linking

Individual Teams users link their Teams identity to their ThinkWork identity via **expiring signed account-link tokens** completed at `POST /msteams/account-link/complete`. Identity is **never inferred from email address** — an unlinked user is simply unlinked until they complete a link token, even if their Teams email matches a ThinkWork user.

### 8. Health / status check

Verify a stage's Teams integration without touching secret material:

- Confirm the secret **exists** (not its value): `aws secretsmanager describe-secret --secret-id thinkwork/<stage>/msteams/app`
- Confirm the Azure Bot's messaging endpoint matches `https://<api>/msteams/activities`: `az bot show -g <rg> -n <bot> --query properties.endpoint`
- Confirm tenant bindings via the operator surface (binding rows list Entra tenant id ↔ ThinkWork tenant, timestamps, and status — no tokens).
- After U7 lands, an @mention round-trip in a test team is the end-to-end check.

### 9. Uninstall / revoke + cleanup

Customer side: remove the app from the tenant app catalog (blocks new installs and removes it from clients) and, to fully revoke, delete the enterprise application (service principal) for the ThinkWork app id in their Entra tenant — this revokes all consent.

ThinkWork side: remove the tenant binding for that Entra tenant (operator action). After unbinding:

- inbound activities from that Entra tenant are rejected (no binding → no requester resolution),
- outstanding account links for that binding are invalidated,
- signed state / account-link tokens for the binding stop validating.

Re-install later is a fresh step 4–7 flow; the idempotent completion makes accidental double-cleanup harmless.

### 10. Credential rotation

- **Prefer federated credentials or certificates** over client secrets where the bot channel supports them — nothing long-lived to leak.
- For client secrets: create the **new** secret in Entra first (`az ad app credential reset --append`), update `thinkwork/<stage>/msteams/app` in Secrets Manager, verify token acquisition, **then** delete the old Entra secret. Entra allows multiple active secrets, so rotate with overlap — never delete-then-create.
- After deleting the old credential, confirm it is revoked (token requests with the old secret fail).
- Rotation does not touch tenant bindings or the app package; the manifest contains only the app id, not credentials.

## Security invariants

- **Bot identity never becomes a requester.** Activities are attributed to a linked ThinkWork user or rejected; the bot's own service identity carries no ThinkWork permissions.
- **No customer Azure resources, no customer-provided bot secrets.** All Azure-side resources and credentials are ThinkWork-owned; customers only consent and install.
- **Minimum permissions.** No Graph application permissions, no message history, no RSC permissions — bot scopes only. `validDomains` contains only the API base domain (no wildcards).
- **Nonces are single-use.** Install state and account-link tokens are signed, expiring, and rejected on replay.
- **Wrong-tenant completion is rejected.** Install completion fails closed when the Entra tenant or ThinkWork tenant does not match the signed state; existing bindings are never silently overwritten.
- **Account linking is explicit.** Signed link tokens only — never email inference.
- **Logs redact secrets.** Tokens, signed state, client secrets, and Teams profile data never appear in logs; health checks operate on metadata only.

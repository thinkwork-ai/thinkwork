---
title: "feat: Use WorkOS as primary auth with Cognito token bridge"
owner: "Codex"
status: "draft"
linear: THNK-43
created: "2026-06-19"
supersedes: "docs/plans/2026-06-18-001-feat-workos-auth-plugin-plan.md"
---

# feat: Use WorkOS as primary auth with Cognito token bridge

## Why the prior plan is unsafe

The original THNK-43 plan made Cognito Hosted UI the browser front door and
WorkOS an upstream OIDC identity provider. Live U1 validation proved that shape
can produce Cognito tokens, but it cannot satisfy secure logout/account
switching:

- After ThinkWork logout, the next SSO attempt can land on WorkOS/AuthKit's
  application-authorization page already signed in as the previous user.
- Clicking Allow access returns to Cognito as that same WorkOS user without a
  Google/Microsoft account picker.
- WorkOS documents sign-out as: read the `sid` claim from the WorkOS access
  token, clear the app session, then redirect to the WorkOS logout URL for that
  `sid`.
- In the Cognito Hosted UI federation path, Cognito exchanges the upstream
  WorkOS code and hides the WorkOS access token from ThinkWork, so ThinkWork
  cannot reliably call WorkOS' real browser-session logout.

The fail-closed callback guard in PR #2667 is useful defense-in-depth because it
prevents accepting a stale WorkOS callback. It is not enough for product UX or
security because the user is still shown the stale WorkOS consent screen.

## Target architecture

When the WorkOS Auth plugin is installed and configured, WorkOS becomes the
primary browser authentication authority for the web/desktop sign-in flow.
ThinkWork initiates WorkOS directly, owns the WorkOS callback, captures the
WorkOS session id, and only then bridges the authenticated user into the
existing Cognito-token contract.

The preferred bridge is Cognito custom authentication, not Cognito Hosted UI
federation:

1. Web/desktop requests a server-generated WorkOS authorization URL.
2. Browser redirects directly to WorkOS/AuthKit, with provider/account-picker
   hints applied at the WorkOS layer instead of hoping Cognito forwards them.
3. WorkOS redirects to a ThinkWork API callback.
4. The API exchanges the WorkOS code, validates the WorkOS identity, extracts
   and stores the WorkOS `sid`, resolves or provisions the ThinkWork user and
   tenant membership, and starts a one-time Cognito custom-auth bridge.
5. Cognito custom-auth Lambda triggers verify the server-issued bridge
   challenge and issue normal Cognito ID/access/refresh tokens to the web app.
6. Logout clears local Cognito tokens, revokes the Cognito refresh token where
   possible, deletes ThinkWork's WorkOS session record, and redirects the
   browser to `workos.userManagement.getLogoutUrl({ sessionId: sid })`.

If custom-auth bridge validation proves Cognito cannot safely mint the required
tokens for existing users, the fallback is a larger API auth migration where
ThinkWork accepts WorkOS sessions/JWTs directly for web while preserving Cognito
for mobile/CLI until they are migrated. Do not ship a hosted Cognito -> WorkOS
upstream bridge as the logout solution.

## Implementation Units

### U1. WorkOS-primary auth spike and bridge decision

Goal: prove the exact Cognito custom-auth bridge or explicitly declare the
WorkOS-direct API-auth fallback.

Tasks:

- Add a private spike handler or script that exchanges a WorkOS authorization
  code directly with WorkOS and verifies the returned profile, access token,
  refresh token, and `sid` claim.
- Prototype Cognito custom authentication for a test user:
  `AdminInitiateAuth`/`AdminRespondToAuthChallenge` with `CUSTOM_AUTH`, backed
  by Define/Create/Verify auth challenge Lambda triggers.
- Confirm the resulting Cognito ID token has the existing required claims:
  `iss`, `aud`, `sub`, `email`, `email_verified`, `name`, `custom:tenant_id`
  when available, and a stable Cognito principal that resolves through
  `resolveCallerFromAuth`.
- Confirm logout can redirect through WorkOS' logout URL and that the next SSO
  attempt shows WorkOS/provider account choice rather than stale consent.

Exit criteria:

- A recorded browser proof on `localhost:5180`: SSO login -> app -> logout ->
  next SSO reaches WorkOS/provider login or Google account picker.
- A documented answer for whether custom-auth bridge is viable.
- No product rollout if custom auth cannot mint Cognito tokens safely.

### U2. Server-owned WorkOS auth endpoints

Goal: move WorkOS OAuth from Cognito Hosted UI to ThinkWork API.

Tasks:

- Add `GET /api/auth/workos/authorize` to create a WorkOS authorization URL,
  bind CSRF state, include the post-auth redirect, and optionally request a
  provider/account picker.
- Add `GET /api/auth/workos/callback` to validate state, exchange the WorkOS
  code, verify the WorkOS profile, persist a short-lived server bridge record,
  and redirect back to the web callback with a one-time bridge code.
- Store WorkOS client secrets only in runtime config or Secrets Manager.
- Publish public auth options that point WorkOS buttons to the new API
  authorize route, not Cognito `/oauth2/authorize`.

Verification:

- Unit tests for state binding, redirect allowlists, missing config, invalid
  WorkOS responses, and no secret exposure.
- Local browser proof that the WorkOS button leaves Cognito out of the first
  hop.

### U3. Cognito custom-auth bridge

Goal: preserve the existing Cognito-token contract after direct WorkOS auth.

Tasks:

- Add Cognito Define/Create/Verify auth challenge handlers.
- Add Terraform wiring for the custom-auth Lambda triggers and `ALLOW_CUSTOM_AUTH`
  on the web/mobile app clients that need the bridge.
- Add an API bridge endpoint that consumes the one-time WorkOS bridge record and
  completes the custom-auth flow server-side to obtain Cognito tokens.
- Store returned Cognito tokens in the existing web token storage path so
  GraphQL, `/api/auth/me`, and refresh behavior continue to work.
- Keep email linking gated on verified WorkOS email and stable WorkOS user id.

Verification:

- Unit tests for trigger state-machine success, replay rejection, expiry,
  wrong user, and missing tenant behavior.
- `packages/api` typecheck and targeted tests.
- `apps/web` auth tests proving the callback stores Cognito tokens only after a
  verified server bridge.

### U4. Correct logout

Goal: make logout end both ThinkWork and WorkOS browser sessions.

Tasks:

- Persist WorkOS `sid` server-side with the Cognito/ThinkWork user session
  mapping, with expiry aligned to WorkOS session lifetime.
- Update web/desktop logout to call a ThinkWork logout endpoint that returns a
  WorkOS logout URL when the current session came from WorkOS.
- Redirect the browser to the WorkOS logout URL, then back to `/sign-in`.
- Keep PR #2667's stale-callback guard as a final fail-closed safety net.

Verification:

- End-to-end browser proof on `localhost:5180`: login through WorkOS/Google,
  logout, click SSO again, and observe WorkOS/provider account selection instead
  of automatic reuse or stale authorization consent.
- Repeat with the same browser profile and no manual cookie clearing.

### U5. Tenant/user enforcement and rollout

Goal: ship only after identity and tenant mapping are auditable.

Tasks:

- Ensure the WorkOS identity maps to an existing active ThinkWork user or a
  plugin-approved provisioning path.
- Preserve no-workspace behavior for authenticated users without active
  tenant membership.
- Add structured audit logs for WorkOS user id, Cognito sub, ThinkWork user id,
  tenant id, and logout result, without logging tokens.
- Gate with plugin installation/configuration so Cognito-only deployments are
  unchanged.

Verification:

- WorkOS user with tenant membership lands in `/new`.
- WorkOS user without tenant membership gets the existing no-workspace state.
- Cognito email/password sign-in remains unchanged when the plugin is not
  installed.

## Risks

- Cognito custom auth is more complex than Hosted UI federation and requires
  trigger correctness to avoid minting tokens for an unverified identity.
- Existing mobile/CLI auth paths still assume Cognito. The WorkOS-primary path
  must preserve Cognito tokens until those clients are deliberately migrated.
- Refresh-token lifecycle must be explicit. WorkOS logout ends WorkOS browser
  session; Cognito refresh-token revocation must be handled separately where
  Cognito tokens were issued.
- Provider-specific account-picker behavior depends on WorkOS/AuthKit and the
  upstream provider. The accepted verification is browser evidence, not just URL
  construction.

## Rollout Notes

- Keep PR #2667 draft or merge only as a clearly labeled fail-closed interim
  after product approval. It is not the final logout solution.
- Roll out WorkOS-primary auth behind the WorkOS Auth plugin publication state.
- Start with dev/staging and `localhost:5180` callback URLs before changing
  production web/desktop.
- Preserve the existing Cognito Hosted UI Google path until WorkOS-primary is
  verified end to end.

## End-to-End Verification Contract

Verification must include a screen-recorded or screenshot-backed browser pass:

1. Open `http://localhost:5180/sign-in?next=/new`.
2. Confirm WorkOS SSO control appears only when the WorkOS Auth plugin is
   installed/configured.
3. Click SSO and authenticate through WorkOS/Google.
4. Confirm ThinkWork reaches `/new` with the correct tenant.
5. Click logout.
6. Click SSO again in the same browser profile without clearing cookies.
7. Confirm the user is sent to WorkOS/provider login or Google account picker,
   not directly to stale WorkOS authorization consent for the previous user.
8. Authenticate as the same account and confirm successful return to `/new`.
9. Repeat with a different provider or account before enabling
   provider-specific labels.

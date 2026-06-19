---
title: WorkOS-primary Cognito custom-auth bridge spike
date: 2026-06-19
module: auth
problem_type: spike
component: workos-auth-plugin
severity: high
linear: THNK-43
tags:
  - workos
  - cognito
  - authkit
  - custom-auth
  - authentication
---

# WorkOS-primary Cognito Custom-Auth Bridge Spike

## Result

U1 replaces the prior Cognito Hosted UI -> WorkOS upstream-IdP assumption with a
WorkOS-primary browser flow and a Cognito custom-auth bridge candidate.

The bridge direction is viable enough for U2/U3 implementation:

- ThinkWork must initiate WorkOS/AuthKit directly and own the WorkOS callback.
- The callback must exchange the WorkOS authorization code itself so ThinkWork
  can validate the WorkOS profile and capture the WorkOS access-token `sid`.
- Logout must use the captured `sid` to redirect through WorkOS' logout endpoint.
- Cognito token compatibility should be preserved by a server-owned custom-auth
  bridge: after WorkOS verification, ThinkWork creates a one-time bridge
  challenge and completes Cognito `CUSTOM_AUTH` via
  `AdminInitiateAuth`/`AdminRespondToAuthChallenge`.

Do not continue the hosted Cognito federation path as the product logout fix.
It can produce Cognito tokens, but it cannot give ThinkWork the WorkOS `sid`
required for real WorkOS browser-session logout.

## Artifact Added

This spike adds a repeatable private harness:

- `packages/api/src/lib/workos-primary-auth-spike.ts`
- `packages/api/scripts/workos-primary-auth-spike.ts`
- `packages/api/src/lib/workos-primary-auth-spike.test.ts`

The harness can:

1. Build a direct WorkOS/AuthKit authorization URL with provider/account-picker
   hints.
2. Exchange a WorkOS authorization code directly through
   `/user_management/authenticate`.
3. Read the returned WorkOS user profile and refresh token.
4. Require the access-token `sid` that WorkOS logout needs.
5. Build the WorkOS logout URL from the captured `sid`.
6. Shape the Cognito custom-auth bridge calls for a verified WorkOS user.
7. Validate that the resulting Cognito ID token still carries the downstream
   ThinkWork claim contract.

## How to Run the Spike

Use a non-production WorkOS application and a non-production Cognito user pool.
Do not commit the values below.

```bash
pnpm --dir packages/api exec tsx scripts/workos-primary-auth-spike.ts \
  # with env:
  # WORKOS_CLIENT_ID=client_...
  # WORKOS_CLIENT_SECRET=...
  # WORKOS_REDIRECT_URI=http://localhost:5180/auth/workos/callback
```

Open the printed URL and authenticate. After WorkOS redirects back, rerun with:

```bash
WORKOS_CODE=<callback-code> \
pnpm --dir packages/api exec tsx scripts/workos-primary-auth-spike.ts
```

To run the Cognito custom-auth portion after U3 deploys trigger wiring:

```bash
RUN_COGNITO_CUSTOM_AUTH=1 \
COGNITO_USER_POOL_ID=us-east-1_... \
COGNITO_APP_CLIENT_ID=... \
COGNITO_USERNAME=<verified-user-email> \
COGNITO_BRIDGE_ANSWER=<one-time-bridge-answer> \
pnpm --dir packages/api exec tsx scripts/workos-primary-auth-spike.ts
```

## Custom-Auth Bridge Contract

The U3 implementation should turn this spike shape into product code:

1. WorkOS callback verifies the code and extracts:
   - WorkOS user id (`user.id`)
   - verified email
   - display name when present
   - WorkOS session id (`sid`)
2. API persists a short-lived one-time bridge record keyed by a random
   `bridge_id` and tied to the WorkOS user id/session id.
3. API starts Cognito `CUSTOM_AUTH` for the resolved Cognito username.
4. Define/Create/Verify auth challenge triggers validate the bridge record and
   answer. On success, Cognito issues normal ID/access/refresh tokens.
5. Web stores those Cognito tokens through the existing token-storage path.
6. Logout looks up the WorkOS `sid` for the active session and redirects through
   WorkOS logout before returning to `/sign-in`.

## Verification Status

Local verification added in this unit:

- WorkOS URL construction keeps Cognito out of the first browser hop.
- WorkOS token exchange requires an access token.
- WorkOS logout proof fails closed when the access token has no `sid`.
- Cognito custom-auth bridge inputs include the WorkOS user/session binding.
- Cognito output validation requires `iss`, `aud`, `sub`, verified email,
  `name`, and optional `custom:tenant_id`.

Live browser verification is intentionally deferred until U2/U3 create and
deploy the server-owned WorkOS endpoints and custom-auth triggers through the
normal merge/deploy pipeline. Running ad hoc Cognito trigger mutations to force
U1 live proof would violate the autopilot guardrail against manual deployment
or mutation outside the normal pipeline.

## Sources

- WorkOS AuthKit sessions and logout:
  <https://workos.com/docs/authkit/sessions>
- WorkOS AuthKit authorization URL:
  <https://workos.com/docs/reference/authkit/authentication/get-authorization-url>
- AWS Cognito custom authentication flow:
  <https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-challenge.html>
- AWS Cognito `AdminInitiateAuth`:
  <https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminInitiateAuth.html>
- Prior THNK-43 hosted bridge spike:
  `docs/solutions/spikes/2026-06-18-workos-cognito-oidc-compatibility.md`

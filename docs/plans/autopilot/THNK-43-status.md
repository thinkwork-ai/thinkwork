---
linear: THNK-43
title: WorkOS primary auth with Cognito token bridge
status: in-progress
updated: 2026-06-19
branch: codex/thnk-43-u5-tenant-rollout
---

# THNK-43 Autopilot Status

## Current Pass

- Dispatcher marker: `dispatcher:THNK-43:Implementation:Codex`
- Pass type: Autopilot implementation of
  `docs/plans/2026-06-19-001-feat-workos-primary-auth-bridge-plan.md`.
- Scope: U5, tenant/user enforcement, auditability, and rollout readiness.
- Branch: `codex/thnk-43-u5-tenant-rollout` from `origin/main`
  `039a748d1`.
- PR: pending local verification.
- CI: pending PR.

## Completed

### U1 WorkOS-primary spike

- Created and merged PR #2671:
  <https://github.com/thinkwork-ai/thinkwork/pull/2671>.
- Merge commit: `4daf4bcd52161ff953b5d6ce39bec98101ec163f`.
- Required checks passed before merge: CLA, lint, supply-chain verify, test,
  and typecheck.
- Deleted the remote feature branch and removed the U1 worktree after merge.
- Recorded PR-open and merged evidence in Linear.

### U2 Server-owned WorkOS auth endpoints

- Created and merged PR #2672:
  <https://github.com/thinkwork-ai/thinkwork/pull/2672>.
- Merge commit: `53691e2d1c80351bac09d52b4027513872cd3675`.
- Required checks passed before merge: CLA, lint, Migration Drift Precheck
  (dev), supply-chain verify, test, and typecheck.
- Remote migration drift precheck initially failed because the new
  hand-rolled `0174_workos_auth_bridges.sql` migration was not yet applied to
  dev.
- Applied only `packages/database-pg/drizzle/0174_workos_auth_bridges.sql` to
  dev, then verified
  `bash scripts/db-migrate-manual.sh packages/database-pg/drizzle/0174_workos_auth_bridges.sql`
  reported all declared objects present.
- Squash-merged, deleted the remote feature branch, removed the U2 worktree,
  and recorded PR-open and merged evidence in Linear.

### U3 Cognito custom-auth bridge

- Created and merged PR #2673:
  <https://github.com/thinkwork-ai/thinkwork/pull/2673>.
- Merge commit: `5ea2a83218fe98d8938dc08ab968b98e10a104ad`.
- Required checks passed before merge: CLA, lint, supply-chain verify, test,
  and typecheck.
- CI `test` initially failed because `workos-cognito-bridge.ts` read
  `process.env.COGNITO_USER_POOL_ID` and `process.env.ADMIN_CLIENT_ID`
  directly. Fixed by using `@thinkwork/runtime-config` and re-pushed.
- The branch was then rebased onto current `main`, force-pushed with lease,
  rechecked, squash-merged, and recorded in Linear.

### U4 Correct WorkOS logout

- Created and merged PR #2674:
  <https://github.com/thinkwork-ai/thinkwork/pull/2674>.
- Merge commit: `777142a107879c1007b3982121aa38d8faedfdb6`.
- Required PR checks passed before merge.
- Main deploy for commit `f5ccf3b44500afdfe755a8f48f571b4063adbd44`
  completed successfully after the API Gateway route-conflict recovery.
- Local verification server was started on `localhost:5180`; the sign-in page
  rendered the WorkOS SSO control for the installed plugin.
- Recorded merged/deployed/local-ready evidence in Linear.

### Prior hosted-bridge pass

- Read THNK-43 issue, Linear comments, Linear plan document, and Linear
  brainstorm document.
- Confirmed merged repo artifacts from PR #2644 are present on `main`.
- Moved THNK-43 from Ready to Work to In Progress when implementation began.
- Inspected the repo Cognito/OIDC substrate, auth clients, plugin guidance, and
  relevant docs.
- Performed read-only AWS discovery against the dev user pool and Secrets
  Manager.
- Added U1 spike artifact:
  `docs/solutions/spikes/2026-06-18-workos-cognito-oidc-compatibility.md`.
- Created a temporary WorkOS staging AuthKit/OIDC application and registered
  the dev Cognito `/oauth2/idpresponse` callback.
- Created dev Cognito OIDC IdP `WorkOSAuthU1` in user pool
  `us-east-1_L4DhLVKis` and attached it to `ThinkworkAdmin` and
  `ThinkworkMobile`.
- Completed a Google-backed WorkOS AuthKit sign-in through Cognito
  `ThinkworkAdmin`; the retry authorization code exchanged successfully at the
  Cognito token endpoint.

## U1 Result

### Prior hosted-bridge result

Live Google-backed Cognito token proof is complete for the single SSO fallback.

Evidence now shows:

- WorkOS issuer discovery works from the staging AuthKit domain and advertises
  Cognito-compatible `client_secret_post`, `RS256`, and OIDC endpoints.
- Dev Cognito user pool `thinkwork-dev-user-pool` now has OIDC IdP
  `WorkOSAuthU1`.
- `ThinkworkAdmin` and `ThinkworkMobile` app clients support `COGNITO`,
  `Google`, and `WorkOSAuthU1`.
- WorkOS rendered Google and Microsoft provider choices behind the single
  Cognito WorkOS IdP.
- Google sign-in first triggered the expected existing pre-signup linker retry,
  then returned a Cognito authorization code on the second hosted auth attempt.
- Cognito token exchange succeeded and Cognito remained the final issuer.

The spike records the safe implementation decision: ship a single WorkOS-backed
`Continue with SSO` fallback. Do not ship provider-specific Google/Microsoft
buttons yet.

## Remaining Constraint

The Google-backed final Cognito ID token included `identities` entries for the
existing native `Google` IdP and the WorkOS OIDC IdP, but it did not include
durable WorkOS organization, connection, credential, or selected-upstream
provider claims. A Microsoft pass was attempted, but WorkOS reused the active
Google session before a Microsoft account could be selected.

This is no longer a `Needs Credentials` blocker for the single SSO fallback.
It remains a product/claim-design constraint for provider-specific buttons and
U6 linking enforcement.

### Current WorkOS-primary pass

- Add a private spike harness for direct WorkOS authorization-code exchange,
  WorkOS `sid` extraction, WorkOS logout URL construction, Cognito custom-auth
  command shaping, and Cognito bridge claim validation.
- Add
  `docs/solutions/spikes/2026-06-19-workos-primary-cognito-custom-auth-spike.md`
  to record the bridge decision and the remaining live-proof dependency.
- Local verification:
  - `pnpm --dir packages/api test -- workos-primary-auth-spike.test.ts`
  - `pnpm --dir packages/api typecheck`
  - `git diff --check`
- Formatter note: `pnpm exec prettier --check ...` could not run locally
  because this workspace does not install a `prettier` binary.

### U1 WorkOS-Primary Decision

The correct implementation direction is WorkOS-primary browser auth plus a
Cognito custom-auth token bridge. The old Cognito Hosted UI -> WorkOS upstream
IdP route remains useful evidence but is not the logout solution because
ThinkWork cannot access the WorkOS access-token `sid` from that nested flow.

U1 live browser proof is deferred until U2/U3 land deployable server-owned
WorkOS endpoints and Cognito custom-auth trigger wiring through the normal
merge/deploy pipeline. Forcing a live proof in U1 would require ad hoc Cognito
trigger mutations outside the normal pipeline, which autopilot guardrails
forbid.

## U2 Completed Implementation

U2 replaced the unsafe nested Cognito Hosted UI first hop for WorkOS with
server-owned API endpoints:

- Added a `workos_auth_bridges` table and migration to persist only hashed
  one-time bridge codes plus short-lived WorkOS profile/session metadata.
- Added `GET /api/auth/workos/authorize` to create CSRF-bound WorkOS
  authorization redirects, enforce trusted API hosts, validate browser callback
  origins against same-host, localhost, or explicit metadata allowlists,
  normalize `return_to`, and request account selection.
- Added `GET /api/auth/workos/callback` to validate signed state, exchange the
  WorkOS authorization code, require verified email and WorkOS `sid`, store the
  short-lived bridge record, and redirect the browser back to the web callback
  with a one-time bridge code.
- Updated public auth options so the installed WorkOS provider publishes a
  `workosAuthorize` route instead of exposing a Cognito identity-provider name.
- Updated the web sign-in UI to send WorkOS SSO clicks to the API authorize
  endpoint with `redirect_uri`, `return_to`, and `prompt=select_account`.
- Wired the new API handler and routes into the Lambda API Terraform module.

Local verification:

- `pnpm --dir packages/api test -- workos-auth.test.ts public-auth-options.test.ts`
- `pnpm --dir apps/web test -- src/lib/auth-options.test.ts src/lib/auth.test.ts src/routes/-sign-in.test.tsx`
- `pnpm --dir packages/database-pg test -- migration-0174-workos-auth-bridges.test.ts`
- `pnpm --dir packages/api typecheck`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir packages/database-pg typecheck`
- `git diff --check`
- `terraform fmt -check terraform/modules/app/lambda-api/handlers.tf`

Remote CI recovery:

- `Migration Drift Precheck (dev)` initially failed on PR #2672 because
  `public.workos_auth_bridges`,
  `public.uq_workos_auth_bridges_code_digest`,
  `public.idx_workos_auth_bridges_tenant_status`, and
  `public.idx_workos_auth_bridges_reference` were missing in dev.
- Applied only
  `packages/database-pg/drizzle/0174_workos_auth_bridges.sql` to the dev
  database with `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ...`.
- Verified with
  `bash scripts/db-migrate-manual.sh packages/database-pg/drizzle/0174_workos_auth_bridges.sql`;
  all declared objects are now present.

## U3 Completed Implementation

U3 is preserving the existing Cognito-token contract after direct WorkOS auth:

- Add Cognito Define/Create/Verify auth challenge handlers backed by signed
  short-lived WorkOS bridge challenges.
- Add `POST /api/auth/workos/bridge` to consume a one-time WorkOS bridge code,
  resolve an existing tenant user by verified WorkOS email, and complete
  Cognito `CUSTOM_AUTH` server-side.
- Update the web callback so a `workos_bridge` callback stores returned
  Cognito tokens through the existing localStorage key layout.
- Wire the custom-auth trigger Lambda, Lambda build artifact, app-client
  `ALLOW_CUSTOM_AUTH`, API Gateway bridge route, and Cognito admin-auth IAM
  actions through Terraform.

Local verification:

- `pnpm install --store-dir .pnpm-store`
  - Initial plain `pnpm install` hit a broken global pnpm-store tarball entry
    for `nth-check`; isolated store install succeeded.
  - Node 25 caused the known optional `canvas` native build warning because
    `pkg-config` is unavailable, but pnpm exited successfully.
- `pnpm --dir packages/api test -- workos-cognito-bridge.test.ts workos-auth.test.ts`
  - 20 tests passed across bridge logic, WorkOS auth library, and handler.
- `pnpm --dir apps/web test -- src/lib/auth.test.ts src/routes/auth/callback.test.tsx`
- `pnpm --dir apps/web test -- src/components/SpacesSidebar.test.tsx src/lib/auth.test.ts src/routes/auth/callback.test.tsx`
  - 12 tests passed, including callback coverage proving `workos_bridge`
    stores returned Cognito tokens only after a successful server bridge
    exchange.
- `pnpm --dir packages/api typecheck`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/cli typecheck`
- `pnpm --dir apps/cli test -- terraform-enterprise-artifact-fixture.test.ts terraform-cognito-identity-provider-fixture.test.ts no-required-options.test.ts`
  - 10 tests passed across Terraform artifact, Cognito IdP, and init command
    fixture coverage.
- CI `test` initially failed on PR #2673 because
  `packages/api/src/lib/workos-cognito-bridge.ts` read
  `process.env.COGNITO_USER_POOL_ID` and `process.env.ADMIN_CLIENT_ID`
  directly, violating the runtime-config fixture guardrail. The fix was pushed,
  checks passed, and PR #2673 was merged.

## U4 Completed Implementation

U4 makes WorkOS-primary logout end the upstream WorkOS browser session instead
of only clearing ThinkWork's local Cognito tokens:

- Added `workos_auth_sessions` plus
  `workos_auth_bridges.workos_session_expires_at` in migration
  `0175_workos_auth_sessions.sql`.
- Captured the WorkOS `sid` and token expiry during the WorkOS callback without
  storing raw WorkOS access or refresh tokens.
- Recorded a durable WorkOS session after the server-side Cognito custom-auth
  exchange returns an ID token, keyed by Cognito `sub` and ThinkWork user.
- Added `POST /api/auth/workos/logout`, authenticated by Cognito ID token, to
  mark the latest active WorkOS session logged out and return the WorkOS
  session logout URL.
- Updated web WorkOS callback storage to mark WorkOS-sourced sessions and web
  logout to redirect through WorkOS logout before falling back to Cognito
  Hosted UI logout for non-WorkOS sessions.
- Added the API Gateway route wiring for `/api/auth/workos/logout`.

Local verification:

- `pnpm install --store-dir .pnpm-store`
  - Install succeeded. The optional `canvas` native build still emitted the
    known Node 25/pkg-config warning during postinstall, but pnpm exited 0.
- `pnpm --dir packages/database-pg test -- migration-0175-workos-auth-sessions.test.ts`
- `pnpm --dir packages/api test -- workos-cognito-bridge.test.ts workos-auth.test.ts`
- `pnpm --dir apps/web test -- src/lib/auth.test.ts src/routes/auth/callback.test.tsx`
- `pnpm --dir packages/api typecheck`
- `pnpm --dir packages/database-pg typecheck`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/cli typecheck`
- `pnpm --dir apps/cli test -- terraform-enterprise-artifact-fixture.test.ts terraform-cognito-identity-provider-fixture.test.ts no-required-options.test.ts`
- `terraform fmt -check terraform/modules/app/lambda-api/handlers.tf`
- `git diff --check`

Remote CI recovery:

- `Migration Drift Precheck (dev)` initially failed on PR #2674 because the
  new hand-rolled `0175_workos_auth_sessions.sql` migration was not yet
  applied to dev.
- Applied only `packages/database-pg/drizzle/0175_workos_auth_sessions.sql` to
  the dev database and verified the scoped drift reporter found all declared
  U4 objects present.
- CI `test` then failed because `SpacesSidebar.test.tsx` still expected an
  immediate TanStack Router navigation to `/sign-in` after logout. U4 moved
  redirect ownership into `auth.signOut()` so WorkOS-sourced sessions can
  leave the app through WorkOS logout. Updated the test to assert no local
  navigation races the sign-out redirect.
- Recovery: switched those reads to `getConfig(...)` from
  `@thinkwork/runtime-config`.
- Recovery verification:
  - `pnpm --dir apps/cli test -- terraform-runtime-config-fixture.test.ts`
  - `pnpm --dir packages/api test -- workos-cognito-bridge.test.ts workos-auth.test.ts`
  - `pnpm --dir packages/api typecheck`
- `terraform fmt -check` on touched Terraform files.
- `git diff --check`
- `bash scripts/build-lambdas.sh cognito-custom-auth`
- `bash scripts/build-lambdas.sh workos-auth`

## U5 Current Implementation

U5 is making the WorkOS-primary bridge auditable and preserving workspace
boundaries:

- The WorkOS bridge resolver now joins `tenant_members` and carries an explicit
  `hasActiveTenantMembership` signal for the mapped ThinkWork user.
- WorkOS bridge success emits `auth.signin.success` audit evidence with
  ThinkWork user id, tenant id, WorkOS user id, Cognito sub, auth-provider
  resource id, tenant auth-provider reference id, and tenant-membership state.
- Cognito custom-auth now handles the live AWS behavior where
  `CreateAuthChallenge` does not receive the WorkOS bridge metadata from
  `AdminInitiateAuth`; it creates a generic private challenge there and
  verifies the signed bridge metadata from `AdminRespondToAuthChallenge`.
- WorkOS bridge failures after a bridge record is consumed emit best-effort
  `auth.signin.failure` evidence without logging tokens or raw secrets.
- WorkOS logout now emits `auth.signout` audit evidence with ThinkWork user id,
  tenant id, WorkOS user id, Cognito sub, WorkOS session row id, auth-provider
  resource id, tenant auth-provider reference id, and logout result.
- `/api/auth/me` now treats missing or inactive `tenant_members` rows as the
  existing no-workspace response shape, even if the historical `users.tenant_id`
  column is set.
- Compliance redaction allowlists were expanded only for the WorkOS audit
  identifiers above; token and client-secret shaped fields are still dropped.

Local verification:

- `pnpm install --store-dir .pnpm-store`
  - Install succeeded. The optional `canvas` native build still emitted the
    known Node 25/pkg-config warning, but pnpm exited 0.
- `pnpm --dir packages/api test -- workos-cognito-bridge.test.ts workos-auth.test.ts lib/compliance/__tests__/redaction.test.ts`
  - 99 tests passed across WorkOS bridge, WorkOS auth handler, and compliance
    redaction.
  - After live local e2e exposed Cognito's missing initiate-auth metadata, this
    was rerun with 101 passing tests including the regression case.
- `pnpm --dir packages/api typecheck`
- `bash scripts/build-lambdas.sh cognito-custom-auth`
- `bash scripts/build-lambdas.sh workos-auth`
- `git diff --check`

Local WorkOS/dev configuration repair:

- `localhost:5180` was started from the U5 worktree using the copied local web
  env and confirmed with `curl -I`.
- Browser testing initially reached WorkOS `client-id-invalid`.
- Confirmed the dev API still redirected with the old WorkOS client id suffix
  `QA9640`, while the new ThinkWork WorkOS Staging app client id suffix is
  `EWA5PV`.
- Updated the dev `auth_provider_resources` row
  `d6be764b-f2d0-43a3-b793-c94527e0238d` to the new WorkOS client id and
  rotated the existing Secrets Manager value at the stored `client_secret_ref`
  to the new WorkOS API key.
- Browser/curl follow then reached `redirect-uri-invalid`, so the deployed dev
  API callback URI
  `https://ho7oyksms0.execute-api.us-east-1.amazonaws.com/api/auth/workos/callback`
  was added to the new WorkOS app redirect settings.
- Follow check now lands on the AuthKit app URL using client suffix `EWA5PV`
  with HTTP 200 instead of WorkOS error pages.
- Browser e2e then reached
  `http://localhost:5180/auth/callback?workos_bridge=...` but the web callback
  showed `WorkOS bridge exchange failed`.
- CloudWatch evidence from `/aws/lambda/thinkwork-dev-cognito-custom-auth`
  showed `missing WorkOS bridge challenge` in `CreateAuthChallenge`, and
  `/aws/lambda/thinkwork-dev-api-workos-auth` surfaced
  `CreateAuthChallenge failed with error missing WorkOS bridge challenge`.
- The dev database confirmed the WorkOS bridge rows were verified and consumed,
  and the ThinkWork user `eric@homecareintel.com` had an active owner
  `tenant_members` row. This ruled out WorkOS callback, bridge persistence, and
  no-workspace bootstrap as the cause.
- Localhost e2e is not ready to retry until the U5 branch is merged and the dev
  Lambda deploy has picked up the custom-auth regression fix.

## Next Action

Finish U5 verification, open the U5 PR, monitor/fix required CI, squash merge,
delete the branch/worktree, sync `origin/main`, and record completion in Linear.

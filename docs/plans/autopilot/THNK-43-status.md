---
linear: THNK-43
title: WorkOS primary auth with Cognito token bridge
status: in-progress
updated: 2026-06-19
branch: codex/thnk-43-u2-workos-auth-endpoints
---

# THNK-43 Autopilot Status

## Current Pass

- Dispatcher marker: `dispatcher:THNK-43:Implementation:Codex`
- Pass type: Autopilot implementation of
  `docs/plans/2026-06-19-001-feat-workos-primary-auth-bridge-plan.md`.
- Scope: U2 only, server-owned WorkOS auth endpoints and public/web routing
  away from Cognito Hosted UI for WorkOS SSO.
- Branch: `codex/thnk-43-u2-workos-auth-endpoints` from `origin/main`
  `4daf4bcd5`.
- PR: <https://github.com/thinkwork-ai/thinkwork/pull/2672>
- CI: local targeted verification passing; remote CI pending.

## Completed

### U1 WorkOS-primary spike

- Created and merged PR #2671:
  <https://github.com/thinkwork-ai/thinkwork/pull/2671>.
- Merge commit: `4daf4bcd52161ff953b5d6ce39bec98101ec163f`.
- Required checks passed before merge: CLA, lint, supply-chain verify, test,
  and typecheck.
- Deleted the remote feature branch and removed the U1 worktree after merge.
- Recorded PR-open and merged evidence in Linear.

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

## U2 Current Implementation

U2 is replacing the unsafe nested Cognito Hosted UI first hop for WorkOS with
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

## Next Action

Finish U2 self-review, open the U2 PR, monitor/fix required CI, squash merge,
delete the branch/worktree, sync `origin/main`, then continue automatically to
U3: Cognito bridge challenge exchange.

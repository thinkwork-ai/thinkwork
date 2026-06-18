---
linear: THNK-43
title: WorkOS Auth plugin upstream of Cognito
status: in-progress
updated: 2026-06-18
branch: codex/thnk-43-u1-google-proof
---

# THNK-43 Autopilot Status

## Current Pass

- Dispatcher marker: `dispatcher:THNK-43:Ready to Work:Codex`
- Pass type: U1 live-evidence recovery after a WorkOS staging account became
  available.
- Scope: U1 only, WorkOS-to-Cognito OIDC compatibility spike.
- Branch: `codex/thnk-43-u1-google-proof` from `origin/main`
  `d0de3991558c9df8e9c7c00aabda3460676d6361`.

## Completed

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

## Next Action

Land this evidence update through PR, then update Linear with the PR URL,
merged state, and U1 conclusion. Remove the `Needs Credentials` label only if
Linear still has it. Continue THNK-43 from U2/U3 only for the single
WorkOS-backed SSO fallback; keep provider-specific Google/Microsoft buttons out
of scope until claim mapping and clean Microsoft proof are complete.

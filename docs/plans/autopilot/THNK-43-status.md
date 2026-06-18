---
linear: THNK-43
title: WorkOS Auth plugin upstream of Cognito
status: blocked
updated: 2026-06-18
branch: codex/thnk-43-workos-u1
---

# THNK-43 Autopilot Status

## Current Pass

- Dispatcher marker: `dispatcher:THNK-43:Ready to Work:Codex`
- Pass type: fresh Ready-to-Work implementation, not failed Verification/Review
  rebound.
- Scope: U1 only, WorkOS-to-Cognito OIDC compatibility spike.
- Branch: `codex/thnk-43-workos-u1` from `origin/main`
  `d56c31a5d2af7419d4911ee6f0fb4fa9eb057537`.

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

## U1 Result

Blocked for live token proof.

Read-only evidence showed:

- Dev Cognito user pool `thinkwork-dev-user-pool` has only the existing
  `Google` IdP.
- `ThinkworkAdmin` and `ThinkworkMobile` app clients support `COGNITO` and
  `Google`, not a WorkOS IdP.
- No WorkOS-named Secrets Manager credential exists in the inspected account.
- Repo/local config contains no ready `workos` or `oidc_identity_providers`
  bridge configuration.

The spike records the safe interim decision: use a single WorkOS-backed
`Continue with SSO` fallback until a non-production WorkOS/Cognito bridge proves
provider-specific Google/Microsoft routing and final Cognito claim match.

## Blocker

U1 needs an approved non-production WorkOS OAuth application and Cognito test
target. Required inputs are listed in the spike doc. Clearing the blocker
requires either a pre-created bridge or explicit approval to create/update a
non-production Cognito OIDC IdP and WorkOS redirect configuration.

## Next Action

Land this artifact branch through PR, then mark THNK-43 with the most specific
blocker labels and a Linear comment. Do not advance to U2-U7 or Verification
until U1 live evidence is available.

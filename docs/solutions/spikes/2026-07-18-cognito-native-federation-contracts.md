---
module: authentication
date: 2026-07-18
last_updated: 2026-07-18
category: spikes
problem_type: architecture
component: cognito
severity: high
related_components:
  - terraform
  - api
  - appsync
  - web
  - mobile
  - cli
tags:
  - cognito
  - oidc
  - google
  - microsoft-entra
  - workos-removal
  - identity-linking
---

# Cognito-native federation contract characterization

## Purpose

This characterization freezes the authentication behavior that exists before
WorkOS is removed. It distinguishes observed behavior from the contracts that
still require a deployed route-specific fixture. No production resources were
changed while collecting this evidence, and identifiers and tokens are
intentionally omitted.

The target architecture retains three user-visible choices:

- Email and password in the Cognito user pool.
- Google through Cognito's native Google identity provider.
- Microsoft through direct Cognito OIDC providers: one `organizations` route
  and tenant-GUID routes for enforced enterprise connections.

All successful routes must finish with Cognito tokens. Clients and APIs must
not exchange or accept WorkOS tokens.

## Observed deployed baseline

Read-only inventory of the development stage on 2026-07-18 showed:

- One Cognito pool with about 18 users.
- Google and two legacy WorkOS identity providers.
- Four app clients. The main web and mobile clients both permit local Cognito
  and Google and both enable custom auth, password auth, SRP, and refresh.
- The web client currently uses 17 callback URLs and 9 logout URLs; mobile uses
  3 callbacks and 2 logout URLs.
- The pool invokes a pre-sign-up Lambda plus the legacy define/create/verify
  custom-auth triggers.
- The subscription API defaults to API-key authentication with IAM and Cognito
  as additional modes.
- A redacted cached Google-federated ID token demonstrated that an ID token's
  app-client provenance is in `aud` and that Cognito emits an `identities`
  entry naming Google. The token was expired, so it is not evidence for a live
  connection or refresh.

An AppSync WebSocket connection made with that expired token opened at the
transport layer and returned `connection_error`. That result proves neither
successful Cognito authorization nor subscription-start/invalidation behavior.

## Unsafe current contracts frozen by tests

The tests added with this spike deliberately describe existing behavior; they
are not endorsements of it:

1. The pre-sign-up trigger links on email without requiring the external
   provider's `email_verified` claim.
2. When no native user matches, it creates a Cognito user, assigns a generated
   permanent password, and links the external identity to that user.
3. Unknown provider prefixes are passed to Cognito rather than being checked
   against a provider registry.
4. The GraphQL caller resolver returns an email-matched database user even if
   that row already belongs to a different Cognito subject.
5. `/api/auth/me` resolves an account and membership by email without checking
   the authenticated Cognito subject.
6. Terraform gives both primary clients the same provider set and the same
   broad local/custom authentication flows.

These contracts identify the takeover and least-privilege boundaries that the
admission phase must replace. In particular, verified email may be evidence
used inside an explicit enrollment or recovery flow, but it must not silently
rebind an established subject during ordinary authentication.

## Read-only harness

`packages/api/scripts/cognito-native-federation-spike.ts` provides two offline
checks:

- A route manifest capacity check. The manifest supplies explicit service
  limits, reserve headroom, clients, callbacks, logout URLs, provider
  allowlists, and auth-flow allowlists. Keeping limits in the input avoids
  hard-coding service quotas that may change or be raised per account.
- A redacted token summary. The JWT is read from a named environment variable,
  is decoded locally, and only emits token use, app-client provenance, issuer,
  claim presence, provider names, and expiration state. It never emits the raw
  token, subject, or email.

Example:

```bash
pnpm --filter @thinkwork/api exec tsx \
  scripts/cognito-native-federation-spike.ts --manifest /tmp/routes.json

TOKEN_VALUE='…' pnpm --filter @thinkwork/api exec tsx \
  scripts/cognito-native-federation-spike.ts --token-env TOKEN_VALUE
```

Do not commit route manifests containing secrets or raw tokens.

## Required deployed fixture evidence

The following remain explicit gates. They must be recorded from unpublished
route-specific fixtures before cutover; they must not be inferred from the
shared development clients:

| Contract                | Required evidence                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local email/password    | Local-only client accepts password/SRP as designed, rejects every external provider, and refresh preserves its client provenance.                                        |
| Google                  | Google-only hosted-UI route rejects local and Microsoft initiation, returns Cognito tokens with the Google identity, and refresh stays on the same client.               |
| Microsoft organizations | Organizations-only route accepts eligible work/school accounts, rejects personal Microsoft accounts, returns Cognito tokens, and preserves client provenance on refresh. |
| Tenant Entra            | Tenant-GUID route accepts only the configured tenant and rejects another tenant through both direct initiation and callback handling.                                    |
| API admission           | Each route is admitted only for the intended app-client/provider pair; stale, mismatched, unverified, and conflicting identities fail closed.                            |
| Realtime                | A fresh Cognito token completes AppSync WebSocket connect, subscription start, authorized delivery, and invalidation; a forbidden route receives no data.                |
| Capacity                | The route manifest plus canary/rollback reserve fits actual account quotas for app clients, identity providers, callbacks, logout URLs, and Lambda trigger wiring.       |

The repository can proceed with provider-neutral schema and control-plane work
while these fixtures are constructed. Production cutover cannot proceed until
all rows above have fresh, redacted pass/fail evidence.

## Implementation consequence

Use route-specific Cognito app clients and explicit provider/auth-flow
allowlists as the first boundary, then independently enforce the route and
tenant contract in token admission. Treat `sub` plus the issuer/user-pool as
the stable external identity key. Email-based matching is permitted only in a
one-time, audited enrollment flow that detects ambiguity and never overwrites
an established subject.

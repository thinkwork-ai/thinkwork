---
title: WorkOS to Cognito OIDC compatibility spike
date: 2026-06-18
module: auth
problem_type: spike
component: workos-auth-plugin
severity: high
linear: THNK-43
tags:
  - workos
  - cognito
  - oidc
  - authentication
  - plugins
---

# WorkOS to Cognito OIDC Compatibility Spike

## Result

U1 now has a live Google-backed WorkOS-to-Cognito authorization-code proof in
the dev environment. A temporary WorkOS staging AuthKit/OIDC application was
registered with the dev Cognito callback, Cognito accepted it as an OIDC
identity provider, and `ThinkworkAdmin` completed a hosted auth code exchange
through WorkOS using a Google account in the `homecareintel.com` domain.

Safe conclusion for downstream work:

- Cognito can remain ThinkWork's final issuer for a WorkOS-backed route.
- The candidate upstream surface is a confidential WorkOS Connect OAuth
  Application/AuthKit-domain OIDC application registered with the Cognito
  `/oauth2/idpresponse` callback.
- Provider-specific Google/Microsoft buttons are still not approved. WorkOS
  rendered provider-specific choices, but the final Cognito token preserved only
  the Cognito WorkOS IdP identity, not the selected WorkOS upstream provider or
  connection as a durable claim. Microsoft was not independently proven because
  the browser reused the active WorkOS Google session.
- U2/U3 may proceed against a single WorkOS-backed `Continue with SSO` fallback
  design. Provider-specific buttons need a later claim-mapping/session-isolation
  decision and Microsoft proof before they ship.

## Evidence Collected

Initial read-only checks were run on 2026-06-18 from branch
`codex/thnk-43-workos-u1`. A follow-up live proof was run the same day from
branch `codex/thnk-43-u1-google-proof` after a WorkOS staging account was
created and explicit permission was granted for non-production Cognito/WorkOS
configuration. No production deployment was changed, and no secret value is
recorded in this artifact.

| Check                    | Evidence                                                                                                                                                                                                                                          | Impact                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo Terraform substrate | `terraform/modules/foundation/cognito/main.tf` defines generic `aws_cognito_identity_provider` resources for `var.oidc_identity_providers`, and both admin and mobile app clients include those provider names in `supported_identity_providers`. | The repo can represent a WorkOS OIDC IdP once a validated WorkOS OAuth application exists.                                                          |
| Repo variable contract   | `terraform/modules/foundation/cognito/variables.tf` and `terraform/modules/thinkwork/variables.tf` accept `provider_name`, `client_id`, `client_secret`, `issuer_url`, optional explicit endpoint URLs, scopes, JWKS URI, and attribute mappings. | The immediate module shape is compatible with a WorkOS OIDC bridge; secret handling must be moved out of plaintext tfvars before a production path. |
| Existing clients         | `apps/web/src/lib/auth.ts` has `getHostedSignInUrl({ identityProvider })`, while web, mobile, desktop, and React Native SDK still expose Google-specific helpers or labels.                                                                       | Client work must become provider-option driven later; U1 does not authorize UI work.                                                                |
| Existing linking trigger | `packages/api/src/handlers/cognito-pre-signup.ts` maps only `google` to `Google` and links by email.                                                                                                                                              | U6 must generalize provider names and require verified email plus stable WorkOS/upstream context before linking.                                    |
| AWS dev user pool        | Read-only `list-identity-providers` on `thinkwork-dev-user-pool` (`us-east-1_L4DhLVKis`) returned only `Google`.                                                                                                                                  | No deployed WorkOS IdP exists to exercise.                                                                                                          |
| AWS dev app clients      | Read-only client descriptions for `ThinkworkAdmin` and `ThinkworkMobile` showed `COGNITO` and `Google` as supported IdPs.                                                                                                                         | Even if a WorkOS IdP were created elsewhere, current dev clients would not route to it.                                                             |
| WorkOS secrets inventory | Read-only Secrets Manager search for WorkOS-named secrets returned an empty list.                                                                                                                                                                 | No WorkOS client credentials are available for this bridge in the inspected account.                                                                |
| Direct config search     | Repo and local deployment config search found no `workos`, `GoogleOAuth`, `MicrosoftOAuth`, or `oidc_identity_providers` values for this bridge.                                                                                                  | There is no already-approved configuration to test without new setup.                                                                               |

Read-only verification also rechecked the dev `ThinkworkAdmin` and
`ThinkworkMobile` app clients. Both currently support `COGNITO` and `Google`,
not a WorkOS IdP. Callback URLs were inspected only to confirm routing shape;
no client secrets or tokens were fetched.

## Live Dev Bridge Evidence

The follow-up proof configured only the dev Cognito user pool and a WorkOS
staging application:

| Check                   | Evidence                                                                                                                                                                                                                                                                                                                 | Impact                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WorkOS issuer discovery | WorkOS AuthKit domain `https://welcoming-nutmeg-53-staging.authkit.app` returned OIDC discovery with `/oauth2/authorize`, `/oauth2/token`, `/oauth2/userinfo`, `/oauth2/jwks`, `client_secret_post`, and `RS256`.                                                                                                        | WorkOS satisfies Cognito's OIDC discovery and token-auth requirements for the tested staging application.                                                                         |
| WorkOS redirect         | The WorkOS Connect OAuth application redirect URI was set to `https://thinkwork-dev.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`.                                                                                                                                                                                | WorkOS can return to Cognito rather than directly to a ThinkWork app callback.                                                                                                    |
| Cognito IdP             | Dev user pool `us-east-1_L4DhLVKis` has OIDC provider `WorkOSAuthU1` with issuer `https://welcoming-nutmeg-53-staging.authkit.app`, scopes `openid profile email`, attributes request method `GET`, and mappings `email=email`, `name=name`, `username=sub`.                                                             | Cognito can represent the WorkOS bridge without product code changes.                                                                                                             |
| Cognito app clients     | `ThinkworkAdmin` and `ThinkworkMobile` now include `WorkOSAuthU1` alongside `COGNITO` and `Google` in `SupportedIdentityProviders`.                                                                                                                                                                                      | Web and mobile clients can initiate a WorkOS-backed Cognito hosted auth route in dev.                                                                                             |
| WorkOS provider UI      | A Cognito `/oauth2/authorize` request with `identity_provider=WorkOSAuthU1` redirected to WorkOS AuthKit, which rendered provider links including `provider=GoogleOAuth` and `provider=MicrosoftOAuth`.                                                                                                                  | WorkOS can present provider-specific social choices behind the single Cognito WorkOS IdP.                                                                                         |
| Google callback         | The first Google attempt returned Cognito callback error `PreSignUp failed with error Provider linked -- retrying authentication.` A retry through the same Cognito WorkOS IdP returned a Cognito authorization code.                                                                                                    | The existing pre-signup linker can link the WorkOS federated identity, but the first login after link needs the expected retry.                                                   |
| Cognito token exchange  | Exchanging the retry authorization code at the Cognito token endpoint succeeded with HTTP 200. The ID token issuer was `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_L4DhLVKis`, audience was `ThinkworkAdmin`, token use was `id`, and scope was `openid profile email`.                                       | Cognito remains the final issuer after WorkOS completes the upstream Google authentication.                                                                                       |
| Final identity claims   | The final ID token included a stable Cognito subject/username, redacted email in the `homecareintel.com` domain, `name`, and `identities` entries for existing `Google` plus `WorkOSAuthU1` (`providerType=OIDC`). It did not include WorkOS organization, connection, credential, or selected-upstream-provider claims. | Single SSO fallback is compatible. Provider-specific buttons are not compatible until U6 or WorkOS configuration maps durable upstream provider/connection evidence into Cognito. |

The WorkOS OAuth client secret and Cognito authorization code were used only
for the live exchange and are intentionally omitted.

## Cognito Requirements to Satisfy

AWS Cognito user-pool OIDC federation supports the desired final-token shape:
the user pool can sit between external OIDC IdPs and ThinkWork clients, map
upstream claims, then issue Cognito user-pool tokens. Cognito also supports
silent redirect to a selected IdP via the `identity_provider` authorize
parameter.

The WorkOS bridge must satisfy these Cognito constraints before validation can
pass:

- HTTPS issuer discovery or explicit HTTPS `authorize_url`, `token_url`,
  `attributes_url`, and `jwks_uri`.
- Cognito-compatible token endpoint client authentication. Cognito requires
  `client_secret_post`, so WorkOS client metadata and a real token exchange
  must prove this, not merely library compatibility.
- ID tokens signed with an algorithm Cognito accepts and a JWKS key whose `kid`
  matches the token header.
- The Cognito domain callback registered in WorkOS as:
  `https://<cognito-domain>/oauth2/idpresponse`.
- Scopes at minimum `openid email profile`.
- Attribute mappings that fill Cognito `email`, `email_verified`, `name`, and a
  stable username source.

## Candidate WorkOS Surface

The best candidate is a WorkOS Connect OAuth Application backed by an AuthKit
domain:

- WorkOS documents Connect OAuth Applications as authorization-code OIDC
  applications with discovery through the AuthKit domain.
- The OAuth application should be confidential for the Cognito bridge because
  Cognito is the server-side relying party and can hold a client secret.
- The WorkOS redirect URI for this application must be Cognito's
  `/oauth2/idpresponse`, not a ThinkWork app callback. ThinkWork clients should
  still receive the final Cognito callback code from Cognito.
- WorkOS social providers such as Google and Microsoft are configured in
  WorkOS. The upstream Google/Microsoft redirect URIs remain WorkOS-owned
  provider redirect URIs, not Cognito callback URLs.

Rejected for v1 unless the OIDC bridge fails:

- Accepting WorkOS JWTs directly in ThinkWork APIs.
- Letting each customer configure direct Google/Microsoft Cognito social
  providers.
- Calling WorkOS Standalone SSO as the app's final login system while bypassing
  Cognito token issuance.

## Provider Routing Result

Provider-specific routing is partially proven, but provider-specific product
buttons are still not approved.

AWS documents `identity_provider` and `idp_identifier` as Cognito parameters
that choose the Cognito IdP. They do not establish a supported way for ThinkWork
to append arbitrary WorkOS parameters such as `provider=GoogleOAuth` or
`provider=MicrosoftOAuth` and have Cognito forward them to the upstream OIDC
authorization endpoint.

The live proof showed WorkOS AuthKit can render provider-specific links behind
the single Cognito OIDC provider. Selecting Google completed a Cognito code
flow after the existing pre-signup linker retried. However, the final Cognito
claims did not identify `GoogleOAuth` as the selected WorkOS provider; Cognito
only recorded `WorkOSAuthU1` as the federated OIDC provider. A Microsoft pass
was attempted next, but the active WorkOS session immediately reused the Google
session and returned to Cognito, so Microsoft remains unproven without session
isolation or a clean Microsoft-authenticated browser state.

Therefore the approved v1 UI decision from this spike is:

- Publish one public option: `Continue with SSO`.
- Internally route it with Cognito
  `/oauth2/authorize?...&identity_provider=<WorkOS Cognito IdP name>`.
- Do not publish Google or Microsoft buttons until the implementation maps or
  derives durable provider/connection evidence and verifies both providers in
  clean sessions.

This is no longer a blocker for the single SSO fallback. It remains a blocker
for provider-specific buttons and any UX copy that promises a particular
upstream provider.

## Required Claim Shape

Before provider-specific buttons can ship, a successful WorkOS-backed Cognito
token must prove both the Cognito session and upstream identity context.

Required Cognito ID-token or mapped user attributes:

- `iss`: ThinkWork Cognito user-pool issuer.
- `aud`: the Cognito app client that initiated the flow.
- `sub` and `cognito:username`: stable Cognito user identity.
- `email` and `email_verified`: email must be present and verified, or linking
  fails closed.
- `name`: mapped display name when WorkOS provides it.
- `identities`: Cognito federated identity array showing the WorkOS Cognito IdP
  name and stable upstream subject as Cognito sees it.
- WorkOS organization, connection, credential, or upstream-provider evidence
  mapped into a durable Cognito attribute or readable claim before any
  provider-specific button is published.

If the final Cognito token only says "WorkOSAuth" without identifying the
actual upstream provider/connection, provider-specific buttons remain invalid.
The single SSO fallback is still acceptable because it does not promise a
specific upstream provider at click time.

## Redacted Configuration Template

The current Terraform substrate can model the bridge with a shape like this
after a validated WorkOS OAuth application exists:

```hcl
oidc_identity_providers = [
  {
    provider_name    = "WorkOSAuth"
    client_id        = "<workos-connect-oauth-client-id>"
    client_secret    = "<from-secrets-manager-or-runtime-control-plane>"
    issuer_url       = "https://<authkit-domain>"
    authorize_scopes = "openid email profile"
    attribute_mapping = {
      email    = "email"
      name     = "name"
      username = "sub"
    }
  }
]
```

Do not commit the real client secret to tfvars. U2/U3 should use the existing
Secrets Manager guidance and select either a deployment-control-plane apply path
or an operator-gated service endpoint for mutation.

## Commands Used

These commands are safe to repeat because they are read-only. Any returned
secret values must be redacted before sharing.

```sh
rg -n "WORKOS|WorkOS|workos|GoogleOAuth|MicrosoftOAuth|oidc_identity_providers" \
  . --glob '!node_modules/**' --glob '!dist/**' --glob '!**/.terraform/**'

aws cognito-idp list-user-pools \
  --region us-east-1 \
  --max-results 60

aws cognito-idp list-identity-providers \
  --region us-east-1 \
  --user-pool-id us-east-1_L4DhLVKis

aws cognito-idp describe-user-pool-client \
  --region us-east-1 \
  --user-pool-id us-east-1_L4DhLVKis \
  --client-id <redacted-client-id>

aws secretsmanager list-secrets \
  --region us-east-1 \
  --query 'SecretList[?contains(Name, `WorkOS`) || contains(Name, `workos`)].Name'
```

## Remaining Decisions After U1

The live bridge clears the original credentials blocker for the single SSO
fallback. The remaining decisions before provider-specific buttons are:

1. Decide whether U2/U3 should persist the WorkOS OAuth client secret through
   Terraform/Secrets Manager or a control-plane mutation path. Do not commit it
   to tfvars.
2. Decide where WorkOS organization, connection, credential, or selected
   upstream provider metadata should be mapped so U6 can enforce verified,
   auditable linking.
3. Re-run Microsoft in a clean browser/session or with an explicit Microsoft
   test account. The current browser reused the WorkOS Google session before a
   Microsoft account could be selected.
4. Preserve the first-login retry behavior in U6 tests: a newly linked WorkOS
   federated identity may return `Provider linked -- retrying authentication`
   once before the next Cognito authorization succeeds.

## Sources

- THNK-43 plan:
  `docs/plans/2026-06-18-001-feat-workos-auth-plugin-plan.md`
- Origin brainstorm:
  `docs/brainstorms/2026-06-18-thnk-43-workos-auth-plugin-requirements.md`
- AWS Cognito OIDC IdP docs:
  <https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-oidc-idp.html>
- AWS Cognito third-party federation docs:
  <https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-identity-federation.html>
- WorkOS Connect OAuth Applications docs:
  <https://workos.com/docs/authkit/connect/oauth>
- WorkOS Social Login docs:
  <https://workos.com/docs/authkit/social-login>
- WorkOS Google OAuth docs:
  <https://workos.com/docs/integrations/google-oauth>
- WorkOS Microsoft OAuth docs:
  <https://workos.com/docs/integrations/microsoft-oauth>
- Secrets Manager guidance:
  `docs/solutions/best-practices/oauth-client-credentials-in-secrets-manager-2026-04-21.md`

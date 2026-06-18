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

U1 is blocked for live sign-in proof in this pass. The repository and AWS
account already support a Cognito OIDC provider shape, but there is no
configured non-production WorkOS Auth OIDC bridge to test without creating or
mutating auth infrastructure.

Safe conclusion for downstream work:

- Cognito can remain ThinkWork's final issuer for a WorkOS-backed route.
- The candidate upstream surface is a confidential WorkOS Connect OAuth
  Application/AuthKit-domain OIDC application registered with the Cognito
  `/oauth2/idpresponse` callback.
- Provider-specific Google/Microsoft buttons are not approved yet. Ship only a
  single WorkOS-backed SSO fallback until a live Cognito-to-WorkOS test proves
  provider-specific routing and final claim match.
- U2/U3 may design plugin state and bridge provisioning around the Cognito OIDC
  substrate, but U5 must not expose separate Google/Microsoft buttons from this
  evidence alone.

## Evidence Collected

Read-only checks were run on 2026-06-18 from branch
`codex/thnk-43-workos-u1`. No production mutation, deployment change, or
secret value was recorded in this artifact.

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

Provider-specific routing is not proven.

AWS documents `identity_provider` and `idp_identifier` as Cognito parameters
that choose the Cognito IdP. They do not establish a supported way for ThinkWork
to append arbitrary WorkOS parameters such as `provider=GoogleOAuth` or
`provider=MicrosoftOAuth` and have Cognito forward them to the upstream OIDC
authorization endpoint.

WorkOS documents provider-specific selection through its own authorization URL
API and provider parameter. Cognito's OIDC bridge does not call that API; it
redirects to the configured OIDC authorization endpoint.

Therefore the approved v1 UI decision from this spike is:

- Publish one public option: `Continue with SSO`.
- Internally route it with Cognito
  `/oauth2/authorize?...&identity_provider=<WorkOS Cognito IdP name>`.
- Do not publish Google or Microsoft buttons until a live test proves either
  Cognito forwards a supported WorkOS hint or WorkOS exposes distinct OIDC
  IdP/application surfaces with final claims that prove the selected provider.

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

## Blocker to Clear U1

To complete U1 instead of blocking it, create or provide a non-production
WorkOS OAuth application and an approved non-production Cognito test target:

1. WorkOS AuthKit domain or Connect OAuth Application issuer.
2. WorkOS OAuth client id and secret stored in Secrets Manager or an approved
   non-committed operator channel.
3. WorkOS redirect URI set to the Cognito domain
   `/oauth2/idpresponse`.
4. Google and Microsoft enabled in the WorkOS staging environment.
5. Permission to create/update a non-production Cognito OIDC IdP and attach it
   to the test app client, or a pre-created test user pool where that mutation
   is already approved.
6. A test login user for Google and Microsoft, or confirmation that the
   WorkOS-hosted provider choice flow is the only intended U1 route.

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

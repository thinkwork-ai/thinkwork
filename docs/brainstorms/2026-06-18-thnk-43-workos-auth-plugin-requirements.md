---
date: 2026-06-18
topic: thnk-43-workos-auth-plugin
---

# THNK-43 WorkOS Auth Plugin

## Problem Frame

ThinkWork needs Google, Microsoft, and future enterprise SSO without pushing every customer deployment through fragile provider-by-provider Cognito social federation. Cognito must remain the authentication contract that ThinkWork APIs, AppSync, CLI, mobile, and AWS-backed runtime paths already trust. WorkOS Auth should therefore be packaged as an installable ThinkWork plugin that provides OAuth/SSO capabilities upstream of Cognito, while Cognito continues issuing the final JWTs used by the platform.

OAuth controls must not appear on the login screen by default. A tenant or deployment sees WorkOS-backed login options only after the WorkOS Auth plugin is installed and configured for that tenant/deployment.

---

## Actors

- A1. End user: Signs in to ThinkWork through email/password or configured OAuth/SSO options.
- A2. Tenant admin/operator: Installs and configures the WorkOS Auth plugin for a deployed ThinkWork environment.
- A3. ThinkWork platform: Keeps Cognito as the final identity issuer and maps upstream WorkOS identities into existing tenant/user claims.
- A4. WorkOS Auth plugin: Owns WorkOS configuration, provider availability, and the bridge into Cognito federation.

---

## Key Flows

- F1. Plugin not installed
  - **Trigger:** A user opens the login page for a deployed ThinkWork environment.
  - **Actors:** A1, A3
  - **Steps:** The app loads public auth configuration for the deployment. No configured WorkOS Auth plugin is found. The login screen renders Cognito email/password and reset-password controls only.
  - **Outcome:** Users are not shown Google, Microsoft, or generic OAuth options until the tenant explicitly installs and configures WorkOS Auth.
  - **Covered by:** R1, R2, R8

- F2. Plugin installed and configured
  - **Trigger:** A tenant admin installs the WorkOS Auth plugin and completes required WorkOS/Cognito bridge configuration.
  - **Actors:** A2, A3, A4
  - **Steps:** The plugin stores validated WorkOS settings, configures Cognito to trust WorkOS as an upstream OIDC identity provider, publishes public-safe auth option metadata for the login page, and keeps secrets server-side.
  - **Outcome:** The login page can render WorkOS-backed OAuth controls and route users through Cognito federation.
  - **Covered by:** R3, R4, R5, R6, R7

- F3. WorkOS-backed OAuth sign-in
  - **Trigger:** A user clicks a configured WorkOS-backed OAuth option such as Google or Microsoft.
  - **Actors:** A1, A3, A4
  - **Steps:** The app starts the existing Cognito authorize flow with the WorkOS IdP selected. Cognito redirects to WorkOS. WorkOS handles Google, Microsoft, or enterprise SSO. Cognito receives mapped OIDC claims from WorkOS and issues normal Cognito tokens back to the app.
  - **Outcome:** The rest of ThinkWork sees a Cognito-authenticated user, not a parallel WorkOS-only session.
  - **Covered by:** R4, R5, R9, R10

---

## Requirements

**Plugin gating**

- R1. The login page must not display Google, Microsoft, or other OAuth controls unless the WorkOS Auth plugin is installed and configured for the current tenant/deployment.
- R2. The default unauthenticated login state must continue to support Cognito email/password where that deployment allows password users.
- R3. WorkOS Auth must be represented as an installable/configurable ThinkWork plugin, not as a globally enabled platform feature.

**Cognito bridge**

- R4. Cognito must remain the final token issuer for ThinkWork application sessions in v1.
- R5. WorkOS must act as an upstream OAuth/SSO broker that federates into Cognito, rather than as a parallel token issuer accepted directly by ThinkWork APIs.
- R6. Plugin configuration must create or validate the Cognito-to-WorkOS OIDC trust path, including provider metadata, client credentials, scopes, and claim mappings.
- R7. WorkOS client secrets and provider secrets must stay server-side in the plugin/deployment configuration path and must not be exposed in runtime web config.

**Login experience**

- R8. The unauthenticated runtime config must expose only public-safe auth capabilities needed to decide which login controls to show.
- R9. WorkOS-backed login controls should be labeled for the user-facing provider or choice they represent, while internally routing through the WorkOS-backed Cognito IdP.
- R10. Successful WorkOS-backed sign-in must land in the existing Cognito session handling path for web, mobile, desktop, CLI, API Gateway, and AppSync compatibility.

**Customer simplicity**

- R11. A customer deployment should not require direct Google or Microsoft OAuth configuration in Cognito for each environment once WorkOS Auth is the chosen plugin path.
- R12. Setup should be admin-driven and deployment-scoped: install plugin, provide WorkOS configuration, verify, then OAuth controls appear.
- R13. If plugin configuration is incomplete or fails validation, the login page must hide WorkOS-backed controls and surface the configuration problem only to admins/operators.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R8.** Given TEI has no configured WorkOS Auth plugin, when a user opens `tei.thinkwork.ai`, the login page shows Cognito email/password controls and no Google/Microsoft buttons.
- AE2. **Covers R3, R6, R12.** Given a tenant admin installs WorkOS Auth and enters valid WorkOS/Cognito bridge settings, when configuration validation succeeds, the deployment publishes WorkOS-backed auth options for that tenant.
- AE3. **Covers R4, R5, R10.** Given a user signs in through WorkOS-backed Microsoft login, when the auth flow completes, the app stores and refreshes Cognito tokens through the existing session path.
- AE4. **Covers R7, R13.** Given WorkOS Auth is installed but missing a required secret, when the login page loads, users do not see broken OAuth buttons and admins can diagnose the incomplete plugin configuration.

---

## Success Criteria

- Customers can enable Google and Microsoft login through one WorkOS Auth plugin configuration instead of per-environment Cognito social-provider setup.
- End users see OAuth controls only when those controls are actually usable.
- ThinkWork APIs and real-time subscriptions continue to receive Cognito JWTs, preserving existing auth assumptions.
- Planning can proceed without inventing whether WorkOS replaces Cognito: v1 explicitly uses WorkOS upstream of Cognito.

---

## Scope Boundaries

- Do not accept WorkOS JWTs directly in ThinkWork APIs for v1.
- Do not migrate Cognito email/password users into WorkOS in v1.
- Do not expose global Google/Microsoft buttons before the WorkOS Auth plugin is installed and validated.
- Do not continue adding one-off Google/Microsoft social-provider wiring to every customer Cognito deployment as the long-term customer path.
- Do not make every tenant install WorkOS Auth; Cognito-only deployments remain valid.

---

## Key Decisions

- WorkOS Auth is a plugin, not a built-in login default: this keeps OAuth/SSO capability explicit and tenant-controlled.
- Cognito remains the final issuer: this protects the existing API, AppSync, CLI, mobile, desktop, and AWS runtime auth contract.
- WorkOS sits upstream of Cognito: this moves Google/Microsoft/customer SSO complexity out of Cognito social-provider configuration while preserving platform compatibility.
- Broken or incomplete plugin configuration hides OAuth controls from users: the login page should not advertise auth paths that cannot complete.

---

## Dependencies / Assumptions

- Cognito user pools can federate to an external OIDC identity provider and then issue Cognito tokens to ThinkWork clients.
- WorkOS can provide an OIDC/OAuth surface compatible with Cognito user-pool federation requirements for the chosen AuthKit/Connect configuration.
- The deployed ThinkWork runtime can expose public-safe plugin auth metadata before a user is authenticated.
- Plugin installation/configuration can run deployment-level or tenant-level validation before changing login behavior.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R6][Needs research] Which WorkOS surface should Cognito federate to: AuthKit hosted login, WorkOS Connect OAuth application, or another WorkOS OIDC-compatible endpoint?
- [Affects R6][Needs research] Does the chosen WorkOS surface satisfy Cognito user-pool OIDC requirements such as HTTPS discovery, JWKS, userinfo, supported signing algorithms, and client authentication method?
- [Affects R8][Technical] What public unauthenticated endpoint or runtime config should expose installed/configured auth plugin capabilities to the login page?
- [Affects R9][Product/technical] Should the login screen show separate Google and Microsoft buttons, a single "Continue with SSO" button, or provider buttons configured by the WorkOS Auth plugin?
- [Affects R12][Technical] Should plugin installation mutate Cognito configuration directly, trigger a deployment workflow, or produce operator instructions for hosted/customer-managed deployments?

---

## Next Steps

-> /ce-plan for structured implementation planning, beginning with the WorkOS-to-Cognito compatibility spike.

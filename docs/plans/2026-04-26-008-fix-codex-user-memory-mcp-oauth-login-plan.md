---
title: "fix: Codex User Memory MCP OAuth login"
type: fix
status: active
date: 2026-04-26
origin: docs/plans/2026-04-20-008-feat-memory-wiki-mcp-server-plan.md
---

# fix: Codex User Memory MCP OAuth login

## Problem Frame

`codex mcp login thinkwork-user-memory-dev` currently fails with `No authorization support detected` because the deployed ThinkWork API does not expose the MCP OAuth discovery endpoints Codex expects for a streamable-HTTP MCP server. Registering the URL with `codex mcp add --url https://ho7oyksms0.execute-api.us-east-1.amazonaws.com/mcp/user-memory` succeeds, but login and initialization fail because the API returns `404` for protected-resource metadata and the MCP endpoint is not present.

This plan is a focused unblocker for Codex login. It implements the OAuth discovery and authorization-code path needed for Codex to obtain a ThinkWork-issued bearer token for the User Memory MCP resource. It intentionally does not complete every v0 tool from the parent Memory/Wiki MCP plan; the tool surface can land after `codex mcp login` works.

## Requirements Trace

- **R1.** `codex mcp login thinkwork-user-memory-dev` discovers OAuth support from the registered MCP resource URL instead of failing with `No authorization support detected`.
- **R2.** The resource server publishes RFC 9728 protected resource metadata for `/mcp/user-memory`, including an `authorization_servers` entry.
- **R3.** The authorization server publishes RFC 8414/OIDC-compatible metadata with `authorization_endpoint`, `token_endpoint`, `jwks_uri`, PKCE support, and a public-client onboarding mechanism Codex can use.
- **R4.** The OAuth flow supports Codex as a public client with PKCE and loopback redirect URIs.
- **R5.** User authentication delegates to the existing Cognito hosted UI so Google-authenticated ThinkWork users continue to sign in through the existing identity provider.
- **R6.** Issued access tokens are audience-bound to the MCP resource and carry enough user context for the future MCP handler to scope memory/wiki by user.
- **R7.** The implementation does not modify live Hindsight/wiki migration scripts, admin memory/wiki UI, or GraphQL auth/resolver files.
- **R8.** Tests cover discovery metadata, dynamic client registration, authorization callback/code issuance, token exchange validation, and the current blocked Codex E2E harness path.

## Scope Boundaries

- In scope: OAuth discovery, dynamic client registration or equivalent public-client support, Cognito handoff, token issuance, JWKS, Terraform routes/env, and a minimal MCP endpoint response that fails auth correctly.
- Out of scope: full `retain`, `memory_recall`, and `wiki_search` implementation. Those remain in `docs/plans/2026-04-20-008-feat-memory-wiki-mcp-server-plan.md`.
- Out of scope: mobile inbound connection management UI.
- Out of scope: schema migrations for durable inbound MCP connections unless needed to complete the authorization-code flow. Prefer encrypted, short-lived authorization-code state in existing infrastructure for this unblocker.

## Context And Patterns

- Parent plan: `docs/plans/2026-04-20-008-feat-memory-wiki-mcp-server-plan.md`.
- Live E2E harness: `packages/api/test/integration/user-memory-mcp/`.
- Existing outbound MCP OAuth discovery/client pattern: `packages/api/src/handlers/skills.ts`.
- Existing Cognito JWT verification shape: `packages/api/src/lib/cognito-auth.ts`.
- Existing API Lambda route wiring: `terraform/modules/app/lambda-api/handlers.tf`.
- Existing Lambda build list: `scripts/build-lambdas.sh`.

External grounding from the MCP authorization spec: MCP servers are OAuth resource servers, must publish OAuth protected-resource metadata, must return `WWW-Authenticate` on 401 with the resource metadata URL, and clients use RFC 8414 authorization-server metadata plus PKCE and RFC 8707 resource indicators.

## Key Decisions

- **Use a ThinkWork shim authorization server for Codex login.** Cognito hosted UI remains the user authentication provider, but ThinkWork owns the MCP authorization server endpoints. This avoids depending on Cognito Dynamic Client Registration, which Cognito does not provide for arbitrary Codex loopback clients.
- **Support Dynamic Client Registration for Codex.** Add a lightweight registration endpoint that accepts public clients with loopback or HTTPS redirect URIs, persists only what the code/token exchange needs, and returns a generated `client_id`.
- **Mint ThinkWork MCP access tokens.** After Cognito authentication succeeds, exchange the Cognito code server-side, then issue a short-lived JWT signed by ThinkWork for the MCP resource audience. The future MCP handler validates this token rather than accepting arbitrary Cognito tokens.
- **Keep tokens user-scoped.** Token claims include Cognito `sub`, tenant resolution inputs, and the MCP resource audience. If tenantId cannot be safely embedded at token time, the future resource handler resolves tenantId from the user identity like existing OAuth-aware GraphQL paths.
- **Use existing API Gateway/Lambda deployment style.** Add small handlers and routes in the existing `lambda-api` module rather than introducing a new service boundary.

## Implementation Units

### Unit 1: OAuth Metadata And Registration

**Goal:** Make Codex detect OAuth support for the User Memory MCP resource.

**Files:**

- Create: `packages/api/src/handlers/mcp-oauth-metadata.ts`
- Create: `packages/api/src/handlers/mcp-oauth-metadata.test.ts`
- Modify: `scripts/build-lambdas.sh`
- Modify: `terraform/modules/app/lambda-api/handlers.tf`

**Approach:**

- Serve protected-resource metadata for both `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp/user-memory`.
- Serve authorization-server metadata at `/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration`.
- Add a public-client registration endpoint advertised as `registration_endpoint`.
- Return metadata that points authorization and token requests at ThinkWork API routes.

**Test Scenarios:**

- `GET /.well-known/oauth-protected-resource/mcp/user-memory` returns `resource` and `authorization_servers`.
- `GET /.well-known/oauth-authorization-server` returns authorization, token, registration, JWKS, PKCE, and response-type metadata.
- Registration rejects non-loopback plaintext redirect URIs.
- Registration accepts Codex-style loopback redirect URIs and returns a client id.

### Unit 2: Cognito-Backed Authorization Code Flow

**Goal:** Let Codex start OAuth and receive an authorization code at its loopback redirect URI after the user signs in through Cognito.

**Files:**

- Create: `packages/api/src/handlers/mcp-oauth-authorize.ts`
- Create: `packages/api/src/handlers/mcp-oauth-authorize.test.ts`
- Modify: `scripts/build-lambdas.sh`
- Modify: `terraform/modules/app/lambda-api/handlers.tf`
- Modify: `terraform/modules/foundation/cognito/variables.tf` only if a callback URL variable needs documentation or default expansion.

**Approach:**

- Validate `client_id`, `redirect_uri`, `response_type=code`, `code_challenge`, and `resource`.
- Redirect to Cognito hosted UI with a ThinkWork callback route as the Cognito `redirect_uri`.
- On callback, exchange the Cognito code server-side, extract the user identity, mint a short-lived authorization code bound to Codex's original redirect URI and PKCE challenge, then redirect back to Codex.
- Do not require admin UI changes.

**Test Scenarios:**

- Missing PKCE returns `400`.
- Unknown client returns `400`.
- Invalid resource returns `400`.
- Valid request redirects to Cognito with state.
- Callback with a valid state redirects to the registered Codex redirect URI with a code and original state.

### Unit 3: Token, JWKS, And Resource 401 Behavior

**Goal:** Complete the OAuth exchange and give Codex a bearer token it can use when calling the MCP resource.

**Files:**

- Create: `packages/api/src/lib/mcp-oauth/token.ts`
- Create: `packages/api/src/lib/mcp-oauth/token.test.ts`
- Create: `packages/api/src/handlers/mcp-oauth-token.ts`
- Create: `packages/api/src/handlers/mcp-oauth-token.test.ts`
- Create: `packages/api/src/handlers/mcp-user-memory.ts`
- Create: `packages/api/src/handlers/mcp-user-memory.test.ts`
- Modify: `scripts/build-lambdas.sh`
- Modify: `terraform/modules/app/lambda-api/handlers.tf`

**Approach:**

- Add token endpoint support for `grant_type=authorization_code`.
- Verify the registered client, redirect URI, authorization code, PKCE verifier, and resource.
- Return a short-lived bearer token with `aud` equal to the MCP resource.
- Add JWKS endpoint for token verification.
- Add a minimal `/mcp/user-memory` route that returns a proper OAuth `401` with `WWW-Authenticate` pointing at protected-resource metadata when no bearer token is present. This lets Codex discover auth and stops the current JSON decode failure.

**Test Scenarios:**

- Token exchange rejects invalid PKCE verifier.
- Token exchange rejects wrong redirect URI.
- Token exchange rejects expired or reused authorization code.
- Token exchange returns bearer token for valid code.
- `/mcp/user-memory` without bearer returns `401` with `WWW-Authenticate`.
- `/mcp/user-memory` with invalid bearer returns `401`.

### Unit 4: Verification Harness

**Goal:** Prove the flow is usable from Codex and keep future regressions visible.

**Files:**

- Modify: `packages/api/test/integration/user-memory-mcp/README.md`
- Modify: `packages/api/test/integration/user-memory-mcp/codex-user-memory-mcp.e2e.test.ts`
- Modify: `docs/plans/2026-04-20-008-feat-memory-wiki-mcp-server-plan.md` only to mark this login unblocker as a prerequisite/foundation if needed.

**Approach:**

- Extend the harness docs with the exact `codex mcp add` and `codex mcp login` commands.
- Keep live E2E opt-in; do not make CI depend on an interactive OAuth browser flow.
- Add a non-interactive metadata test path that confirms deployed URLs expose the required discovery documents when env vars are present.

**Test Scenarios:**

- Local unit tests pass without live env.
- Live metadata probe fails clearly when URL env is absent.
- Live metadata probe confirms discovery routes before an operator runs interactive Codex OAuth.

## Verification

- `pnpm --filter @thinkwork/api test -- mcp-oauth`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm build:lambdas`
- Deploy through PR to `main`.
- After deploy:
  - `codex mcp add thinkwork-user-memory-dev --url https://<api-host>/mcp/user-memory`
  - `codex mcp login thinkwork-user-memory-dev`
  - `codex mcp get thinkwork-user-memory-dev`

## Risks

| Risk | Mitigation |
|---|---|
| Cognito callback URLs do not include the new ThinkWork API callback route | Add Terraform-managed callback URL rather than patching Cognito by hand. |
| Codex requires DCR behavior that differs from the MCP spec examples | Test against Codex CLI during implementation and keep handlers tolerant where safe. |
| Token signing key storage becomes production-sensitive | Use Secrets Manager/SSM indirection and avoid logging token/code contents. |
| Full MCP tools are not ready after login succeeds | Return standards-compliant MCP JSON errors or an empty/minimal tool list until tool implementation lands. |


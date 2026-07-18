---
title: AgentCore Identity and Gateway spike evidence
date: 2026-07-17
module: agentcore-identity
problem_type: architecture-pattern
tags:
  - agentcore
  - identity
  - gateway
  - cedar
  - oauth
  - security
---

# AgentCore Identity and Gateway spike evidence

## Purpose

This is the repo-local handoff record for the live THINK-315 U13 spike. It preserves only the redacted contract and outcomes needed by the managed multiplayer Harness proof. It is not production certification, and it does not substitute for the missing live gates listed below.

## Environment and selected shape

- Region/stage: owned non-production resources in `us-east-1`.
- Discovery/JWKS: self-hosted OIDC metadata and public keys behind API Gateway.
- Signing: asymmetric KMS RS256 key with `kid`; the public issuer surface did not hold provider credentials.
- Gateway inbound authorization: `CUSTOM_JWT` using the self-hosted issuer and Gateway-specific audience.
- Policy: AgentCore Policy/Cedar read the top-level `tenant_id` JWT claim as principal context.
- Identity exchange: `GetWorkloadAccessTokenForJWT` exchanged two distinct user-subject assertions for two distinct opaque workload access tokens.
- Credential model: ThinkWork turn assertion authenticates the exact turn/subject at Gateway; the opaque AgentCore workload token authorizes Identity/vault access; the downstream provider credential authorizes the target. These are three distinct credential classes and must not be collapsed or replayed across audiences.

## Proven live

- Gateway accepted a correctly signed, unexpired KMS-RS256 assertion from the self-hosted issuer.
- Tampered, expired, unsigned, and wrong-audience assertions were rejected.
- Cedar observed the custom `tenant_id` claim.
- Flipping only the Cedar decision changed the same request from allow to deny, demonstrating policy control rather than target behavior.
- Two user subjects produced distinct opaque workload tokens through `GetWorkloadAccessTokenForJWT`.
- Resources were torn down after the spike: Gateway, target, Policy engine/policy, workload identity, two Lambdas, API Gateway issuer, and both IAM roles. The KMS key was scheduled for deletion on 2026-07-24 because AWS requires a seven-day minimum window.

## Explicitly not proven

- Retrieval of two real per-user provider credentials from the AgentCore Identity vault.
- Stable credential-owner continuity through provider refresh/revocation and signing-key rotation.
- Gateway-to-target authenticated caller handoff without replaying the Gateway bearer.
- A gateway-only target boundary that rejects otherwise valid direct calls.
- Harness inbound `CUSTOM_JWT` Bearer invocation.
- Native Harness `agentcore_gateway` OAuth propagation of the original principal/custom claims.
- Concurrent Alice/Bob owner isolation through one Harness.
- Issuer/JWKS outage recovery and rollback behavior.
- Side-effect idempotency. The focused multiplayer proof keeps side-effecting tools disabled.

## Infrastructure constraint

The dev account rejected public unauthenticated Lambda Function URLs even when a public resource policy was attempted. Discovery/JWKS must therefore use API Gateway or CloudFront; do not reintroduce a Function URL fallback.

## Safe reuse rule

Reuse the selected contract and its negative controls, but recreate all resources from reviewed code and Terraform. Do not infer target handoff, vault-owner isolation, Harness propagation, or direct-target rejection from the successful Gateway/JWT exchange. Every missing item above remains a live stop gate in U1 of the combined Harness plan.

## Source trail

- Linear THINK-315 U13 result comment, posted 2026-07-17.
- The originating THINK-315 plan was not landed in this branch; the U13/U14 facts required for this proof are captured above rather than treated as an external file dependency.
- User-provided teardown and result handoff in the planning session on 2026-07-17.

## THINK-316 follow-up

THINK-316 recreated and extended this substrate live. Real AgentCore Identity
authorization-code completion, Alice/Bob owner-isolated provider tokens,
Gateway-to-target handoff, duplicate harmless reads, disclosure filtering, and
direct-target rejection all passed. A standards-compliant OBO token-exchange
provider then closed the native Harness route: one shared `CUSTOM_JWT` Harness
preserved Alice/Bob identity through an Identity `TOKEN_EXCHANGE` Gateway
credential, Cedar policy, and the user-owned `AUTHORIZATION_CODE` target
credential. Alice-to-Alice and Bob-to-Bob were allowed; Bob-to-Alice was denied.

The generic inline carrier also emitted structured `toolUse` and accepted
`toolResult` when `allowedTools` was omitted. Explicit inline-tool allowlisting
remains a service-contract risk, but it is no longer evidence that an XML relay
is required. See
`agentcore-harness-identity-route-selection-2026-07.md` for the redacted verdict
and cleanup record.

---
title: AgentCore Harness identity route selection verdict
date: 2026-07-17
module: agentcore-harness
problem_type: architecture-pattern
tags:
  - agentcore
  - harness
  - identity
  - gateway
  - oauth
  - multiplayer
  - security
---

# AgentCore Harness identity route selection verdict

## Verdict

**THINK-316 U1 passed: select one shared, tenant-scoped AgentCore Harness with
native AgentCore Identity and Gateway authorization.** A live Alice/Bob proof
preserved the exact caller through Harness, issued a distinct user-scoped
Gateway credential, applied Cedar authorization, resolved the correct
user-owned target credential, and returned only a disclosure-safe result.

The topology does not need a Harness per user, thread, Space, logical agent, or
ordinary tool set. Those variations belong in trusted per-turn configuration,
participant-scoped sessions, Gateway Policy, and Identity. Additional Harnesses
remain justified only for materially different trust/execution profiles such as
privileged command execution, VPC/filesystem isolation, or regional boundaries.

This is an architecture-gate pass, not a production cutover. Pi remains active
until the remaining plan units prove session reconstruction, canonical public
context, dynamic capability projection, disclosure, operational hardening, and
the deployed operator workflow.

## Corrected two-exchange path

The successful native path was:

1. ThinkWork KMS-RS256 user JWT authenticates Alice or Bob to the Harness
   `CUSTOM_JWT` endpoint.
2. AgentCore Identity `TOKEN_EXCHANGE` exchanges that exact user subject for a
   distinct Gateway-audience JWT; the service-linked workload identity prevents
   callers from manually minting its workload access token.
3. Gateway `CUSTOM_JWT` and Cedar authorize the operation, then AgentCore
   Identity performs a second `TOKEN_EXCHANGE` for a downstream-audience token
   carrying the same exact user subject plus the Gateway workload identity.
4. The controlled target accepts only Gateway handoff and returns a sanitized
   projection.

Do not collapse these into one reusable bearer. The inbound Harness assertion,
Gateway credential, and downstream provider credential have different issuers,
audiences, owners, and jobs.

## Live evidence

The native shared-Harness result was:

- Alice-to-Alice: allowed.
- Bob-to-Bob: allowed.
- Bob-to-Alice: denied by policy before Alice's credential could resolve.
- Direct target invocation: denied.
- Gateway credential: `TOKEN_EXCHANGE`, with a distinct subject-bound token for
  each user.
- Target credential: `TOKEN_EXCHANGE`, with Alice/Bob owner continuity and no
  second consent prompt.
- Inbound Harness authentication: `CUSTOM_JWT`.
- Raw tokens and private fixture sentinels: absent from proof output.

The AWS official Harness OAuth sample was also rerun as a control. Its event
stream initially appeared blank because the prior parser discarded exception
frames. Correct parsing exposed a missing `bedrock-agentcore:ListEvents`
permission for the sample's auto-created Memory. With Memory disabled to isolate
OAuth, the documented Cognito JWT → Harness → Identity client credential →
Gateway → Lambda flow passed. OAuth itself was not the blocker.

## THINK-311 regression correction

The earlier generic inline-function carrier was also retested. Harness emitted
a documented structured `toolUse`, accepted the corresponding `toolResult`, and
completed the turn. The earlier XML/text behavior was caused by supplying an
explicit `allowedTools` list that did not match the service's effective inline
tool namespace. Omitting `allowedTools` restored the documented contract.

That result removes the conclusion that caller-fulfilled tools inherently need
an undocumented XML relay. It does **not** make the inline bridge the preferred
identity route: native Identity/Gateway passed and avoids re-owning the model
loop. It also leaves an implementation risk because the current default
`allowedTools=["*"]` can expose Harness built-ins. Production must prove a
precise server-derived allowlist or use the native Gateway surface without
granting unwanted built-ins.

ThinkWork/Hindsight remains authoritative for public thread and scoped durable
memory. Harness session state is a disposable participant-scoped execution
cache, never shared thread authority.

## Remaining implementation gates

- Prove the production IdP/OBO contract, signing-key rotation, JWKS outage,
  credential revocation, and rollback behavior.
- Keep side-effecting tools disabled until operation binding, idempotency, and
  ambiguous-retry behavior are certified.
- Prove exact dynamic tool visibility and authorization from trusted server
  state; never treat prompt text or a tool list as the security boundary.
- Prove participant-session reconstruction and canonical public-event catch-up
  under Alice/Bob overlap.
- Preserve disclosure filtering before private target output enters Harness
  prompts, memory, telemetry, or the public thread.
- Add the guarded `AgentCore Harness (proof)` operator runtime option and run the
  deployed end-to-end proof with zero Pi fallback.

## Cleanup

All ephemeral Harness, Gateway, Policy, Identity, Lambda, API Gateway, IAM, and
target resources were deleted. Matching proof log groups were empty and
removed. Two ephemeral proof KMS keys from the corrected attempts are pending
AWS's mandatory seven-day deletion window until 2026-07-24. No ThinkWork
application or Pi resource was changed.

## Durable proof entry points

- `packages/api/scripts/proofs/agentcore-harness-native-proof.ts`
- `packages/api/scripts/proofs/agentcore-harness-official-oauth-baseline.py`
- `packages/api/scripts/proofs/agentcore-exact-user-gateway-proof.py`
- `packages/api/scripts/proofs/agentcore-harness-exact-user-proof.py`
- `terraform/proofs/agentcore-multiplayer/`

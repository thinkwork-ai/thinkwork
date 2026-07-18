---
title: AgentCore Harness managed multiplayer proof verdict
date: 2026-07-17
module: agentcore-harness
problem_type: architecture-verdict
tags:
  - think-316
  - agentcore
  - harness
  - identity
  - gateway
  - multiplayer
  - security
---

# AgentCore Harness managed multiplayer proof verdict

## Verdict

**PASS — proceed to Pi-retirement certification planning.**

One pinned, tenant-scoped Amazon Bedrock AgentCore Harness preserved
ThinkWork's single-agent multiplayer behavior across two authenticated users.
ThinkWork remained authoritative for the public thread and participant
hydration; fresh Harness sessions owned only the managed execution loop;
AgentCore Gateway plus Cedar made the operation decision; AgentCore Identity
performed two on-behalf-of token exchanges; and the controlled target enforced
the same owner boundary independently.

This verdict authorizes retirement _certification planning_, not a production
cutover or deletion of Pi. Scheduled/ownerless execution, side-effecting tools,
all connector families, long-thread compaction, and production capacity remain
separate certification gates.

## Why the Identity design changed

The first nested design used `AUTHORIZATION_CODE` at the Gateway target. It
correctly elicited consent, but its authorization session was bound to the
Gateway's derived inbound token. The ThinkWork application does not and should
not possess that hidden credential, so trying to complete the session with the
original Harness JWT or a caller-supplied user id failed closed.

The supported design is OBO at both hops:

1. ThinkWork sends a short-lived KMS-RS256 participant JWT to the Harness
   `CUSTOM_JWT` endpoint.
2. Harness outbound Identity exchanges it for a Gateway-audience user token.
3. Gateway validates the derived token and Cedar authorizes the exact principal
   plus requested owner.
4. Gateway outbound Identity exchanges that inbound token for a
   target-audience token carrying the same user subject.
5. The target validates the credential owner, rejects owner mismatch, and
   returns only its structural disclosure projection.

AWS documents OBO as the pattern for an already-authenticated user crossing an
identity-aware downstream service without another consent prompt. It carries
both user and workload identity across the hop. See [supported authentication
patterns](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/common-use-cases.html)
and [Gateway outbound authorization](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-outbound-auth.html).

## Live proof evidence

The final run used the deployed ThinkWork GraphQL `sendMessage` path, one
Harness, qualifier `ThinkworkProof`, immutable version `5`, and a new enrolled
thread created after the canonical public-event trigger existed. The sequence
was Alice → Bob → Bob-denied-Alice → Alice mixed disclosure.

Provider-backed results:

- Alice received only the Alice fixture.
- Bob received only the Bob fixture.
- Bob's request for Alice was denied; no Alice credential owner or fixture was
  returned.
- Direct target access without the Gateway credential was denied.
- Alice's mixed result published the approved task field and a
  `confirmation_required` withholding decision.
- Bob's equivalent restricted mixed operation was denied.
- No OAuth consent URL, raw token, private note, or private sentinel was
  published.

Authoritative database result for the final redacted thread alias
`0bebe7e5af50`:

| Evidence            | Result                                                   |
| ------------------- | -------------------------------------------------------- |
| Runtime restoration | enrollment `restored`; platform runtime `pi`             |
| Turn execution      | 4 turns; 4 Harness; 0 Pi/Flue/Strands; 4 succeeded       |
| Usage               | 4/4 turns have usage                                     |
| Fresh sessions      | 4 allocated/completed; 2 participants; 1 version         |
| Logical identity    | 1 base agent fingerprint; 4 participant-turn projections |
| Canonical thread    | 9 unique public events; 5 user + 4 assistant messages    |
| Cost                | 4 complete Harness usage/cost rows; 8 cost rows total    |
| Public privacy scan | 0 forbidden values                                       |

The first evidence pass caught a real bug: `baseFingerprint` included the
perspective-specific `config_fingerprint`, which produced two apparent base
agents. The implementation moved that value into the participant projection,
added a regression test, redeployed, and reran the entire proof. The table above
is the corrected rerun, not the earlier superficially green chat.

## Architecture consequence

The default topology is one Harness per tenant and explicit trust/execution
profile—not per user, thread, Space, logical agent, skill set, or tool set.
Participant differences remain per-turn trusted projections; Gateway Policy
owns dynamic authorization; Identity owns user/workload credential propagation;
ThinkWork owns canonical public and scoped durable memory.

Additional Harnesses are justified only for a different hard boundary such as
privileged command execution, VPC/filesystem isolation, regulatory region, or
independent operator ownership.

## Operations and capacity

Fresh-per-turn hydration was selected because participant-session reuse showed
only an 11.07% benefit, below the frozen 20% complexity threshold. Safe live
rates passed. The account's high-rate quota-increase request remains open and
does not block implementation, review, or safe-rate proof execution. It must be
closed before production admission control claims the requested peak envelope.

## Cleanup

The proof runner used `finally` restoration through the same operator mutation
as the UI. It restored the prior Pi runtime, invalidated Bob's temporary proof
session, and returned that Cognito fixture to `FORCE_CHANGE_PASSWORD`. The
latest enrollment is durably `restored`; no proof thread can continue invoking
Harness while Pi is selected. A fresh non-proof ThinkWork GraphQL thread then
returned the exact `PI_RESTORED_SMOKE_OK` response through Pi and was archived.
The proof Harness and endpoint, Gateway target, Gateway, Cedar policy and
engine, workload identity, OAuth credential provider, proof HTTP routes,
Lambdas, SSM profile, alarms, and proof IAM roles were deleted after the Pi
smoke. A final AWS inventory returned zero matching proof resources. The sole
AWS-enforced remainder is the disabled signing key, which is in
`PendingDeletion` until July 24, 2026 under KMS's mandatory seven-day window.
The retained database ledgers and this redacted verdict contain no raw tokens
or synthetic private fixture values.

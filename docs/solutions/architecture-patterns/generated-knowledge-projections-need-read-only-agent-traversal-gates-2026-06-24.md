---
title: Generated knowledge projections need read-only agent traversal gates
date: 2026-06-24
category: docs/solutions/architecture-patterns
module: OKF Wiki Navigator / AgentCore Pi
problem_type: architecture_pattern
component: assistant
severity: high
applies_when:
  - "A governed knowledge store is projected into agent-readable files"
  - "An agent runtime needs filesystem-like traversal without write access"
  - "S3, EFS, database, graph, and runtime tools all participate in one feature"
  - "Operators need proof that a new retrieval path participated in a turn"
  - "Default routing should wait for comparison evidence"
tags:
  - okf
  - wiki-navigator
  - agentcore-pi
  - efs
  - s3
  - context-engine
  - trace-evidence
  - eval-gate
---

# Generated knowledge projections need read-only agent traversal gates

## Context

THNK-63 shipped the OKF Wiki Navigator v1. The feature turns governed
ThinkWork wiki, Brain, graph, and provenance state into an Open Knowledge
Format markdown projection, publishes versioned bundle artifacts to S3,
hydrates the current bundle into EFS, mounts that view read-only into Pi, and
exposes bounded `wiki_ls`, `wiki_rg`, `wiki_read`, and `wiki_links` tools.

The durable learning is the cross-layer pattern, not the OKF file format by
itself: a generated knowledge projection can be agent-native and inspectable
without becoming canonical storage or a raw backend escape hatch. Postgres,
Brain, wiki, graph, and provenance remain canonical. S3 is the artifact history
and audit plane. EFS is a rebuildable current read view. Pi can traverse the
projection only through constrained tools, and routing changes stay
evaluation-gated.

Session history confirmed two decisions that are easy to lose in a long
implementation. The planning worker found a stale requirements line that said
"no direct Pi filesystem mounts", then reconciled it with the later Linear
decision: the v1 may use a read-only Pi EFS mount while the model-facing
boundary remains constrained tools and policy gates (session history). The
closeout worker also hit duplicate docs/status PRs and used the merged PR
#2876 as the canonical U8 artifact instead of forcing a second overlapping PR
(session history).

## Guidance

Treat the projection as several separate contracts that must line up before the
feature is considered safe.

First, keep the projection generated and replayable. The materializer should
write a validated bundle under a versioned S3 prefix before moving the current
pointer. The current manifest should include enough evidence to prove exactly
which bundle Pi read: bundle id, checksum, object count, byte count,
generated-at, source counts, and redaction posture. EFS should be hydrated from
that current manifest and be rebuildable from S3, not edited directly.

```text
Canonical state -> OKF materializer -> S3 bundle version
                                      -> S3 current manifest
                                      -> EFS current read view
                                      -> Pi read-only mount
```

Second, split writer and reader permissions at the infrastructure boundary. The
hydrator can mount a write access point and stage a new bundle before atomically
republishing `current`. Pi mounts a separate read access point and receives
`elasticfilesystem:ClientMount` only. It should not get `ClientWrite` or
`ClientRootAccess`, and its tool schemas should not accept tenant ids, S3 keys,
absolute host paths, mount roots, backend ids, or write flags.

Third, make filesystem traversal a provider contract, not arbitrary file IO.
The provider should resolve every path beneath the tenant current root and
reject `..`, absolute paths, symlink escapes, hidden files other than the
approved manifest, binary or invalid UTF-8 files, unsupported extensions, and
oversized reads. Search should enforce byte, result, depth, and timeout bounds.
Markdown is untrusted source data: the agent may cite or summarize it, but page
text cannot expand tool policy or override system/developer instructions.

Fourth, make participation visible. THNK-63 made OKF navigator tools return
structured trace details, emit live `wiki_context_trace` activity events, and
backfill durable trace events during finalize from tool invocation evidence.
That backfill matters because a dropped live callback should not erase the
operator's proof that the wiki projection participated.

```text
Tool result details.okfWikiTrace
  -> live wiki_context_trace event
  -> finalized thread_turn_events backfill
  -> web trace card with bundle, tool, path/query, snippets, bounds, truncation
```

Finally, do not ship default retrieval cutover as part of the first projection
slice. THNK-63 added a comparison corpus and deployed smoke harness that compare
DB wiki retrieval, OKF traversal, DB-plus-OKF hybrid, raw memory, and knowledge
graph retrieval. That evidence gate is what keeps a working filesystem path
from becoming an unproven default.

## Why This Matters

Generated markdown feels deceptively simple. Without the separation above, it
can quietly become a second source of truth, a writable workspace, or an
unreviewed storage API exposed to a model. Each of those outcomes weakens the
governance model that made the knowledge store trustworthy in the first place.

The read-only mount is also not just a Terraform detail. Adding EFS to a Lambda
runtime pulls VPC, security group, endpoint, NAT, and callback behavior into
the feature. THNK-63 treated VPC egress preservation as a verification gate
because Pi still needs Bedrock/AgentCore, S3, Secrets/SSM, and ThinkWork API
callbacks after the mount exists.

Trace evidence closes the loop for operators. A green unit test can prove the
provider rejects unsafe paths, and a dry-run smoke can prove the script shape.
The product question is different: did the deployed agent actually see OKF
context, which pages did it inspect, which snippets returned, and did the turn
preserve that evidence after refresh? The trace card makes that answer
inspectable.

## When to Apply

- When projecting governed database, graph, wiki, Brain, or memory state into
  markdown or another agent-readable filesystem.
- When an agent runtime benefits from walking files directly, but mutations
  must stay with platform-owned materializers or review workflows.
- When a new retrieval path crosses infrastructure, runtime policy, agent tool
  registration, UI evidence, and evaluation.
- When source content may contain prompt-injection text and must be marked as
  cite-or-summarize-only source data.
- When the team is tempted to make a new provider default before comparing it
  against existing retrieval paths.

## Examples

Good generated-projection shape:

```text
Materializer:
  reads governed wiki/Brain/graph/provenance state
  writes versioned S3 OKF bundle and current manifest

Hydrator:
  validates manifest and checksums
  stages immutable bundle directory
  atomically republishes the EFS current view

Pi:
  mounts read-only EFS access point
  registers wiki_ls/wiki_rg/wiki_read/wiki_links only when runtime and policy allow
  records okf_wiki_trace evidence on tool invocations

Operator:
  sees wiki_context_trace cards in thread detail
  runs deployed smoke and comparison report before routing changes
```

Poor generated-projection shape:

```text
Materializer writes markdown into the same path agents can edit.
Pi gets a broad mount and generic file tools.
Tool schemas accept absolute paths or tenant ids.
Markdown text is treated as instructions.
Verification stops after the tool appears in the allowlist.
Default query_wiki_context routing changes before comparison evidence exists.
```

The poor shape may demo quickly, but it collapses source-of-truth, access
control, prompt-injection, and operator-verification boundaries into one vague
"the agent can read files" claim.

## Related

- [THNK-63 plan](../../plans/2026-06-22-002-feat-okf-wiki-navigator-plan.md)
- [THNK-63 autopilot status](../../plans/autopilot/THNK-63-status.md)
- [OKF Wiki Navigator docs](../../src/content/docs/concepts/knowledge/okf-wiki-navigator.mdx)
- [OKF Wiki Navigator verification runbook](../../verification/okf-wiki-navigator-e2e.md)
- [First-party provider tools should stay behind policy facades](./first-party-provider-tools-stay-behind-policy-facades-2026-06-14.md)
- [Company Brain active-substrate reads stay behind Context Engine](./company-brain-active-substrate-reads-through-context-engine-2026-06-15.md)
- [Context Engine adapters need operator-level verification](../best-practices/context-engine-adapters-operator-verification-2026-04-29.md)
- [Cognee Thread Ingest Explorer validation pattern](../best-practices/cognee-thread-ingest-explorer-2026-06-04.md)
- [EFS-sidecar Lambda bypasses the worker queue for read-only ops](./efs-sidecar-lambda-bypasses-worker-queue-for-reads-2026-05-13.md)
- [PR #2854: OKF bundle contract and artifact manifests](https://github.com/thinkwork-ai/thinkwork/pull/2854)
- [PR #2861: OKF EFS refresh and Pi read-only mount](https://github.com/thinkwork-ai/thinkwork/pull/2861)
- [PR #2872: OKF trace evidence in thread thinking](https://github.com/thinkwork-ai/thinkwork/pull/2872)
- [PR #2874: retrieval comparison and smoke harness](https://github.com/thinkwork-ai/thinkwork/pull/2874)
- [PR #2876: OKF navigator operator docs](https://github.com/thinkwork-ai/thinkwork/pull/2876)

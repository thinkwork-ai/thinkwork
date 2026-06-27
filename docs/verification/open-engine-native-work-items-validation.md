---
title: Open Engine native Work Items validation
date: 2026-06-27
status: native-passes-with-gaps
linear: THINK-86
related:
  - THINK-85
  - THINK-88
---

# Open Engine Native Work Items Validation

## Verdict

Native Work Items should be the foundation for ThinkWork Open Engine queues.
Linear should remain the comparison benchmark, optional adapter, and escape
hatch, but should not be required as the source of truth for Work Items.

The validation result is **native passes with gaps**. U1 through U5 proved the
headless queue contract ThinkWork needs first: explicit eligibility, atomic
claim, durable receipts, narrow API access, and a runner smoke that dispatches
one claimed Work Item into the existing AgentLoop path. This is enough to move
forward on native Work Items without rebuilding Linear's full UI.

The biggest remaining gap is exactly the concern that made Linear attractive:
external agents already know how to use Linear, but they do not yet know how to
use ThinkWork Work Items. That is not a reason to make Linear the foundation.
It is a reason to make ThinkWork MCP the next access layer, exposing Work Item
queues and ThinkWork Brain context to external agents through a tool contract
they can consume directly.

## Evidence

| Slice                    | Result | Evidence                                                                                                                                                                                                                                                                          |
| ------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1 queue state           | Passed | Work Items now persist Open Engine queue keys, routing metadata, claim owner, claim lease, human hold, dependency readiness, and eligibility indexes. PR #3025 merged at `a9e2733d0207580d958a07df406e0725a659d3d9`.                                                              |
| U2 eligibility and claim | Passed | Eligibility excludes completed, archived, blocked, human-held, dependency-waiting, future-scheduled, and actively claimed rows. Claiming uses a persistence-bound conditional claim with `FOR UPDATE SKIP LOCKED`. PR #3027 merged at `77f0c520fe17377a7eebed67187b095f33e181f5`. |
| U3 receipts              | Passed | Open Engine receipts are durable Work Item events. Blocked receipts create human hold and release claims; resumed, failed, and completed receipts update queue state predictably. PR #3028 merged at `bdbfb9e0fd2daad66627a4e940b1a44436214fae`.                                  |
| U4 internal API          | Passed | GraphQL exposes a narrow admin/service-gated contract for eligible list, atomic claim, and receipt recording. PR #3030 merged at `164d9fcb65957f7c33010f81e1c24a09b0b244f4`.                                                                                                      |
| U5 runner smoke          | Passed | A thin runner claims one eligible item, records the claimed receipt, dispatches one AgentLoop wakeup with Work Item context, and records a failed receipt when dispatch fails. PR #3032 merged at `98cb0ceb2e5900b380017e5bf7c4e7b00c07c898`.                                     |

## Pass Criteria Assessment

| Criterion                  | Assessment                                                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Atomic claim               | Passed. Claim correctness is enforced in the database/API service boundary rather than by prompt discipline.                                                                                 |
| Explicit eligibility       | Passed for the first queue contract. Eligibility includes status, archive/completion state, blocking, human hold, dependency readiness, schedule, claim lease, queue key, and routing scope. |
| Durable receipts           | Passed. Receipts are cold-readable Work Item events with Open Engine metadata.                                                                                                               |
| Human interruption         | Partially passed. Queue semantics for human hold, blocked, answered, and resumed exist; the dedicated human UI remains follow-up work.                                                       |
| Evidence-backed completion | Partially passed. Receipt metadata supports evidence pointers; production UX and runtime enforcement remain follow-up work.                                                                  |
| Agent accessibility        | Partially passed. Internal GraphQL and runner paths exist; external-agent access through ThinkWork MCP remains the key next gap.                                                             |

## Native vs Linear

| Axis              | Native Work Items                                                                                                                    | Linear foundation                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Queue correctness | Strong fit after U1-U5. Queue state, claims, receipts, and holds are product-owned and testable at the persistence/service boundary. | Strong collaboration model, but Open Engine-specific claim and receipt semantics would have to be encoded through issue fields, labels, comments, or adapter conventions.  |
| Agent usability   | Good for ThinkWork runtime now; incomplete for external agents until MCP tools exist.                                                | Excellent today because many agents already understand Linear issues, comments, statuses, and labels.                                                                      |
| Human operability | Enough backend semantics now; needs a small Work Item blocker/receipt surface.                                                       | Excellent UI out of the box, but much broader than the headless queue surface ThinkWork needs first.                                                                       |
| Integration cost  | Lower long-term because Work Items, Brain, Threads, AgentLoops, and receipts share one native substrate.                             | Lower short-term for agent familiarity, higher long-term due source-of-truth sync, tenant data boundaries, adapter drift, and custom Open Engine semantics layered on top. |
| Strategic control | Strong. ThinkWork owns queue semantics, data locality, retention, Brain integration, and future runtime behavior.                    | Weaker. Linear becomes operational infrastructure for a ThinkWork-native product concept.                                                                                  |

## Decision

Proceed with **Open Engine Native on Work Items**.

Do not require Linear as the foundation for Work Items. Build the next layer as
ThinkWork MCP over the native Work Item queue contract so external agents get a
tool-native path to the same queue and Brain context. Keep a Linear adapter as
an optional interoperability path for teams that already operate in Linear, but
make that adapter project into or wrap native Work Items rather than replace
them as the source of truth.

## Remaining Gaps

- External agents need ThinkWork MCP tools before native Work Items can match
  Linear's out-of-the-box agent familiarity.
- Humans need a minimal blocker and receipt surface before the queue is
  operationally comfortable without Linear.
- Production operation needs stale-claim recovery, metrics, alerts, concurrency
  coverage, and a queue runbook.
- Team routing belongs in THINK-87 and should build on the same native queue
  contract rather than fork it.
- A Linear adapter/plugin still belongs in THINK-88, but as optional
  interoperability after native queue ownership is accepted.

## Follow-Up Issues

- THINK-89: Open Engine Native: ThinkWork MCP queue tools.
- THINK-90: Open Engine Native: human blocker and receipt surface.
- THINK-91: Open Engine Native: queue operations hardening and observability.

## Pivot Criteria

Reconsider Linear as the foundation only if the next phase shows one of these
native failures:

- External-agent MCP access stays meaningfully harder than Linear for ordinary
  queue work.
- Human unblock/review flows require rebuilding a broad issue tracker before
  the queue is usable.
- Stale claims, duplicate dispatches, or failed receipts cannot be made
  observable and recoverable with normal ThinkWork operations.
- The queue contract creates source-of-truth ambiguity between Work Items,
  Threads, Brain, and AgentLoops.

Until then, Linear is the benchmark and adapter target, not the substrate.

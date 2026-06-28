---
title: OpenEngine one-task runner
date: 2026-06-28
module: open-engine
problem_type: runbook
tags:
  - open-engine
  - mcp
  - work-items
  - codex
  - automation
---

# OpenEngine One-Task Runner

ThinkWork OpenEngine uses Work Items, not Linear, as the runtime queue. The
one-task runner is the recurring automation entrypoint for external agents such
as Codex and Claude:

1. verify `/mcp/open-engine` access,
2. fetch configured standing context, routing map, and optional skill directory
   material,
3. inspect the routed queue,
4. claim exactly one eligible Work Item,
5. fetch task context and documents progressively,
6. write status ledger evidence, and
7. emit the execution prompt for the claimed Work Item.

The helper lives at:

```bash
node scripts/open-engine-one-task-runner.mjs
```

## Modes

`verify` is read-only and should be used by setup checks, cron health checks,
and first-run debugging:

```bash
OPEN_ENGINE_MCP_URL="https://<api-id>.execute-api.<region>.amazonaws.com/mcp/open-engine" \
OPEN_ENGINE_BEARER="<private bearer>" \
THINKWORK_TENANT_ID="<tenant uuid>" \
OPEN_ENGINE_AGENT_ID="codex" \
OPEN_ENGINE_QUEUE_KEY="codex" \
node scripts/open-engine-one-task-runner.mjs --mode verify
```

`prepare` claims one Work Item, fetches the context packet and previewable
documents, updates that Work Item's status ledger, and prints a Codex prompt:

```bash
OPEN_ENGINE_MCP_URL="https://<api-id>.execute-api.<region>.amazonaws.com/mcp/open-engine" \
OPEN_ENGINE_BEARER="<private bearer>" \
THINKWORK_TENANT_ID="<tenant uuid>" \
OPEN_ENGINE_AGENT_ID="codex" \
OPEN_ENGINE_QUEUE_KEY="codex" \
OPEN_ENGINE_STANDING_CONTEXT_WORK_ITEM_ID="<standing context work item uuid>" \
OPEN_ENGINE_ROUTING_MAP_DOCUMENT_ID="<routing map document uuid>" \
OPEN_ENGINE_SKILL_DIRECTORY_DOCUMENT_ID="<optional skill directory document uuid>" \
node scripts/open-engine-one-task-runner.mjs \
  --mode prepare \
  --prompt-file /tmp/thinkwork-open-engine-task.md
```

Do not commit bearer tokens, tenant IDs that should stay private, generated
prompt files, or local MCP client config.

## Required Inputs

| Input                                 | Purpose                                                   |
| ------------------------------------- | --------------------------------------------------------- |
| `OPEN_ENGINE_MCP_URL` / `--endpoint`  | The deployed `/mcp/open-engine` endpoint.                 |
| `OPEN_ENGINE_BEARER` / `--bearer`     | Private OAuth or service bearer. Prefer env.              |
| `THINKWORK_TENANT_ID` / `--tenant-id` | Tenant scope for service bearer auth.                     |
| `OPEN_ENGINE_AGENT_ID` / `--agent`    | ThinkWork agent UUID, slug, name, or workspace folder.    |
| `OPEN_ENGINE_QUEUE_KEY` / `--queue`   | Queue to poll, such as `codex`, `claude`, or `thinkwork`. |
| `OPEN_ENGINE_LABEL_SLUGS` / `--label` | Optional label filters.                                   |
| `OPEN_ENGINE_SPACE_ID` / `--space-id` | Optional Space/project filter.                            |

## Standing Context Inputs

These inputs are optional for local smoke tests, but they are the expected
production cold-start contract for recurring OpenEngine runners:

| Input                                                                          | Purpose                                                                 |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `OPEN_ENGINE_STANDING_CONTEXT_WORK_ITEM_ID` / `--standing-context-work-item-id` | Work Item that stores private setup, SOPs, boundaries, and agent notes. |
| `OPEN_ENGINE_STANDING_CONTEXT_DOCUMENT_IDS` / `--standing-context-document`     | Additional standing-context document IDs. Repeat or comma-separate.     |
| `OPEN_ENGINE_ROUTING_MAP_DOCUMENT_ID` / `--routing-map-document`                | Owner/queue map for Codex, Claude, ThinkWork agent, and humans.         |
| `OPEN_ENGINE_SKILL_DIRECTORY_DOCUMENT_ID` / `--skill-directory-document`        | Optional skill directory and subscription state.                        |
| `OPEN_ENGINE_MAX_STANDING_CONTEXT_DOCS` / `--max-standing-context-docs`         | Max documents fetched from the standing-context Work Item.              |

Standing context should be stored as durable Work Item, Space, or tenant
documents. A simple v1 setup uses one Standing Work Item in the OpenEngine Space
with these resources attached:

- **Private setup context**: repo paths, MCP endpoint/auth notes, allowed
  sources, account boundaries, approval rules, and current operating warnings.
- **Routing map**: queue keys, agent identities, human operators, ownership
  boundaries, and handoff rules.
- **Optional skill directory**: skills available to agents, subscription state,
  approved scope, installed version, and update policy.

The runner uses existing `/mcp/open-engine` document tools for this material.
No separate database model is required for this slice.

## Safety Contract

- `verify` never claims work.
- `prepare` fetches configured standing context before any queue claim.
- `prepare` lists visible work before claim and then atomically calls
  `open_engine_claim_next`.
- A run stops after one claimed Work Item.
- If no eligible Work Item is visible, no claim is attempted.
- If the claim race loses, the runner returns `no_work`.
- The generated prompt explicitly tells the agent not to claim another item.
- The generated prompt carries the standing context, routing-map, and optional
  skill contract into the one-task session.
- Status ledger evidence is written to the claimed Work Item before the helper
  exits.
- The coding agent must still record the final `done`, `review`, `blocked`,
  `human_hold`, or `failed` state through MCP after it performs the task.

## Work Item Timeline Model

The Work Item timeline separates narrative comments from lower-level activity.
Agent-facing receipts such as `AGENT CLAIMED`, `AGENT STATUS`, `AGENT REVIEW`,
blockers, and `AGENT DONE` should render as comments so humans can read the
handoff in order. Work Item property, resource, and status changes remain
activity events.

Status ledger documents stay machine-readable evidence. They should be linked
from the OpenEngine state surface rather than replacing the comment timeline.

## Cold-Start Order

Every recurring runner should follow this order:

1. Verify `/mcp/open-engine` access with `open_engine_verify_connection`.
2. Resolve agent identity and queue key.
3. Fetch configured standing context before polling for new task work.
4. Read the routing map so handoffs target a known queue or human operator.
5. Read the optional skill directory. Discoverable skills are informational;
   they are not automatically installed.
6. Inspect queue snapshot and eligible Work Items.
7. Claim exactly one Work Item atomically.
8. Fetch the claimed Work Item context and task documents progressively.
9. Execute the task, recording comments, receipts, status ledger evidence, and
   final state through `/mcp/open-engine`.

## Optional Skill Contract

Optional standing skills are not ambient authority. They are a documented
subscription choice:

- `available`: the skill is discoverable but not approved for automatic use.
- `subscribed`: the operator approved the skill for a specific scope.
- `installed`: the runtime installed the subscribed skill at a recorded version.
- `updated`: the runtime refreshed an installed skill within the same approved
  scope.
- `declined`: the runtime chose not to install or update, usually because the
  scope changed or human approval is missing.

Use `open_engine_record_receipt` with `skill_subscribed`, `skill_installed`,
`skill_updated`, or `skill_declined` when a runner changes or explicitly
declines optional skill state. Scope expansion requires a human answer before
install/update.

## Routing Map Convention

The routing map should answer:

- Which queue keys exist (`codex`, `claude`, `thinkwork`, `human`, etc.).
- Which agent identities are allowed to claim each queue.
- Which human operator owns each queue.
- Which Spaces/projects each queue usually serves.
- Which actions require human approval.
- What to do when a target queue is unavailable.

If a task needs handoff and the routing map does not identify a valid target,
the agent should record a blocker or human hold instead of guessing.

## Codex Recurring Prompt

Use this prompt as the recurring job body after running the helper in `prepare`
mode and passing the generated prompt to Codex:

```markdown
Use ThinkWork OpenEngine as the runtime queue.

1. Run `node scripts/open-engine-one-task-runner.mjs --mode prepare`.
2. Read the generated one-task prompt.
3. Read the standing context, routing map, and optional skill directory included
   in the generated prompt before touching task work.
4. Work only the claimed Work Item in that prompt.
5. Use `/mcp/open-engine` tools for context, documents, receipts, status ledger,
   and final state.
6. Do not claim any additional Work Item.
7. Do not use Linear as the runtime queue.
8. Stop when the claimed Work Item is complete, in review, blocked, held, or
   failed with durable evidence.
```

## Claude Setup

Claude uses the same helper and prompt flow. Change only the runtime identity:

```bash
OPEN_ENGINE_AGENT_ID="claude" \
OPEN_ENGINE_QUEUE_KEY="claude" \
node scripts/open-engine-one-task-runner.mjs --mode prepare
```

If `claude` does not resolve, run `--mode verify` and pick an agent slug or ID
from `availableAgents`.

## Nate OpenEngine Parity

Nate's guide uses Linear as the shared queue. ThinkWork maps the same operating
surface to Work Items:

| Nate OpenEngine concept                                      | ThinkWork OpenEngine implementation                                          |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Linear team/project                                          | Tenant + Space/project organization.                                         |
| Agent Todo / Working / Needs Input / Review / Done           | Work Item status model plus OpenEngine queue fields.                         |
| `agent-instructions` label and title brackets                | Work Item labels, queue key, owner agent/user, and routing metadata.         |
| Private setup issue                                          | Standing Work Item documents and repo-local agent bootstrap docs.            |
| Mandatory standing context preflight                         | Runner fetches configured standing context before queue claim.               |
| Optional standing skills                                     | Skill directory documents plus skill subscription/install/update receipts.   |
| Agent routing map                                            | Routing-map document plus OpenEngine queue keys and handoff tool.            |
| Status comment updated in place                              | Per-Work Item status ledger document.                                        |
| Runner checks holds, blockers, delegated work, then one task | MCP queue snapshot, Work Item state, receipts, handoff, and one-task prompt. |
| Receipts in comments                                         | Narrative agent receipts render as comments; property changes stay events.   |
| Smoke test issue                                             | Real ThinkWork Work Item dogfood via `/mcp/open-engine`.                     |
| Team routing                                                 | OpenEngine queue keys and `open_engine_handoff_work_item`.                   |

Known intentional difference: ThinkWork does not maintain one global status
comment per agent in this slice. Queue-level visibility comes from
`open_engine_queue_snapshot`; task-level visibility comes from the Work Item
status ledger and activity surface.

## Failure Modes

| Symptom                        | Meaning                                                       | Recovery                                                                |
| ------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Missing config error           | Required endpoint, bearer, tenant, agent, or queue is absent. | Set env vars or pass CLI flags.                                         |
| Agent identity did not resolve | The supplied agent ID/slug/name is unknown or archived.       | Run `--mode verify` and use `availableAgents`.                          |
| Missing MCP tool error         | Dev deploy is stale or pointed at the wrong endpoint.         | Confirm PR deploy and endpoint URL.                                     |
| `no_work`                      | No eligible item is visible or claim race lost.               | Inspect queue snapshot, filters, routing, holds, blockers, and claims.  |
| Fetch document failure         | Document is binary or unavailable.                            | Fetch only needed docs progressively; use metadata/download path later. |
| Missing standing context       | Runner was not configured with the private context packet.     | Set standing context Work Item/document env vars before automation.     |
| Unknown handoff target         | Routing map does not name the queue or human operator.         | Record blocker/human hold and update the routing map.                   |

## Verification

Focused local verification:

```bash
node --test scripts/__tests__/open-engine-one-task-runner.test.mjs
```

Deployed smoke verification:

```bash
node scripts/open-engine-one-task-runner.mjs --mode verify --json
```

End-to-end dogfood verification uses `prepare` against a real Work Item, then a
Codex session follows the emitted prompt and records the final state through
`/mcp/open-engine`.

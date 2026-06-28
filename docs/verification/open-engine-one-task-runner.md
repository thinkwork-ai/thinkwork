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
2. inspect the routed queue,
3. claim exactly one eligible Work Item,
4. fetch context and documents progressively,
5. write status ledger evidence, and
6. emit the execution prompt for the claimed Work Item.

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

## Safety Contract

- `verify` never claims work.
- `prepare` lists visible work before claim and then atomically calls
  `open_engine_claim_next`.
- A run stops after one claimed Work Item.
- If no eligible Work Item is visible, no claim is attempted.
- If the claim race loses, the runner returns `no_work`.
- The generated prompt explicitly tells the agent not to claim another item.
- Status ledger evidence is written to the claimed Work Item before the helper
  exits.
- The coding agent must still record the final `done`, `review`, `blocked`,
  `human_hold`, or `failed` state through MCP after it performs the task.

## Codex Recurring Prompt

Use this prompt as the recurring job body after running the helper in `prepare`
mode and passing the generated prompt to Codex:

```markdown
Use ThinkWork OpenEngine as the runtime queue.

1. Run `node scripts/open-engine-one-task-runner.mjs --mode prepare`.
2. Read the generated one-task prompt.
3. Work only the claimed Work Item in that prompt.
4. Use `/mcp/open-engine` tools for context, documents, receipts, status ledger,
   and final state.
5. Do not claim any additional Work Item.
6. Do not use Linear as the runtime queue.
7. Stop when the claimed Work Item is complete, in review, blocked, held, or
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
| Private setup issue                                          | Work Item documents and repo-local agent bootstrap docs.                     |
| Status comment updated in place                              | Per-Work Item status ledger document.                                        |
| Runner checks holds, blockers, delegated work, then one task | MCP queue snapshot, Work Item state, receipts, handoff, and one-task prompt. |
| Receipts in comments                                         | Durable Work Item activity/events and status ledger documents.               |
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

---
title: OpenEngine MCP agent bootstrap
date: 2026-06-28
module: open-engine
problem_type: setup
tags:
  - open-engine
  - mcp
  - work-items
  - agents
---

# OpenEngine MCP Agent Bootstrap

External agents use ThinkWork Work Items as the OpenEngine runtime queue through
`/mcp/open-engine`. The first step for Codex, Claude, or another MCP-capable
agent is to verify auth, tenant scope, agent identity, and queue visibility
before polling or claiming work.

## Endpoint

Use the deployed API base for the target stage:

```text
https://<api-id>.execute-api.<region>.amazonaws.com/mcp/open-engine
```

The dev endpoint is currently discovered from the deployed stack. Do not hardcode
it in committed config.

## Authentication

Supported auth paths:

- First-party ThinkWork user/session auth when the caller has a valid Cognito
  session.
- Service bearer auth for trusted runtime automation, with tenant scope supplied
  by `x-tenant-id`.

Never commit bearer tokens, Cognito tokens, or tenant secrets. Keep local MCP
client configuration in the agent runner's private config store.

## Agent Identity

OpenEngine receipts and claims are recorded against a real ThinkWork tenant
agent. MCP callers may pass:

- the agent UUID,
- the agent slug,
- the agent name,
- or the agent workspace folder name.

If an identity cannot be resolved, call `open_engine_verify_connection` and use
one of the returned `availableAgents` IDs or slugs.

## Connection Verification

Before queue polling, call:

```json
{
  "tool": "open_engine_verify_connection",
  "arguments": {
    "agentId": "codex",
    "queueKey": "codex"
  }
}
```

Expected result:

- `ok: true`
- `auth.scopePresent: true`
- `tenant.id` is present
- `agentResolution: "resolved"`
- `agent.id` is a ThinkWork agent UUID
- `queue.snapshot` is present for the requested queue

If the result says `agentResolution: "not_found"`, pick an identity from
`availableAgents` and retry.

## Codex Setup Prompt

Use this when configuring Codex against ThinkWork OpenEngine:

```markdown
Connect to ThinkWork OpenEngine MCP at `/mcp/open-engine`.

Before taking work:

1. Call `open_engine_verify_connection` with `agentId: "codex"` and
   `queueKey: "codex"`.
2. Confirm auth, tenant, and agent identity resolve successfully.
3. If `codex` does not resolve, use an agent ID or slug from `availableAgents`.
4. List eligible work with `open_engine_list_work_items`.
5. Claim at most one item with `open_engine_claim_next`.
6. Fetch context and documents progressively.
7. Record receipts/status ledger updates.
8. Complete, block, or hand off the item through OpenEngine tools.

Do not use Linear as the runtime queue.
```

## Claude Setup Prompt

Use the same flow with `agentId: "claude"` and `queueKey: "claude"`:

```markdown
Connect to ThinkWork OpenEngine MCP at `/mcp/open-engine`.

Run `open_engine_verify_connection` before polling. Use `agentId: "claude"` and
`queueKey: "claude"`. If the friendly identity does not resolve, select the
correct ThinkWork agent from `availableAgents`.

After verification, process at most one Work Item per run and leave durable
receipts/status ledger evidence on the Work Item.
```

## Failure Guide

| Symptom                                            | Likely cause                                                                         | Fix                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `401 unauthorized`                                 | Expired user token, missing bearer, or invalid bearer                                | Refresh login or rotate runtime bearer                             |
| `Could not resolve authenticated ThinkWork caller` | Missing tenant scope                                                                 | Add `x-tenant-id` for service bearer or use valid first-party auth |
| `Could not resolve OpenEngine agent identity`      | Agent ID/slug/name is wrong or archived                                              | Run `open_engine_verify_connection` and use `availableAgents`      |
| No eligible Work Items                             | Queue has no ready work, wrong queue key, human hold, blocked, scheduled, or claimed | Inspect `queue.snapshot` and Work Item context                     |

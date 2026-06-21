---
name: n8n-workflow-operator
description: Create, update, validate, test, and debug n8n workflows through ThinkWork's managed n8n MCP tools. Use when a request names n8n, workflows, executions, Code node packages, workflow migration, automation drafts, or asks to create an automation from a thread.
license: Apache-2.0
compatibility: ThinkWork n8n plugin with managed n8n MCP tools and a tenant n8n instance.
metadata:
  thinkwork-plugin: n8n
  skill-format: agentskills
---

# n8n Workflow Operator

Use n8n as a shared tenant automation runtime. Read live workflow and node
state, make draft-safe changes, validate the result, and leave production
activation to the shared native n8n operator unless the human explicitly says
otherwise.

## First Move

1. Use this skill before any n8n workflow create, update, validation, test, or
   debug action.
2. Use the n8n MCP tools provided by the installed ThinkWork n8n plugin. The
   plugin uses a tenant service credential, not per-user n8n activation.
3. If n8n tools are missing, report that the operator must install the n8n
   plugin, deploy the managed app, enable instance-level MCP in n8n, and enable
   MCP access on the workflow, project, or folder.
4. Trust live MCP tool descriptions and node schemas over memory. n8n changes
   quickly; if a live tool or schema disagrees with this skill, follow the live
   tool and report the drift in the handoff.

## Authoring Loop

For requests such as "create a workflow", "edit this workflow", or "make a
smoke test":

1. Classify the pattern: manual trigger, webhook, schedule, HTTP API
   integration, database sync, AI agent, or batch processing.
2. Read [MCP tooling](references/mcp-tooling.md), then discover live node
   schemas before configuring nodes.
3. Read [workflow authoring](references/workflow-authoring.md), then create or
   update an inactive draft. Use UUID-shaped node ids, current `typeVersion`
   values, and no placeholder credentials or secrets.
4. Validate iteratively. Treat validation errors as normal feedback: fix the
   specific field, then validate again.
5. Fetch the workflow after every create or update and inspect `connections` so
   silently dropped or wrong wires are caught before handoff.
6. Test only when safe. n8n test runs execute real HTTP calls, writes, sends,
   and other side effects.
7. Finish with [validation and handoff](references/validation-and-handoff.md).

## ThinkWork Agent-Step Bridge

1. For n8n-to-ThinkWork agent work, use the v1 agent-step bridge with stock
   HTTP Request and Wait nodes. Do not suggest a custom ThinkWork n8n node in
   v1.
2. The HTTP Request node calls ThinkWork's
   `/api/integrations/n8n/agent-steps` endpoint with the separate inbound
   bridge credential. Do not reuse the native n8n MCP service credential.
3. The workflow must pass target Space, target agent, instructions, structured
   input, workflow id/name, execution id, step id, correlation id, optional
   request id, optional timeout, and the current Wait-node resume URL from
   `$execution.resumeUrl`.
4. The Wait node should use On webhook call. Downstream nodes should branch on
   the resumed payload's `status` and read `output`, `error`, `summary`,
   and `links`; they should not scrape ThinkWork thread pages.
5. Explain idempotency as workflow id + execution id + correlation id + step
   id. Retrying the same bridge step should recover or replay the existing
   ThinkWork thread rather than creating a duplicate.

## Stop Conditions

Stop before writing when multiple workflows match, the workflow/project/folder
does not have MCP access enabled, credentials are unknown, a test would touch
production side effects, the user asks for production activation without using
the native n8n operator account, or the live MCP tool surface conflicts with
the requested action.

---
name: lastmile-tasks
description: >
  Propose LastMile task creation for user approval, and enumerate terminals
  so the agent can pick one. Use when the user asks to create a task, ticket,
  or work item that should land in LastMile.
license: Proprietary
metadata:
  author: thinkwork
  version: "1.0.0"
---

# LastMile Tasks Skill

## When to use

The user wants a task created in LastMile (their external task system).
Typical triggers: "file a task", "create a ticket", "send this to LastMile",
"make a task in Houston for the blocked shipment".

## Flow

1. From the conversation, extract a working **title** and, if possible, a
   **terminal**. If the terminal is ambiguous or missing, call
   `list_terminals` and ask the user which one.
2. Once you have title + terminalId, call `propose_task_create`. This does
   **not** create the task in LastMile immediately — it writes an inbox
   item the user sees as a confirmation card in their inbox.
3. Tell the user you've proposed the task and point them at the inbox card
   to confirm. When they approve, the backend fires `POST /tasks` on
   LastMile and stamps this thread as synced.

## Safety rules

1. **One propose per thread** — do not call `propose_task_create` twice for
   the same thread without the user explicitly asking. The current thread
   id is `$CURRENT_THREAD_ID` and the inbox item is scoped to it.
2. **Don't invent terminal ids** — only pass a `terminalId` you got from
   `list_terminals` or that the user stated literally. A fabricated id
   will 4xx from LastMile on approval.
3. **Same tenant only** — scripts run against `$TENANT_ID`. Cross-tenant
   task creation is not allowed.

## Environment

Uses: `THINKWORK_API_URL`, `THINKWORK_API_SECRET`, `TENANT_ID`, `AGENT_ID`,
`CURRENT_THREAD_ID`.

## Operations

| Operation            | Purpose                                                             |
|----------------------|---------------------------------------------------------------------|
| `list_terminals`     | GET `lastmileTerminals` query — returns the user's terminals.       |
| `propose_task_create`| `createInboxItem` mutation with `type='create_task'`.               |

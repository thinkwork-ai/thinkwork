---
name: lastmile-tasks
description: >
  Gather intake details for a new LastMile task via a Question Card,
  then hand off to the LastMile MCP's `workflow_task_create` tool.
  Use on user-created task threads where the external task hasn't been
  minted yet (`syncStatus='local'`).
license: Proprietary
metadata:
  author: thinkwork
  version: "3.0.0"
---

# LastMile Task Intake

You help users create LastMile tasks by collecting intake details in a
Question Card, then asking the LastMile MCP to create the task.

## When to run

A user creates a task-channel thread (mobile Tasks tab → `+` → pick a
workflow → type a title → send). You receive their title as the first
message. The thread has `channel=task`, `type=task`, and
`metadata.workflowId` set. It sits in `syncStatus='local'` until this
flow completes.

Skip this flow if the thread already has
`metadata.external.externalTaskId` — the task exists on LastMile
already (webhook inbound or prior agent run).

## Pick your path

Look at your system prompt. If you see a `## Workflow Skill` section
(injected from the thread's LastMile workflow), take the
**workflow-skill path** below. Otherwise, take the **legacy path**.

## Workflow-skill path

1. Read the form schema from the `## Workflow Skill → ### Form schema`
   fenced JSON block in your system prompt. Copy it verbatim — do NOT
   edit field ids or types.
2. Call `present_form` with `form_json` set to the exact schema JSON:

   ```
   present_form(
     form_json=<the JSON block from ### Form schema>,
     prefill_json=""
   )
   ```

   Send one short message telling the user to fill in the form, then
   STOP. Do not call any other tool in the same turn.
3. The user's next message contains a fenced ```form_response block
   with the submitted values. Call the LastMile MCP's
   `workflow_task_create` tool, passing the workflowId and the entire
   form_response object:

   ```
   workflow_task_create(
     workflowId=<the exact value under "Workflow ID" in the ## Workflow Skill block — NOT the form id, NOT your agent instance_id, and NOT a slug-looking string. Copy it verbatim.>,
     formResponse={"form_id": "<from form_response>", "values": {...}},
     threadTitle=<thread title>,
     creator={"email": "<user email>"}
   )
   ```

   Do not flatten values or resolve IDs yourself — LastMile maps the
   form values against the workflow's own schema and picks the correct
   team/status/taskType/default-assignee server-side. That's the whole
   point of using `workflow_task_create` over `task_create`.
4. On success, summarize in one sentence per any guidance in the
   workflow's `### Instructions` block. If the workflow doesn't specify
   a summary style, one short sentence naming the task id is fine.
   Then stop.

## Legacy path

Used when no `## Workflow Skill` block is present in context. This is
the "generic" LastMile task — no workflow-specific form schema shipped
by the workflow owner, so we fall back to a minimal 4-field intake.

1. Call `present_form` with the hardcoded intake schema:

   ```
   present_form(
     form_path="lastmile-tasks/references/task-intake-form.json",
     prefill_json=""
   )
   ```

   Send one short message, STOP.
2. Read the `form_response` from the user's next message. Shape:

   ```
   {
     "form_id": "lastmile_task_intake",
     "values": {
       "description": "...",
       "priority": "high",
       "due_date": "2026-04-20",
       "assignee_email": ""
     }
   }
   ```

3. Call the LastMile MCP's `task_create` tool directly. You'll need to
   resolve the workflow's default status + team + taskType first via
   `workflows_get` and `workflow_statuses_list`. The workflowId is on
   `thread.metadata.workflowId`.
4. Summarize in one sentence with the task id and priority, e.g.
   "Created `task_abc123` in LastMile (High priority)."

## Gotchas

- `prefill_json` is a JSON-encoded string, not a Python dict. Pass `""`
  when there's nothing to prefill.
- `present_form` requires **exactly one** of `form_path` or `form_json`
  — never both, never neither.
- After `present_form`, STOP. Do not call any other tool in the same
  turn.
- On the workflow-skill path, pass the form_response as an **object**
  (not a JSON string). The MCP's schema expects
  `formResponse: {form_id, values}` directly.
- If the MCP returns an error, tell the user plainly and offer to try
  again — don't silently retry.

---
name: lastmile-tasks
description: >
  Gather intake details for a new LastMile task via a Question Card form,
  then fire the create. Use on user-created task threads where the external
  task hasn't been minted yet (`syncStatus='local'`). Dispatches between a
  workflow-specific form (when the system prompt carries a `## Workflow
  Skill` block) and the generic hardcoded form otherwise.
license: Proprietary
metadata:
  author: thinkwork
  version: "2.0.0"
---

# LastMile Task Intake

You help users create LastMile tasks by asking a short set of intake
questions up front. Always use a Question Card form — never ask the
questions one at a time conversationally.

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

The workflow-skill path is preferred whenever it's available — its
form is tailored to the specific workflow the user picked, and its
instructions may override the tone or behavior described below.

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
   with the submitted values. Copy the **entire** form_response JSON
   (including the outer `{form_id, values}`) and pass it to
   `create_task`:

   ```
   create_task(
     form_response_json=<the entire form_response JSON as a string>
   )
   ```

   Do not parse the values and pass them as per-column kwargs on this
   path — LastMile maps them against the workflow's own schema.
4. On success, summarize in one sentence per any guidance in the
   workflow's `### Instructions` block. If the workflow doesn't specify
   a summary style, one short sentence naming the external task id is
   fine. Then stop.

## Legacy path

Used when no `## Workflow Skill` block is present in context.

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

   `priority` is always present; the rest can be empty strings.
3. Call `create_task` with the per-column kwargs:

   ```
   create_task(
     description=values.description,
     priority=values.priority,
     due_date=values.due_date,
     assignee_email=values.assignee_email,
   )
   ```

4. Summarize in one sentence with the external task id and priority,
   e.g. "Created `task_abc123` in LastMile (High priority)."

## Shared

`create_task` returns `{externalTaskId, threadId, syncStatus}` on
success or `{error}` on failure. If it errors, tell the user plainly
what went wrong and offer to try again — don't silently retry.

## Gotchas

- `prefill_json` is a JSON-encoded string, not a Python dict. Pass `""`
  when there's nothing to prefill.
- `present_form` requires **exactly one** of `form_path` or `form_json`
  — never both, never neither.
- After `present_form`, STOP. Do not call any other tool in the same
  turn.
- On the workflow-skill path, pass the entire form_response JSON
  (including the `form_id` key) as `form_response_json`. A values-only
  payload will be rejected.
- On the legacy path, `assignee_email=""` → the task is assigned to
  the thread creator. Only pass a non-empty value if the user
  explicitly named someone.
- `create_task` is idempotent on the thread — re-calling it after a
  successful create is a no-op (the thread's `metadata.external`
  guards against duplicates).

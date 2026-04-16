---
name: lastmile-tasks
description: >
  Gather intake details for a new LastMile task via a single Question Card form,
  then fire the create. Use on user-created task threads where the external task
  hasn't been minted yet (`syncStatus='local'`).
license: Proprietary
metadata:
  author: thinkwork
  version: "1.0.0"
---

# LastMile Task Intake

You help users create LastMile tasks by asking a short, standard set of
intake questions up front. Don't ask them one at a time — use the
Question Card form.

## When to run

A user creates a task-channel thread (mobile Tasks tab → `+` → pick a
workflow → type a title → send). You receive their title as the first
message. The thread has `channel=task`, `type=task`, and
`metadata.workflowId` set. It sits in `syncStatus='local'` until this
flow completes.

Skip this flow if the thread already has
`metadata.external.externalTaskId` — the task exists on LastMile
already (webhook inbound or prior agent run).

## Workflow

- [ ] Step 1: Present the intake form
- [ ] Step 2: Wait for `form_response`
- [ ] Step 3: Call `create_task`
- [ ] Step 4: Confirm in one sentence

## Step 1 — Present the intake form

Call `present_form` exactly once. Prefill only values that the user's
opening message clearly stated (rare for tasks — most details come
from the form):

```
present_form(
  form_path="lastmile-tasks/references/task-intake-form.json",
  prefill_json=""
)
```

Then send ONE short message telling the user to fill in the form, and
STOP. Do not call other tools in the same turn.

## Step 2 — Read the form_response

The user's next message contains a fenced ```form_response block with
the submitted values:

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

## Step 3 — Create the task

Call `create_task` with the form values verbatim:

```
create_task(
  description=values.description,
  priority=values.priority,
  due_date=values.due_date,
  assignee_email=values.assignee_email,
)
```

`create_task` returns `{externalTaskId, threadId, syncStatus}` on
success or `{error}` on failure. If it errors, tell the user plainly
what went wrong and offer to try again — don't silently retry.

## Step 4 — Summarize

One sentence with the external task id and priority, e.g.
"Created `task_abc123` in LastMile (High priority)." Then stop.

## Gotchas

- `prefill_json` is a JSON-encoded string, not a Python dict. If
  nothing to prefill, pass `""`.
- After `present_form`, STOP — wait for the `form_response`. Don't
  call any other tool in the same turn.
- `assignee_email` empty → task is assigned to the thread creator.
  Only pass a non-empty value if the user explicitly named someone.
- `create_task` is idempotent on the thread — re-calling it after a
  successful create is a no-op (the thread's `metadata.external`
  guards against duplicates).

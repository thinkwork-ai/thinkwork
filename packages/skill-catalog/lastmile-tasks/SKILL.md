---
name: lastmile-tasks
description: >
  Collect task intake via a Question Card form, then create the task in
  LastMile via the MCP's workflow_task_create tool. Runs automatically on
  task-channel threads where the external task hasn't been minted yet.
license: Proprietary
metadata:
  author: thinkwork
  version: "4.0.0"
---

# LastMile Task Intake

**Your job on this thread is to run the form flow below. You MUST use the
`present_form` tool to render a Question Card. You MUST NOT reply with a
bullet list of questions in plain text — that's a regression we are
actively preventing.**

## When to run

Run this flow unconditionally on the first turn of any task-channel
thread. You'll see these signals:

- The thread has `channel=task` and `type=task`.
- `metadata.workflowId` is set (the LastMile workflow the user picked).
- The user's first message is a short task title (e.g. "Fix the OAuth
  issue").
- `sync_status='local'` — the LastMile task hasn't been created yet.

**Skip this flow only** when the thread already has
`metadata.external.externalTaskId` set — that means the task was
already minted in a previous turn and you shouldn't create a duplicate.

## Flow — execute these steps, in order

### Step 1 — Present the form

Call the `present_form` tool (from the `agent-thread-management` skill)
with the intake schema shipped in this skill's references folder:

```
present_form(
  form_path="lastmile-tasks/references/task-intake-form.json",
  prefill_json=""
)
```

Then send ONE short acknowledgement message to the user, for example:
"Opened a short form — fill it in and tap Create task." Then **STOP**.
Do not call any other tool in the same turn. Do not preview the form
fields in text. Do not ask follow-up questions.

### Step 2 — Wait for the form submission

The user's next message will contain a fenced ```form_response``` block
with their submitted values. The shape is:

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

### Step 3 — Create the task in LastMile

Call the LastMile MCP's `workflow_task_create` tool. Pass the
workflowId from `thread.metadata.workflowId` **verbatim** (don't guess;
don't substitute your agent id or the form id). Pass the entire
`form_response` block as-is under `formResponse`:

```
workflow_task_create(
  workflowId=<thread.metadata.workflowId>,
  formResponse={"form_id": "<from form_response>", "values": {...}},
  threadTitle=<thread title>,
  creator={"email": "<user email>"}
)
```

Do not flatten `values` or translate priority / due_date into other
formats — LastMile maps the submitted values against the workflow's
own schema server-side. That's the whole point of using
`workflow_task_create` over `task_create`.

### Step 4 — Confirm

On success, reply with **one short sentence** naming the new task id,
e.g. "Created `task_abc123` in LastMile." Then stop.

On error, tell the user plainly what went wrong and offer to try again.
Do not silently retry.

## Hard rules

- NEVER respond with a bullet list of intake questions. ALWAYS call
  `present_form` on the first turn.
- `prefill_json` is a JSON-encoded **string** (pass `""` when empty),
  NOT a Python dict.
- `present_form` takes EXACTLY ONE of `form_path` or `form_json` —
  never both, never neither.
- After `present_form`, STOP. No other tool in the same turn.
- Pass `formResponse` to `workflow_task_create` as an **object**
  (`{form_id, values}`), not as a JSON string.
- If you can't find `workflow_task_create` in your tool list, the
  LastMile MCP isn't connected — surface that to the user with
  actionable next steps (Settings → MCP Servers → LastMile Tasks →
  Connect). Do not fall back to typing questions.

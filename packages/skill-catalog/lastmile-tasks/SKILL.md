---
name: lastmile-tasks
display_name: LastMile Tasks
description: >
  Collect task intake via a Question Card form, then create the task in
  LastMile via the MCP's workflow_task_create tool. Runs automatically on
  task-channel threads where the external task hasn't been minted yet.
license: Proprietary
metadata:
  author: thinkwork
  version: "5.0.0"
category: task-management
version: "3.0.0"
author: thinkwork
icon: clipboard-list
tags: [tasks, lastmile, intake, forms]
execution: context
is_default: true
triggers:
  - "create a lastmile task"
  - "new lastmile task"
  - "file a task"
  - "make a ticket"
---

# LastMile Task Intake

**Your job on this thread is to run the form flow below. You MUST use
the `present_form` tool to render a Question Card. You MUST NOT reply
with a bullet list of questions in plain text — that's a regression
we are actively preventing.**

## When to run

Run this flow unconditionally on the first turn of any task-channel
thread. You'll see these signals:

- The thread has `channel=task` and `type=task`.
- `metadata.workflowId` is set (the LastMile workflow the user picked).
- The user's first message is a short task title (e.g. "Fix the OAuth
  issue").
- `sync_status='local'` — the LastMile task hasn't been created yet.

**Skip this flow only** when the thread already has
`metadata.external.externalTaskId` set — the task was already minted
previously and you must not create a duplicate.

## Read your Workflow Skill block BEFORE calling any tool

Scroll up in your system prompt and find the section titled
`## Workflow Skill`. It is injected by the runtime whenever the
thread's workflow ships its own skill configuration. The block contains:

- **Workflow ID** — the exact string you must pass as `workflowId`
  when you call `workflow_task_create`. Copy it **verbatim**. Do NOT
  paraphrase, guess, substitute your own agent id, or pass the literal
  text `<thread.metadata.workflowId>` or `{{thread.metadata.workflowId}}`.
  If you cannot find the block, STOP and tell the user the workflow
  wasn't linked — don't invent an id.
- **Instructions** (optional) — workflow-specific guidance you MUST
  follow for tone, guardrails, and confirmation style.
- **Form schema** (optional) — a JSON schema you MUST pass to
  `present_form` via `form_json`, ignoring the static fallback.

## Flow — execute these steps, in order

### Step 1 — Present the form

**If the `## Workflow Skill` block has a `### Form schema`** (fenced
JSON block): pass that schema verbatim via `form_json`:

```
present_form(
  form_json=<the JSON object from the fenced block, as a string>,
  prefill_json=""
)
```

**Otherwise** (no `## Workflow Skill` block, or block has no form):
fall back to the hardcoded intake schema shipped with this skill:

```
present_form(
  form_path="lastmile-tasks/references/task-intake-form.json",
  prefill_json=""
)
```

Then send ONE short acknowledgement message — "Opened a short form —
fill it in and tap Create task." — and **STOP**. Do not call any other
tool in the same turn. Do not preview the fields in text. Do not ask
follow-up questions.

### Step 2 — Wait for the form submission

The user's next message will contain a fenced ```form_response``` block
with their submitted values. The shape is:

```
{
  "form_id": "<whatever the schema's id is>",
  "values": { ... }
}
```

### Step 3 — Create the task in LastMile

Call the LastMile MCP's `workflow_task_create` tool. Use the **exact
Workflow ID** from your `## Workflow Skill` block (copy-paste; don't
paraphrase). Pass the entire `form_response` block as-is under
`formResponse`:

```
workflow_task_create(
  workflowId="<exact string from ## Workflow Skill → Workflow ID>",
  formResponse={"form_id": "<from form_response>", "values": {...}},
  threadTitle="<thread title>",
  creator={"email": "<user email>"}
)
```

Do not flatten `values` or translate priority / due_date into other
formats — LastMile maps the submitted values against the workflow's
own schema server-side.

### Step 4 — Confirm

On success, follow any guidance from the `### Instructions` part of
the `## Workflow Skill` block. If no custom guidance, reply with
**one short sentence** naming the new task id,
e.g. "Created `task_abc123` in LastMile." Then stop.

On error, tell the user plainly what went wrong and offer to try
again. Do not silently retry.

## Hard rules

- NEVER respond with a bullet list of intake questions. ALWAYS call
  `present_form` on the first turn.
- NEVER pass a placeholder string like `<thread.metadata.workflowId>`
  or `{{thread.metadata.workflowId}}` as the `workflowId` argument.
  Copy the real value from your `## Workflow Skill` block. If the
  block is missing, STOP and surface the issue to the user.
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

---
name: customer-onboarding
display_name: Customer Onboarding
description: Onboard a new customer by gathering information and creating tasks for the team. Handles intake questions, conditional task creation, user assignment, and deadline tracking.
category: operations
version: "1.1.0"
author: thinkwork
icon: user-plus
tags: [onboarding, tasks, operations, customers]
execution: context
triggers:
  - "onboard a customer"
  - "new customer onboarding"
  - "start onboarding"
  - "onboard"
  - "new customer"
---

# Customer Onboarding

You help onboard new customers by gathering information and creating tasks for the team.

## Workflow

- [ ] Step 1: Present intake form (single form, all questions at once)
- [ ] Step 2: Wait for the user's `form_response` and confirm
- [ ] Step 3: Create tasks — read `references/task-specs.md`, then create all sub-tasks
- [ ] Step 4: Promote — call `promote_to_task` to convert this thread
- [ ] Step 5: Follow-up — schedule deadline reminder if applicable
- [ ] Step 6: Summarize — list what was created

## Step 1: Present the intake form

DO NOT ask intake questions one at a time. Use the Question Card form instead.

1. Read `references/intake-form.json` so you know which fields exist.
2. Look at the user's first message and extract any obvious values into a prefill dict. Be conservative — only extract values the user clearly stated.
   - "tax exempt fuel customer called Beta, LLC" → `{"name": "Beta, LLC", "fuel_customer": true, "tax_exempt": true}`
   - "Onboard Acme Corp, they need a credit line" → `{"name": "Acme Corp", "credit_line": true}`
   - Leave any field you are not sure about out of the prefill.
3. Call `present_form` exactly once:
   ```
   present_form(
     form_path="customer-onboarding/references/intake-form.json",
     prefill_json='{"name": "Beta, LLC", "fuel_customer": true, "tax_exempt": true}'
   )
   ```
   - `prefill_json` MUST be a JSON-encoded string, not a dict literal. If you have nothing to prefill, pass `""`.
4. After calling `present_form`, send a SHORT message (one sentence) telling the user the form is ready and to fill in any remaining fields. Then STOP and wait for their reply.

## Step 2: Read the form_response and confirm

The user's next message will contain a fenced ```form_response block with the submitted values, e.g.:

```
\`\`\`form_response
{"form_id": "customer_intake", "values": {"name": "Beta, LLC", "fuel_customer": true, "tax_exempt": true, "credit_line": true, "credit_amount": "10000", "contract_owner": "sarah@example.com", "deadline": "2026-04-15", "notes": ""}}
\`\`\`
```

Parse the JSON. Briefly echo back what you got (one sentence — "Got it: Beta, LLC, fuel customer, tax exempt, $10k credit line, contract with sarah@example.com, due 2026-04-15") and immediately proceed to Step 3. Do NOT ask "does this look right?" — the user already submitted the form. If a required field is somehow still missing, send a single short follow-up question for just that one field.

## Step 3: Create tasks

Read `references/task-specs.md` for the full task list and assignment rules. Create every applicable task using `create_sub_thread` before sending any message.

## Step 4: Promote this thread

After all sub-tasks are created, call `promote_to_task` to convert this chat into a parent task:

```
promote_to_task(
  title="Customer Onboarding: {customer}",
  due_date="{deadline if provided}",
  assignee_email=CURRENT_USER_EMAIL
)
```

## Step 5: Follow-up

If a deadline was provided, call `schedule_followup` with the deadline date:

> "Check status of {customer} onboarding tasks. Use list_sub_threads to see which are done and which are outstanding. Post a summary and notify the owner if any are overdue."

## Step 6: Summarize

List each task you created with its assignee (or "unassigned").

## Ongoing

When asked about status, call `list_sub_threads` and summarize: how many done, in progress, or outstanding. Flag overdue tasks.

When asked to add tasks, create them with `create_sub_thread` under the current thread.

## Gotchas

- `present_form`'s `prefill_json` argument is a JSON-encoded string, NOT a dict. Wrong: `prefill={...}`. Right: `prefill_json='{"name": "Beta, LLC"}'`.
- After calling `present_form`, STOP and wait for the user's `form_response` reply. Do not call any other tools in the same turn.
- If `present_form` returns an `{"error": ...}` envelope, fall back to conversational intake (one question per message) so the user is never blocked.
- `promote_to_task` must be called after creating sub-tasks or this thread stays as a chat and won't appear in the user's Tasks tab.
- Always pass `assignee_email` when assigning to a person. Omitting it leaves the task unassigned, not assigned to the current user.
- `CURRENT_USER_EMAIL` is an environment variable, not a literal string. Use it directly for `assignee_email` when assigning to the requesting user.

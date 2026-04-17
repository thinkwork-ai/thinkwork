# ThinkWork → LastMile: workflow-scoped task intake (proposal)

**Status:** proposal for the LastMile API team — 2026-04-16
**Owner (ThinkWork side):** Eric Odom

## Context

Today, a ThinkWork user creates a LastMile task by picking a workflow on
mobile and typing a title. Our agent pauses the create, presents a
standard 4-question intake form (description / priority / due date /
assignee), and then fires `POST /tasks` with the answers. The hardcoded
form is workflow-agnostic — an Engineering task and an Accounting task
see identical questions.

We want each LastMile workflow to drive its own intake: the agent's
behavior, the questions, and the `form_response` → task mapping should
all live on the LastMile side. ThinkWork becomes the host ("here is the
form the user needs to answer; here is what they answered") and
LastMile owns the content and the write semantics.

## Proposed shape

Add a `skill` property to each workflow record (present on both
`GET /workflows` and `GET /workflows/{id}`):

```json
{
  "id": "t15kbzez6y8e33qxdbkx7jt5",
  "name": "Engineering",
  "teamId": "engineering-team",
  "taskTypeId": "task_type_…",
  "skill": {
    "schemaVersion": 1,
    "instructions": "## Engineering Task Intake\n\nGuide the user through…",
    "form": { /* Question Card schema — see below */ }
  }
}
```

All three sub-fields are optional. When `skill` is absent or empty, the
ThinkWork agent falls back to its default 4-question form (our current
behavior).

### `skill.instructions` — markdown

Freeform markdown injected into the agent's system prompt for the
duration of the thread. This is the equivalent of a `SKILL.md` on our
side: tell the agent what to do, when to stop, what `form_response`
should trigger, tone, guardrails, etc. The agent consumes this as
instructions, not as a user-visible string.

Roughly 50–500 words is the sweet spot. Example:

```markdown
You help users file LastMile engineering tasks. Use the intake form
(do NOT ask questions one at a time). After the user submits the
form, briefly echo the key fields back in one sentence and call
`create_task`. Don't ask for status or priority — the workflow
defaults handle those.
```

### `skill.form` — Question Card schema

The same schema ThinkWork's `present_form` skill tool consumes. Shape:

```json
{
  "id": "eng_task_intake",
  "title": "Engineering task",
  "description": "Fill in the details so the team can pick this up.",
  "submit_label": "Create task",
  "fields": [
    {
      "id": "description",
      "label": "What needs to happen?",
      "type": "textarea",
      "required": true,
      "placeholder": "Root cause, affected users, any logs/links…"
    },
    {
      "id": "incident_severity",
      "label": "Severity",
      "type": "select",
      "required": true,
      "options": [
        { "value": "sev1", "label": "SEV 1 — production down" },
        { "value": "sev2", "label": "SEV 2 — degraded" },
        { "value": "sev3", "label": "SEV 3 — routine" }
      ]
    },
    {
      "id": "p21_order_number",
      "label": "Related P21 order #",
      "type": "text",
      "required": false
    },
    {
      "id": "on_call_engineer",
      "label": "On-call engineer",
      "type": "user_picker",
      "required": false
    }
  ]
}
```

#### Field types we support today

| Type          | Renders as                                   |
|---------------|----------------------------------------------|
| `text`        | Single-line text input                       |
| `textarea`    | Multi-line text input                        |
| `select`      | Radio/dropdown (requires non-empty `options`) |
| `boolean`     | Toggle                                       |
| `date`        | Date picker (`YYYY-MM-DD` on submit)         |
| `user_picker` | Tenant-member autocomplete; resolves to email |

Each field supports `id`, `label`, `type`, `required`, and
`placeholder` (optional). `select` additionally requires `options`
(array of `{value, label}`). Adding new types requires a ThinkWork-side
update — tell us early if you need something we don't have.

### `skill.schemaVersion` — integer

Starts at `1`. Lets LastMile ship breaking changes later without
silently breaking our consumer. We'll refuse any `skill` block with a
`schemaVersion` we don't know, fall back to the default form, and log
the mismatch so we can tell you when to coordinate a rollout.

## Ownership model

ThinkWork becomes a thin host. The `form_response` flows **back to
LastMile as an opaque blob**, and LastMile maps it to task columns:

```
mobile user → createThread (ThinkWork)
           → agent presents `skill.form`
           → user submits form
           → agent calls ThinkWork's `createLastmileTask(threadId, formResponse)`
           → ThinkWork POSTs { workflowId, formResponse, … } to LastMile
           → LastMile writes the task, returns { id }
           → ThinkWork stamps thread `synced`
```

Concretely, we need a new LastMile endpoint (or an extension of
existing `POST /tasks`) that accepts:

```json
{
  "workflowId": "t15kbzez6y8e33qxdbkx7jt5",
  "threadId": "ba47…",
  "threadTitle": "Fix the login page redirect",
  "formResponse": {
    "form_id": "eng_task_intake",
    "values": {
      "description": "…",
      "incident_severity": "sev2",
      "p21_order_number": "P21-11409",
      "on_call_engineer": "kelsey@homecareintel.com"
    }
  },
  "creator": {
    "userId": "user_wv4f3er5wsdnev73kkavtixu",
    "email": "eric@homecareintel.com"
  }
}
```

Response mirrors the current `POST /tasks`: `{success: true, id:
"task_…"}`. LastMile is free to:

- Map well-known form ids (`description`, `due_date`, etc.) to
  native task columns;
- Stuff custom ids into `task.entity_data` or wherever you keep
  workflow-specific payloads;
- Apply any validation, defaulting, or side effects owned by the
  workflow (automation rules, notifications, etc.).

We never need to know those rules. If the payload is malformed, return
a 4xx with a message — we surface it back to the user in-thread.

## Fallback behavior

| `skill` on workflow | ThinkWork behavior                                   |
|---------------------|------------------------------------------------------|
| Absent or `null`    | Use our default 4-question form; POST to existing `/tasks` with mapped fields (today's behavior). |
| `{schemaVersion, form}` | Present `form`, forward `form_response` to the new LastMile endpoint. |
| `{schemaVersion, instructions}` (no form) | Inject `instructions` into the agent; agent asks conversationally, collects free-form payload. |
| Both `instructions` + `form` | Inject `instructions`, present `form`, forward `form_response`. Typical case. |
| Unknown `schemaVersion` | Fall back to default; log. |

## End-to-end sequence

```
1. User on mobile: picks Engineering workflow, types title,
   hits send.
2. Thinkwork `createThread` — stamps thread sync_status='local'
   with "Fill out the intake form" reason. No POST to LastMile.
3. Thinkwork backend fetches workflow (cached) and passes
   workflow.skill to the agent as thread context.
4. Agent injects skill.instructions into its system prompt,
   calls present_form with skill.form, then stops.
5. User fills form, submits. Mobile sends form_response as
   the next user message.
6. Agent parses form_response, calls ThinkWork's
   createLastmileTask(threadId, formResponse) mutation.
7. ThinkWork backend calls POST /tasks/intake on LastMile
   with the full envelope above.
8. LastMile maps the form values, writes the task, returns
   the id.
9. ThinkWork stamps thread sync_status='synced',
   metadata.external.externalTaskId, sends a confirmation
   message into the thread.
```

## What we need from you

1. Confirm the shape above works on your side (or propose tweaks).
2. Expose `skill` on `GET /workflows/{id}` and `GET /workflows`.
3. Stand up the new endpoint (naming TBD —
   `POST /workflows/{id}/tasks` with a `formResponse` body is
   a reasonable candidate) that accepts the envelope and returns
   `{success, id}`.
4. Version the skill blob (`schemaVersion: 1` to start).

## What we'll do

1. Cache `workflow.skill` per-workflow-per-tenant (TTL ~5 min) to
   avoid a round-trip on every task create.
2. Add a `fallbackToDefault` branch that kicks in on malformed skill
   blobs or unknown `schemaVersion`.
3. Pass the workflow's `instructions` into the agent's system-prompt
   context for the thread.
4. Our existing `lastmile-tasks` skill becomes the dynamic consumer;
   no static form schema in our repo once this lands.

## Open questions

1. Should `skill.form` also be able to reference a reusable form
   elsewhere (e.g. `formRef: "eng_intake_v2"` pointing at a
   separate LastMile record)? Probably not for v1 — inline is
   simpler — but flag if shared forms are a thing for you.
2. Do you plan to scope `skill` per-workflow or per-task-type? Your
   current data model has `taskTypeId` on both. If two tasks under
   the same workflow need different forms, we'd want the property
   on `task_type` instead (or in addition).
3. Rate limiting / auth — the new endpoint will be called with the
   creator's PAT, same as today's `POST /tasks`. Any additional
   scopes needed?

# PRD: LastMile `workflow.skill` consumer

**Status:** Draft — awaiting LastMile team confirmation of the proposal at `.claude/proposals/lastmile-workflow-skill-proposal.md`
**Owner:** Eric Odom
**Last updated:** 2026-04-16
**Depends on:** `external-task-integration.md` (shipped) + live `createLastmileTask` flow from PRs #131 / #132 / #133

---

## 0. Implementation progress

Not started. This PRD is the spec; implementation begins once LastMile commits to shipping the `skill` property + the `formResponse` forward endpoint.

### Verification status

- [ ] LastMile-side shape confirmed (`skill` on `GET /workflows/{id}`, `schemaVersion: 1`, Question Card schema verbatim)
- [ ] LastMile-side forward endpoint confirmed (`POST /workflows/{id}/tasks` or equivalent, accepting `formResponse` envelope)
- [ ] Phase 1 — REST wrapper + workflow fetch/cache
- [ ] Phase 2 — `createLastmileTask` mutation accepts `formResponse` blob
- [ ] Phase 3 — dynamic form dispatch in `lastmile-tasks` skill
- [ ] Phase 4 — `instructions` injection into agent thread-metadata
- [ ] E2E: workflow *with* `skill` → forward endpoint → task materializes with custom fields
- [ ] E2E: workflow *without* `skill` → existing `POST /tasks` path unchanged

---

## 1. Summary

Today, every LastMile task thread opens the same hardcoded 4-question intake form (description / priority / due date / assignee). That's workflow-agnostic: Engineering, Accounting, and Dispatch all see identical questions, and custom fields (severity, order #, driver, etc.) have nowhere to live.

LastMile is going to ship a new optional property — `workflow.skill` — that carries per-workflow agent instructions, a Question Card form, and a schemaVersion. ThinkWork's job is to consume it:

- **Present** `workflow.skill.form` via `present_form` instead of our default.
- **Inject** `workflow.skill.instructions` into the agent's system-prompt context for that thread.
- **Forward** the user's `form_response` to LastMile as an opaque JSON blob — LastMile owns the mapping to task columns (native fields + `entity_data`).

When `skill` is absent or we don't understand the `schemaVersion`, we fall back to today's behavior with no regression.

**Core product line:** ThinkWork hosts the intake experience. LastMile owns the form content and the task write semantics.

---

## 2. Why this exists

The hardcoded intake was the right choice for the initial ship (PRs #131 / #132 / #133) because it got us end-to-end. But it's a dead-end for product:

1. **Workflows need their own questions.** An engineering incident wants severity + affected system; a fuel delivery wants terminal + volume + driver. Shoving both through the same generic form is a bad UX.
2. **Custom fields have nowhere to go today.** Our typed `CreateLastmileTaskInput` (description / priority / dueDate / assigneeEmail) can't carry fields LastMile hasn't explicitly agreed to. Any time LastMile adds a new native column we'd need a PR on our side.
3. **Agent behavior should adapt to the workflow.** A SEV-1 incident intake wants a different tone (concise, prompt for on-call) than a customer-onboarding intake (patient, thorough). Per-workflow `instructions` gives LastMile that lever without touching our code.

The inline `skill` blob is the minimum surface that solves all three without a cross-repo skill catalog coupling. Option A from the design discussion (workflow → skill slug referencing our catalog) was rejected because it requires a ThinkWork PR whenever LastMile wants a new intake pattern.

---

## 3. Shape expected from LastMile

Full external proposal at `.claude/proposals/lastmile-workflow-skill-proposal.md`. Summary below.

### 3.1 `skill` on workflow records

`GET /workflows/{id}` and `GET /workflows` return:

```json
{
  "id": "t15kbzez6y8e33qxdbkx7jt5",
  "name": "Engineering",
  "teamId": "engineering-team",
  "taskTypeId": "task_type_…",
  "skill": {
    "schemaVersion": 1,
    "instructions": "markdown — 50–500 words of agent behavior",
    "form": { /* Question Card schema */ }
  }
}
```

All three sub-fields are optional. A workflow with no `skill` (or `skill: null`) is treated as legacy.

### 3.2 `skill.form` shape

Matches the Question Card schema that `packages/skill-catalog/agent-thread-management/scripts/forms.py::present_form` already consumes:

```json
{
  "id": "eng_task_intake",
  "title": "Engineering task",
  "description": "...",
  "submit_label": "Create task",
  "fields": [
    { "id": "...", "label": "...", "type": "textarea | text | select | boolean | date | user_picker", "required": true, "placeholder": "...", "options": [...] }
  ]
}
```

Supported field types: `text`, `textarea`, `select` (requires `options`), `boolean`, `date` (`YYYY-MM-DD`), `user_picker` (resolves to email). Anything outside this set requires a ThinkWork-side extension.

### 3.3 Forward endpoint (LastMile needs to ship)

When `skill` is present, ThinkWork POSTs the `form_response` as an opaque blob to a new LastMile endpoint instead of the current fielded `POST /tasks`. Target shape:

```
POST /workflows/{workflowId}/tasks
Body:
{
  "threadId": "ba47…",
  "threadTitle": "Fix the login page redirect",
  "formResponse": {
    "form_id": "eng_task_intake",
    "values": { /* verbatim from the user's form submission */ }
  },
  "creator": {
    "userId": "user_wv4f3er5wsdnev73kkavtixu",
    "email": "eric@homecareintel.com"
  }
}
→ { "success": true, "id": "task_…" }
```

LastMile maps well-known `values` ids to native columns (`description`, `priority`, etc.) and stuffs the rest into `task.entity_data` or wherever workflow-specific payloads live.

### 3.4 `schemaVersion`

Starts at `1`. Unknown versions → we log + fall back to the default form.

---

## 4. Consumer design (our side)

### 4.1 Flow overview

```
1. User picks workflow on mobile, types title, hits send.
2. ThinkWork createThread — stamps sync_status='local' with reason
   "Fill out the task intake form in the thread to sync to LastMile."
   (no change from today's behavior).
3. Backend reads workflow.skill from cache (or fetches + caches).
4. If skill present:
   a. Inject skill.instructions into thread_metadata.workflow_skill
      so chat-agent-invoke ships it to the Strands agent.
   b. Agent calls present_form with skill.form (dynamic).
   c. User submits form → form_response in next user message.
   d. Agent calls lastmile-tasks.create_task with the full
      form_response JSON.
   e. Mutation forwards form_response to the new LastMile endpoint.
   f. Thread stamped 'synced' + metadata.external.externalTaskId.
5. If skill absent / unknown schemaVersion:
   → existing 4-question form + current POST /tasks path. No change.
```

### 4.2 Workflow fetch + per-tenant cache

**Where:** `packages/api/src/integrations/external-work-items/providers/lastmile/restClient.ts` already has `getWorkflow()`. Wrap a small LRU (or `Map` with epoch-based eviction) around it keyed by `${tenantId}:${workflowId}`, TTL ~5 min.

Invalidation: we don't get webhook signals for workflow edits, so TTL is the mechanism. Aggressive refresh only if a subsequent write returns a `schema_out_of_date` error (not in the v1 design; defer).

### 4.3 Injecting `instructions` into agent context

**Where:** `packages/api/src/handlers/chat-agent-invoke.ts` already attaches thread metadata to the Strands invoke payload (lines ~457–462 per the earlier exploration). Add a `workflow_skill` block on the metadata populated from the cached workflow record:

```json
thread_metadata: {
  ...existing,
  workflow_skill: {
    schemaVersion: 1,
    instructionsMarkdown: "..."
  }
}
```

The Strands agent reads `instructionsMarkdown` and prepends it to its per-turn system prompt. The AgentCore / Strands repo is out-of-tree; a matching change there is a hard dependency (documented in §8).

### 4.4 Dynamic form dispatch in `lastmile-tasks`

**Where:** `packages/skill-catalog/lastmile-tasks/scripts/tasks.py` + `SKILL.md`.

Today the skill calls:

```python
present_form(form_path="lastmile-tasks/references/task-intake-form.json", prefill_json="")
```

Post-PRD the skill should:

1. Read `workflow.skill.form` off `thread_metadata.workflow_skill` (already pushed in §4.3).
2. If present, write the schema to a temp file and call `present_form(form_path=<temp>)` — OR extend `present_form` to accept an inline `schema_json` argument (smaller surface, cleaner; see §9).
3. If absent, fall back to the static `task-intake-form.json`.

The `create_task` skill function signature changes from typed args to an opaque blob:

```python
create_task(form_response_json: str) -> str
```

It parses the JSON, validates `form_id` matches the presented form, and passes the `values` dict through to the mutation verbatim.

### 4.5 Mutation rewrite

**Where:** `packages/api/src/graphql/resolvers/external-tasks/createLastmileTask.mutation.ts` + `packages/database-pg/graphql/types/external-tasks.graphql`.

Today's input:

```graphql
input CreateLastmileTaskInput {
  threadId: ID!
  description: String
  priority: String
  dueDate: AWSDateTime
  assigneeEmail: String
}
```

Add an optional `formResponse: AWSJSON` field. Behavior:

| `formResponse` present | `workflow.skill` present | Behavior |
|---|---|---|
| ✅ | ✅ | Forward to LastMile's new endpoint; stamp synced. |
| ✅ | ❌ (legacy workflow) | Ignore `formResponse`, require typed fields, use existing `POST /tasks`. (Agent is buggy — log + fall back.) |
| ❌ | ✅ | Reject: agent skipped the form. Return a clear error. |
| ❌ | ❌ | Existing path — typed fields only. Back-compat. |

### 4.6 REST client method

**Where:** same `restClient.ts` file.

```ts
export async function submitTaskIntake(args: {
  ctx: LastmileRestCtx;
  workflowId: string;
  body: {
    threadId: string;
    threadTitle: string;
    formResponse: { form_id: string; values: Record<string, unknown> };
    creator: { userId: string; email: string };
  };
}): Promise<CreateTaskResponse>;
```

Mirrors `createTask()` plumbing (baseUrl, refreshToken, idempotency-key headers). Idempotency key: `thinkwork-thread-${threadId}` — same scheme used today, so LastMile dedupes across retries.

---

## 5. Fallback matrix

| `workflow.skill` on record | ThinkWork behavior |
|---|---|
| Absent / `null` | Default 4-question form; existing `POST /tasks` with typed fields. (Today's behavior.) |
| `{schemaVersion: 1, form, instructions}` | Typical case: inject `instructions`, present `form`, forward `form_response` to new endpoint. |
| `{schemaVersion: 1, form}` (no instructions) | Agent runs with its normal system prompt, but uses LastMile's `form`. |
| `{schemaVersion: 1, instructions}` (no form) | Inject `instructions`; agent asks conversationally, builds `form_response` from chat. |
| `{schemaVersion: 2, …}` (unknown) | Log the version gap; fall back to default. Alert-worthy in prod monitoring. |
| Malformed `form` (e.g. invalid Question Card schema) | `present_form`'s built-in validation throws; fall back to default + log. |

---

## 6. Phases

Each phase is a PR that can land and deploy independently. No phase has a visible-to-end-user behavior change until phase 3 — phases 1–2 are safe to ship ahead of LastMile's rollout.

### Phase 1 — REST wrapper + workflow cache

**Files:** `restClient.ts`

- Add `submitTaskIntake()` (won't be called until phase 2).
- Add a module-local `Map<string, {workflow, fetchedAt}>` cache around `getWorkflow()` with 5-minute TTL. Callers use `getWorkflowCached()`; the un-cached version stays for on-demand refresh.
- No behavior change.

**Tests:** unit tests for cache TTL (hit / stale / miss); mocked fetch.

### Phase 2 — Mutation accepts `formResponse`

**Files:** `createLastmileTask.mutation.ts`, `external-tasks.graphql`

- Add `formResponse: AWSJSON` to input.
- Branch on `workflow.skill` presence (read from cache): skill → `submitTaskIntake`; no skill → existing path.
- The `formResponse`-without-skill case rejects with a clear error.

**Tests:** resolver-level unit tests for the four branches in §4.5.

### Phase 3 — Dynamic form in the skill

**Files:** `packages/skill-catalog/lastmile-tasks/scripts/tasks.py`, `SKILL.md`, potentially `packages/skill-catalog/agent-thread-management/scripts/forms.py` if we extend `present_form` to accept inline schemas (see §9).

- Skill reads `workflow_skill` off thread_metadata.
- Dispatches between LastMile's `form` and the static fallback.
- `create_task(form_response_json)` replaces the typed-arg version. SKILL.md rewritten to match.

**Tests:** manual E2E against a dev workflow that has `skill` populated (LastMile side needs to exist first) + existing static-form E2E still green.

### Phase 4 — `instructions` injection

**Files:** `chat-agent-invoke.ts`

- Include `workflow_skill.instructionsMarkdown` on the invoke payload.
- Coordinate with the Strands / AgentCore repo to prepend it to the per-turn system prompt.

**Blocked by:** out-of-repo agent change. Document + hand off in the corresponding AgentCore PR.

---

## 7. Verification

### 7.1 Pre-merge

- `pnpm -F @thinkwork/api typecheck` clean for each phase.
- `pnpm -F @thinkwork/api test` — all 420+ existing tests still green; new unit tests for the cache, the mutation branch matrix, and the `CreateTaskRequest` → `formResponse` forwarding.

### 7.2 Post-merge E2E (per phase 3)

Extend `scripts/integration/e2e-lastmile-create-task.ts`:

1. **Legacy workflow** (no `skill`) — today's flow. Already covered.
2. **Workflow with `skill.form` only** — drive `createThread`, manually construct a `form_response` matching the LastMile-provided schema, call `createLastmileTask({threadId, formResponse})`, assert thread stamped synced + custom fields round-trip on the LastMile side.
3. **Workflow with `skill.instructions` only** — verify `instructionsMarkdown` lands in the agent's thread context (harder to assert without the Strands side; at minimum confirm it's on the invoke payload).
4. **Unknown `schemaVersion`** — seed a workflow blob with `schemaVersion: 99`; assert ThinkWork falls back to default and emits a structured warning.

---

## 8. Dependencies / coordination

### 8.1 LastMile team (hard dependencies)

1. Expose `skill` on `GET /workflows/{id}` and `GET /workflows` list responses.
2. Stand up the forward endpoint (`POST /workflows/{id}/tasks` or equivalent) that accepts the envelope in §3.3 and returns `{success, id}`.
3. Commit to `schemaVersion: 1` semantics. Future bumps coordinated via email + this PRD.

### 8.2 AgentCore / Strands repo (for phase 4)

Prepend `thread_metadata.workflow_skill.instructionsMarkdown` to the per-turn system prompt when present. Lives outside this repo; track via a matching issue on the AgentCore side.

### 8.3 Field-type parity

If LastMile uses form field types we don't support (anything outside `text / textarea / select / boolean / date / user_picker`), we extend `present_form`'s renderer. Not expected in v1 — flag early.

---

## 9. Open questions

1. **`present_form` inline-schema support.** Phase 3 works either way:
   - (a) Write LastMile's form to a temp file and point `present_form` at it. Small change, slightly awkward lifecycle.
   - (b) Extend `present_form` to accept a `schema_json: str` arg. Cleaner, one-time change to the agent-thread-management skill. **Preferred.**
   Decision: do (b) as part of phase 3.

2. **Scope granularity.** Confirmed with Eric 2026-04-16: workflow 1:1 task_type for now, so `skill` on workflow is correct. If that ever splits, we move to `task_type.skill` without changing the mutation surface — the shape is identical.

3. **Shared forms (`formRef`).** Inline-only for v1. Deferred.

4. **Cache invalidation on workflow edit.** 5-minute TTL is the only mechanism. If LastMile ships a webhook for workflow metadata changes, we subscribe and bust the cache. Not blocking v1.

5. **Error surfacing.** When LastMile's forward endpoint returns 4xx (e.g. validation failure on the `values` payload), we throw from the GraphQL mutation — mobile surfaces as a thread error message. Good enough for v1; consider a retry affordance in v2.

---

## 10. Links

- **External proposal to the LastMile team:** `.claude/proposals/lastmile-workflow-skill-proposal.md`
- **Currently-live implementation this builds on:**
  - PR #131 — intake form skill + `createLastmileTask` mutation + thread-create stops auto-syncing
  - PR #132 — resolver accepts API-key auth path
  - PR #133 — coerce `YYYY-MM-DD` → full ISO for LastMile `dueDate`
- **Broader external-task context:** `.prds/external-task-integration.md`
- **Form schema pattern prior art:** `packages/skill-catalog/customer-onboarding/` (intake-form.json + SKILL.md)
- **`present_form` implementation:** `packages/skill-catalog/agent-thread-management/scripts/forms.py`

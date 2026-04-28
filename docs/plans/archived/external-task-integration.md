# PRD: External Task Integration v2

**Status:** Shipped (MVP + Phase A–D complete) — entering polish + write-path-verification phase
**Owner:** Eric Odom
**Last updated:** 2026-04-15

---

## 0. Implementation progress

**Last updated:** 2026-04-15

### Shipped — 2026-04-15 (sprint: webhook visibility, MCP correctness, OAuth lifecycle)

Fourteen PRs landed against this PRD over a single day. The summary below is grouped by theme; full PR bodies are on GitHub (PR # = pull request number on `thinkwork-ai/thinkwork`).

**Webhook → user-visible feedback loop (fixes the "silent webhook" gap from PR #33):**
- **PR #75** `feat(external-tasks): log webhook updates to the task timeline` — `summarizeWebhookEvent()` in `ingestEvent.ts` produces a human-readable line per external provider webhook (`task.updated`, `task.assigned`, `task.commented`, etc.) and inserts a system-authored row in `messages` with `metadata.kind = "external_task_event"`. Noise filter drops `task.created` and `updated_at`-only updates.
- **PR #76** `feat(external-tasks): realtime AppSync broadcast on webhook ingest` — fans out `notifyNewMessage` + `notifyThreadUpdate` after the insert so the mobile task detail screen and inbox list refetch without pull-to-refresh.
- **PR #77** `feat(external-tasks): Expo push notifications on meaningful webhook events` — narrow v1 push policy: `task.assigned`/`task.reassigned` → "Assigned to you"; `task.updated` with `status` or `due_*` → summary line; comments + creates suppressed.
- **PR #78** `fix(external-tasks): await webhook ingest fan-out (notify + push)` — caught live during E2E: the fire-and-forget `.catch(() => {})` pattern was leaving notify/push as deferred microtasks that the webhooks Lambda froze before flushing. AppSync sockets timed out (`other side closed`) and pushes landed ~36 s late on the next invocation. Wrapped the three fan-out promises in `await Promise.allSettled(...)` so the handler waits for I/O. Cost: +200–500 ms tail latency. Benefit: deterministic realtime + immediate push.
- **PR #81** `feat(external-tasks): render webhook audit rows on task card` — adds an `activity_list` block to `buildExternalProviderBlocks` and a new `apps/mobile/components/genui/external-task/blocks/ActivityList.tsx` mobile renderer. PR A's audit rows now surface inside the task card (NOT in the chat timeline, which intentionally stays user/assistant-only). Plumbing: `apps/mobile/app/thread/[threadId]/index.tsx` derives an `activityRows` array alongside the chat-filtered `messages` array.

**external provider MCP correctness — read path, write path, error handling:**
- **PR #79** `fix(external-tasks): refresh external provider task via tasks_get (not task_get)` — sub-agent probed `tools/list` against `mcp-dev.mobile-host-tei.com/tasks` with Eric's real token. Ground truth: tools are pluralized (`tasks_get`, `tasks_list`) and `tasks_get` requires `task_id`, not `id`. Renamed `EXTERNAL_PROVIDER_TOOLS.get`/`list` and updated `refresh.ts` to send `{task_id}`.
- **PR #80** `fix(external-tasks): external provider write path, mcp error handling, status unwrap` — **headline finding: every save-edit had been silently no-op'ing for the entire life of the integration.** `executeAction.ts` was sending `{id: externalTaskId}` to every write tool, but the schema requires `task_id`. external provider returned `{error: "Task not found"}` inside `result.content[0].text` with `isError: true`, and `mcpClient.ts` didn't check `isError` so the error string fell through as a "non-object payload" and `executeExternalProviderAction` then called `refreshExternalProviderTask` which returned the unchanged task — the mobile UI interpreted the unchanged envelope as "save succeeded". Verified live with a `description: "probe-A"` round-trip. Fixes: rename `id` → `task_id` everywhere, `task_assign` → `task_update_assignee`, drop the non-existent `task_add_comment` tool, `mcpClient.isError` handling that throws with the text content, status/priority object unwrap (external provider returns `{id, name, color, icon}`, not strings), `capabilities.commentOnTask = false` so the mobile Comment button hides via the existing capability gate.
- **PR #83** `fix(external-tasks): resolve task card labels (status, assignee, priority)` — follow-up to PR #80 after live verification: `core.status.label = "Backlog"` was set correctly but the mobile `FieldList.renderValue` did `field.options?.find(o => o.value === field.value)` and the curated `EXTERNAL_PROVIDER_STATUS_OPTIONS` had no entry for the real external provider opaque id `status_hfcq...`. Inject the unwrapped option into `field.options` so the lookup matches. Also handle external provider's `assignee.first_name` + `assignee.last_name` (it doesn't ship `name`, only the parts) and add a `user` branch to `FieldList.renderValue` that reads `core.assignee.name`. Bonus: Save Changes button moved bottom-left → right-justified per follow-up feedback.

**OAuth + token lifecycle:**
- **PR #84** `fix(external-tasks): auto-refresh external provider MCP tokens via WorkOS refresh_token` — caught when the dev environment broke ~25 minutes after a fresh reconnect. WorkOS access tokens have a ~15 min lifetime, but `resolveExternalProviderUserToken` was returning the stored access_token straight from Secrets Manager with no expiry check. New `refreshExternalProviderMcpToken()` helper: reads `expires_at` from `user_mcp_tokens`, POSTs `grant_type=refresh_token` to WorkOS's `/oauth2/token` with the rotated `refresh_token` + `client_id` from `tenant_mcp_servers.auth_config`, persists the rotated pair back to SM **before returning** (WorkOS rotates on every use), updates `expires_at`. On 401: marks the row `expired`. On network error: returns null without flipping to expired (transient self-heal). Race-condition decision: accept single-request degradation rather than add SM optimistic locking.
- **PR #85** `fix(mcp-oauth): send prompt=login on authorize for fresh IdP session` — first attempt at "let users switch accounts on reconnect", per WorkOS support recommendation. One-line `authorizeUrl.searchParams.set("prompt", "login")` in `skills.ts`.
- **PR #86** `fix(mcp-oauth): also send max_age=0 — prompt=login alone isn't enough` — live test of #85 showed WorkOS AuthKit ignored `prompt=login` and rendered the consent screen with "Logged in as eric@homecareintel.com" intact. Added `max_age=0` as the OIDC companion lever (§3.1.2.1). Standards-compliant, harmless.
- **PR #88** `fix(mcp-oauth): ephemeral browser session + deep-link callback` — **the actual fix.** PRs #85 and #86 were both ignored by WorkOS; probing `/sessions/logout`, `/oauth2/logout`, and `/logout` on the AuthKit instance all returned 404 and OIDC discovery had no `end_session_endpoint`, killing the logout-redirect approach. Real root cause: the mobile MCP Servers screen used `WebBrowser.openBrowserAsync` which on iOS opens **SFSafariViewController** sharing the system Safari cookie jar — WorkOS session cookies persisted across reconnect attempts indefinitely. Fix: switch both call sites (`mcp-servers.tsx`, `mcp-server-detail.tsx`) to `openAuthSessionAsync` with `preferEphemeralSession: true` (matching the existing Google OAuth flow at `auth-context.tsx:340-355`), and have `mcpOAuthCallback` redirect to `thinkwork://mcp-oauth-complete` so the in-app browser auto-closes via Expo's deep-link match. **Confirmed working on device.**

**Mobile UX polish on the task card:**
- **PR #82** `feat(external-tasks): task card UI cleanup — two-col fields, header edit, form polish` — definition-list field layout (label left, value right), removed the `action_bar` block from `buildExternalProviderBlocks` entirely (Change status / Assign / Comment / Edit buttons gone), single Pencil icon in the task header opens the same edit modal, Save Changes button moved out of the modal header chrome to the modal body.

**Other:**
- **PR #87** — Eric's three local mobile commits (`feat(mobile): polish threads header and thread detail loading`, `wip(mobile): sticky session + shimmer loading placeholder`, `fix(mobile): resolve tenantId on SRP restore path too`) rebased through the worktree-isolation flow and merged via PR (branch protection).

### Verification status (2026-04-15)

- [x] `pnpm typecheck` (api) — clean
- [x] `pnpm test` (api) — **367 passed / 8 skipped** (was 257 at last update, +110 cases across PRs A–H)
- [x] `tsc --noEmit` (mobile) — 122 pre-existing errors unchanged across all PRs (none in touched files)
- [x] **Live E2E on dev (Eric's real device + external provider dev tenant)** — webhook → activity row → push within ~2s → mobile card live-updates without pull-to-refresh, all confirmed in CloudWatch + DB queries + on-device observation
- [x] **Live save-edit round-trip** verified by direct `task_update` MCP probe with `description: "probe-A"` / `description: "probe-B"` and read-back via `tasks_get` (test task description restored before commit)
- [x] **MCP token auto-refresh** — verified by waiting >15 min idle then firing a webhook; CloudWatch shows `[oauth-token] Refreshed external provider MCP token ... (expires_in=900s)` followed by successful `tasks_get`
- [x] **Account switching on reconnect** (PR #88) — confirmed working on device after merge

### Resolved gaps (was "Diagnosed gaps blocking mobile E2E" in 2026-04-14 update)

All five gaps from the previous update are fixed:

1. **`ensureExternalTaskThread` assignee** — fixed in Phase A (pre-2026-04-15).
2. **Denormalized columns** — fixed in Phase A.
3. **Thread detail screen routing** — fixed in Phase C.
4. **Tasks tab row provider indicator** — fixed in Phase C.
5. **No way to seed without live webhook** — moot now: the live webhook from external provider dev tenant is wired and we routinely fire synthetic webhooks via curl during testing.

### Known follow-ups (not blocking, captured for next sprint)

These are quality / completeness items, not regressions:

1. **PR G-bis: `status_id` mapping for save-edit end-to-end.** `task_update_status` requires a real opaque external provider status id (e.g. `status_hfcqtycmuaix6pjfnu3mb3ot`); the mobile form's select still uses the curated `EXTERNAL_PROVIDER_STATUS_OPTIONS` value strings. Status changes from the form will currently fail with a clear MCP error (not silent success — that's PR #80's contribution). Need to source real ids via `tasks_schema()` or per-task workflow metadata.
2. **Repo-wide fire-and-forget notify sweep.** PR #78 fixed only the webhooks Lambda. `sendMessage.mutation.ts`, `createThread.mutation.ts`, `updateThread.mutation.ts`, `delegateThread.mutation.ts`, and `escalateThread.mutation.ts` all still use `notify*(...).catch(() => {})`. They appear to work because the graphql-http Lambda stays warmer, but it's the same latent class of bug.
3. **Assignees other than the current user.** `tasks_get` populates the nested `assignee: {first_name, last_name, email}` only for the task's own assignee/creator. For tasks assigned to someone else, we still show a raw id. external provider MCP exposes `user_whoami` but **no `users_get` / `users_list` tool** — would need either a new external provider tool or a cached directory.
4. **Priority casing.** external provider returns `priority: "medium"` as a plain string (not an object), and our curated `EXTERNAL_PROVIDER_PRIORITY_OPTIONS` only has `urgent / high / normal / low` — so "medium" falls through `priorityLabelFor()` as `{value: "medium", label: "medium"}` and renders lowercase in the card. Trivial fix.
5. **JWT `exp` decoding in PR #84.** Currently we read `expires_at` from the DB. We could decode the access_token JWT directly and skip the DB lookup. Cleanup, not urgent.
6. **Comment tool path.** `task_add_comment` doesn't exist on the external provider MCP server. PR #80 disabled the Comment button via `capabilities.commentOnTask = false`. Either find a different external provider path (probably needs external provider to add it) or leave the button hidden permanently.
7. **`prompt=login` + `max_age=0` are still in the authorize URL** (PRs #85/#86) — they're standards-compliant and harmless even with the ephemeral-session fix in #88. If WorkOS ever updates AuthKit to honor them, the fixes compose. Not a follow-up so much as a "leaving these in place on purpose" note.

### Shipped — 2026-04-14 and earlier

- **PR #33 — merged `649df8c` (2026-04-13).** Full MVP end-to-end against external provider Tasks. Landed:
  - Adapter seam (`packages/api/src/integrations/external-work-items/`) + external provider adapter (normalize, form schema, executeAction, refresh, signature, event normalizer)
  - Shared `mcpClient` extracted from `refreshGenUI`; supports per-user OAuth bearer tokens
  - `executeExternalTaskAction` GraphQL mutation + resolver + orchestrator; direct path, no agent round-trip; writes audit system messages
  - `POST /integrations/:provider/webhook` Lambda (`handlers/integration-webhooks.ts`) + adapter-neutral `ingestEvent` pipeline + `ensureExternalTaskThread` idempotent upsert + reassignment handoff
  - Mobile `ExternalTaskCard` + block renderers (task_header / field_list / badge_row / action_bar / form) + fixture; `PinnedExternalTaskHeader` above thread timelines
  - Mobile "Connect external provider Tasks" CTA on Settings → Integrations
  - `oauth-callback` captures external provider-native user id into `connections.metadata.mobile-host.userId`
  - `refreshGenUI` surgically generalized: legacy map extracted to `genui-refresh-legacy.ts`; `external_task` branch routes through the adapter registry; CRM/places untouched
  - Terraform: new Lambda + route registered in `lambda-api/handlers.tf`; `scripts/build-lambdas.sh` builds the new handler
  - `scripts/seed-mobile-host-provider.sql` idempotent seed for the `connect_providers` row

- **PR #34 — open `99a7c84`, branch `external-tasks-e2e-tests` (2026-04-14).** 44 unit tests across 5 files covering:
  - `mobile-host-signature` (9): HMAC valid/invalid/malformed; `sha256=` prefix; dev fallback open; prod fallback closed
  - `mobile-host-normalize-event` (9): kind mapping, `previousProviderUserId`, fallback `task_id`, error cases
  - `external-task-execute-action` (9): orchestrator guards + happy path + summary phrasing
  - `external-task-ingest-event` (8): pipeline branches + reassignment handoff
  - `integration-webhooks-handler` (9): routing, status mapping, rate limit at 600/min
  - API suite now **257 passed / 8 skipped**. All mocked; no DB or network.

### Diagnosed gaps (blocking mobile E2E — see handoff plan)

These prevent any task — real or seeded — from appearing in the iOS Tasks tab. Full diagnosis + fix sites in `/Users/ericodom/.claude/plans/harmonic-hatching-cookie.md`.

1. **`ensureExternalTaskThread` never sets `assignee_type` / `assignee_id`.** `ensureThreadForWork` only populates assignee fields when an `agentId` is passed. External tasks end up with NULL assignee and are filtered out by the Tasks tab query (`threads(channel=TASK, assigneeId=me)`).
2. **Denormalized task columns not populated from the envelope.** `title` is set but `status` / `priority` / `due_at` / `description` are not. The Tasks tab row reads from denormalized columns, not `metadata.external.latestEnvelope`, so rows would render blank even after Gap 1 is fixed.
3. **Thread detail screen routes `channel=task` to the sub-task FlatList view.** `PinnedExternalTaskHeader` is only rendered on the `!isTask` branch, so external tasks are opened into the wrong layout with no way to reach the form.
4. **Tasks tab row has no provider indicator.** Cosmetic but useful for E2E verification.
5. **No way to seed an external task without a live external provider webhook.** `ingestExternalTaskEvent` is only reachable via HMAC-signed `POST /integrations/mobile-host/webhook` from a configured external provider tenant. No existing dev-only handler pattern in `packages/api/src/handlers/`.

### Planned next phases

- **Phase A** — backend denormalization fixes (Gaps 1 + 2) in `ensureExternalTaskThread.ts`, extend ingest pipeline tests.
- **Phase B** — dev-only `POST /api/dev/external-tasks/seed` Lambda gated on `STAGE !== "main"`; reuses `normalizeExternalProviderTask` + `envelopeFromRaw` + `ensureExternalTaskThread`.
- **Phase C** — mobile: route external-task threads through the timeline-with-pinned-header path (`app/thread/[threadId]/index.tsx`); add "external provider" pill to Tasks tab rows (`app/(tabs)/tasks/index.tsx`).
- **Phase D** — live external provider webhook (outside the repo): configure webhook URL + `EXTERNAL_PROVIDER_WEBHOOK_SECRET` on the dev Lambda. Zero code changes if A–C are correct.

### Verification status

- [x] `pnpm typecheck` (api) — clean
- [x] `pnpm test` (api) — 257 / 8 skipped
- [x] `tsc --noEmit` (mobile) — zero new errors vs main baseline
- [ ] Manual E2E on iOS simulator against the dev tenant — blocked on Phases A–C

---

## 1. Summary

ThinkWork should make external tasks feel native without becoming a task system itself.

When a user is assigned work in an external system like external provider Tasks, Linear, Jira, or Asana, ThinkWork opens a dedicated thread for that work. Inside the thread, the task is rendered as a **mobile-first GenUI experience** made from native cards and forms, not markdown-heavy chat output and not iframe-wrapped remote UIs. Users can review, update, and discuss the task in ThinkWork, while the external system remains the source of truth.

**Core product line:** ThinkWork owns the **work experience**. The external provider owns the **work record**.

---

## 2. Why this exists

In Maniflow, task-like work lived too close to ThinkWork's own state model. That made the UX strong, but the architecture brittle.

ThinkWork should not repeat that mistake.

At the same time, pure chat is not good enough for task work on mobile. Users should not have to scroll through markdown blobs to inspect status, assignee, due date, checklists, comments, or forms. And MCP-UI / MCP-APP patterns that wrap provider UIs in iframes are the wrong abstraction for mobile. They are hard to control, hard to make consistent, and do not produce a durable ThinkWork-native product surface.

So the right move is:

1. keep **threads** as the main unit of work in ThinkWork,
2. attach external tasks to threads through a normalized adapter layer,
3. render them through a **bounded native GenUI component system**,
4. send structured edits back to the provider,
5. use agents for reasoning and conversational work, not as the only way to click a status dropdown.

---

## 3. Product principles

### 3.1 Threads stay central

A task is not a separate product primitive in ThinkWork. It is an **external work item attached to a thread**.

Threads remain the place where:
- the user sees the work,
- the agent collaborates on the work,
- actions and audit history accumulate,
- related subthreads or follow-up work can emerge.

### 3.2 ThinkWork owns the UX, not the state

ThinkWork should deliver a first-class task experience, but it should not become authoritative for task state.

The external provider remains canonical for:
- status
- assignee
- due date
- comments
- workflow fields
- provider-specific metadata

ThinkWork may cache and denormalize some fields for speed and filtering, but this is a projection, not ownership.

### 3.3 Native GenUI is foundational

Task work in ThinkWork should be rendered through a constrained set of **native mobile-first GenUI cards**, not markdown and not embedded remote apps.

This is not a nice-to-have. It is core product infrastructure.

### 3.4 MCP is infrastructure, not the product contract

MCP tools may execute reads and writes, but ThinkWork's product contract should be a normalized external-work-item model and a bounded action/capability model. Tool names and provider payloads should not leak into the user-facing architecture.

### 3.5 Structured actions should not require full agent turns

Explicit UI actions like changing status, assigning a user, or submitting a task form should execute through a structured action layer. Full agent turns should be reserved for ambiguous, conversational, or multi-step requests.

---

## 4. Goals

- A connected external task can appear in ThinkWork as a thread-native task experience within seconds of assignment or creation.
- The task experience feels native on mobile through bounded GenUI cards and forms.
- Users can inspect and update common task fields without relying on markdown chat output.
- Chat remains available for planning, clarification, automation, and agent execution.
- The architecture generalizes across providers without schema rewrites.
- ThinkWork stores linkage, projection, and audit context, but does not own task truth.

---

## 5. Non-goals

- No new internal `tasks` table for MVP.
- No iframe-based embedded provider UI.
- No provider-specific UI forks for external provider vs Linear vs Jira.
- No requirement that every structured UI action goes through a full agent wakeup.
- No attempt to normalize every exotic provider field in MVP.
- No internal-only task objects that exist without an external source system.

---

## 6. User experience vision

When a user is assigned a task in an external system:
- a ThinkWork thread appears,
- the top of the thread shows a rich native task card,
- the thread sheet and thread list can group/filter/sort by projected task fields,
- the user can open a form card to edit fields like status, assignee, due date, or notes,
- chat remains available for conversational collaboration with the agent,
- the thread becomes the durable context for the work, even though the provider remains the source of truth.

The key is that the user experiences a **task workspace**, not a raw webhook mirror and not a markdown transcript.

---

## 7. Core design decision

### 7.1 External work items attach to threads

Every external task maps into ThinkWork through a normalized `external_work_item` linkage stored on the thread.

Suggested thread metadata shape:

```ts
metadata.external = {
  kind: "task",
  provider: "mobile-host" | "linear" | "jira" | "asana",
  externalId: "...",
  url: "...",
  version: "...",
  authority: "external",
  syncState: "ok" | "drift" | "refreshing" | "error",
  capabilities: {
    read: true,
    updateStatus: true,
    assign: true,
    comment: true,
    editFields: true,
    create: false,
  },
  lastSyncedAt: "...",
  lastChangeOrigin: "inbound" | "outbound",
}
```

Thread columns like `title`, `status`, `priority`, and `due_at` may be denormalized for filtering and lists, but the canonical state remains external.

---

## 8. GenUI architecture

This is the biggest change in v2.

The task experience should be powered by a **bounded native component grammar** instead of freeform markdown or provider-hosted mini-apps.

### 8.1 Required GenUI components for MVP

ThinkWork should support a small set of reusable task-oriented components:

- `external_task_card`
  - title
  - status
  - priority
  - assignee
  - due date
  - description preview
  - source badge
  - quick actions

- `external_task_fields_card`
  - compact structured field view
  - provider-agnostic display of normalized fields

- `external_task_activity_card`
  - comments / updates / history summary

- `external_task_actions_card`
  - button row / menu for common actions

- `external_task_form_card`
  - editable structured form
  - submit/cancel
  - field validation
  - loading/error states

- `external_task_list_card`
  - list or grouped list of tasks for thread collections / board views

The point is not to support arbitrary UI generation. The point is to support a constrained set of native surfaces that can cover most task interactions cleanly on mobile.

### 8.2 Normalized task resource contract

Task UI should render from a **ThinkWork-normalized task resource**, not directly from provider payloads.

The adapter layer should coerce external responses into a stable shape with four parts:

1. **Core**
   - fields shared across providers and safe for common rendering
2. **Capabilities**
   - what the current user can actually do to this task
3. **Extensions**
   - structured provider-specific richness that should not be flattened away
4. **Raw**
   - the original provider payload for debugging, fallback, and future evolution

Suggested normalized shape:

```ts
type NormalizedTask = {
  core: {
    id: string
    provider: "mobile-host" | "linear" | "jira" | "asana"
    title: string
    description?: string
    status?: { value: string; label: string; color?: string }
    priority?: { value: string; label: string; color?: string }
    assignee?: { id?: string; name: string; email?: string }
    dueAt?: string
    url?: string
    updatedAt?: string
  }
  capabilities: {
    getTask?: boolean
    listTasks?: boolean
    updateStatus?: boolean
    assignTask?: boolean
    commentOnTask?: boolean
    editTaskFields?: boolean
    createTask?: boolean
  }
  fields: TaskFieldSpec[]
  actions: TaskActionSpec[]
  forms?: {
    edit?: TaskFormSchema
    comment?: TaskFormSchema
  }
  extensions?: {
    providerFields?: TaskFieldSpec[]
    workflow?: Record<string, unknown>
    activity?: Record<string, unknown>
  }
  raw?: Record<string, unknown>
}
```

This is the key implementation rule: **normalize the task for ThinkWork, do not make the renderer understand every provider's response shape.**

### 8.3 Renderer contract

The renderer should be driven by a **bounded block grammar**, not by arbitrary provider JSON and not by LLM-invented layouts.

Suggested block types for MVP:

- `task_header`
- `field_list`
- `badge_row`
- `activity_list`
- `action_bar`
- `form`
- `section`
- `empty_state`

Suggested field/input types for MVP:

- `text`
- `textarea`
- `badge`
- `select`
- `user`
- `date`
- `chips`
- `boolean`
- `hidden`

Suggested envelope shape:

```ts
{
  _type: "external_task",
  _source: {
    provider: "mobile-host",
    tool: "task_get",
    params: { id: "task_123" },
  },
  item: NormalizedTask,
  blocks: [
    { type: "task_header", ... },
    { type: "field_list", ... },
    { type: "action_bar", ... },
  ],
}
```

The same rule applies to task lists and forms. They should be built from normalized resources and a renderer whitelist, not from provider-specific React branches spread across the app.

### 8.3.1 Draft interfaces

This should not be implemented as a lowest-common-denominator task model. It should be a **normalized core + typed extensions** model.

Draft interfaces:

```ts
type TaskProvider = "mobile-host" | "linear" | "jira" | "asana"

type TaskActionType =
  | "external_task.update_status"
  | "external_task.assign"
  | "external_task.comment"
  | "external_task.edit_fields"
  | "external_task.refresh"

type TaskFieldType =
  | "text"
  | "textarea"
  | "badge"
  | "select"
  | "user"
  | "date"
  | "chips"
  | "boolean"
  | "hidden"

type TaskOption = {
  value: string
  label: string
  color?: string
  metadata?: Record<string, unknown>
}

type TaskFieldSpec = {
  key: string
  label: string
  type: TaskFieldType
  value?: unknown
  editable?: boolean
  required?: boolean
  placeholder?: string
  helpText?: string
  badgeColor?: string
  multiple?: boolean
  options?: TaskOption[]
  metadata?: Record<string, unknown>
}

type TaskActionSpec = {
  id: string
  type: TaskActionType
  label: string
  variant?: "primary" | "secondary" | "ghost" | "danger"
  formId?: string
  params?: Record<string, unknown>
  confirm?: {
    title: string
    body?: string
    confirmLabel?: string
  }
}

type TaskFormField = {
  key: string
  label: string
  type: Exclude<TaskFieldType, "badge">
  required?: boolean
  defaultValue?: unknown
  placeholder?: string
  helpText?: string
  hidden?: boolean
  options?: TaskOption[]
  loadOptions?: {
    source: "static" | "provider"
    resource?: string
    params?: Record<string, unknown>
  }
  validation?: {
    minLength?: number
    maxLength?: number
    pattern?: string
  }
}

type TaskFormSchema = {
  id: string
  title: string
  description?: string
  submitLabel: string
  cancelLabel?: string
  actionType: TaskActionType
  fields: TaskFormField[]
}

type TaskBlock =
  | {
      type: "task_header"
      title?: string
      showSource?: boolean
      showUpdatedAt?: boolean
    }
  | {
      type: "field_list"
      title?: string
      fieldKeys: string[]
      columns?: 1 | 2
    }
  | {
      type: "badge_row"
      fieldKeys: string[]
    }
  | {
      type: "activity_list"
      title?: string
      path?: string
      limit?: number
    }
  | {
      type: "action_bar"
      actionIds: string[]
    }
  | {
      type: "form"
      formId: string
    }
  | {
      type: "section"
      title?: string
      blocks: TaskBlock[]
    }
  | {
      type: "empty_state"
      title: string
      body?: string
      actionId?: string
    }

type ExternalTaskEnvelope = {
  _type: "external_task"
  _source?: {
    provider: TaskProvider
    tool: string
    params: Record<string, unknown>
  }
  item: NormalizedTask
  blocks: TaskBlock[]
}
```

These are intentionally drafty, but they make the intended split explicit:
- adapters produce normalized tasks, actions, forms, and extension data
- the renderer consumes a bounded envelope contract
- the UI emits ThinkWork-native action types

### 8.4 Form cards are first-class

The editable form card is foundational.

It should support:
- select fields
- text fields
- textarea
- assignee picker
- due date picker
- hidden provider metadata
- optimistic submit state
- server-confirmed refresh

The form schema should come from the adapter layer, not from handwritten per-provider React branches everywhere.

A `TaskFormSchema` should define:
- field order
- field types
- validation rules
- option loaders / static options
- submit action id
- loading and error copy

### 8.5 No iframe wrappers

MCP-UI / MCP-APP style iframe wrappers are explicitly out of scope.

Reasons:
- bad mobile ergonomics,
- weak visual consistency,
- poor composability inside threads,
- weak durability as a ThinkWork-native product surface,
- higher long-term coupling to external UI contracts.

---

## 9. Capability model

ThinkWork should normalize task providers into a bounded set of capabilities.

### 9.1 MVP capabilities

- `get_task`
- `list_tasks`
- `update_status`
- `assign_task`
- `comment_on_task`
- `edit_task_fields`

### 9.2 Post-MVP capabilities

- `create_task`
- `transition_workflow_state`
- `add_checklist_item`
- `link_related_work`
- `bulk_update`

The GenUI layer should only expose actions the adapter says are supported.

### 9.3 Action contract

The UI should emit **ThinkWork-native action types**, not provider-specific tool names.

Suggested MVP action types:

- `external_task.update_status`
- `external_task.assign`
- `external_task.comment`
- `external_task.edit_fields`
- `external_task.refresh`

The executor layer then maps those actions to the correct provider operation, potentially through MCP under the hood.

---

## 10. Adapter architecture

ThinkWork needs a first-class **external work item adapter** seam.

### 10.1 Adapter responsibilities

Each provider adapter is responsible for:
- verifying inbound webhook signatures,
- normalizing inbound event payloads,
- normalizing provider read responses into `NormalizedTask`,
- exposing supported capabilities,
- building form schemas for editable task surfaces,
- generating normalized action definitions,
- translating structured outbound actions into provider-native calls,
- mapping provider-specific errors back into ThinkWork-safe UI states,
- preserving raw payloads for debugging and fallback.

### 10.2 Design rule

Providers may have wildly different response shapes. That complexity should be isolated behind the adapter.

Examples:
- external provider might return `status.name`
- Linear might return `state.name`
- Jira might return `fields.status.name`

The renderer should see the same normalized `status` shape either way.

### 10.3 Suggested structure

```txt
packages/api/src/integrations/external-work-items/
  index.ts
  types.ts
  executeAction.ts
  normalizeEvent.ts
  providers/
    mobile-host/
      verifySignature.ts
      normalizeEvent.ts
      normalizeItem.ts
      buildFormSchema.ts
      executeAction.ts
    linear/
    jira/
    asana/
```

This seam should be about **external work items**, not just “task provider webhooks.”

---

## 11. Inbound flow

### 11.1 External → ThinkWork

1. Provider sends webhook or ThinkWork polls.
2. Adapter verifies authenticity.
3. Adapter normalizes event into canonical item/event shape.
4. ThinkWork resolves the matching user/connection.
5. ThinkWork creates or updates the attached task thread.
6. ThinkWork updates denormalized thread fields.
7. ThinkWork refreshes the normalized task resource.
8. ThinkWork refreshes or invalidates task GenUI payload.
9. ThinkWork appends system activity only when useful.

### 11.2 Creation rule

For MVP, a thread should be created when:
- a task is assigned to the connected user, or
- a task already linked to that user changes materially.

### 11.3 Reassignment rule

If a task is reassigned from connected user A to connected user B:
- A's thread is closed/archived with a clear system message,
- B gets a fresh task thread.

This keeps conversation context clean.

---

## 12. Outbound flow

This is where v2 deliberately differs from the original draft.

### 12.1 Structured UI actions

Structured actions from task cards or form cards should go through a **direct action executor**, not a full agent wakeup by default.

Examples:
- change status
- reassign task
- edit due date
- submit task form
- add a short comment

Flow:
1. User interacts with a native task card/form.
2. Client sends a ThinkWork-native structured action request.
3. ThinkWork validates capability and payload.
4. The executor resolves the provider adapter.
5. The adapter executes the provider update directly, potentially via MCP under the hood.
6. ThinkWork records an audit event on the thread.
7. Thread projection + normalized task resource + GenUI refresh are updated.

This gives fast, reliable UX for high-frequency actions.

### 12.2 Agent-driven actions

Agent turns remain the right path for:
- ambiguous requests,
- conversational planning,
- multi-step operations,
- provider actions that need reasoning,
- requests like “clean this up,” “figure out what’s blocked,” or “draft a response to the assignee.”

### 12.3 Rule of thumb

If the action can be represented as a validated form submission or button click, it should not require a full LLM turn.

### 12.4 One more design rule

The UI contract should remain ThinkWork-native even if the execution path uses MCP.

In other words:
- **MCP is a backend implementation detail**
- **the adapter/executor contract is the product contract**

---

## 13. Thread identity decision

The PRD should explicitly choose the identity model.

### Recommended MVP choice

A thread represents **one external task for one connected user context**.

That means the practical identity is closer to:
- `(provider, externalTaskId, connectedUserId)`

rather than only:
- `(provider, externalTaskId)`

Why:
- reassignment behavior already implies user-specific context,
- conversation history should not leak across owners,
- it keeps agent context clean,
- it maps well to the “fresh thread on reassignment” rule.

---

## 14. Data model guidance

### 14.1 No new `tasks` table for MVP

Keep the core architecture thread-based.

### 14.2 Accept a small projection surface

It is fine to denormalize onto `threads` for:
- title
- status
- priority
- due date
- assignee label

But these fields should be clearly treated as projection/cache.

### 14.3 Optional future table

If the system later needs stronger sync, analytics, or cross-thread joins, ThinkWork may eventually introduce a small `external_work_items` table.

That would still be acceptable **if** it remains a linkage/projection layer and not a new ThinkWork-owned task authority.

Not needed for MVP.

---

## 15. Repo implications

Based on current repo shape, a few seams need to be cleaned up before this is truly provider-agnostic.

### 15.1 `refreshGenUI` needs refactoring

The current GenUI refresh path appears too tied to existing assumptions. It should become capable of refreshing normalized external task cards without carrying CRM or provider-specific logic everywhere.

### 15.2 Integrations surface is incomplete

The repo already appears to know about `mobile-host` in some backend paths, but the user-facing integrations surface does not yet fully reflect that. The product seam needs to become end-to-end.

### 15.3 Webhook targeting likely needs expansion

If webhook targeting is still centered on `agent | routine`, this design needs a real integration/external-work-item path instead of jamming provider sync through the wrong abstraction.

---

## 16. MVP scope

Provider: **external provider Tasks only**

Deliver:
- connect external provider Tasks
- receive assignment/update events
- create/update task-linked threads
- render native task card in the thread
- support form-card-driven edits for common fields
- support direct structured actions for status/assignee/field updates
- support agent chat for reasoning and conversational actions
- keep external provider authoritative

Do not deliver in MVP:
- full board builder
- multi-provider workflow customization
- iframe-based provider surfaces
- universal support for every provider-specific field
- nightly reconciliation jobs unless drift proves painful immediately

---

## 17. Verification plan

- Connect a external provider account and confirm a task assignment opens a ThinkWork thread.
- Confirm the thread renders a native task card, not markdown.
- Open a form card and update status, assignee, or due date.
- Confirm the provider changes immediately.
- Confirm thread audit history reflects the action.
- Ask the agent to update the task conversationally and confirm that path still works.
- Reassign the task to another connected user and confirm thread handoff behavior.
- Simulate a provider failure and confirm the UI shows a recoverable sync/drift state.

---

## 18. Risks and traps

- The biggest architectural trap is accidentally rebuilding a hidden internal task system through metadata, cards, and sync logic.
- The biggest product trap is falling back to markdown because card/form support is incomplete.
- The biggest UX trap is routing every structured action through an LLM turn and making simple task edits feel laggy.
- The biggest technical trap is letting provider-specific payloads leak into thread resolvers and GenUI components.
- The biggest long-term trap is treating MCP tool contracts as the product API.

---

## 19. Open questions

- Do we want a lightweight `external_work_items` projection table after MVP, or can threads + metadata carry the load long enough?
- Should task lists/boards in ThinkWork be purely thread-derived, or should they query the provider live in some contexts?
- How much provider-specific field customization belongs in the form-card schema for MVP?
- Which actions are safe to expose directly in UI vs requiring an agent confirmation step?
- Do we want admin-side integration management in addition to mobile settings?

---

## 20. Bottom line

ThinkWork should not build a second task system.

It should build a **thread-native, mobile-first external task experience** powered by:
- normalized external work item adapters,
- bounded native GenUI cards and forms,
- direct structured action execution for explicit edits,
- agent turns for reasoning and conversation,
- and a strict rule that external systems remain authoritative.

If this is done right, ThinkWork becomes the best place to **work with tasks** without becoming the place that **owns tasks**.

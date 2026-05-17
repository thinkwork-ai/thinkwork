---
status: active
date: 2026-05-17
type: feat
title: "feat(cli): Phase 1 — implement thread / message / label / inbox commands"
origin: docs/brainstorms/2026-05-17-thinkwork-cli-roadmap-completion-requirements.md
depth: standard
---

# feat(cli): Phase 1 — chat-surface commands (`thread`, `message`, `label`, `inbox`)

## Summary

Implement the four Phase 1 stub commands from the parent brainstorm (see origin: `docs/brainstorms/2026-05-17-thinkwork-cli-roadmap-completion-requirements.md`). All four are currently scaffolded (subcommand surfaces, `--help` text, and flag parsing declared) but every action calls `notYetImplemented(path, 1)` and exits 2. This plan turns each into a working command backed by the existing GraphQL API.

**Key planning finding: zero API work required.** All 24 subcommands across the four commands map cleanly to existing queries/mutations in `packages/database-pg/graphql/types/` — `threads.graphql`, `messages.graphql`, `thread-dependencies.graphql`, `inbox-items.graphql`. Phase 1 is pure CLI client work plus per-PR docs sync.

---

## Problem Frame

After PR #1327 shipped F1+F2 (the existing-surface UX fixes), the next slice of the CLI roadmap is converting the Phase 1 stubs into real commands. The brainstorm's R2 names this group explicitly: `thread`, `message`, `label`, `inbox` — the chat-surface commands that serve the **power-user-terminal-for-end-users** half of the CLI's charter (per origin: `Charter Decisions` and `R1`).

Today these commands exist in the binary's `--help` output, accept arguments, then exit 2 with a "ships in Phase 1" message that points readers at `apps/cli/README.md#roadmap`. Eric's lived experience running `thinkwork eval` proved the gap is felt; the same gap exists across every chat-surface verb.

Phase 1 closes that gap by wiring each subcommand action through the GraphQL client to the already-deployed API.

---

## Scope

### In scope

- All 24 subcommands across the four Phase 1 commands:
  - **`thread`** (10 subcommands): `list`, `get`, `create`, `update`, `checkout`, `release`, `comment`, `label assign|remove`, `escalate`, `delegate`, `delete`.
  - **`message`** (2 subcommands): `send`, `list`.
  - **`label`** (4 subcommands): `list`, `create`, `update`, `delete`.
  - **`inbox`** (8 subcommands): `list`, `get`, `approve`, `reject`, `request-revision`, `resubmit`, `cancel`, `comment`.
- Per-PR documentation sync per origin R10:
  - `apps/cli/README.md` — remove the command's line from the roadmap section, update its row in the command-list section.
  - `docs/src/content/docs/applications/cli/commands.mdx` — add or replace the command's full section with subcommand reference, flag tables, and examples.
  - Per-command `--help` text already declared in the stub files; only modify when behavior diverges from the scaffold.
- One worktree per command, one PR per command, squash-merged as CI goes green (per memory `feedback_merge_prs_as_ci_passes` and the pattern proven in PR #1327).
- Removal of `notYetImplemented` calls in each touched file. The `apps/cli/src/lib/stub.ts` helper stays — it is still used by Phase 2-5 stubs and is retired by R1 only after the last stub is gone.

### Out of scope (deferred to follow-up work)

- Phase 2-5 commands (`agent`, `template`, `tenant`, `member`, `team`, `kb`, `routine`, `scheduled-job`, `turn`, `wakeup`, `webhook`, `connector`, `skill`, `memory`, `recipe`, `artifact`, `cost`, `budget`, `performance`, `trace`, `dashboard`) — own brainstorm-driven plans.
- The R-Q1/R-Q2/R-Q3/R-Q4/R-Q5 reshape questions from the brainstorm — all relate to Phase 3+/4+/5 commands and do not affect Phase 1.
- The R-Q6 auth-token UX work (recommend `$THINKWORK_API_KEY` for scripting) — Phase 1 commands honor the existing session-resolution path; the recommendation pattern is its own README/docs PR.
- A refactor of `resolveEvalContext` / `resolveWikiContext` / new Phase 1 `resolveXContext` helpers into a single shared `resolveApiCommandContext`. The duplication is recognized but small; consolidation waits until ~5+ helpers exist and the abstraction is obvious. (Deferred refactor, not a non-goal.)
- Streaming/realtime updates (e.g., live `thread get --follow` via subscriptions). The subscription schema exists but the CLI has no streaming pattern yet. Defer to a separate brainstorm if desired.

---

## Key Technical Decisions

- **Per-command directory when subcommand count ≥ 5; single file otherwise.** Mirrors the existing CLI repo: `eval/` (10 subcommands → directory with one file per action + `gql.ts` + `helpers.ts`), `wiki/` (3 subcommands → directory with `gql.ts` + `helpers.ts` because helpers grew large). For Phase 1: `thread/` and `inbox/` get directories; `message.ts` and `label.ts` stay as single files since they only have 2 and 4 subcommands respectively. The implementer may upgrade `label` to a directory if `helpers.ts` content grows materially.
- **Per-command `resolveXContext` helper.** Each command's `helpers.ts` (or inline equivalent for single-file commands) gets its own `resolveThreadContext` / `resolveMessageContext` / etc., mirroring `resolveEvalContext` in `apps/cli/src/commands/eval/helpers.ts`. This duplication is intentional for v1 — see Scope Boundaries for the deferred consolidation.
- **`thread comment` maps to `sendMessage` with `role: USER`.** No separate "comment" mutation exists in the schema; the operator-comment vs agent-message distinction is carried by `senderType` / `senderId` on `Message`. The `thread comment` subcommand sets `role: USER`, `senderType: "user"`, `senderId: <caller's user ID resolved from session>`. Consumers (admin UI, mobile) already render the unified `Message` list and distinguish role visually; no UI changes needed.
- **`thread label assign|remove` calls `assignThreadLabel` / `removeThreadLabel` mutations** even though they live on the thread surface in the CLI and the label surface in the schema. This mirrors the brainstorm's R3 (preserve scaffolded shape) — the CLI subcommand exists today as `thread label <assign|remove>` and must keep that shape. The `thinkwork label` command itself only manages label CRUD, not assignments.
- **`thread get <idOrNumber>`** branches on input shape (alphanumeric-with-prefix vs pure integer) to call `thread(id:)` vs `threadByNumber(tenantId:, number:)`. Same pattern as Linear-style "fetch by issue number." Tenant ID is resolved from the session/flag/env before the GraphQL call.
- **`inbox list --mine` resolves the caller's user ID from the session.** No special filter on the API — pass `recipientId: <caller's user ID>` to `inboxItems()`. If the session has no resolved user ID (api-key auth without a user binding), `--mine` returns an error directing the caller to either remove the flag or use OAuth-resolved auth.
- **JSON-mode output** is honored on every list/get subcommand via the existing `isJsonMode()` / `printJson()` helpers in `apps/cli/src/lib/output.ts`. Human-readable output uses ASCII tables (matching `eval list`) for list verbs and key-value pretty-print for `get` verbs.
- **One PR per command.** Four PRs total, in dependency-free order. Each PR includes its source changes + the docs sync for that command. Squash-merge as CI passes per memory `feedback_merge_prs_as_ci_passes`. PRs target `main`, never stack (memory `feedback_pr_target_main`).

---

## High-Level Technical Design

This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.

```
                ┌─────────────────────────────────────────────────────────┐
                │  apps/cli/src/commands/<cmd>.ts  OR  <cmd>/index.ts    │
                │  - Commander subcommand definitions (already scaffolded)│
                │  - .action(...) delegates to per-subcommand handler     │
                └────────────────────────────┬────────────────────────────┘
                                             │
                          ┌──────────────────┴──────────────────┐
                          │   apps/cli/src/commands/<cmd>/<sub>.ts │  (action handlers)
                          │   - parses opts                       │
                          │   - calls resolve<Cmd>Context(opts)   │
                          │   - issues gqlQuery / gqlMutate       │
                          │   - prints via lib/output             │
                          └──────────────────┬──────────────────┘
                                             │
                          ┌──────────────────┴──────────────────┐
                          │   apps/cli/src/commands/<cmd>/helpers.ts │
                          │   - resolve<Cmd>Context (stage+tenant+client) │
                          │   - format helpers (table rows, status badges)│
                          └──────────────────┬──────────────────┘
                                             │
                          ┌──────────────────┴──────────────────┐
                          │   apps/cli/src/commands/<cmd>/gql.ts     │
                          │   - typed GraphQL documents               │
                          │   - generated via `pnpm --filter         │
                          │     thinkwork-cli codegen`                │
                          └─────────────────────────────────────┘
```

Each new action handler is ~30-60 lines: parse opts → resolve context → issue one or two GraphQL calls → render. The shape is established by `apps/cli/src/commands/eval/run.ts` (longest, most interactive) and `apps/cli/src/commands/eval/list.ts` (shortest, pure read).

---

## Output Structure

```text
apps/cli/src/commands/
├── thread/                          [NEW directory for thread command]
│   ├── index.ts                     [moved from thread.ts; registers subcommands]
│   ├── gql.ts                       [GraphQL documents]
│   ├── helpers.ts                   [resolveThreadContext + formatters]
│   ├── list.ts
│   ├── get.ts
│   ├── create.ts
│   ├── update.ts
│   ├── checkout.ts
│   ├── release.ts
│   ├── comment.ts
│   ├── label.ts                     [assign|remove subcommand actions]
│   ├── escalate.ts
│   ├── delegate.ts
│   └── delete.ts
├── message.ts                       [stays single-file; 2 subcommands]
├── label.ts                         [stays single-file; 4 subcommands]
└── inbox/                           [NEW directory for inbox command]
    ├── index.ts                     [moved from inbox.ts]
    ├── gql.ts
    ├── helpers.ts
    ├── list.ts
    ├── get.ts
    ├── approve.ts
    ├── reject.ts
    ├── request-revision.ts
    ├── resubmit.ts
    ├── cancel.ts
    └── comment.ts
```

This is a scope declaration showing the expected output shape. The implementer may adjust (e.g., promote `label.ts` to a directory if helpers grow) — per-unit `**Files:**` sections are authoritative.

---

## Implementation Units

### U1. `thread` command — implement all 10 subcommands

**Goal:** Wire every `thread` subcommand action through the GraphQL client to the existing `threads.graphql` query/mutation surface. The current `apps/cli/src/commands/thread.ts` stub becomes `apps/cli/src/commands/thread/index.ts` plus one file per action. Ship as PR #1 of Phase 1.

**Requirements:** R1, R2 (Phase 1 first command), R3 (preserve scaffolded subcommand shape), R10 (docs sync in same PR), R12 (drop `notYetImplemented` import).

**Dependencies:** none.

**Files:**

- Move: `apps/cli/src/commands/thread.ts` → `apps/cli/src/commands/thread/index.ts` (delete the stub import, replace `.action(() => notYetImplemented(...))` calls with imports of the new action handlers).
- Create: `apps/cli/src/commands/thread/gql.ts` — typed GraphQL documents for `threads`, `threadsPaged`, `thread`, `threadByNumber`, `threadLabels`, `createThread`, `updateThread`, `deleteThread`, `checkoutThread`, `releaseThread`, `assignThreadLabel`, `removeThreadLabel`, `escalateThread`, `delegateThread`. Generated via `pnpm --filter thinkwork-cli codegen`.
- Create: `apps/cli/src/commands/thread/helpers.ts` — `resolveThreadContext` (mirrors `resolveEvalContext` in `apps/cli/src/commands/eval/helpers.ts`); format helpers for thread tables (id/number/title/status/assignee columns) and status badges.
- Create: `apps/cli/src/commands/thread/{list,get,create,update,checkout,release,comment,label,escalate,delegate,delete}.ts` — one per subcommand action.
- Create: `apps/cli/__tests__/thread-registration.test.ts` — mirror of `apps/cli/__tests__/eval-registration.test.ts`.
- Modify: `apps/cli/src/cli.ts` — import path stays (`./commands/thread.js` → `./commands/thread/index.js` via package-export convention; the directory's `index.ts` makes this automatic if TypeScript resolves it; otherwise update the import path).
- Modify: `apps/cli/README.md` — remove the `thread` line from the roadmap section; update or add the row in the command-list section.
- Modify: `docs/src/content/docs/applications/cli/commands.mdx` — add or replace the `## thread` section with full subcommand reference, flag tables, and examples.

**Approach:**

- For each subcommand, the action handler: parses `opts`, calls `resolveThreadContext(opts)` (returns `{ stage, region, client, tenantId, tenantSlug }`), issues one GraphQL call via `gqlQuery` / `gqlMutate` from `apps/cli/src/lib/gql-client.ts`, then renders via `printJson` (JSON mode) or a domain-appropriate human-readable shape (table for `list`, key-value pretty-print for `get`, success line for mutations).
- `thread comment` invokes `sendMessage` mutation with `role: USER`, `senderType: "user"`, `senderId: <caller's user ID from session>`. (See Key Technical Decisions.)
- `thread label assign|remove` invokes `assignThreadLabel` / `removeThreadLabel` respectively. The CLI subcommand keeps its existing shape; the user thinks "this is a thread operation" while the schema models it on the thread-label assignment table.
- `thread checkout` / `thread release` use the `CheckoutThreadInput` / `ReleaseThreadInput` shapes; `--agent <id>` flag maps to the `agentId` (when present) or defaults to the caller's identity from session.
- `thread delete` honors the existing `-y / --yes` flag pattern (mirrors `eval delete` in `apps/cli/src/commands/eval/delete.ts`).
- `thread get <idOrNumber>` branches: pure integer → `threadByNumber(tenantId:, number:)`; alphanumeric → `thread(id:)`.

**Patterns to follow:**

- `apps/cli/src/commands/eval/` directory shape (one-file-per-action + `gql.ts` + `helpers.ts`).
- `apps/cli/src/commands/eval/helpers.ts::resolveEvalContext` for the context resolver.
- `apps/cli/src/commands/eval/list.ts` for simple read patterns.
- `apps/cli/src/commands/eval/run.ts` for interactive prompting with `@inquirer/prompts`.
- `apps/cli/src/commands/eval/delete.ts` for destructive verbs with `-y/--yes`.
- `apps/cli/src/lib/output.ts` for JSON-mode + table rendering.
- `apps/cli/src/lib/interactive.ts` for `isInteractive` / `requireTty` / `promptOrExit`.

**Test scenarios:**

- Registration smoke (mirrors `apps/cli/__tests__/eval-registration.test.ts`): assert each of the 10 subcommands is registered, accepts the documented flags, and has non-empty `--help` text.
- `thread list`: returns a table when given valid options; honors `--json`; surfaces empty result with a friendly "no threads found" message; honors `--limit` cap.
- `thread get <id>`: alphanumeric input dispatches `thread(id:)`; pure-integer input dispatches `threadByNumber(tenantId:, number:)`; nonexistent input prints a clear "not found" error and exits non-zero.
- `thread create`: in TTY mode, prompts for missing title and assignee; in non-TTY mode with no title arg, errors with the missing-flag list; honors `--label` repeatable flag (resolves label names → IDs via `threadLabels()` then calls `assignThreadLabel` after `createThread`).
- `thread update`: only provided flags become part of the `UpdateThreadInput`; omitted fields are not sent (mirrors the partial-update pattern in `eval test-case update`).
- `thread delete`: without `-y`, prompts for confirmation in TTY; with `-y`, skips the prompt; non-TTY without `-y` errors.
- `thread comment <id>`: with content arg → calls `sendMessage` with `role: USER`; without content but `--file` → reads file; with neither and TTY → prompts; with neither and non-TTY → errors.
- `thread label assign|remove`: each dispatches the right mutation; validates threadId + labelId existence before calling.
- `thread checkout`/`release`: round-trip through `CheckoutThreadInput`/`ReleaseThreadInput`; `--agent` flag sets `agentId`.
- Error paths: missing session → `printMissingApiSessionError` (already fixed in PR #1327); GraphQL errors surface with the error message, not the raw payload.

**Verification:**

- All 10 subcommands return real data instead of exit-2.
- `pnpm --filter thinkwork-cli typecheck` clean.
- `pnpm --filter thinkwork-cli test` adds new tests, total passes (target 180+).
- `pnpm --filter thinkwork-cli build` produces a dist that, run against dev with a valid session, executes `thread list` and returns rows.
- README + commands.mdx updated; `thread` no longer appears in the README's roadmap section.

---

### U2. `message` command — implement `send` and `list`

**Goal:** Wire `thinkwork message send <threadId> [content]` and `thinkwork message list <threadId>` through `sendMessage` and `messages` GraphQL operations. Ship as PR #2 of Phase 1.

**Requirements:** R1, R2, R3, R10, R12.

**Dependencies:** none — independent of U1 at the code level (no imports between command files). Conceptually a user benefits from `thread list` to get IDs first, but `thinkwork message send` accepts a thread ID directly so it works standalone.

**Files:**

- Modify: `apps/cli/src/commands/message.ts` — replace `notYetImplemented` calls with action handlers inline. Stays single-file (only 2 subcommands). Inline `gql.ts` content via small `const` documents at the top of the file; or extract to `apps/cli/src/commands/message/gql.ts` if the implementer prefers (judgment call — both are fine).
- Create: `apps/cli/__tests__/message-registration.test.ts`.
- Modify: `apps/cli/README.md` — drop `message` from roadmap, update command-list.
- Modify: `docs/src/content/docs/applications/cli/commands.mdx` — add/replace `## message` section.

**Approach:**

- `message send <threadId> [content]`: resolves `tenantId` via the existing context helper; calls `sendMessage` with `role: USER` (default), `content` from arg or `--file` or interactive prompt. `--as-agent <id>` flag (already declared in the stub) sets `role: ASSISTANT` and `senderType: "agent"` + `senderId: <agent-id>` — this is an api-key-auth-only flag; reject the flag when the session is OAuth-resolved with a clear error.
- `message list <threadId>`: calls `messages(threadId:, limit:, cursor:)` — renders as a table (timestamp / role / author / content-preview) in human mode, full JSON in JSON mode. Cursor pagination via `--cursor <c>`.

**Patterns to follow:**

- Same as U1 — `eval/` is the canonical reference.
- For interactive content prompting: `apps/cli/src/commands/eval/test-case/create.ts` uses `input` from `@inquirer/prompts` for multi-line text.

**Test scenarios:**

- Registration smoke: `message send` and `message list` both registered with their flags.
- `message send`: content arg → mutation fired with that content; `--file` → reads file; TTY no content → prompts; non-TTY no content → errors.
- `message send --as-agent`: rejected on OAuth session with clear error; accepted on api-key session (test by injecting a fake api-key session via test fixture).
- `message list`: returns paginated results; `--cursor` honored; empty result handled.
- Error paths: invalid `threadId` → API error surfaced; missing session → fixed error from PR #1327.

**Verification:**

- Both subcommands return real data instead of exit-2.
- Typecheck + tests pass.
- Build artifact `node apps/cli/dist/cli.js message send <real-thread-id> "test"` against dev succeeds end-to-end.
- README + commands.mdx updated.

---

### U3. `label` command — implement label CRUD

**Goal:** Wire `thinkwork label list|create|update|delete` through `threadLabels`, `createThreadLabel`, `updateThreadLabel`, `deleteThreadLabel`. Ship as PR #3 of Phase 1.

**Requirements:** R1, R2, R3, R10, R12.

**Dependencies:** none at code level.

**Files:**

- Modify: `apps/cli/src/commands/label.ts` — replace 4 `notYetImplemented` calls with inline action handlers + a small inline gql document set. Stays single-file (4 subcommands, ~150 lines projected).
- Create: `apps/cli/__tests__/label-registration.test.ts`.
- Modify: `apps/cli/README.md` — drop `label` from roadmap, update command-list.
- Modify: `docs/src/content/docs/applications/cli/commands.mdx` — add/replace `## label` section.

**Approach:**

- `label list`: tenant scope from session; calls `threadLabels(tenantId:)`; renders as table (id / name / color swatch / description) in human mode, JSON in JSON mode.
- `label create [name]`: name from arg or interactive prompt; color via `--color <hex>` flag (validate `^#[0-9a-fA-F]{6}$`); description via `--description`; calls `createThreadLabel(input:)`.
- `label update <id>`: only provided flags become part of the `UpdateThreadLabelInput`.
- `label delete <id>`: confirm prompt (skipped with `-y/--yes`); calls `deleteThreadLabel(id:)`. Surface in the prompt that any thread-label assignments will be removed.

**Patterns to follow:**

- `apps/cli/src/commands/eval/test-case/create.ts` for the partial-update + interactive prompt pattern.
- `apps/cli/src/commands/eval/delete.ts` for the destructive-with-confirm pattern.

**Test scenarios:**

- Registration smoke for all 4 subcommands.
- `label list`: returns rows; empty result handled; JSON mode honored.
- `label create`: with all flags → mutation fires; TTY with no flags → prompts; invalid `--color` hex → validation error before API call.
- `label update`: only specified fields go into input; unspecified fields untouched.
- `label delete`: confirm prompt fires in TTY without `-y`; `-y` skips prompt; non-TTY without `-y` errors.
- Error paths: missing session → fixed error from PR #1327; deleting a label that doesn't exist → clear "not found" error.

**Verification:**

- All 4 subcommands return real data instead of exit-2.
- Typecheck + tests pass.
- `node apps/cli/dist/cli.js label list` against dev returns the tenant's labels.
- README + commands.mdx updated.

---

### U4. `inbox` command — implement approval flow surface

**Goal:** Wire all 8 `inbox` subcommands through the `inboxItems`/`inboxItem` queries and the approval mutation set. Ship as PR #4 of Phase 1.

**Requirements:** R1, R2, R3, R10, R12.

**Dependencies:** none at code level. Conceptually, `inbox` is the highest-value Phase 1 surface for operators (approval flows for agent-proposed work), so shipping it last sequences the "biggest value-add per PR" curve correctly — each preceding PR makes `inbox` more useful (you've already got `thread list`, `message send`, `label list` to navigate around once `inbox approve` returns control to an agent).

**Files:**

- Move: `apps/cli/src/commands/inbox.ts` → `apps/cli/src/commands/inbox/index.ts` (replace `notYetImplemented` action imports with real ones).
- Create: `apps/cli/src/commands/inbox/gql.ts` — typed documents for `inboxItems`, `inboxItem`, `approveInboxItem`, `rejectInboxItem`, `requestRevision`, `resubmitInboxItem`, `cancelInboxItem`, `addInboxItemComment`.
- Create: `apps/cli/src/commands/inbox/helpers.ts` — `resolveInboxContext`; format helpers for the inbox item table (id / type / status badge / requester / age) and the detail view.
- Create: `apps/cli/src/commands/inbox/{list,get,approve,reject,request-revision,resubmit,cancel,comment}.ts`.
- Create: `apps/cli/__tests__/inbox-registration.test.ts`.
- Modify: `apps/cli/src/cli.ts` — update import path for inbox.
- Modify: `apps/cli/README.md` — drop `inbox` from roadmap, update command-list.
- Modify: `docs/src/content/docs/applications/cli/commands.mdx` — add/replace `## inbox` section.

**Approach:**

- `inbox list`: tenant scope from session; calls `inboxItems(tenantId:, status:, entityType:, entityId:, recipientId:)`. `--mine` flag resolves the caller's user ID from session and passes it as `recipientId`. If session has no resolved user ID (api-key auth without user binding), `--mine` errors with guidance.
- `inbox get <id>`: calls `inboxItem(id:)`; renders the detail view including comments + links + linked threads.
- `inbox approve <id>`: calls `approveInboxItem(id:, input:)` with `--notes` mapped to `reviewNotes`. The `decisionValues` field (for inbox items whose recipe declared a `decisionSchema`) is not exposed in v1 — flag it in deferred work.
- `inbox reject <id>`: calls `rejectInboxItem(id:, input:)` with `--notes` → `reviewNotes`.
- `inbox request-revision <id>`: calls `requestRevision(id:, input:)`; `--notes` is required (the input field is non-null).
- `inbox resubmit <id>`: calls `resubmitInboxItem(id:, input:)`; takes optional `--notes` (maps to a metadata field on resubmit — see the `ResubmitInboxItemInput` schema for the exact field shape; resolve at implementation time).
- `inbox cancel <id>`: calls `cancelInboxItem(id:)`.
- `inbox comment <id> [content]`: calls `addInboxItemComment(input:)`; content from arg, `--file`, or interactive prompt (same shape as `thread comment`).

**Patterns to follow:**

- `apps/cli/src/commands/eval/` directory shape (since inbox has 8 subcommands, directory pattern applies).
- `apps/cli/src/commands/eval/get.ts` for detail-view rendering.
- The session-based user-ID resolution for `--mine` mirrors the way `eval list` resolves the caller's tenant — read from `loadStageSession(stage)` for the cached user info; if absent, error with guidance.

**Test scenarios:**

- Registration smoke for all 8 subcommands.
- `inbox list`: default `--status PENDING` honored; `--status` accepts each enum value; `--mine` resolves caller's user ID and filters; `--mine` on a userless session errors with clear guidance.
- `inbox get`: returns full detail including comments and links.
- `inbox approve`/`reject`: `--notes` mapped to `reviewNotes`; missing required input fields errored before the API call.
- `inbox request-revision`: `--notes` is required; missing in non-TTY errors; prompted in TTY when missing.
- `inbox resubmit`: optional `--notes` honored.
- `inbox cancel`: idempotent — calling on an already-CANCELLED item surfaces a clear API error.
- `inbox comment`: same content-input pattern as `thread comment` (arg / `--file` / prompt / error).
- Error paths: missing session → fixed error from PR #1327; permission denied (e.g., rejecting an item not routed to caller) → API error surfaced.

**Verification:**

- All 8 subcommands return real data instead of exit-2.
- Typecheck + tests pass.
- `node apps/cli/dist/cli.js inbox list` against dev returns the tenant's pending items.
- README + commands.mdx updated.

---

## System-Wide Impact

- **CLI users (operators + power-user end-users).** Phase 1 unblocks the entire chat-surface workflow from the terminal — listing/creating/closing threads, sending messages to them, organizing with labels, processing approval requests. The end-user-terminal half of the brainstorm's charter starts to materialize.
- **`apps/cli/README.md`.** The roadmap section shrinks from 25 lines to 21 (Phase 1 entries drop out). The command-list section gains real entries for `thread`, `message`, `label`, `inbox` and the published-vs-pending columns update.
- **`docs/src/content/docs/applications/cli/commands.mdx`.** Grows by 4 new top-level sections (`## thread`, `## message`, `## label`, `## inbox`) with full subcommand references. The two-mode login section is unaffected.
- **CLI version.** Each PR ships under the current 0.9.x line; a future `0.10.0` would be appropriate when Phase 1 completes (4 new commands is a meaningful feature bump). The version-bump decision is a separate concern — flagging it as deferred so the implementer can either bump per-PR or once at end-of-phase.
- **Mobile + admin SPA.** No changes. These commands consume already-shipped GraphQL operations the admin and mobile clients also use.
- **API.** No changes. The query/mutation surface is fully in place.
- **The 21 remaining stubs (`agent`, `template`, …, `dashboard`).** No changes; their roadmap entries stay until their respective phase PRs land.

---

## Risks

- **`thread comment` semantics could be challenged later.** Today the schema has `Message` with `MessageRole` but no separate "operator comment" entity. Mapping `thread comment` to `sendMessage role: USER` is the only honest play given the schema, but if a future product decision introduces a distinct comment surface (e.g., for admin-only annotations that agents shouldn't see), `thread comment` will need to switch. Mitigation: document the mapping in `thread comment --help` ("Internally sends a USER message; if your tenant uses operator-only comments, they appear in the same message list with `senderType: user`.").
- **`inbox approve --decision-values` is omitted in v1.** Inbox items whose recipe declared a `decisionSchema` (per the `InboxItemDecisionInput.decisionValues` AWSJSON field) cannot currently provide that structured payload from the CLI. Mitigation: document the omission in `inbox approve --help` and link to the admin UI for items requiring structured decisions. Add as deferred work.
- **No live API e2e for any Phase 1 command in CI.** Same posture as PR #1327 — vitest registration smoke + types + lint is the floor. Mitigation: each PR runs the built CLI against `dev` from the worktree as a manual smoke (mirroring U1's pattern from the prior plan).
- **Codegen drift on rebase.** If multiple Phase 1 PRs are in flight (e.g., U1 still under review while U2 is being built), the second PR's `pnpm codegen` may produce diffs that conflict with U1's `gql.ts`. Mitigation: ship strictly sequentially — open U2's PR only after U1 is merged. This matches `feedback_pr_target_main` (no stacking).
- **Per-command `helpers.ts` duplication.** Four new `resolveXContext` functions land that look ~95% identical to `resolveEvalContext` and `resolveWikiContext`. Recognized in Scope Boundaries; defer consolidation until ~5+ such helpers exist and the right abstraction is obvious.

---

## Patterns Followed

- Per-command directory structure with `index.ts` + `gql.ts` + `helpers.ts` + one file per subcommand action (`apps/cli/src/commands/eval/`).
- Context-resolver helper pattern (`resolveEvalContext` in `apps/cli/src/commands/eval/helpers.ts`).
- Interactive prompt fallback when TTY + missing required args (`apps/cli/src/commands/eval/run.ts`, `apps/cli/src/lib/interactive.ts`).
- JSON-mode output via the global `--json` flag and `apps/cli/src/lib/output.ts`.
- Destructive-verb confirmation via `-y/--yes` (`apps/cli/src/commands/eval/delete.ts`).
- Per-command registration smoke test (`apps/cli/__tests__/eval-registration.test.ts`, `apps/cli/__tests__/wiki-registration.test.ts`).
- Conventional-commit subjects, PRs target `main`, squash-merge as CI passes (memory `feedback_pr_target_main`, `feedback_merge_prs_as_ci_passes`).
- Worktree-per-PR isolation (memory `feedback_worktree_isolation`).

---

## Deferred to Follow-Up Work

- **U6 — `apps/cli/README.md` Authentication section** (origin R11): explain the two login modes plus the recommended `thinkwork user api-key create` + `$THINKWORK_API_KEY` pattern for scripted/daily use. Independent of Phase 1; can ship before, after, or alongside.
- **U7 — Consolidate `resolveXContext` helpers** into a shared `apps/cli/src/lib/resolve-api-context.ts`. Wait until ~5+ helpers exist (eval, wiki, thread, message-inline, label-inline, inbox = 6 after Phase 1). Right time is between Phase 1 and Phase 2.
- **U8 — `inbox approve --decision-values`** to support inbox items with structured `decisionSchema`. Requires a CLI input format decision (YAML file? JSON string? prompt walkthrough?).
- **U9 — `thread get --follow`** for live subscriber-style updates as new messages arrive. Needs a CLI streaming pattern; the AppSync subscription schema already supports it (`packages/database-pg/graphql/types/subscriptions.graphql`). Defer to a brainstorm on streaming UX.
- **U10 — CLI version bump to 0.10.0** at end of Phase 1 (4 new commands = feature bump). Either per-PR or end-of-phase; flagging so it doesn't get forgotten.

---

## Open Questions (resolve during implementation, not now)

- For `message send --as-agent <id>` on api-key auth: which session field carries the api-key identity and how does it map to `senderType` / `senderId`? Read the existing `apps/cli/src/lib/gql-client.ts` and `apps/cli/src/cli-config.ts` at implementation time and pick the right field.
- For `inbox resubmit --notes`: `ResubmitInboxItemInput` accepts `title`, `description`, `config` — where does `--notes` belong? Likely a metadata field or a separate addInboxItemComment call after resubmit. Resolve at implementation time by reading the resolver in `packages/api/src/graphql/`.
- For `thread label assign|remove`: should the assignment be idempotent at the CLI level (don't error if assigning an already-assigned label)? Match the API's behavior — read the resolver for `assignThreadLabel` and mirror.
- Codegen output path: confirm `pnpm --filter thinkwork-cli codegen` emits to `apps/cli/src/gql/` (existing path) or per-command-directory. Per-command-directory keeps each PR's diff scoped; existing path is one shared blob. Pick the smaller-diff option at implementation time.

---

## Verification (Plan-Level)

- 4 PRs merged to `main` via squash, in order: thread → message → label → inbox.
- Post-merge Deploy on `main` green after each merge (per memory `feedback_watch_post_merge_deploy_run`).
- `apps/cli/README.md` roadmap section no longer lists `thread`, `message`, `label`, `inbox` after the fourth PR.
- `docs/src/content/docs/applications/cli/commands.mdx` has accurate top-level sections for all four commands.
- A power user running `thinkwork login --stage dev` followed by any of: `thinkwork thread list`, `thinkwork message send <id> "hi"`, `thinkwork label list`, `thinkwork inbox list --mine` returns real data from the tenant.
- Memory file `project_cli_roadmap_completion_brainstorm.md` updated with the 4 PR numbers as they merge.

---
plan: Computer Thread Detail UI fixes
type: fix
status: active
created: 2026-05-09
---

# Fix: Computer Thread Detail (chat) UI fixes

Five small, scoped corrections to the Computer Thread Detail page (`/threads/$id` in `apps/computer`). Each is independently verifiable; together they tighten chrome, remove duplicated/filler activity rows, restore chronological event order, and render the assistant response as Markdown (with proper handling of streaming-time partial syntax).

---

## Branching prerequisite

The screenshots and the code being modified live on `main` (most recent merge: `74d9a49f feat(computer): UI polish + Threads route + shared UserMenu (#1050)`). The current checkout is on the older branch `codex/computer-v1-m2-streaming-buffer-ui`, which does **not** contain `TaskThreadView.tsx` in its modern form.

Per repo conventions (`feedback_worktree_isolation`, CLAUDE.md PR/branch workflow):

- Create a fresh worktree off `origin/main` at `.claude/worktrees/computer-thread-detail-ui-fixes`.
- All file paths in this plan are repo-relative and resolve **inside that worktree**, not the current checkout.
- PR opens against `main`. Squash-merge + delete branch + remove worktree on green per `feedback_merge_prs_as_ci_passes`.

---

## Problem frame

The Computer Thread Detail page (`apps/computer`, `<TaskThreadView>`) has five low-risk visual / behavior bugs that compound to make the page feel cluttered and stale:

1. **Header indent** — `AppTopBar` uses `px-4`, which pushes the back arrow further right than intended.
2. **Two "Thinking" rows per assistant turn** — one is rendered by `ThreadTurnActivity` (turn-level, with status/source/duration/tokens), and a second is unconditionally pushed by `actionRowsForMessage` for every assistant message (label "Thinking", filler detail "Computer planned the response.").
3. **"Computer planned the response." filler** — same root cause as #2: the per-message Thinking row has a fallback string when no `metadata.reasoning` / `metadata.thinking` / `metadata.summary` exists. With current Strands payloads it almost never has real content, so the user sees the filler.
4. **Reverse chronological event order** — `actionRowsForTurn` iterates `turn.events` in the order the GraphQL resolver returns them, and `computerEvents` orders DESC by `created_at`. Result: newest event is shown first, oldest last. The user expects oldest-at-top, newest-at-bottom.
5. **Assistant response renders as plain text** — `TranscriptMessage` (`TaskThreadView.tsx`) and `StreamingMessageBuffer` both wrap raw `message.content` in a `prose` div but never run a Markdown parser, so tables, bold, links, lists, and code blocks render as literal characters.

---

## Scope boundaries

### In scope
- `apps/computer` Thread Detail UI: header padding, activity rows, event ordering, Markdown rendering (durable + streaming).
- Adding `streamdown` (or equivalent) to `apps/computer` `package.json` and configuring it.
- Updating `TaskThreadView.test.tsx` to match the corrected behavior.

### Deferred to follow-up work
- Surfacing real Claude reasoning/thinking blocks (when present in `metadata.reasoning` / `metadata.thinking`) as a richer turn-level disclosure. The current change removes the placeholder; a future change can re-introduce a real reasoning panel with confidence that it carries actual content.
- Markdown rendering on the **mobile** ActivityTimeline (`apps/mobile/components/threads/ActivityTimeline.tsx`) already uses `MarkdownMessage`; no change there.
- Markdown rendering in **admin** ExecutionTrace (`apps/admin/src/components/threads/ExecutionTrace.tsx`) already uses `react-markdown`; no change there.
- Sorting tool invocations from `usage.tool_invocations` chronologically — they currently arrive ordered by the runtime in execution order, which is correct; only events need re-sorting.

### Outside this product's identity
- Rebuilding the activity timeline as a fully unified, sub-agent-branched view like admin's `ExecutionTrace`. The Computer page is intentionally simpler and end-user-facing.

---

## Key technical decisions

### D1. Streamdown (Vercel) for Markdown rendering
- Use `streamdown` for both the persisted assistant message body and the streaming buffer. It's purpose-built for partial Markdown during token streams: closes unterminated emphasis / fences / lists at the live cursor, sanitizes HTML by default, and supports GFM tables (which the screenshot's lead list needs).
- Configure with GFM enabled (default) and a hardened sanitizer (default). Apply `prose prose-invert` styles via a wrapper, not via Streamdown's internal classNames, so the design stays consistent with the streaming buffer's existing look.
- Trade-off: ~50KB minified added to the `apps/computer` bundle. Acceptable: this page is a primary surface and the package replaces hand-rolled prose styling.
- Why not bare `react-markdown`: streaming-time partial syntax (e.g. mid-table render) is the explicit failure mode the user called out, and that's exactly the gap Streamdown closes. The admin app's `ExecutionTrace` uses `react-markdown` because content there is always finalized; the Computer page must handle live tokens.

### D2. Remove the message-level "Thinking" row entirely
- `actionRowsForMessage` always pushes a `{ title: "Thinking", ... }` row at index 0 for every assistant message. This is the duplicate the user sees. The turn-level `ThreadTurnActivity` already renders a single, authoritative "Thinking" row using the active turn's status/source/duration/tokens — strictly better data.
- Drop the unconditional thinking push from `actionRowsForMessage`. Tool-call and tool-result rows still render. This naturally resolves Issue #3 (filler "Computer planned the response.") because that string only existed as the fallback for the row we're removing.
- A real Claude reasoning panel can return later (deferred above) wired to `metadata.reasoning` / `metadata.thinking` only when populated.

### D3. Sort events ASC by `createdAt` in `actionRowsForTurn`
- Backend resolver orders `computerEvents` DESC. Don't change the resolver — admin and other consumers may already rely on DESC for "latest event first" lookups.
- Sort in `actionRowsForTurn` (the only consumer that needs chronological order) by `createdAt` ASC before iterating. Fall back to event id stability when timestamps tie (events recorded in the same millisecond).

### D4. Header padding asymmetric: `pl-3 pr-4`
- "Reduce by 1 unit" in Tailwind = one step (e.g. `4` → `3` = 16px → 12px). Apply only to the left so right-side icons keep their breathing room. Single-token change in `AppTopBar.tsx`.

---

## Implementation Units

### U1. Reduce AppTopBar left padding

**Goal:** Back-arrow / title block sits 4px closer to the rail edge.

**Requirements:** Issue #1.

**Dependencies:** none.

**Files:**
- `apps/computer/src/components/AppTopBar.tsx`

**Approach:** In the root `<header>` element (line 16), change `px-4` to `pl-3 pr-4`. No other styling changes.

**Patterns to follow:** Tailwind utility ordering already used elsewhere in this file (size + spacing + border).

**Test scenarios:**
- Test expectation: none — pure styling change, visual verification by running dev server and confirming back arrow alignment matches Image #27 with reduced left inset. Existing `AppTopBar` tests (if any) should continue to pass with no behavioral change.

**Verification:** Run `pnpm --filter @thinkwork/computer dev`, navigate to a thread detail, visually confirm the back arrow's left edge is 4px closer to the viewport edge than before.

---

### U2. Drop the duplicate per-message "Thinking" row

**Goal:** Each assistant turn shows exactly one Thinking row (the turn-level one). The filler "Computer planned the response." disappears as a side effect.

**Requirements:** Issues #2 and #3.

**Dependencies:** none.

**Files:**
- `apps/computer/src/components/computer/TaskThreadView.tsx`
- `apps/computer/src/components/computer/TaskThreadView.test.tsx`

**Approach:**
- In `actionRowsForMessage` (currently lines ~482–530), remove the unconditional `rows.push({ title: "Thinking", detail: thinking || "Computer planned the response.", kind: "thinking" })` block. Tool-call and tool-result rows continue to be pushed unchanged.
- Leave `ThreadTurnActivity` (`<ThinkingRow title="Thinking" ... />`) untouched — that's the authoritative one we're keeping.
- The empty-thread `ThinkingRow` ("Computer is preparing this thread.") and the `actions.length === 0` fallback inside `TranscriptMessage` ("Reasoning complete.") also stay — they're distinct states, not duplicates of the turn-level row.

**Patterns to follow:** The existing `actionRowsForMessage` builder pattern; just remove the unconditional first push.

**Test scenarios:**
- Existing test "renders transcript messages, generated artifact cards, and command composer" currently asserts `getByText("Thinking")` once, which today resolves to the duplicate per-message row. After this change there is no per-message Thinking row in that fixture (the fixture has no `turns`, so no turn-level row either). Update the assertion to confirm "Thinking" is **not** rendered when neither a turn nor a tool-result implies one. Replace with a positive assertion that the assistant content "I created a dashboard app." renders alongside "Using data_visualization".
- Add a test: "renders only one Thinking row when both an assistant message and a running turn exist" — provide `thread.turns = [{ id: "t1", status: "running", ... }]` plus an assistant message, assert `screen.getAllByText("Thinking").length === 1`.
- Add a test: "does not render the literal string 'Computer planned the response.'" — render with the same fixture as the existing test, assert `screen.queryByText("Computer planned the response.")` is null.

**Verification:** Visit a thread with a completed assistant turn. Exactly one Thinking row visible at the turn level; no second Thinking row appearing inline with the assistant message. The phrase "Computer planned the response." is gone.

---

### U3. Sort turn events ASC by createdAt

**Goal:** Activity rows show oldest-first, newest-last (matches Image #30: `thread turn enqueued` → `thread turn dispatched` → `Opening browser`).

**Requirements:** Issue #4.

**Dependencies:** none.

**Files:**
- `apps/computer/src/components/computer/TaskThreadView.tsx`
- `apps/computer/src/components/computer/TaskThreadView.test.tsx`

**Approach:**
- In `actionRowsForTurn` (currently around line 575), before iterating `turn.events ?? []`, copy the array and sort ascending by `Date.parse(createdAt)`. Tie-break by event `id` for stability when two events share a millisecond (the existing seed data does include same-ms pairs — see Image #30's two `11:58:00.530Z` and `11:58:00.545Z` entries).
- Do not change `actionRowForEvent` itself or the dedupe `seen` set logic.
- Do not change the GraphQL resolver — it intentionally returns DESC.

**Technical design (directional, not implementation specification):**
```
sortedEvents = [...(turn.events ?? [])].sort((a, b) => {
  const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
  const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
  if (ta !== tb) return ta - tb;
  return (a.id ?? "").localeCompare(b.id ?? "");
});
for (const event of sortedEvents) { /* existing body */ }
```

**Patterns to follow:** Local `[...arr].sort(...)` is already idiomatic in this file (see `findLastIndex` use elsewhere).

**Test scenarios:**
- Add a test: "renders turn events in chronological order regardless of input order" — pass a thread with one turn whose `events` array is **DESC** by `createdAt`, render, then read the visible row order from the DOM (e.g. `screen.getAllByRole("group")` or query by titles) and assert oldest title appears first.
- Add a test: "stably orders events with identical createdAt" — two events with the same `createdAt` and ids `"a"` and `"b"`; assert `"a"` renders before `"b"` regardless of input order.

**Verification:** Open a thread where multiple events fired close together; confirm row order matches wall-clock progression (enqueued → dispatched → opening browser → browser completed → response recorded → task completed → using browser automation, top-to-bottom).

---

### U4. Add Streamdown dependency

**Goal:** `streamdown` is available in `apps/computer` for U5.

**Requirements:** Issue #5 (setup half).

**Dependencies:** none.

**Files:**
- `apps/computer/package.json`
- `pnpm-lock.yaml` (regenerated by `pnpm install`)

**Approach:**
- Add `streamdown` to `dependencies` in `apps/computer/package.json` at the latest published minor.
- Run `pnpm install` from repo root.
- No code changes in this unit — it's a setup step. U5 wires it in.

**Patterns to follow:** Other workspace packages (e.g. `apps/admin`) declare `react-markdown` and `remark-gfm` as direct deps; `streamdown` plays the same role here.

**Test scenarios:**
- Test expectation: none — package install only. The CI lint/typecheck/test gates will cover that the install succeeded and the package resolves; U5's tests cover behavior.

**Verification:** `pnpm install` exits clean. `pnpm --filter @thinkwork/computer typecheck` still passes (no imports yet, just the dep declaration).

---

### U5. Render assistant content (durable + streaming) as Markdown via Streamdown

**Goal:** Assistant message bodies and the live streaming buffer render Markdown — tables, bold, links, lists, code, and inline emphasis — including during streaming when syntax may be partially complete.

**Requirements:** Issue #5.

**Dependencies:** U4.

**Files:**
- `apps/computer/src/components/computer/TaskThreadView.tsx`
- `apps/computer/src/components/computer/StreamingMessageBuffer.tsx`
- `apps/computer/src/components/computer/TaskThreadView.test.tsx`
- `apps/computer/src/components/computer/StreamingMessageBuffer.test.tsx`

**Approach:**
- In `TranscriptMessage` (`TaskThreadView.tsx`, currently around line 314), replace the bare `{message.content?.trim() || "(No message content)"}` text node inside the prose `<div>` with a Streamdown component that consumes `message.content`. Keep the wrapper `<div className="prose prose-invert max-w-none ...">` so existing typography styles continue to apply; pass content via Streamdown's children/markdown prop per its public API.
- In `StreamingMessageBuffer.tsx`, replace the `<p><span>{text}</span>...</p>` inside the prose `<article>` with the same Streamdown component fed the joined chunk text. Keep the `aria-label="Computer is typing"` cursor pip rendered as a sibling **outside** the Streamdown subtree so the parser doesn't see it as content.
- Empty-string fallback: when `message.content` is empty/whitespace, keep the existing `(No message content)` placeholder rather than passing empty input to Streamdown.
- GFM (tables, task lists, autolinks): enable. The screenshot's lead list response uses pipe tables.
- Sanitization: rely on Streamdown's default sanitizer. Don't disable it.

**Technical design (directional):**
```
// Persisted message body
<div className="prose prose-invert max-w-none ...">
  {hasContent
    ? <Streamdown>{message.content!}</Streamdown>
    : <p>(No message content)</p>}
</div>

// Streaming buffer
<article className="prose prose-invert max-w-none ..." aria-label="Streaming assistant response">
  <Streamdown>{text}</Streamdown>
  <span aria-label="Computer is typing" className="ml-1 inline-block h-2 w-2 ..." />
</article>
```

**Patterns to follow:**
- The existing `prose prose-invert max-w-none text-[1.05rem] leading-8` wrapper class set is the design contract — keep it.
- `apps/admin/src/components/threads/ExecutionTrace.tsx` line ~1095 demonstrates the wrapper-prose-then-markdown-component idiom; mirror that shape.

**Test scenarios:**
- "renders bold and pipe table from assistant content" — render a message whose `content` is a small GFM table plus `**bold**`. Assert the table renders as a `<table>` element and the bold word appears inside `<strong>`.
- "renders inline links as anchor elements" — content `Visit [example](https://example.com)`; assert `screen.getByRole("link", { name: "example" })`.
- "renders streaming chunks as Markdown" — pass `streamingChunks` whose joined text is `**Working** on it`; assert the bold portion is wrapped in `<strong>`.
- "renders streaming partial Markdown without crashing" — pass chunks ending mid-table (e.g. `| col1 | col2 |\n|---|---|\n| a | `), assert the component renders without throwing and the typing cursor is still present.
- "renders empty content placeholder when message body is blank" — assert `(No message content)` text is shown when `content` is `""` or whitespace.

**Verification:**
1. Open a thread where the assistant returned a Markdown table (e.g. the leads-list reply in Image #31). Confirm the table renders with header row + body rows, not as pipe characters.
2. Send a new message that triggers a streaming response. Confirm progressive Markdown formatting appears as tokens arrive (bold tightens, table emerges) without flicker or thrown errors.
3. Confirm the typing-cursor pip still appears beside the in-flight text.

---

## Risk analysis & mitigation

- **Streamdown XSS surface.** Default sanitization is on; assistant content is user-influenced via the model. Keep Streamdown's defaults; don't pass `rehypePlugins` that re-enable raw HTML. Tested via U5's "renders inline links" test — links should render but malicious `<script>` should not (covered by Streamdown's defaults; explicit XSS test optional).
- **Bundle size.** ~50KB added. Acceptable for this primary surface; revisit if Lighthouse regresses meaningfully.
- **Test refresh.** Removing the per-message Thinking row breaks the existing assertion `getByText("Thinking")` in the "renders transcript messages..." test. U2 explicitly updates it; if missed, the test will fail loudly in CI.
- **Event-order dependence.** Some downstream code in `apps/computer` may assume DESC events. We're sorting only inside `actionRowsForTurn`, not at the source — other readers (e.g. counters) still see DESC. Confirmed: the only consumer of `turn.events` order in `TaskThreadView.tsx` is `actionRowsForTurn`.
- **Streaming + Markdown reflow.** Streamdown is built for this; the explicit test scenario for partial table syntax in U5 covers the failure mode the user worries about ("streaming markdown can be tricky").

---

## System-wide impact

- **No GraphQL schema changes** — this is purely client-side.
- **No backend changes** — `computerEvents` continues to return DESC.
- **No mobile / admin changes** — they already render Markdown correctly via their own paths.
- **Test surface:** `TaskThreadView.test.tsx` and a new `StreamingMessageBuffer.test.tsx` (or extension of the existing one if present). CI gates: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`.

---

## Verification (end-to-end)

After all five units land, on a fresh dev session against the deployed dev stack:

1. Sign in to `apps/computer`, open the "Computer browser evidence smoke" thread (or any thread with a completed turn that has events).
2. Confirm the back arrow sits visually closer to the viewport edge (Image #27 → fixed).
3. Confirm exactly one "Thinking" row per turn (Image #28 → fixed).
4. Confirm "Computer planned the response." string is gone from the page (Image #29 → fixed).
5. Confirm event rows render oldest-first → newest-last (Image #30 → fixed).
6. Confirm the assistant's tabular reply renders as a real Markdown table; send a new prompt and watch the streamed Markdown tighten as tokens arrive (Image #31 → fixed).

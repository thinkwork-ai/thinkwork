---
plan: Computer Thread density + collapse activity on turn end
type: fix
status: active
created: 2026-05-09
---

# Fix: Tighten Computer Thread markdown density + collapse activity rows into Thinking when the turn ends

Two surgical UI tweaks on the Computer Thread Detail page (`apps/computer`, `<TaskThreadView>`):

1. **Density.** The rendered Markdown wastes vertical space — every paragraph, list, and heading inherits Tailwind Typography's loose defaults. The admin Threads page (`<ExecutionTrace>`) demonstrates the dense look we want (Image #4 in the request); apply the same set of `prose-*:my-*` overrides to the Computer's persisted-message and streaming-buffer wrappers, plus a tighter inter-segment gap.
2. **Activity collapse.** Today the run timeline renders the `Thinking` row plus all child action rows as flat siblings, with each row independently disclosable. After the turn finishes, only `Thinking` should remain visible; all sub-rows nest *inside* the Thinking disclosure and unfold when the user expands it. While the turn is running, keep today's auto-expanded view so streaming progress is visible.

Both changes touch the same component (`apps/computer/src/components/computer/TaskThreadView.tsx`) and one sibling (`StreamingMessageBuffer.tsx`). Independent of each other; pair-shipped because they together produce the "tightened thread feel" the user is after.

---

## Branching prerequisite

The current checkout is `codex/computer-v1-m2-streaming-buffer-ui`, 16 commits behind `origin/main`. Recent landings on `main` that this plan depends on:

- `0aa49588 fix(computer): tighten thread detail UI (#1058)` — landed plan `docs/plans/2026-05-09-004-*`'s Streamdown wiring + per-message Thinking dedup. The wrapper this plan tightens (`prose prose-invert max-w-none text-[1.05rem] leading-8 text-foreground prose-p:my-0`) lives at `apps/computer/src/components/computer/TaskThreadView.tsx` line 314 in the post-#1058 tree.
- `b8887161 feat(computer): activate applet host api`, `b72de07a feat(computer): mount live applets` — applet/canvas changes that don't conflict with this plan.

Per `feedback_worktree_isolation` and CLAUDE.md PR/branch workflow:

- Create a fresh worktree off `origin/main` at `.claude/worktrees/computer-thread-density-and-collapse`.
- All file paths in this plan are repo-relative and resolve **inside that worktree**, not the current checkout.
- PR opens against `main`. Squash-merge + delete branch + remove worktree on green per `feedback_merge_prs_as_ci_passes`.
- Note: the existing `codex/computer-v1-m2-streaming-buffer-ui` branch can be ignored for this plan — it predates #1058 and is unrelated to this work.

---

## Problem frame

### Issue 1 — Markdown is too loose

The Computer thread renders assistant Markdown via Streamdown inside this wrapper:

```
prose prose-invert max-w-none text-[1.05rem] leading-8 text-foreground prose-p:my-0
```

Only paragraphs are tightened (`prose-p:my-0`). Every other prose element — `ul`, `ol`, `li`, `h1`-`h6`, `blockquote` — keeps Tailwind Typography's defaults, which budget ~`1em` to `1.5em` of vertical margin per element. Combined with `leading-8` (line-height: 32px against a 16.8px base, i.e. ~1.9 ratio), a list of three brunch options consumes ~80% of the viewport (Image #3 in the request).

The admin equivalent (`apps/admin/src/components/threads/ExecutionTrace.tsx:1094`) packs the same content into ~40% of the viewport with this wrapper:

```
text-sm text-muted-foreground prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-headings:my-2 max-w-none
```

That's the dense reference (Image #4). The Computer page is end-user-facing (vs admin's operator-facing density), so we tighten **toward** the admin recipe but stay one notch more breathable — keep `prose-base` (the unsuffixed default) rather than dropping to `prose-sm`, drop the explicit `leading-8`, and apply the rest of the modifiers verbatim.

A second contributor to the loose feel: `<TaskThreadView>` wraps each transcript segment (user message + assistant turn + activity timeline) in a `grid gap-8` container (`apps/computer/src/components/computer/TaskThreadView.tsx:108`). 32px between segments is too much when each segment is also internally relaxed; tightening to `gap-5` (20px) brings the page closer to the admin reference without making turns visually run together.

### Issue 2 — Activity rows are flat siblings of Thinking

`<ThreadTurnActivity>` (`apps/computer/src/components/computer/TaskThreadView.tsx:172-212`) renders:

```
<article aria-label="Thinking and tool activity">
  <ThinkingRow title="Thinking" detail={turnSummary(...)} isActive={running} />
  {rows.map(row => <ActionRow ... />)}      // Finding sources, Using browser automation,
                                            //  thread turn enqueued, ..., task completed
  {error ? <ActionRow title="Run failed" .../> : null}
</article>
```

`<ThinkingRow>` and `<ActionRow>` are each independent `<details>` elements with no parent disclosure. After the turn finishes, the user sees ~10 collapsed sibling rows (Image #5), even though they semantically belong under `Thinking`.

Desired behavior:

- **Running turn**: Thinking row + all action rows visible and unfolded (today's behavior — preserves the streaming-progress affordance).
- **Finished turn (success)**: Only the `Thinking` disclosure visible by default, collapsed. Expanding it reveals the turn-summary detail line **and** all action rows underneath. Each action row remains its own `<details>` so payload JSON can still be inspected per-tool.
- **Finished turn (failure)**: Default-open like the running case, so the `Run failed` row is immediately visible without the user having to discover the error inside a closed disclosure. Treat `turn.error` truthy as an "expand" signal alongside `running`.
- **Pending / queued / claimed (pre-running)**: Treat the same as `running` for the spinner affordance — the row needs to communicate "work is starting up" rather than render an empty closed Thinking with no signal that anything is queued. Specifically, `isActive` fires for `running | pending | queued | claimed`; `defaultOpen` fires for `running | pending | queued | claimed | (any status with turn.error)`.

The state seam is `turn.status` plus `turn.error`. The transition from any expanded state (running / pre-running / errored) to a clean terminal status (`completed` or `succeeded` with no error) is the collapse trigger.

---

## Scope boundaries

### In scope

- `apps/computer/src/components/computer/TaskThreadView.tsx`: prose wrapper class string at the persisted-message body, segment `gap-*`, and the `ThreadTurnActivity` / `ThinkingRow` refactor.
- `apps/computer/src/components/computer/StreamingMessageBuffer.tsx`: matching prose wrapper class string so the streaming response renders at the same density as the persisted body.
- `apps/computer/src/components/computer/TaskThreadView.test.tsx`: assertions for the collapse-on-finish behavior (running shows children, finished hides them by default, expanding reveals them).

### Deferred to follow-up work

- Audit other Markdown surfaces in `apps/computer` (artifact descriptions in `GeneratedArtifactCard`, applet readme renders, etc.) for the same prose density tokens. They were not flagged in the user's screenshots and may have legitimate reasons to differ. A follow-up could unify the prose tokens behind a shared classname constant in `apps/computer/src/lib/`.
- Mobile (`apps/mobile/components/threads/ActivityTimeline.tsx`) is unaffected — the user pointed at the Computer (desktop) surface in all three screenshots.
- Admin (`apps/admin/src/components/threads/ExecutionTrace.tsx`) is the *reference*, not the *target* — no changes there.
- A persisted "Thinking expanded" preference (e.g. localStorage) so a user who manually expanded a finished turn doesn't get re-collapsed on remount. Today's unmount/remount is rare on this page; revisit only if it becomes a complaint.
- Animating the collapse transition (CSS `interpolate-size: allow-keywords` / view-transitions). Native `<details>` snaps; animation is polish, not in this plan.

### Outside this product's identity

- Replacing native `<details>` with a Radix Collapsible. The native element is sufficient, accessible, and consistent with the per-row pattern already used in `<ActionRow>`.

---

## Key technical decisions

### D1. Tighten the prose wrapper, don't switch from Streamdown

The dense look is a class-string change, not a library change. Streamdown stays. The wrapper changes from:

```
prose prose-invert max-w-none text-[1.05rem] leading-8 text-foreground prose-p:my-0
```

to (proposed; specific values reviewable during implementation):

```
prose prose-invert max-w-none text-[1.05rem] text-foreground
prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0
prose-headings:mt-4 prose-headings:mb-2 prose-headings:font-semibold
prose-strong:font-semibold prose-hr:my-4
```

Rationale:
- Drop `leading-8`. Tailwind Typography's `prose` already sets `line-height: 1.75` for paragraphs and `1.6` for tighter elements; the explicit `leading-8` was overriding that with an aggressively-spaced 32px regardless of element. After removing it, the default Typography line-height applies, which matches the admin reference's feel.
- Keep `text-[1.05rem]`. A small bump from base 16px is intentional for end-user readability and is not the cause of the loose feel.
- Mirror admin's `prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-headings:my-2` recipe but bump paragraph/list margins from `my-1` (4px) to `my-2` (8px) and headings from `my-2` to `mt-4 mb-2` (16px / 8px). One notch more breathable than admin so the end-user surface doesn't feel cramped, while still cutting roughly in half against today's defaults.
- `prose-strong:font-semibold` softens Tailwind Typography's default `bold` (700) on `<strong>` so titled list items like **1. Launderette** don't dominate.
- Apply the **identical** wrapper string to `StreamingMessageBuffer.tsx` so streamed and persisted bodies are visually indistinguishable when the cursor flips from one to the other.

The exact token choices are a decision-during-implementation: take a Storybook-style screenshot pass during ce-work and pick values that match the admin reference's vertical rhythm. The values above are a starting point, not a contract.

### D2. Refactor ThinkingRow to accept children; ThreadTurnActivity nests rows when status is terminal-and-clean

Today `ThinkingRow` only renders an optional `detail` paragraph after its summary. Extend the component to accept React children, render them inside the `<details>` body after the optional `detail` paragraph, and let `<ThreadTurnActivity>` slot all action rows in as children when the turn is finished.

Define two helpers:

```jsx
const isExpandedStatus = (status) =>
  ["running", "pending", "queued", "claimed"].includes(status.toLowerCase());
const shouldDefaultOpen = (turn) =>
  isExpandedStatus(String(turn?.status ?? "")) || Boolean(turn?.error);
```

`isExpandedStatus` drives the `isActive` spinner; `shouldDefaultOpen` drives the disclosure's initial state (and includes `turn.error` so failed turns auto-expand the visible error row — see Issue 2 desired behavior above).

Three design questions and the resolutions:

- **Q: Controlled `open` (driven by `shouldDefaultOpen(turn)`) or uncontrolled `defaultOpen`?**
  Use **uncontrolled `defaultOpen` plus a `key` tied to the open-state signal**. Reasons:
  - Controlled `open={shouldOpen}` would force-close the disclosure on every render after the turn finishes, breaking user toggle interactions.
  - Uncontrolled with no remount would mean a turn that started running with `open=true` stays open forever after finishing.
  - Adding `key={shouldDefaultOpen(turn) ? "open" : "closed"}` remounts the `<details>` exactly when the turn transitions across the open-state boundary (running/pre-running/errored → clean-terminal), applying the new `defaultOpen={false}`. Subsequent user toggles work normally because nothing else triggers a remount.
- **Q: Should the action rows themselves stay as their own `<details>` children inside the parent?**
  **Yes.** Per-row collapsed JSON inspection is useful and is the pattern already used by `<ActionRow>`. Nesting `<details>` inside `<details>` is valid HTML and works as expected (parent closed → children unreachable; parent open → children individually toggleable). No flattening needed.
- **Q: Accessibility — what aria-label replaces the dropped `<article aria-label="Thinking and tool activity">`?**
  Add `aria-label="Thinking and tool activity"` to the outer `<details>` element (or its `<summary>`) so screen readers preserve the prior labelled-region affordance. Keep chevron icons `aria-hidden="true"` so they aren't announced as content.

### D3. Always render `ThreadTurnActivity` as a single Thinking disclosure, regardless of status

Don't branch the JSX between "running" and "finished" trees. Always render:

```
<ThinkingRow
  key={shouldDefaultOpen(turn) ? "open" : "closed"}
  title="Thinking"
  detail={turnSummary(...)}
  isActive={isExpandedStatus(turn.status)}
  defaultOpen={shouldDefaultOpen(turn)}
  aria-label="Thinking and tool activity"
>
  {actionRows}
</ThinkingRow>
```

While the turn is running (or pre-running, or errored), `defaultOpen={true}` shows the children inline, so the visual matches today (Thinking row + child rows visible as the run streams; failed turn shows its error row immediately). When status flips clean-terminal, the remount applies `defaultOpen={false}` and the user sees only the Thinking row.

Side benefit: removes the current `aria-label="Thinking and tool activity"` `<article>` wrapper and the `grid gap-3` container — the parent `<details>` carries the label and is the semantic group.

### D4. Don't change tool/event grouping logic

`actionRowsForTurn`, `actionRowForEvent`, `toolActionTitle`, dedupe via `seen` set, ASC event sort by `createdAt` — all unchanged. The list of rows is the same; only the parent container changes.

---

## High-level technical design

*Directional sketch, not implementation specification.*

```jsx
// ThinkingRow becomes children-accepting and aria-label-accepting:
function ThinkingRow({ title, detail, isActive, defaultOpen, ariaLabel, children }) {
  const hasChildren = Array.isArray(children) ? children.some(Boolean) : Boolean(children);
  return (
    <details open={defaultOpen} aria-label={ariaLabel} className="group w-fit text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-3 text-base">
        <span className={isActive ? spinnerClass : dotClass} aria-hidden="true" />
        {title}
        <ChevronRight aria-hidden="true" className="size-4 transition-transform group-open:rotate-90" />
      </summary>
      {detail ? <p className="ml-7 mt-2 ...">{detail}</p> : null}
      {hasChildren ? <div className="ml-7 mt-3 grid gap-2">{children}</div> : null}
    </details>
  );
}

// ThreadTurnActivity flattens to one disclosure:
function ThreadTurnActivity({ turn }) {
  const status = String(turn?.status ?? "").toLowerCase();
  const isExpandedStatus = ["running", "pending", "queued", "claimed"].includes(status);
  const shouldOpen = isExpandedStatus || Boolean(turn?.error);
  const rows = actionRowsForTurn(turn, parseRecord(turn?.usageJson));
  // ... shouldRender gate identical to today
  return (
    <ThinkingRow
      key={shouldOpen ? "open" : "closed"}
      title="Thinking"
      detail={turnSummary(turn, usage)}
      isActive={isExpandedStatus}
      defaultOpen={shouldOpen}
      ariaLabel="Thinking and tool activity"
    >
      {rows.map(row => <ActionRow key={...} {...row} />)}
      {turn.error ? <ActionRow title="Run failed" detail={turn.error} kind="tool" /> : null}
    </ThinkingRow>
  );
}
```

---

## Implementation Units

### U1. Tighten Markdown prose density on the Computer thread

**Goal:** The persisted assistant message body and the streaming buffer render with the dense vertical rhythm shown in `apps/admin/src/components/threads/ExecutionTrace.tsx` (Image #4), with a small breathing-room concession for the end-user surface.

**Requirements:** Issue 1 (markdown spacing).

**Dependencies:** none.

**Files:**
- `apps/computer/src/components/computer/TaskThreadView.tsx` (the prose wrapper at line 314 in `<TranscriptMessage>`, and the `gap-8` at line 108 in the transcript scroll container)
- `apps/computer/src/components/computer/StreamingMessageBuffer.tsx` (the prose wrapper at line 14)
- `apps/computer/src/components/computer/TaskThreadView.test.tsx` (assertions on rendered prose density — see test scenarios)
- `apps/computer/src/components/computer/StreamingMessageBuffer.test.tsx` (matching density assertion if one already exists; otherwise add one)

**Approach:**
- Replace the existing wrapper class string at `TaskThreadView.tsx:314` with the D1 recipe. Keep `text-[1.05rem]`, drop `leading-8` and `prose-p:my-0`, add `prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-headings:mt-4 prose-headings:mb-2 prose-headings:font-semibold prose-strong:font-semibold prose-hr:my-4`. Do not touch the empty-content fallback `<p>(No message content)</p>`.
- Apply the **identical** class string to `StreamingMessageBuffer.tsx:14` so streamed and persisted bodies match. The cursor pip span stays as a sibling outside the `<Streamdown>` subtree (already correct on `main`).
- Reduce the inter-segment gap at `TaskThreadView.tsx:108` from `gap-8` to `gap-5`. Do not touch `pt-10 pb-6` — the page-edge insets are already reasonable.
- The exact margin token values (e.g. `my-1` vs `my-2`, `mt-3` vs `mt-4` for headings) are tunable during ce-work — confirm by visual comparison against Image #4 with the same source content. The plan's recipe is a starting point, not a hard contract.

**Patterns to follow:**
- `apps/admin/src/components/threads/ExecutionTrace.tsx:1094` is the dense reference. Read that wrapper string and the rendered look in dev before finalizing tokens.
- Tailwind v4 + `@tailwindcss/typography` 0.5.16 is already on this app (see `apps/computer/package.json`); no plugin/config changes needed.

**Test scenarios:**
- "renders assistant Markdown with tightened prose modifiers" — render a `TaskThreadView` with an assistant message whose `content` is a small Markdown sample (heading + paragraph + list of 3 items + bold). Assert the wrapper element has `class` containing `prose-p:my-2`, `prose-ul:my-2`, `prose-li:my-0`, `prose-headings:mt-4`, `prose-headings:mb-2` (or whatever final tokens are picked — keep the assertion list aligned with the implementation). Do **not** assert the absence of `leading-8` if it's unrelated to the new behavior; assert presence of the new modifiers.
- "renders streaming buffer with the same prose modifiers as persisted bodies" — render `StreamingMessageBuffer` with a small chunk array whose joined text contains a heading and list. Assert the `<article>` wrapper has the same set of `prose-*:my-*` modifiers as the persisted-message wrapper.
- "renders the unchanged segment grid container with reduced gap" — render `TaskThreadView` with two messages and a turn. Assert the inner grid container's `class` includes `gap-5` and not `gap-8`.

**Verification:**
1. Run `pnpm --filter @thinkwork/computer dev` in the worktree, sign in to dev, open a thread that has a Markdown response with bullets and bold (the brunch list from the screenshot is ideal but any Markdown-bearing thread works).
2. Compare side-by-side with the admin Threads page (`pnpm --filter @thinkwork/admin dev` on a free port, e.g. 5175 — remember to add that port to the Cognito `ThinkworkAdmin` CallbackURLs per `project_admin_worktree_cognito_callbacks`). Confirm the Computer surface now renders the same content in noticeably less vertical space.
3. Send a fresh prompt to trigger a streaming response. Confirm the streaming density matches the persisted density — no visual jump when the cursor flips to the durable copy.

---

### U2. Collapse activity rows into the Thinking disclosure when the turn ends

**Goal:** While a turn is running, the Thinking row and all action rows are visible (today's shape). After the turn finishes, only the Thinking row is visible by default; expanding it reveals the turn summary line **and** all action rows nested underneath.

**Requirements:** Issue 2 (collapse on turn end).

**Dependencies:** none. (Independently shippable from U1, but pair-shipped.)

**Files:**
- `apps/computer/src/components/computer/TaskThreadView.tsx` (the `ThreadTurnActivity` and `ThinkingRow` components, ~lines 172-212 and 418-447)
- `apps/computer/src/components/computer/TaskThreadView.test.tsx` (new tests for collapse-on-finish behavior)

**Approach:**
- Extend `ThinkingRow` to accept an optional `children: ReactNode`, an optional `defaultOpen: boolean`, and an optional `ariaLabel: string`. Render children inside the `<details>` body after the optional `<p>` detail, wrapped in a `ml-7 mt-3 grid gap-2` container so they align with the existing left-indented `detail` paragraph and stack consistently. Guard the wrapper with a truthy-children check so an empty/falsy children array doesn't render an empty container with margins.
- Add `open={defaultOpen}` and `aria-label={ariaLabel}` to the `<details>` element. (`open` makes it the *initial* open state — the user can still toggle it freely after mount because we force a remount on status-boundary transitions rather than re-driving `open` on every render.)
- Mark the chevron and the spinner/dot icon `aria-hidden="true"` so screen readers don't announce them as content inside the labelled summary.
- In `<ThreadTurnActivity>`, compute two booleans:
  - `isExpandedStatus = status ∈ {running, pending, queued, claimed}` — drives `isActive` so the spinner fires for any pre-or-during-run state.
  - `shouldDefaultOpen = isExpandedStatus || Boolean(turn.error)` — drives `defaultOpen` so failed turns auto-expand to surface their error row, and pre-running turns stay open until they actually run.
- Replace the current `<article>` + flat-children pattern with a single `<ThinkingRow>` slot. Pass `defaultOpen={shouldDefaultOpen}`, `isActive={isExpandedStatus}`, `ariaLabel="Thinking and tool activity"`, and `key={shouldDefaultOpen ? "open" : "closed"}` so the `<details>` remounts exactly when the turn crosses the open-state boundary, picking up the new `defaultOpen={false}`. Pass action rows + the `Run failed` row (when `turn.error`) as children.
- Drop the `<article aria-label="Thinking and tool activity">` wrapper — the `<details>` carries the label and is the semantic group. The existing test at `TaskThreadView.test.tsx` line 129 / line 274 that asserts `getByLabelText("Thinking and tool activity")` continues to pass because the label moves from the `<article>` to the `<details>` (still queryable via `getByLabelText`).
- Do not change `actionRowsForTurn`, `actionRowForEvent`, the dedupe `seen` set, the ASC event sort, or `<ActionRow>` itself.
- Do not change behavior for the empty-thread `<ThinkingRow title="Thinking" detail="Computer is preparing this thread." isActive={isThreadRunning(thread)} />` at lines 110-114 — that path doesn't have action rows, so it stays a leaf disclosure (no `children`, no `ariaLabel` beyond the default).

**Patterns to follow:**
- The existing `<ActionRow>` `<details>` pattern in `TaskThreadView.tsx:449-480` is the disclosure idiom — children can mirror its `ml-7 mt-2` indent.
- React's `key` prop for forcing remount is already used elsewhere in the repo (e.g. `apps/admin/src/components/threads/ThreadTraces.tsx`); not a novel pattern.

**Test scenarios:**

> **JSDOM caveat for `<details>` toggling.** vitest's default JSDOM environment does NOT implement `HTMLDetailsElement`'s native click-to-toggle on `<summary>`. `userEvent.click(summary)` will not flip `details.open`. For any test that needs the open state to change *after* mount, choose one of these patterns: (a) toggle directly via a ref or query — `details.open = true` then dispatch `new Event("toggle", { bubbles: true })`; or (b) use `fireEvent` + manual `open` mutation. Tests that only need to assert the *initial* open state (driven by `defaultOpen`) work normally because that's just attribute reading. Tests below note which pattern they rely on.

- "renders Thinking row expanded with action rows visible while turn is running" *(initial-state assertion — JSDOM-safe)* — fixture: thread with `turns[0].status = "running"` and at least 2 events. After render, assert the `<details>` for Thinking has the `open` attribute (e.g. `screen.getByLabelText("Thinking and tool activity").open === true`), and assert at least two action-row titles (e.g. `Finding sources`, `Opening browser` — pick from the actual seed event types) are present in the DOM.
- "renders Thinking row collapsed with action rows hidden after turn completes cleanly" *(initial-state assertion — JSDOM-safe)* — fixture: same shape, but `turns[0].status = "completed"` and no `turn.error`. Assert the `<details>` does **not** have `open`, and assert action-row titles are absent from the *visible* DOM. If `@testing-library/jest-dom`'s `toBeVisible` is available, use it; otherwise fall back to asserting `details.open === false` and trust the browser's native hiding behavior.
- "renders Thinking row expanded for failed turn so error is visible" *(initial-state assertion — JSDOM-safe)* — fixture: `turns[0].status = "failed"`, `turn.error = "boom"`. Assert `details.open === true` and the `Run failed` row + its detail string are visible. This is the DL-002 regression guard — the test fails if `defaultOpen` reverts to status-only logic.
- "renders Thinking row expanded with spinner active for queued/pending status" *(initial-state assertion — JSDOM-safe)* — fixtures with `status: "queued"` and `status: "pending"`. Assert `details.open === true` and the `isActive` spinner element is present (its class set differs from the static-dot variant).
- "expanding the Thinking disclosure after a finished turn reveals the action rows" *(post-mount toggle — uses JSDOM workaround)* — finished-turn fixture (`status: "completed"`, no error). Per the JSDOM caveat above: query the details element via `getByLabelText`, set `details.open = true`, and dispatch a `toggle` event (or use `fireEvent.toggle(details)`); then assert action-row titles become queryable. Document this approach inline so future test authors don't fight JSDOM.
- "remounts and collapses when status flips running → completed" *(rerender with key change)* — render with `status: "running"`, assert `open=true`. Re-render via `rerender` with the same thread but `status: "completed"` (no error). Assert `open=false` — the `key` change forces remount with the new `defaultOpen`. JSDOM-safe because no click is involved.
- "preserves user toggle within a single status state" *(combines rerender + JSDOM toggle workaround)* — render with `status: "completed"`. Apply the JSDOM toggle workaround to flip the disclosure open. Re-render with the same `status: "completed"` (no key flip). Assert `open=true` is preserved (no remount, no defaultOpen re-apply).
- The existing assertion `screen.getByLabelText("Thinking and tool activity")` at `TaskThreadView.test.tsx` line 129 / line 274 continues to pass and needs no update — the label moves from `<article>` to `<details>` but is still queryable via `getByLabelText`.

**Verification:**
1. Open a thread with a recently-completed turn that had multiple browser events. Confirm only the `Thinking` row is visible by default; expanding it reveals turn-summary detail + the full set of action rows; expanding any action row reveals its JSON payload (today's behavior preserved).
2. Send a new prompt. While the turn is running, confirm `Thinking` is open and the action rows stream in beneath it. When the turn finishes, confirm the disclosure auto-collapses to just `Thinking`.
3. After the turn finishes, manually expand `Thinking`. Wait a few seconds (no further turns). Confirm the disclosure stays open across passive re-renders (e.g. subscription pings) — the `key` only flips on status transitions, not arbitrary re-renders.

---

## Risk analysis & mitigation

- **Risk: tightening `prose-headings:mt-4` etc. could squash the *first* heading in a body against the user message above.** Mitigation: `mt-4` (16px) + the segment-level gap of `gap-5` (20px) + the wrapper's intrinsic padding still leaves ~36px between user message and assistant heading, which matches the admin reference. Adjust `gap-5` → `gap-6` if visual review during ce-work disagrees.
- **Risk: dropping `leading-8` could make existing assistant content with deliberately-spaced ASCII tables feel cramped.** Mitigation: Tailwind Typography's `prose` default line-height (1.75 for paragraphs, 1.6 for code) is the broadly-tested baseline; admin uses it without complaint. Code blocks keep `pre`'s own line-height (Streamdown's defaults) which we don't touch.
- **Risk: forced remount of `<details>` via `key={isRunning ? "running" : "finished"}` could lose focus mid-run if a screen-reader user is interacting with the disclosure exactly at the running→finished transition.** Mitigation: the transition fires once per turn (status doesn't oscillate), and the user's prior interaction was with the open-by-default state, so the post-remount closed state is the desired outcome. Acceptable for v1; revisit if a11y feedback surfaces it.
- **Risk: stylistic regression in mobile viewport.** Mitigation: the prose modifiers don't include any responsive variants; vertical rhythm scales with text size. Visually verify on mobile breakpoint via dev tools during ce-work.
- **Risk: existing test `getByLabelText("Thinking and tool activity")` will fail when we drop the wrapping `<article>`.** Mitigation: U2's test scenarios explicitly call out the update to the existing assertion. CI will fail loudly if missed.

---

## System-wide impact

- **No GraphQL changes.**
- **No backend changes.**
- **No mobile changes.** `apps/mobile` already uses `MarkdownMessage` and is unaffected.
- **No admin changes.** `apps/admin` is the reference, not the target.
- **Test surface:** `TaskThreadView.test.tsx` (existing), possibly `StreamingMessageBuffer.test.tsx` (existing). CI gates remain `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`.
- **No new dependencies.**

---

## Verification (end-to-end)

After both units land, on a fresh dev session against the deployed dev stack:

1. Sign in to `apps/computer`. Open a thread with a Markdown-rich assistant response (the brunch list from Image #3, or any thread with bullets, bold, and headings).
2. Confirm the rendered Markdown is ~half the vertical extent of the pre-fix screenshot. Side-by-side with the admin Threads view, the Computer copy is *one notch* more breathable but clearly in the same density family.
3. Confirm only one `Thinking` row is visible per finished turn (no flat sibling action rows below it).
4. Click `Thinking` on a finished turn. Confirm the turn-summary line and the full set of action rows expand below. Click any action row's chevron. Confirm its JSON payload appears.
5. Send a fresh prompt. While streaming: confirm `Thinking` is auto-expanded, action rows stream in beneath it, the streaming-buffer Markdown renders with the same density as the persisted body.
6. Watch the running→finished transition. Confirm the disclosure auto-collapses to just `Thinking` once `turn.status` flips terminal.
7. Manually expand `Thinking` on the now-finished turn. Wait through several subscription/scheduled re-renders. Confirm the disclosure stays open.

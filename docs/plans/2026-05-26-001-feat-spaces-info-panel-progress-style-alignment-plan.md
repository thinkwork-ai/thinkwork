---
title: "feat: Align spaces info-panel Progress section with admin thread detail style"
type: feat
created: 2026-05-26
status: active
depth: lightweight
---

# feat: Align spaces info-panel Progress section with admin thread detail style

## Summary

Reshape the spaces info-panel Progress section so its visual structure mirrors the admin thread detail Progress card — uppercase "PROGRESS" header treatment, "X/Y required complete" subtitle, percent badge, slim progress bar, per-task row with an owner/status sublabel, and a relative "Updated X ago" footer. Spaces keeps its existing dark-mode palette, its clickable task buttons (which prefill the composer), and its "Mark as completed" footer link. In both apps, the **completed-state** task icon swaps to `IconCircleCheckFilled` from `@tabler/icons-react` rendered in the row's muted text color (no green accent). Other states (todo/blocked) remain on their current icons in each app.

## Problem Frame

The two surfaces today render the same conceptual data (a progress checklist of tasks for a thread) in visibly different ways:

- **`apps/admin` thread detail right rail** (`apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx` — `ThreadProgressPanel` / `ThreadProgressTaskRow`) uses an uppercase semibold "Progress" header, a "X/Y required complete" line, a progress bar, per-task rows with an owner/status sublabel, and an "Updated X ago" footer. The completed icon is the lucide outlined `CheckCircle2` rendered in `text-muted-foreground`.
- **`apps/spaces` task info panel** (`apps/spaces/src/components/workbench/TaskThreadView.tsx` — `ThreadInfoChecklistProgressSection` / `ThreadInfoChecklistRow`) uses a simpler `text-sm font-medium text-white/55` header with just a percent badge, no count subtitle, no progress bar, no owner sublabel, and no updated-at footer. Completed icon is lucide `CheckCircle2` in `text-emerald-300` (bright green).

The user wants the spaces panel to feel like the admin card structurally, while keeping the two spaces-only affordances (clickable rows + "Mark as completed" link) and using a filled tabler icon rendered in the muted text color for the completed state across both apps.

## Scope

In scope:

- Restructure `ThreadInfoChecklistProgressSection` and `ThreadInfoChecklistRow` in `apps/spaces/src/components/workbench/TaskThreadView.tsx` to match the admin Progress card layout.
- Swap the **completed** task icon to `IconCircleCheckFilled` from `@tabler/icons-react` in both `apps/spaces` and `apps/admin`, colored to match the row's text color (`text-white/45` in spaces, `text-muted-foreground` in admin).
- Update `apps/spaces/src/components/workbench/TaskThreadView.test.tsx` assertions that asserted the old, simpler shape (notably the `queryByText("1/2 required complete")` `toBeNull()` assertion at line 464).

Out of scope:

- Re-platforming spaces from its dark `text-white/X` / `bg-white/8` palette onto admin's `text-muted-foreground` semantic tokens. Spaces stays dark.
- Migrating the todo/blocked icons to tabler. Only the completed icon changes.
- Changing the data shape, GraphQL queries, or progress-derivation logic.
- Changing composer-prefill behavior or the conditions that enable "Mark as completed".
- Any change to admin beyond the completed-icon swap.

### Deferred to Follow-Up Work

- Unifying all three icon states (todo / blocked / completed) onto `@tabler/icons-react` across both apps — captured here in case a future pass wants a consistent icon family.

## Key Technical Decisions

- **Use `IconCircleCheckFilled` from `@tabler/icons-react`.** Already a dependency in both apps (`^3.40.0`). The "filled" variant matches the user's image #3. Color comes from the parent row's text color via a Tailwind class, _not_ a hard-coded prop — that keeps the icon adopting whatever muted color the surrounding row uses (`text-white/45` in spaces, `text-muted-foreground` in admin). Pass `size={14}` (or use `className="size-3.5"`) so the visual weight matches the existing 3.5 × 3.5 lucide icons in both files.
- **Keep `lucide-react` icons for the non-completed states.** `CircleDashed` / `AlertCircle` in spaces and `Circle` / `AlertCircle` in admin all stay. The user only called out the completed icon.
- **Spaces keeps its dark palette.** Section structure follows admin; tailwind classes use the existing `text-white/45`, `text-white/55`, `text-white/75`, `bg-white/8`, `bg-white/10` vocabulary so the section visually integrates with the rest of `TaskThreadView`. Admin keeps its `text-muted-foreground` semantic tokens.
- **Spaces "Updated X ago" footer derives from `max(tasks[].updatedAt)`.** The spaces `ThreadInfoChecklistState` does not carry a single section-level `updatedAt`. Derive a single timestamp from the latest `updatedAt` across `checklist.tasks` and reuse the existing `formatInfoDate` helper (already used by the "Thread completed" line). When no task has an `updatedAt`, omit the footer rather than rendering a placeholder.
- **Preserve all spaces-only affordances.** The task row stays a `<button>` (so `onTaskPrompt` still prefills the composer), and `ThreadInfoCompletionAction` ("Mark as completed") still renders below the task list. The "Thread completed {formatInfoDate(completedAt)}" line stays where it is — the new updated-at footer is independent.
- **Task row sublabel content in spaces.** Use `task.assigneeDisplay` + the human-readable status (derive `statusLabel` from `task.status` / `task.blocked` using the existing `formatInfoStatus` helper, which returns title-case "Todo", "Completed", "Blocked", etc.). Render the sublabel only when either field is present.

## High-Level Technical Design

Directional sketch — not implementation code — showing the target shape of the spaces Progress section. The implementing agent should treat this as context, not paste it verbatim.

```
<section>
  <header row>
    <h2>Progress</h2>            // uppercase + tracking, white/55
    <Badge>{percent}%</Badge>    // existing pill
  </header row>

  <subtitle>
    {total ? `${completed}/${total} required complete` : "No linked tasks"}
  </subtitle>

  <progress bar />               // h-1 or h-1.5, bg-white/10 + bg-white/40 fill

  <task list>                    // existing button-based rows, restructured
    <button row>
      <Icon />                   // IconCircleCheckFilled (completed) | AlertCircle | CircleDashed
      <stack>
        <title line-clamp-2 />
        <sublabel: assignee · statusLabel />
      </stack>
    </button row>
    ...
  </task list>

  {completedAt && <Thread completed line />}
  {derivedUpdatedAt && <Updated X ago />}
  <Mark as completed link />
</section>
```

## Implementation Units

### U1. Swap admin completed icon to `IconCircleCheckFilled`

**Goal:** In the admin Progress card, render the _completed_ task row's icon using the filled tabler icon, colored to match the surrounding muted row text.

**Files:**

- `apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx`

**Approach:**

- Add an import for `IconCircleCheckFilled` from `@tabler/icons-react`. Keep the existing `CheckCircle2`, `Circle`, `AlertCircle` imports — `CheckCircle2` is unused only at the completed branch of `ThreadProgressTaskRow`; verify whether it's used elsewhere in the file before removing it.
- In `ThreadProgressTaskRow` (around lines 1036–1065), change the `Icon` selection so `status === "completed"` resolves to `IconCircleCheckFilled` rather than `CheckCircle2`.
- The size + color classes stay the same (`mt-0.5 h-3.5 w-3.5 shrink-0` plus `text-muted-foreground` for the completed branch). Tabler icons accept `className` the same way; size via the existing `h-3.5 w-3.5` is sufficient. Do not pass `stroke` to the filled variant (it has no stroke).

**Patterns to follow:**

- Existing tabler usage in `apps/mobile/app/routines/[id]/index.tsx:329` for `IconCircleCheck` — confirms the import path and prop shape.

**Test scenarios:**

- Test expectation: none — no test file exists for `$threadId.tsx` (`apps/admin/src/routes/_authed/_tenant/threads/` contains only the route file). Visual verification on the running admin dev server is the validation path. Implementer should screenshot the Progress card with at least one completed task to confirm the filled circle renders in muted color.

**Verification:**

- `pnpm --filter @thinkwork/admin typecheck` passes.
- `pnpm --filter @thinkwork/admin lint` passes.
- Manual: open a thread with a completed task in the admin Progress card, confirm the completed row shows a filled circle-check in the same muted gray as the row text (not green).

---

### U2. Restructure spaces info-panel Progress section to match admin layout

**Goal:** Reshape `ThreadInfoChecklistProgressSection` and `ThreadInfoChecklistRow` in spaces so the visible structure matches admin's `ThreadProgressPanel`: uppercase tracking header, "X/Y required complete" subtitle, slim progress bar, per-row owner/status sublabel, "Updated X ago" footer. Swap the completed icon to `IconCircleCheckFilled` (muted). Keep clickable buttons, keep "Mark as completed", keep the existing dark palette.

**Dependencies:** None (independent of U1; can be done in parallel).

**Files:**

- `apps/spaces/src/components/workbench/TaskThreadView.tsx`
- `apps/spaces/src/components/workbench/TaskThreadView.test.tsx` (assertion updates — see U3 if reviewer prefers a separate unit, but bundling here keeps the diff atomic)

**Approach:**

- **Imports.** Add `IconCircleCheckFilled` to the existing `@tabler/icons-react` import line (currently only `IconPaperclip`). `CheckCircle2` stays imported from lucide unless it has no other usage in the file after the swap — verify and remove if dead.
- **Section header.** Change `<h2 className="text-sm font-medium text-white/55">Progress</h2>` to the admin-style treatment: `<h2 className="text-xs font-semibold uppercase tracking-wider text-white/55">Progress</h2>`. Keep the percent pill on the right; restyle if needed so it sits aligned with the smaller header.
- **Count subtitle.** Below the header row, render a `<p className="text-xs text-white/55">` showing `${completed}/${total} required complete` when `total > 0`, or `"No linked tasks"` when `total === 0` (replacing the existing `"No linked tasks"` empty-state which is currently in a different position).
- **Progress bar.** Add a slim bar mirroring admin's structure: outer `h-1.5 overflow-hidden rounded-full bg-white/10` + inner `h-full rounded-full bg-white/40` with `style={{ width: `${progress}%` }}`. Render only when `total > 0`. Choose the inner color so it reads on the dark backdrop — `bg-white/40` (analog of admin's `bg-muted-foreground/70`) is a starting point; the implementer can adjust if visual review shows it's too washed.
- **Task list.** Keep the `space-y` rhythm but tighten to match admin's `space-y-2` per row. Each row stays a `<button>` (preserves `onTaskPrompt`); update inner layout so the title becomes `line-clamp-2 text-xs font-medium leading-snug text-white/80` (existing), and add a sublabel `<p className="mt-0.5 truncate text-[10px] text-white/45">` showing `${task.assigneeDisplay} · ${statusLabel}` when either is present. Derive `statusLabel` from `formatInfoStatus(task.status)` (title-case helper at `apps/spaces/src/components/workbench/TaskThreadView.tsx:754`) and `task.blocked` (e.g., `"Completed"`, `"Blocked"`, `"Todo"`, `"In progress"`, `"Not applicable"`).
- **Icon swap.** In `ThreadInfoChecklistRow`, replace the completed branch's `CheckCircle2` with `IconCircleCheckFilled`. Color class for the completed branch changes from `"text-emerald-300"` to `"text-white/45"` (matches the surrounding muted row text — this is the explicit ask). `CircleDashed` (todo) and `AlertCircle` (blocked) stay as-is with their current colors.
- **Updated-at footer.** After the task list, render `<p className="text-[10px] text-white/45">Updated {formatInfoDate(latestUpdatedAt)}</p>` when `latestUpdatedAt` is non-null. Derive `latestUpdatedAt` once in `ThreadInfoChecklistProgressSection`: `useMemo(() => max(checklist.tasks.map(t => t.updatedAt).filter(Boolean)), [checklist.tasks])`. Render order at the bottom of the section: thread-completed line (if `checklist.completedAt`), updated-at line (if derived), then `<ThreadInfoCompletionAction />`. The action stays last so its right-aligned link sits below all status text, matching the current visual placement.
- **Preserved behavior.** `onTaskPrompt` click handler stays bound on the row button. Error / loading / empty states (`checklist.error`, `checklist.isLoading`, `checklist.tasks.length === 0`) stay where they are between the header block and the task list. `ThreadInfoCompletionAction` is not touched — it already renders "Mark as completed" / "Completed".

**Patterns to follow:**

- `ThreadProgressPanel` and `ThreadProgressTaskRow` in `apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx` (lines 978–1090) for the structural shape.
- Existing tabler icon usage in `apps/mobile/app/routines/[id]/index.tsx` (passes `size={16} color={...}` directly) — for spaces, prefer the className-based approach (`className="size-3.5 text-white/45"`) to keep the icon adopting the row's text color without a hard-coded hex.

**Test scenarios:**

Add or update in `apps/spaces/src/components/workbench/TaskThreadView.test.tsx`:

1. **Happy path — multi-task checklist renders new shape.** Given a `checklist` with 3 tasks (1 completed, 1 blocked, 1 todo), required count 3: assert the rendered section shows "Progress" heading, "1/3 required complete" subtitle, "33%" percent badge, the progress bar element (visible by class), each task title, and the sublabel formatted as `${assigneeDisplay} · ${statusLabel}` for at least one task. (Replaces / updates the existing assertion at line 464 — flip `queryByText("1/2 required complete")).toBeNull()` to `getByText("1/2 required complete")`.)
2. **Completed-task icon swap.** Given a task with `status: "completed"`, assert the row is associated with an icon element that is NOT the green-emerald lucide `CheckCircle2`. Acceptable detection: query the row by `aria-label="Update <title>"`, then assert the icon's class list contains `text-white/45` (not `text-emerald-300`). If a more direct icon assertion is awkward, fall back to asserting the row does not carry `text-emerald-300` anywhere.
3. **Task-row still prefills composer.** Regression: clicking a task button still calls the existing composer-prefill flow (the test at lines ~470–478 already covers this for "Enter customer information into P21" — keep that assertion intact after the layout change).
4. **"Updated X ago" footer.** Given tasks with `updatedAt` timestamps, assert the section renders an "Updated …" line. Given tasks with no `updatedAt`, assert no "Updated" line is present.
5. **Empty state.** Given `checklist.tasks.length === 0`, assert "No linked tasks" still renders and that the progress bar and "X/Y required complete" subtitle do NOT render.
6. **"Mark as completed" link still present.** Given a `checklist` where all required tasks are complete and `onCompleteThread` is provided, assert the "Mark as completed" button is in the document (regression — covered by `SpacesThreadDetailRoute.test.tsx:540` already, but worth a unit-level assertion too).

**Verification:**

- `pnpm --filter @thinkwork/spaces typecheck` passes.
- `pnpm --filter @thinkwork/spaces lint` passes.
- `pnpm --filter @thinkwork/spaces test -- TaskThreadView.test` passes (and the existing `1/2 required complete` assertion has been flipped).
- Manual on the running spaces app: open a task thread with a multi-task progress checklist. Confirm the section header is uppercase tracked, the "X/Y required complete" subtitle is present, the progress bar fills proportionally, each task row shows an owner/status sublabel, the completed icon is a filled muted circle-check, clicking a row still prefills the composer, the "Mark as completed" link sits at the bottom, and an "Updated X ago" footer appears when task `updatedAt` data is present.

---

### U3. Sweep co-located test assertions and adjacent snapshots

**Goal:** Catch any other test that asserted on the old spaces Progress shape so the suite stays green.

**Dependencies:** U2.

**Files:**

- `apps/spaces/src/components/workbench/TaskThreadView.test.tsx`
- `apps/spaces/src/components/workbench/SpacesThreadDetailRoute.test.tsx`

**Approach:**

- Re-run the spaces test suite after U2 lands; for each failing assertion that targets the Progress section's old text/structure, update it to the new shape. Likely touch points: the `1/2 required complete` `toBeNull` flip already called out in U2, the "renders native onboarding Progress in the Info Panel and task clicks prefill the composer" test in `SpacesThreadDetailRoute.test.tsx` (line ~438), and any places asserting "Progress" header position or absence of subtitle text.
- Do not loosen assertions that catch real regressions (composer prefill, "Mark as completed" presence). Tighten new assertions where the new shape allows it.

**Test scenarios:**

- This unit is itself a test-update unit, not a behavior-add. The "scenarios" are: every existing test that exercised the Progress section continues to pass and now reflects the post-U2 shape.

**Verification:**

- `pnpm --filter @thinkwork/spaces test` passes overall.

## Risks

- **Test churn.** Several spaces tests assert on the current Progress shape; U2 + U3 must update them carefully without weakening the regression net around composer prefill and "Mark as completed".
- **Visual mismatch from the dark palette.** Admin's progress bar uses `bg-muted-foreground/70` against `bg-muted`. The chosen analogs in spaces (`bg-white/40` over `bg-white/10`) are an educated starting point; the implementer should screenshot-verify and adjust if the bar reads too dim or too bright on the dark info-panel backdrop.
- **`IconCircleCheckFilled` sizing.** Tabler filled icons sometimes render slightly differently in visual weight than lucide outlined icons at the same pixel size. If the filled circle reads visually heavier than the adjacent outlined `CircleDashed`/`AlertCircle`, the implementer may need to drop one step (e.g., `size-3` instead of `size-3.5`) for the completed branch only.

## Deferred Implementation Notes

- Whether to remove the now-unused `CheckCircle2` lucide import from each file — depends on whether the symbol is used anywhere else in the file after the swap. Resolve at edit time, not now.
- Exact `bg-white/X` opacity for the progress bar inner fill in spaces — pick the value that visually matches admin's contrast level on dev.

## Origin

No upstream brainstorm document. Source: direct user request 2026-05-26 with annotated screenshots of `apps/admin` thread detail Progress card, current `apps/spaces` info-panel Progress section, and a sample Tabler filled-check icon as the target completed-state glyph.

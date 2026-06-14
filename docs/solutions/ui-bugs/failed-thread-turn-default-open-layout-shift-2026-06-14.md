---
title: Failed thread turns should not default open on loaded conversations
date: 2026-06-14
category: docs/solutions/ui-bugs
module: apps/web thread conversation
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "A loaded failed thread turn shows its run details on first paint, then collapses about one second later"
  - "The conversation jumps vertically when the `Run failed` detail body disappears"
  - "Tests and older plans still encode failed turns as the one default-open terminal status"
root_cause: logic_error
resolution_type: code_fix
severity: medium
related_components:
  - apps/web/src/components/workbench/TaskThreadView.tsx
  - apps/web/src/components/workbench/turnHeader.ts
  - apps/web/src/components/ai-elements/reasoning.tsx
tags:
  - thread-turns
  - failed-status
  - layout-shift
  - disclosure-state
  - reasoning
  - thnk-25
---

# Failed thread turns should not default open on loaded conversations

## Problem

THNK-25 reported that a failed thread turn loaded with the "Failed after ..."
activity detail expanded, then collapsed shortly after render. That open-then-
close sequence made the conversation jump even though the thread data was
already loaded and stable.

The durable lesson is not just "set `defaultOpen` to false." The bug came from
stale product intent: older desktop turn-surface plans and tests said failed
turns should default open so errors were immediately visible, while the current
conversation requirement is that loaded activity rows start collapsed to avoid
layout shift.

## Symptoms

- Failed thread activity renders the `Run failed` row and error detail on first
  paint.
- About one second later, the detail body closes and the page height shrinks.
- The header remains correct (`Failed after ...`), which can make the issue look
  like an async data race rather than local disclosure state.
- Existing tests assert the old default-open behavior, so a correct fix must
  intentionally rewrite the regression contract.

## What Didn't Work

- Treating the issue as a data-loading race. The failed turn can be fully loaded;
  the visible shift still happens because local UI state initializes open and
  then auto-closes.
- Changing the shared `Reasoning` primitive first. The failing surface uses
  `Reasoning` as a collapsible substrate, but the smallest safe fix is local to
  thread turn activity. A global primitive change risks unrelated reasoning
  displays.
- Preserving a helper whose only remaining behavior is a constant. PR #2480's
  review caught that `shouldDefaultExpand()` became stale once no status should
  default open.
- Relying on older plan language. The May desktop turn-surface plan explicitly
  described failed turns as expanded by default, and session history shows that
  expectation propagated into worker context and tests. Treat that old plan as
  superseded for loaded conversations. (session history)

## Solution

Make loaded thread activity rows default closed for every rendered status, while
keeping failure discoverability in the collapsed header and manual disclosure.

The verified PR for THNK-25 used this shape in
`ThreadTurnActivity`:

```tsx
const failureDetail =
  status === "failed" ? turn.error || "No error detail was provided." : null;

<ThinkingRow
  title={title}
  costLabel={costLabel}
  running={running}
  elapsedLabel={elapsedLabel}
  defaultOpen={false}
  detail={turnSummary(turn, usage)}
  ariaLabel="Turn activity"
>
  {failureDetail ? (
    <ActionRow title="Run failed" detail={failureDetail} kind="tool" />
  ) : null}
</ThinkingRow>;
```

The fix also removed the now-stale `shouldDefaultExpand()` helper, updated the
component comment to say activity rows default closed after load, and gave the
disclosure trigger the visible status header as its accessible name:

```tsx
<ReasoningTrigger
  aria-label={title}
  className="group gap-2 text-sm"
  icon={null}
  getThinkingMessage={() => /* status header */}
/>
```

Focused tests should encode the product rule directly:

- a failed turn starts with `data-state="closed"`;
- the trigger is named with the failed header, such as `Failed after 5s`;
- `Run failed` and the error are absent until manual expansion;
- after the former auto-close delay, the disclosure is still closed;
- a failed turn with no error still shows a fallback detail after expansion;
- all rendered statuses, including `failed`, default closed.

## Why This Works

`Reasoning` initializes from `defaultOpen`. It also has a one-time auto-close
effect for disclosures that are default-open and no longer streaming. When a
loaded failed turn passed `defaultOpen={true}`, the UI showed details
immediately, then the non-streaming auto-close closed them after the delay.

Passing `defaultOpen={false}` locally prevents the detail body from mounting in
the first place, so there is no open-to-closed transition and no height collapse.
Keeping the header as `Failed after ...` preserves the important status signal
without making the error body occupy layout before the user asks for it.

## Prevention

- When a product decision reverses an older UI rule, update the helper,
  component comment, and test name together. A stale helper like
  `shouldDefaultExpand()` keeps the old intent alive even after behavior changes.
- For loaded conversation surfaces, default closed is the stable baseline. Add a
  test that covers every rendered status, not only the statuses that changed in
  the bug report.
- If a shared primitive has lifecycle behavior such as auto-close, first remove
  accidental triggers at the consumer. Change the primitive only when more than
  one consumer needs the new lifecycle contract.
- Keep failure visible in the collapsed affordance. A collapsed failed turn
  should still have an honest header (`Failed after ...`) and an accessible
  trigger name, with `Run failed` available after expansion.
- Search older plans before assuming intent. In this case,
  `docs/plans/2026-05-28-004-feat-desktop-turn-surface-and-composer-cleanup-plan.md`
  and `docs/plans/2026-05-09-006-fix-computer-thread-density-and-collapse-plan.md`
  both preserved the previous "failed turns default open" rule.

## Related Issues

- Linear: THNK-25, "Thread conversation loading issue"
- GitHub: thinkwork-ai/thinkwork#2480, `fix(web): keep failed thread activity collapsed`
- Related plan:
  `docs/plans/2026-05-28-004-feat-desktop-turn-surface-and-composer-cleanup-plan.md`
- Related plan:
  `docs/plans/2026-05-09-006-fix-computer-thread-density-and-collapse-plan.md`
- Related learning:
  `docs/solutions/design-patterns/audit-existing-ui-and-data-model-before-parallel-build-2026-04-28.md`

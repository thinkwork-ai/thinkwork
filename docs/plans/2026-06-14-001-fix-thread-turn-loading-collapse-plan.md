---
title: fix: Prevent failed thread turns from loading expanded
type: fix
status: active
date: 2026-06-14
origin: Linear THNK-25
---

# fix: Prevent failed thread turns from loading expanded

## Overview

The thread conversation turn activity row should not mount expanded and then collapse after load. THNK-25 reports that a failed turn initially shows the "Run failed" detail under the "Failed after ..." header, then closes shortly afterward, causing a visible layout shift. This plan updates the web turn activity surface so failed turns follow the same collapsed-on-initial-load rule as other turn statuses while keeping the failed header and manual error disclosure intact.

## Problem Frame

The prior desktop turn surface plan intentionally made failed turns default open so errors were immediately visible. THNK-25 supersedes that product rule for the loaded conversation screen: the initial default behavior must be collapsed to avoid content shifting after the thread renders. The debug findings attached to THNK-25 traced the shift to `shouldDefaultExpand("failed")` returning `true`, which feeds `Reasoning`'s default-open state and then triggers its one-time non-streaming auto-close behavior.

## Requirements Trace

- R1. Failed thread turn activity rows render collapsed on initial load.
- R2. The failed turn header still reads distinctly, such as "Failed after 5s", and never falls back to a success-looking "Worked for ..." label.
- R3. Expanding the failed turn manually still reveals the run failure row and error detail.
- R4. All turn statuses share the no-initial-layout-shift default-closed behavior unless a future product requirement explicitly changes it.

## Scope Boundaries

- Do not change the shared `Reasoning` auto-close primitive unless local turn-surface changes fail to address the reported behavior.
- Do not change GraphQL, persistence, mobile, Lambda, Terraform, or deployed runtime behavior.
- Do not remove failed error detail; only change its initial disclosure state.

## Context & Research

### Relevant Code and Patterns

- `apps/web/src/components/workbench/turnHeader.ts` centralizes turn status header helpers.
- `apps/web/src/components/workbench/TaskThreadView.tsx` renders `ThreadTurnActivity` and passes `defaultOpen={shouldDefaultExpand(status)}` into the activity disclosure.
- `apps/web/src/components/workbench/TaskThreadView.test.tsx` already has focused coverage for turn surface default-open/default-closed behavior and failed turn rendering.
- `apps/web/src/components/workbench/turnHeader.test.ts` already covers the pure header helper behavior.
- `apps/web/src/components/ai-elements/reasoning.tsx` is the shared collapsible substrate; it auto-closes non-streaming default-open disclosures after a delay.

### Institutional Learnings

- `docs/solutions/design-patterns/audit-existing-ui-and-data-model-before-parallel-build-2026-04-28.md` reinforces using existing UI/data model patterns before changing user-visible surfaces.
- `docs/solutions/developer-experience/stale-localhost-vite-server-detached-checkout-2026-06-05.md` is relevant if browser verification behaves unexpectedly because an old local Vite server points at another checkout.

### External References

- None. Existing repo-local behavior, tests, and the Linear debug document are sufficient for this focused UI regression.

## Key Technical Decisions

- Inline the activity row default as collapsed rather than keeping a status helper that now always returns `false`. This fixes the reported failed-turn loading shift with the smallest blast radius and avoids changing unrelated typed reasoning parts.
- Keep the failed header text unchanged. The collapsed row should still communicate failure without requiring the detail body to be visible immediately.
- Update the tests to encode the new product requirement rather than preserving the old failed-default-open expectation.

## Open Questions

### Resolved During Planning

- Should failed turns remain the only default-open status? No. THNK-25 explicitly says the initial default behavior should be collapsed, including the failed detail body.
- Should the shared `Reasoning` auto-close behavior change? No for this unit. The local default-open source is enough to prevent the open-to-closed transition reported here.

### Deferred to Implementation

- Whether the existing tests need fake-timer coverage for the auto-close delay depends on how the current test helpers observe `Reasoning` state after the default is changed.

## Implementation Units

- U1. **Collapse failed turn activity by default**

**Goal:** Failed turn activity rows start closed on initial thread render, remain stable after the former auto-close window, and still reveal failure details when manually expanded.

**Requirements:** R1, R2, R3, R4

**Dependencies:** None

**Files:**

- Modify: `apps/web/src/components/workbench/turnHeader.ts`
- Modify: `apps/web/src/components/workbench/TaskThreadView.tsx`
- Test: `apps/web/src/components/workbench/turnHeader.test.ts`
- Test: `apps/web/src/components/workbench/TaskThreadView.test.tsx`

**Approach:**

- Set the turn activity `ThinkingRow` default to closed directly. If no statuses should default open, avoid preserving a status-dependent helper that now only wraps a constant.
- Update the `ThreadTurnActivity` comment to reflect the current product rule: all turn activity rows initially collapse to avoid layout shift.
- Replace the old failed-default-open test with a regression test that asserts failed turns start closed, preserve the "Failed after ..." header, and reveal "Run failed" plus the error after manual expansion.
- Expand the default-closed status coverage so `failed` is included with every other rendered status.
- Add timer-aware coverage if practical so advancing past the prior auto-close delay does not require or cause an open-to-closed transition.

**Execution note:** Start by updating the focused tests that currently encode the old failed-default-open behavior, then make the helper change.

**Patterns to follow:**

- Keep pure status logic in `turnHeader.ts` and test it in `turnHeader.test.ts`.
- Keep thread rendering behavior tests in `TaskThreadView.test.tsx`, using the existing `getThinkingDisclosure` and `openThinkingDisclosure` helpers.

**Test scenarios:**

- Happy path: a failed turn with `startedAt`, `finishedAt`, and `error` renders a collapsed disclosure with a "Failed after ..." header.
- Happy path: manually opening that failed disclosure reveals "Run failed" and the error detail.
- Edge case: a failed turn with missing duration and/or missing error detail still starts collapsed, keeps a failure-labeled header, and does not present success-looking copy.
- Edge case: all rendered statuses, including `failed`, report `data-state="closed"` on initial render.
- Regression: after the former auto-close delay, a failed turn remains closed rather than transitioning from open to closed.
- Accessibility: the failed disclosure trigger remains keyboard-focusable, toggles with keyboard activation through the existing button semantics, exposes expanded/collapsed state through the disclosure state, and has an accessible name containing the failure status.

**Verification:**

- Focused turn header and task thread view tests pass.
- Web typecheck passes for the changed files.
- Browser verification shows a failed turn collapsed on first paint, with no visible height collapse between first paint and two seconds at a desktop viewport, and expandable to show the failure detail.

## System-Wide Impact

- **Interaction graph:** The change affects only the web `TaskThreadView` turn activity disclosure initialization.
- **Error propagation:** Failed run data and error text remain unchanged; only initial visibility changes.
- **State lifecycle risks:** Lower risk than changing `Reasoning`; no persisted state or server lifecycle is involved.
- **API surface parity:** No API, mobile, CLI, or backend surface changes are required.
- **Integration coverage:** Component tests should cover the user-visible disclosure state and manual expand behavior.
- **Unchanged invariants:** The status header formatter continues to produce distinct terminal labels for failed, cancelled, timed-out, skipped, and succeeded turns.

## Risks & Dependencies

| Risk                                                            | Mitigation                                                                                               |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Failed errors become less immediately visible.                  | Preserve the explicit "Failed after ..." header and assert manual expansion reveals the failure details. |
| A global `Reasoning` change could alter unrelated reasoning UI. | Keep this fix local to the turn activity default state unless tests prove a broader issue remains.       |
| Tests continue encoding the old product intent.                 | Update focused tests to make the collapsed failed state the new regression contract.                     |

## Documentation / Operational Notes

- No public docs or deployment runbooks need updates.
- Normal web deploy after merge is sufficient.

## Sources & References

- Linear issue: THNK-25, "Thread conversation loading issue"
- Linear document: "Debug Findings and Fix Plan: Thread Conversation Loading Issue"
- Related plan: `docs/plans/2026-05-28-004-feat-desktop-turn-surface-and-composer-cleanup-plan.md`
- Related code: `apps/web/src/components/workbench/turnHeader.ts`
- Related code: `apps/web/src/components/workbench/TaskThreadView.tsx`
- Related tests: `apps/web/src/components/workbench/turnHeader.test.ts`
- Related tests: `apps/web/src/components/workbench/TaskThreadView.test.tsx`

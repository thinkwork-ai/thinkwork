---
title: "feat: Collapse long user prompts on Computer thread detail page"
type: feat
status: completed
created: 2026-05-16
depth: lightweight
---

# feat: Collapse long user prompts on Computer thread detail page

## Summary

Add OpenAI-style truncation to user message bubbles on the Computer thread detail page so very long prompts no longer dominate the transcript. Clip the bubble at ~10 lines, overlay a bottom-fade gradient matched to the bubble background, and reveal a "Show more" affordance that expands to full content on click.

---

## Problem Frame

User messages in `apps/computer` render as a single contiguous bubble inside `TranscriptMessage`. When a user pastes a multi-paragraph briefing or a long runbook spec (the screenshot example is a `Check for recent package and repository updates…` prompt that fills most of the viewport), the bubble becomes a wall of text that pushes assistant output and prior turns out of view. The transcript becomes hard to scan and the answer (the operator's actual interest) is buried.

OpenAI's chat surface solves this by clipping the user bubble to ~10 lines, overlaying a fade to the bubble background, and showing a "Show more" link. Once expanded the full prompt is visible. We want the same behavior on Computer's thread detail page — scoped to the user bubble, because assistant responses render as flowing markdown (headings, code, tables, artifact cards) and need a separate treatment if any.

---

## Requirements

- R1. User message bubbles in the Computer thread transcript clip to ~10 lines of body content when long, with a bottom-to-top fade gradient over the last ~2 lines of clipped content.
- R2. When clipped, a "Show more" button (with a downward chevron) sits inside the bubble container, immediately below the clipped text and above the bubble's bottom padding, mirroring the reference design in [Image #2]. Clicking it expands the bubble to full content.
- R3. Short user messages (≤ ~10 lines rendered) render unchanged — no max-height, no gradient, no "Show more".
- R4. The clamp affordance is two-way. While clipped, the button reads "Show more" with a down-chevron and expands on click. While expanded, the button reads "Show less" with an up-chevron and re-collapses on click. The button only renders when the content actually overflows the threshold. (Original R4 specified one-way expansion; reversed 2026-05-16 after live UI review showed the lack of a re-collapse affordance left the user scrolling past the full prompt.)
- R5. Assistant messages, action rows, thinking rows, generated artifact cards, and other non-user-bubble surfaces render unchanged.
- R6. Existing `TaskThreadView` test coverage continues to pass; new tests assert the collapse, fade, and expansion behavior.

---

## Success Criteria

- A user prompt that fills the viewport (such as the screenshot example) renders as a ~10-line bubble plus a "Show more" button; the assistant's response remains visible without scrolling past the prompt.
- A 2-line user prompt renders identically to today — no extra controls, no measurement-induced flicker.
- Clicking "Show more" reveals the full prompt and removes the gradient.
- The fade gradient blends visually into the bubble background — at the bottom of the gradient region the text is fully obscured, with no hard ellipsis line. Verified by side-by-side visual check against [Image #2] (OpenAI reference) in dev.
- No regressions in `TaskThreadView.test.tsx`.

---

## Scope Boundaries

- Only the user-message bubble inside `TranscriptMessage` is in scope. Assistant message rendering, action rows, the follow-up composer, and the streaming buffer are untouched.
- No persistence of expanded state across navigations or reloads — local component state only.
- No newline-preservation work on the user bubble (the bubble currently flattens newlines into wrapped text; that is a separate UX issue).
- No equivalent change to the admin SPA thread detail page (`apps/admin`) — different code path, different reframing context.

### Deferred to Follow-Up Work

- Applying similar collapse logic to other surfaces that render long prompt strings (Threads list previews, scheduled-job dialogs) — they have their own truncation strategies today.

---

## Key Technical Decisions

- **Inline component, not a shared `Collapsible` primitive.** The shared `packages/ui` Collapsible (Radix) is built for show/hide of arbitrary content, not for measure-and-clip-with-fade behavior. The collapse logic is small enough to live as a sub-component inside `apps/computer/src/components/computer/TaskThreadView.tsx` next to `TranscriptMessage`. Avoid premature abstraction per `CLAUDE.md` guidance. If a second surface needs the same behavior later, extract then.
- **Measurement via `scrollHeight` vs `clientHeight`, re-evaluated on resize.** The codebase already uses this pattern in `apps/computer/src/applets/iframe-controller.ts:169`. Apply max-height + overflow-hidden unconditionally; after mount, compare the measured content's `scrollHeight` against the clamped height to decide whether to render "Show more". Wrap the measurement in a `ResizeObserver` (feature-detected per `apps/computer/src/iframe-shell/main.ts:184`) so that container width changes (window resize, sidebar toggle) and body content changes (re-render with new text) re-trigger the overflow check. This avoids both the flicker case (short messages briefly clipping) and the stale case (a message that becomes long after mount never gaining "Show more").
- **CSS gradient overlay, not `line-clamp`.** Tailwind's `line-clamp-10` uses `-webkit-line-clamp` which renders an ellipsis on the final line and offers no fade. The reference design is a gradient fade, which requires `max-height` + `overflow: hidden` + a positioned gradient element (or `::after` pseudo-element) inside the bubble.
- **Threshold = 10 lines at the current `text-base leading-7` rhythm (~280px of content).** Defined as a constant near the sub-component. The bubble's vertical padding (`py-3`) is outside the clamped region so the gradient fades the text only, not the padding.
- **Gradient color = solid bubble background, no alpha mixing.** The bubble's `bg-muted/70` is the visible color; the gradient must terminate at that same rendered color so the fade reads as content vanishing into the bubble. Use the Tailwind `bg-gradient-to-t from-muted to-transparent` recipe applied to a `::after`-style overlay inside the bubble (after the `bg-muted/70` has resolved on the parent). Gradient height = 2 lines (~56px). No visual judgment call left to the implementer — if the gradient does not match the bubble color, the test is failing the success-criterion visual check and the fix is to inspect the actual computed background, not to retune the gradient.
- **Per-message local state.** A `useState<boolean>` inside the new sub-component holds expanded/collapsed. No prop drilling, no global store. State resets if the message remounts — acceptable per the one-way-per-session contract (R4).
- **No animation.** Expansion is instant — matches the reference design and avoids layout-thrash from height-animating large content.

---

## Implementation Units

### U1. Add collapsible user-message body with fade and "Show more"

**Goal:** Wrap the user message body rendering in `TranscriptMessage` (currently `body || "(No message content)"`) with a new sub-component that measures content height, clamps to ~10 lines, overlays a fade gradient matching the bubble background, and toggles to full content on "Show more".

**Requirements:** R1, R2, R3, R4, R5.

**Dependencies:** none.

**Files:**

- `apps/computer/src/components/computer/TaskThreadView.tsx` — add new sub-component (e.g. `CollapsibleUserMessageBody`) and use it inside the `isUser` branch of `TranscriptMessage` (around lines 488–545). Define the line-count threshold and computed max-height as named constants near the top of the sub-component.
- `apps/computer/src/components/computer/TaskThreadView.test.tsx` — add tests for the new behavior (see Test scenarios).

**Approach:**

- The new sub-component is invoked **only** from the `isUser` branch of `TranscriptMessage` (the existing `body || "(No message content)"` expression around line 513). The assistant-message branch is not modified and does not import or reach the new component, preserving R5.
- The sub-component receives the plain-text body string and renders it inside a relatively-positioned inner wrapper. The bubble container itself (`rounded-2xl bg-muted/70 px-5 py-3 …`) is unchanged — clamp + gradient apply to the inner text wrapper only, so the bubble's own padding is preserved at all times.
- It tracks `isExpanded` (`useState<boolean>`) and `isOverflowing` (`useState<boolean>`, defaults `false`).
- A `useLayoutEffect` reads `ref.current.scrollHeight` on mount and registers a `ResizeObserver` (feature-detected) on the inner wrapper. The callback re-compares `scrollHeight` against the clamp threshold and updates `isOverflowing`. The observer is torn down on unmount.
- When `!isExpanded && isOverflowing`: the inner wrapper gets `max-h-[280px] overflow-hidden`; the gradient overlay (absolute, bottom-0, full-width, height ~56px / 2 lines) renders inside the wrapper using `bg-gradient-to-t from-muted to-transparent`. See "Gradient color" decision above for color rationale.
- The "Show more" button renders inside the bubble container, immediately after the inner wrapper and before the bubble's bottom padding — a sibling of the wrapper, not nested inside it. Visible only when `isOverflowing && !isExpanded`. Uses a plain `<button>` styled link-like (e.g. `text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1`) with a `ChevronDownIcon` from `lucide-react`. Label is the literal string `Show more`.
- When `isExpanded`: max-height and gradient overlay are not rendered; full content is visible; the button is not rendered (per R4 — no "Show less").
- Preserve the existing `(No message content)` fallback for empty bodies — short-circuit collapse logic entirely when `body` is empty so empty messages render as today.

**Patterns to follow:**

- `apps/computer/src/applets/iframe-controller.ts:169` — `scrollHeight > clientHeight` measurement.
- `apps/computer/src/iframe-shell/main.ts:184` — `ResizeObserver` usage with feature-detection (`typeof ResizeObserver === "function"`).
- Surrounding `TaskThreadView.tsx` sub-component style — local sub-components defined in the same file (e.g. `TranscriptMessage`, `ThreadTurnActivity`, `PromptTaskQueue`).
- Existing bubble classes preserved verbatim: `rounded-2xl bg-muted/70 px-5 py-3 text-base leading-7 text-foreground` and the wrapping `max-w-[78%]`.

**Execution note:** the bubble's `py-3` padding sits outside the clamp region; the clamp applies to the inner text wrapper only so the fade ends at the bubble's text edge, not at the bubble's bottom border.

**Test scenarios** (add to `apps/computer/src/components/computer/TaskThreadView.test.tsx`):

- **Short user message renders unchanged.** Mount `TaskThreadView` with a single user message whose body is one short line. Assert no "Show more" button is present, no max-height class is applied to the body wrapper, and the bubble visually matches the existing short-message snapshot/structure. (Covers R3.)
- **Long user message clips and shows "Show more".** Mount with a user message body that, when measured, exceeds the clamp threshold. Mock `scrollHeight` via `Object.defineProperty` on the rendered element (same pattern as `apps/computer/src/applets/iframe-controller.test.ts:530`) to simulate overflow. Assert the body wrapper has the clamp max-height class, that a gradient overlay element is rendered, and that a "Show more" button is visible. (Covers R1, R2.)
- **Clicking "Show more" expands the bubble.** From the previous state, click "Show more". Assert the max-height class is removed, the gradient overlay is no longer rendered, and the "Show more" button is no longer present. (Covers R2, R4.)
- **No "Show less" appears after expansion.** From the expanded state, assert no button labelled "Show less" (or any re-collapse affordance) exists in the bubble. (Covers R4.)
- **Re-measurement when content grows past threshold.** Mount with a short body (no overflow, no "Show more"). Update the same message id to a body whose mocked `scrollHeight` exceeds the threshold. Assert "Show more" now appears and the clamp max-height class is applied — i.e., the measurement effect re-fires and re-decides on body change. This guards the `ResizeObserver`-driven re-evaluation contract from the Key Technical Decisions. (Covers R1, R2.)
- **Assistant message rendering is unchanged.** Mount a thread with one short user message and one long assistant message (mock the assistant's element `scrollHeight` past the threshold to prove the path isn't shared). Assert the assistant message has no "Show more" button and no clamp max-height — only the user-bubble path is affected. (Covers R5.)
- **Empty user body uses the existing fallback.** Mount a user message with `content: ""`. Assert the bubble renders `(No message content)` and has no "Show more" / gradient. (Edge case for R3 + existing behavior.)

**Verification:** running `pnpm --filter @thinkwork/computer test` passes including the new test cases. Loading the Computer thread detail page in dev (`pnpm --filter @thinkwork/computer dev`) with a long-prompt thread shows the clipped bubble + gradient + "Show more"; clicking expands to full content; short threads render unchanged.

---

## Risks & Mitigations

- **Measurement flicker on first render.** A naive measurement-on-mount approach can flash full content before clipping. Mitigation: apply clamp + overflow-hidden as the default class state; only un-clamp after measurement confirms content fits.
- **Gradient color mismatch with bubble background.** `bg-muted/70` has alpha; a `from-muted to-transparent` gradient may not exactly match the bubble's rendered color over different surface backgrounds. Mitigation: visually tune the gradient stop color during implementation. If a perfect match is hard, use a soft fade over the last ~2 lines — the goal is "content fades out," not a pixel-perfect mask.
- **ResizeObserver in test environment.** jsdom does not implement `ResizeObserver` natively. Mitigation: feature-detect (already established pattern), and in tests mock `scrollHeight` directly per the existing `iframe-controller.test.ts` precedent rather than relying on ResizeObserver firing.
- **Future need for "Show less".** Some users will inevitably expand a very long prompt and want a one-click way to re-collapse. Deferred (see Scope Boundaries). The component structure is small enough that adding "Show less" later is a one-state-flip change.

---

## Out of Scope

- Newline preservation inside the user bubble (separate UX issue — the bubble flattens `\n` to wrapped lines today).
- Truncation behavior in other surfaces that render prompt strings (Threads list previews, scheduled-job dialogs, admin SPA).
- Assistant message collapse — assistant content is multi-block markdown and would need a different strategy.
- Animation / transition on expand — instant is consistent with the reference design.

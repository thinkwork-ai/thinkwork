---
title: "docs: document mobile HITL review flow"
type: docs
status: completed
date: 2026-04-26
---

# docs: document mobile HITL review flow

## Overview

Update the mobile application documentation so readers understand that human-in-the-loop workspace review is handled inside the existing Mobile Threads experience. The docs should explain how pending review requests surface in the Threads tab, how the thread detail confirmation card works, what each action means, and how that mobile decision resumes or cancels the workspace run through the shared GraphQL/orchestration contract.

This is a docs-only slice. The deployed feature already exists in the mobile app; the work is to make `docs/src/content/docs/applications/mobile/` match the current product behavior after the workspace HITL work merged and passed smoke testing.

---

## Problem Frame

The mobile docs currently describe Threads as chat, streaming, tool-call rendering, workspace selection, quick actions, and voice dictation. They do not mention the new role the mobile app now plays as the confirmation surface between agents and users when a workspace run pauses for human review.

That gap matters because the product direction intentionally kept HITL in Threads instead of creating a separate Tasks or Admin-first surface. Operators and developers need the docs to make that clear: a pending workspace review appears as an urgent thread state, sorts above ordinary thread activity, shows an amber `Needs answer` treatment, and exposes Approve, Continue, and Reject actions inside the same thread where the agent will resume.

---

## Requirements Trace

- R1. Document that mobile is the end-user HITL surface between agents and users for workspace review requests.
- R2. Document the Threads tab behavior: pending HITL reviews sort ahead of non-HITL threads, rows show `Needs answer`, preview text says the agent is waiting for confirmation, and the Threads tab badge turns into the HITL count when any visible thread needs review.
- R3. Document the thread detail behavior: the confirmation card shows target path, review body, up to three proposed changes, optional note field, and action buttons.
- R4. Explain the user-facing action semantics: Approve clears the agent to continue with approval, Continue resumes a pending run without accepting a fresh review request, and Reject cancels the run.
- R5. Explain the backend contract at a narrative level: mobile uses `agentWorkspaceReviews`, `agentWorkspaceReview`, `acceptAgentWorkspaceReview`, `resumeAgentWorkspaceRun`, and `cancelAgentWorkspaceReview`; decisions write auditable workspace events and queue a workspace wakeup when applicable.
- R6. Preserve the docs house style: narrative first, technical details under an "Under the hood" section, no large code dumps.
- R7. Keep the documentation mobile-focused and operator-practical, not marketing-style.

---

## Scope Boundaries

- Do not change mobile app behavior in this slice.
- Do not add a new admin-console HITL guide unless the mobile docs need one outbound cross-link.
- Do not document raw S3 object editing as a supported review path.
- Do not expose dev-only smoke-test ids or tenant names in user-facing docs.
- Do not over-specify implementation details that can drift, such as exact component line numbers or internal state variable names.

---

## Context & Research

### Relevant Code and Patterns

- `docs/src/content/docs/applications/mobile/threads-and-chat.mdx` is the primary page for Threads tab, thread detail, streaming states, tool-call render, and message input. This should be the main documentation home for mobile HITL.
- `docs/src/content/docs/applications/mobile/index.mdx` summarizes the Mobile app and the section guide. It should mention that Threads also handles agent confirmation requests.
- `docs/astro.config.mjs` currently lists one `Threads & Chat` mobile page. Add a separate sidebar page only if implementation finds the HITL section makes that page unwieldy.
- `apps/mobile/app/(tabs)/index.tsx` queries `AgentWorkspaceReviewsQuery`, builds `pendingReviewsByThreadId`, sorts HITL threads first, and switches the Threads tab badge to an amber HITL count.
- `apps/mobile/components/threads/ThreadRow.tsx` renders the `Needs answer` badge and HITL preview text.
- `apps/mobile/app/thread/[threadId]/index.tsx` renders the workspace review card and calls accept, resume, or cancel mutations with optional response markdown and expected review ETag.
- `apps/mobile/lib/thread-hitl-state.ts` and `apps/mobile/lib/workspace-review-state.ts` contain the user-facing HITL state helpers and action labels.
- `apps/mobile/lib/graphql-queries.ts` defines the mobile GraphQL operations for listing, inspecting, accepting, resuming, and cancelling workspace reviews.
- `packages/database-pg/graphql/types/agent-workspace-events.graphql` defines the shared GraphQL contract that mobile consumes.
- `docs/plans/2026-04-26-004-fix-workspace-hitl-resume-completion-plan.md` records the final deployed behavior and simulator retest posture.

### Institutional Learnings

- `docs/plans/2026-04-21-008-docs-full-rewrite-thinkwork-docs-site-plan.md` establishes the current docs house pattern: explain the mental model first, put technical details lower on the page, and avoid code dumps.
- `docs/solutions/best-practices/mobile-sub-screen-headers-use-detail-layout-2026-04-23.md` is only indirectly relevant because this is docs-only, but it reinforces that mobile detail behavior should be described as a focused workflow, not as a new navigation concept.
- The recent HITL smoke test confirmed the intended wording and lifecycle: mobile approval produces `review.responded`, queues a workspace wakeup, resumes Marco in the same thread, and the run completes after the target workspace agent continues.

### External References

External research skipped. This is an internal product documentation update grounded in deployed code and local plans.

---

## Key Technical Decisions

- **Use the existing Threads & Chat page as the primary home.** HITL is part of the Threads product model, not a separate mobile application area. Add a substantial section there before "Message input" so it sits with thread list/detail behavior.
- **Mention HITL in the Mobile overview but keep details on the Threads page.** The overview should update the Threads tab description and guide-layout bullet, then link to the deeper section.
- **Document GraphQL and workspace events as an under-the-hood contract, not as user instructions.** The docs should help implementers reason about the flow without encouraging users to edit S3 review files manually.
- **Keep action language aligned with the app.** The docs should use `Approve`, `Continue`, and `Reject` because those are the current mobile button labels.

---

## Open Questions

### Resolved During Planning

- Should this be a new mobile docs page? No for the first pass. The feature intentionally lives in Threads, and the existing `threads-and-chat.mdx` page is the right conceptual home.
- Should the docs describe admin review UI too? No. This request is specifically for `documentation -> apps -> mobile`. Cross-link to admin or workspace orchestration only if a relevant page already exists and the link helps orientation.
- Should the docs include smoke-test identifiers? No. Keep the docs product-level and stable.

### Deferred to Implementation

- Whether the added HITL section becomes long enough to justify a future `human-in-the-loop.mdx` child page. Start inline; split only if the page becomes hard to scan.
- Whether to include a small screenshot later. The plan does not require one because the docs currently use prose for this page, but a screenshot may be useful after the UI settles.

---

## Implementation Units

- U1. **Update Mobile overview positioning**

**Goal:** Make the Mobile app overview acknowledge that Threads is also where users answer agent confirmation requests.

**Requirements:** R1, R2, R6, R7.

**Dependencies:** None.

**Files:**
- Modify: `docs/src/content/docs/applications/mobile/index.mdx`

**Approach:**
- Update the opening paragraph or "Who uses it" section to mention reviewing agent confirmation requests alongside chatting, integrations, and push notifications.
- Update the Threads tab row in "The three tabs" so it includes HITL confirmations without making the row verbose.
- Update the guide-layout bullet for Threads & Chat to mention HITL review cards.
- Keep the aside about user-scoped state intact; HITL decisions are user actions in mobile, while tenant-scoped configuration remains admin-owned.

**Patterns to follow:**
- Existing concise table and guide-layout prose in `docs/src/content/docs/applications/mobile/index.mdx`.

**Test scenarios:**
- Happy path: a reader scanning the overview can tell that mobile is where end users answer agent confirmation requests.
- Edge case: the overview still clearly distinguishes mobile user actions from admin tenant configuration.

**Verification:**
- The overview links readers to the Threads & Chat page for details and does not introduce a new unsupported surface.

---

- U2. **Document HITL behavior on Threads & Chat**

**Goal:** Add the user-facing HITL flow to the main mobile Threads documentation.

**Requirements:** R1, R2, R3, R4, R6, R7.

**Dependencies:** U1.

**Files:**
- Modify: `docs/src/content/docs/applications/mobile/threads-and-chat.mdx`

**Approach:**
- Add "Human-in-the-loop confirmations" after the Thread detail or Streaming section and before Message input.
- Describe the Threads tab state: pending HITL threads sort to the top, row badge says `Needs answer`, preview text explains the agent is waiting for confirmation, and the Threads tab badge uses the HITL count before unread counts.
- Describe the thread detail card: target path, review text, proposed changes summary, optional note field, and three actions.
- Explain action semantics in plain language:
  - `Approve` accepts the review and clears the agent to continue.
  - `Continue` resumes a pending workspace run when the run is already queued or no approval decision is needed.
  - `Reject` cancels the run.
- Explain expected user feedback: successful actions show a confirmation alert, non-cancel decisions mark the thread active while the agent resumes, and stale reviews ask the user to refresh.
- Avoid implementation-heavy code snippets; keep it product/operator readable.

**Patterns to follow:**
- Existing `threads-and-chat.mdx` structure: user-facing explanation first, technical subscription/details sections later.
- Existing Related pages block at the bottom.

**Test scenarios:**
- Happy path: given a pending review, the docs tell the reader where it appears and how to approve it.
- Happy path: given a user wants to add context for the agent, the docs mention the optional note field and that the note is sent with the decision.
- Edge case: given a stale review, the docs explain that the user should refresh rather than retrying blindly.
- Error path: given the user rejects a request, the docs make clear that the run is cancelled rather than resumed.

**Verification:**
- The mobile Threads page describes the end-to-end HITL user flow without promising a separate Tasks/Admin route.

---

- U3. **Add an Under the hood contract note**

**Goal:** Give implementers enough context to connect the mobile UI to workspace orchestration without turning the page into an API reference.

**Requirements:** R5, R6.

**Dependencies:** U2.

**Files:**
- Modify: `docs/src/content/docs/applications/mobile/threads-and-chat.mdx`

**Approach:**
- Add a short "Under the hood" subsection inside or immediately after the HITL section.
- Name the relevant GraphQL operations from `apps/mobile/lib/graphql-queries.ts`: `agentWorkspaceReviews`, `agentWorkspaceReview`, `acceptAgentWorkspaceReview`, `resumeAgentWorkspaceRun`, and `cancelAgentWorkspaceReview`.
- State that review decisions become auditable workspace events, and approval/resume queue workspace wakeups that continue the same thread.
- State that the mobile app derives visibility from `agentWorkspaceReviews(status: "awaiting_review")`; when the backend lifecycle reaches a terminal or processing state, the HITL row treatment clears naturally.
- Include the invariant that protected orchestration paths are not edited directly through generic workspace file writes.

**Patterns to follow:**
- `docs/src/content/docs/applications/mobile/threads-and-chat.mdx` existing "Real-time, not polling" section: concise technical detail that explains the behavior without dumping implementation code.

**Test scenarios:**
- Happy path: a developer reading the docs can identify the GraphQL operations to inspect for mobile HITL behavior.
- Integration: the docs preserve the event-driven model: mobile decision -> GraphQL mutation -> workspace event/wakeup -> same thread resumes.
- Error path: the docs do not suggest raw S3 edits or generic workspace writes as a workaround.

**Verification:**
- The technical note is accurate against `apps/mobile/lib/graphql-queries.ts` and `packages/database-pg/graphql/types/agent-workspace-events.graphql`.

---

- U4. **Check docs navigation and build health**

**Goal:** Ensure the docs update is discoverable and does not break the Starlight site.

**Requirements:** R6, R7.

**Dependencies:** U1, U2, U3.

**Files:**
- Modify if needed: `docs/astro.config.mjs`
- Validate: `docs/src/content/docs/applications/mobile/index.mdx`
- Validate: `docs/src/content/docs/applications/mobile/threads-and-chat.mdx`

**Approach:**
- Keep `docs/astro.config.mjs` unchanged if the HITL material stays inside the existing Threads & Chat page.
- If implementation splits the content into a new child page, add a sidebar entry under Mobile and update the overview guide layout.
- Run the docs build or an equivalent local validation so MDX syntax, links, and Starlight imports are valid.

**Patterns to follow:**
- Existing Mobile sidebar entries in `docs/astro.config.mjs`.

**Test scenarios:**
- Happy path: docs build succeeds after the MDX changes.
- Edge case: all new links resolve locally and no sidebar entry points at a missing page.
- Regression: existing Mobile pages remain reachable through the sidebar.

**Verification:**
- The docs site builds successfully, or any inability to build is recorded with the exact blocker.

---

## System-Wide Impact

- **Interaction graph:** Documentation only. The described runtime path is mobile Threads -> GraphQL workspace review mutations -> workspace events/wakeups -> resumed thread turn.
- **Error propagation:** The docs should mention stale review refresh behavior and access errors at a user-facing level, but no code error paths change.
- **State lifecycle risks:** The docs should not claim a review disappears because the client hides it; it disappears when backend review/run state no longer matches `awaiting_review`.
- **API surface parity:** Mobile and any other future client should use the same GraphQL workspace review contract. This docs slice only describes the mobile implementation.
- **Integration coverage:** Docs build/link validation is enough; no app code tests are expected because this plan does not change runtime behavior.
- **Unchanged invariants:** Tenant isolation, auditable workspace events, orchestration writer protections, and same-thread resume are unchanged and should be described consistently.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Docs drift from the just-merged implementation. | Ground wording in `apps/mobile` GraphQL queries and state helpers, not memory of the feature. |
| The page becomes too dense. | Start inline on Threads & Chat; split into a dedicated child page only if implementation shows the section overwhelms the existing page. |
| Docs imply users should manage S3 review files directly. | Explicitly document mobile GraphQL actions as the supported path and call protected workspace writes an invariant. |
| Action semantics confuse `Approve` and `Continue`. | Define both in a compact action table matching the current button labels. |

---

## Documentation / Operational Notes

- This plan itself is the documentation plan. No deployment or migration is needed.
- If screenshots are added later, avoid dev-only tenant/thread identifiers and keep them generic.
- The change should be safe to land independently of backend deploys because it documents already-merged behavior.

---

## Sources & References

- Mobile overview: `docs/src/content/docs/applications/mobile/index.mdx`
- Mobile Threads docs: `docs/src/content/docs/applications/mobile/threads-and-chat.mdx`
- Mobile HITL list behavior: `apps/mobile/app/(tabs)/index.tsx`
- Thread row HITL badge: `apps/mobile/components/threads/ThreadRow.tsx`
- Thread detail confirmation card: `apps/mobile/app/thread/[threadId]/index.tsx`
- HITL state helpers: `apps/mobile/lib/thread-hitl-state.ts`, `apps/mobile/lib/workspace-review-state.ts`
- Mobile GraphQL operations: `apps/mobile/lib/graphql-queries.ts`
- Shared GraphQL contract: `packages/database-pg/graphql/types/agent-workspace-events.graphql`
- Related plan: `docs/plans/2026-04-26-004-fix-workspace-hitl-resume-completion-plan.md`

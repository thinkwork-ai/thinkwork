---
title: "fix: Customer Onboarding progress workflow"
type: fix
status: completed
date: 2026-05-25
origin: docs/plans/2026-05-25-004-feat-customer-onboarding-native-checklist-plan.md
completed_by:
  - "PR #1710"
  - "PR #1722"
  - "PR #1744"
---

# fix: Customer Onboarding progress workflow

## Problem Frame

The Customer Onboarding demo now creates native checklist rows and shows them in the thread, but the product still has two competing surfaces and the agent still treats "status" like generic chat. The demo needs one authoritative Progress surface in the Info Panel. Chat status requests should summarize that Progress, task ownership should make blockers obvious, and clicking a Progress task should prepare the composer to update that task.

## Scope

- Keep Customer Onboarding v1 inside ThinkWork. Do not add LastMile, DocuSign, D&B, credit, tax, or P21 external integrations.
- Remove the onboarding side panel from the Spaces thread route; the Info Panel is the only onboarding progress UI.
- Keep `ArtifactSidePanel` for actual artifact viewing only. It must not mount, flash, or show a header affordance unless there is a selected artifact to display.
- Keep persistence on the existing native `linked_tasks` compatibility layer.
- Update the Customer Onboarding Space source files so the runtime knows that "status" means onboarding Progress in this Space.

## Requirements Trace

- R1. Info Panel includes a `Progress` section with all onboarding tasks, status, required/applicability, owner/role, and blocker state.
- R2. Progress is the canonical source for "what is the status?" answers in Customer Onboarding threads.
- R3. Same-thread chat can update task status from responses like "done", "sent but waiting on customer", "blocked", or "not applicable".
- R4. Task ownership is visible so users can see who owns blockers. Owner may be a Space member display name when configured, otherwise the role is shown.
- R5. Clicking a Progress task fills the composer with a task-specific prompt, for example `Send and receive DocuSign package: `.
- R6. The thread route does not render a duplicate onboarding side panel.
- R7. The thread/feed route renders `ArtifactSidePanel` only while displaying a selected artifact; no empty panel or header affordance should flash during refresh.
- R8. Customer Onboarding `CONTEXT.md` and `docs/customer-onboarding-intake.md` teach the status/progress contract and the human-question pattern.

## Existing Patterns

- `apps/spaces/src/components/workbench/TaskThreadView.tsx` owns the floating `ThreadInfoPanel`, composer, transcript artifact cards, and the artifact side panel that should be removed.
- `apps/spaces/src/components/workbench/SpacesThreadDetailRoute.tsx` already queries `threadLinkedTasks` and passes checklist state to `TaskThreadView`; it also renders the extra `OnboardingChecklistPanel` side panel that should go.
- `packages/api/src/lib/spaces/customer-onboarding-chat-updates.ts` already intercepts onboarding chat updates before default agent dispatch; extend it for status summaries and richer task status language.
- `packages/api/src/lib/spaces/customer-onboarding-seed.ts` owns the generated Customer Onboarding workspace source files; update those constants and source-file tests.

## Implementation Units

### U1. Plan and Workspace Contract

Update the plan and Customer Onboarding source file constants so Space instructions define Progress, status answers, task ownership, task-click update prompts, and human question handling.

Files:

- `docs/plans/2026-05-25-005-fix-customer-onboarding-progress-workflow-plan.md`
- `packages/api/src/lib/spaces/customer-onboarding-seed.ts`
- `packages/api/src/lib/spaces/customer-onboarding-seed.test.ts`
- `packages/api/src/lib/spaces/customer-onboarding-source-files.test.ts`

Tests:

- Seed tests assert the source files mention Progress/status and do not instruct agents to use an external side channel.

### U2. Deterministic Status and Chat Task Updates

Extend the Customer Onboarding `sendMessage` hook so status requests produce a Progress summary and task update phrases update native checklist rows without falling through to the default agent.

Files:

- `packages/api/src/lib/spaces/customer-onboarding-chat-updates.ts`
- `packages/api/src/lib/spaces/customer-onboarding-chat-updates.test.ts`

Tests:

- Extractor recognizes status requests.
- Extractor maps "sent but waiting on customer" to in-progress, "blocked" to blocked, "done" to completed, and "not applicable" to not applicable.
- Hook remains before default agent dispatch.

### U3. Info Panel as the Only Progress UI

Remove the duplicate onboarding side panel from the thread route. Enhance the Info Panel Progress rows with clickable task prompts, owner/role/blocker display, and a completion affordance that stays in the Info Panel. Keep artifact viewing available only when an artifact is selected.

Files:

- `apps/spaces/src/components/workbench/SpacesThreadDetailRoute.tsx`
- `apps/spaces/src/components/workbench/TaskThreadView.tsx`
- `apps/spaces/src/components/workbench/TaskThreadView.test.tsx`

Tests:

- Customer onboarding threads render Progress inside `thread-info-panel`.
- The route does not render `OnboardingChecklistPanel`.
- Clicking a Progress task fills the composer with a task prompt.
- Artifact side panel is not rendered unless a selected artifact exists and the artifact panel is open.

### U4. Verify and Ship

Run focused API and Spaces tests, typecheck affected packages when needed, format check touched files, open a PR, merge after CI, then update the live Customer Onboarding Space source files in S3 and run a browser E2E.

Checks:

- `pnpm --filter @thinkwork/api test -- src/lib/spaces/customer-onboarding-chat-updates.test.ts src/lib/spaces/customer-onboarding-seed.test.ts src/lib/spaces/customer-onboarding-source-files.test.ts`
- `pnpm --filter @thinkwork/spaces test -- src/components/workbench/TaskThreadView.test.tsx`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm --filter @thinkwork/spaces typecheck`
- Browser E2E on the Customer Onboarding Space: new thread asks missing questions, Progress appears only in the Info Panel, status summarizes Progress, clicking a task prefills composer, and chat updates task statuses.

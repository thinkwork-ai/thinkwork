---
title: Eval Test Case Delete - Plan
type: fix
date: 2026-07-14
topic: eval-test-case-delete
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
linear_issue: THINK-289
---

# Eval Test Case Delete - Plan

## Goal Capsule

- **Objective:** Make deleting an eval test case from the Evaluations Studio actually work, with the app-standard confirmation dialog, and add a delete option to the Edit Eval sheet.
- **Product authority:** THINK-289 (reported by Eric Odom); UI conventions from the existing eval test case detail view.
- **Open blockers:** none.

---

## Product Contract

### Summary

Fix the Evaluations Studio trashcan so deleting an eval test case removes it and refreshes the list, replace the native browser `confirm()` with the app-standard confirmation dialog, and add a Danger Zone delete section to the Edit Eval sheet so users can delete without navigating back to the Studio.

### Problem Frame

Clicking the trashcan in the Evaluations Studio shows a native browser confirm, and after clicking OK nothing visibly happens — the row stays. The delete handler in `apps/web/src/components/settings/SettingsEvalStudio.tsx` discards the mutation result: any error (permissions, network, schema drift) is silently swallowed, so the user gets no feedback and the list never changes. The native confirm is also inconsistent with the rest of the application, which uses the shared `AlertDialog` component for destructive confirmations. Separately, deleting from inside an eval's edit view requires exiting to the Studio first, which makes cleanup tedious.

### Key Decisions

- **Reuse the existing detail-view delete pattern.** The test case detail view (`apps/web/src/components/settings/SettingsEvalTestCaseDetail.tsx`) already does this correctly: shared `AlertDialog` confirmation, `toast.error` on failure, `toast.success` on success. Both new surfaces adopt that pattern rather than inventing a new one.
- **Root-causing the silent failure is in scope.** Surfacing the swallowed error is necessary but not sufficient — planning must determine why the delete does not take effect for the reporter (the resolver requires tenant admin; error handling is absent client-side) and the fix must make delete succeed for authorized users, not just report the failure.
- **AgentCore evaluator resource cleanup stays out.** The resolver hard-deletes only the DB row and never cleans up Bedrock AgentCore evaluator resources referenced by `agentcoreEvaluatorIds`. That pre-existing gap is noted as a scope boundary, not fixed here.

### Requirements

**Studio delete fix**

- R1. Deleting an eval test case from the Evaluations Studio trashcan removes it and the list view refreshes to reflect the deletion without a manual reload.
- R2. The delete confirmation uses the app-standard `AlertDialog` confirmation dialog, not the native browser `confirm()`.
- R3. Delete outcomes are surfaced to the user: an error toast with the failure message on error, a success toast on success — no silent failure path remains.

**Edit Eval sheet delete**

- R4. The Edit Eval sheet gains a Danger Zone section at the bottom containing a delete action for the open eval test case, using the same confirmation dialog and outcome toasts.
- R5. After a successful delete from the Edit Eval sheet, the user is returned to the Evaluations Studio and the list reflects the deletion.

### Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given the Evaluations Studio list, when the user clicks the trashcan on a row and confirms in the dialog, then the eval test case is deleted, a success toast appears, and the row disappears from the list.
- AE2. **Covers R3.** Given a delete that fails server-side (e.g., insufficient permissions), when the user confirms the delete, then an error toast with the failure message appears and the row remains.
- AE3. **Covers R4, R5.** Given the Edit Eval sheet for an existing eval test case, when the user uses the Danger Zone delete action and confirms, then the case is deleted, a success toast appears, and the user lands on the Evaluations Studio with the case gone.

### Scope Boundaries

- Cleaning up orphaned Bedrock AgentCore evaluator resources (`agentcoreEvaluatorIds`) on delete is out of scope; if it warrants work, it gets its own issue.
- Soft-delete, undo, or archive semantics are out of scope — delete remains a hard delete.
- The dataset-case remove flow and other eval surfaces that already use `AlertDialog` are untouched.

### Outstanding Questions

- **Deferred to Planning:** confirm the actual failure mode the reporter hit (permission rejection vs. deployed schema/resolver drift vs. network) by exercising the mutation against dev; the fix must address the real cause in addition to R3's error surfacing.

### Sources

- Grounding: `apps/web/src/components/settings/SettingsEvalStudio.tsx` (broken handler, lines ~161-179), `apps/web/src/components/settings/SettingsEvalTestCaseDetail.tsx` (correct pattern, lines ~189-238), `apps/web/src/lib/evaluation-queries.ts` (`DeleteEvalTestCaseMutation`), `packages/database-pg/graphql/types/evaluations.graphql` (`deleteEvalTestCase`), `packages/api/src/graphql/resolvers/evaluations/index.ts` (resolver, lines ~1424-1438), `packages/ui/src/components/ui/alert-dialog.tsx` (shared dialog).
- Prior art: `docs/plans/2026-05-17-001-feat-eval-studio-filter-header-and-result-edit-sheet-plan.md`, `docs/brainstorms/2026-06-12-evaluations-trust-core-requirements.md`.

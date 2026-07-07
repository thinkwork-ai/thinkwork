# inbox_items headless-failure rows have no reader — don't plan features onto the "operator inbox"

**Date:** 2026-07-07
**Context:** THINK-155 U3 reused THINK-137's `raiseHeadlessFailureItem` pattern for `document_refresh_failed` items, per its plan's R5 ("reusing THINK-137's inbox-item surface"). The live smoke revealed the premise was stale.

## Finding

The operator inbox as a rendered surface is deprecated. Nothing in `apps/web` or `apps/mobile` renders `inbox_items` rows of type `automation_headless_failure` (THINK-137) or `document_refresh_failed` (THINK-155):

- The **Work Items** surface (`workItems` query) reads its own work-item service/tables, not `inbox_items`.
- The only `inboxItems` GraphQL consumer is the **approvals** route (`apps/web/src/routes/_authed/_shell/approvals.*`), which handles approval-type items.

Both failure-item writers work correctly — rows are recorded, deduplicated one-OPEN-item-per-automation, failureCount increments — but the data is invisible to every user-facing surface. The effective failure signals for scheduled document refreshes today are the document's staleness chip (`artifacts.refresh_failed_at`, THINK-155 R8) and the automation run history.

## Rules

- **Any plan that says "raise an inbox item" must name the surface that renders it** — and verify that surface exists by finding the GraphQL consumer, not by trusting a prior plan's wording. THINK-137's plan predates the deprecation; plans that cite it inherit the stale premise.
- The recorded `document_refresh_failed` / `automation_headless_failure` data is intact and ready for a reader. THINK-155's R6–R7 binding round owns choosing the surface (likely the workflow detail view, beside the "maintains → ⟨document⟩" binding display) — see the note on the THINK-155 Linear issue (2026-07-07).
- If a new failure type genuinely needs operator visibility *now*, put it where operators already look: the automation's run history / detail view, not `inbox_items`.

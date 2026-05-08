---
title: U11.U4 — admin SPA Exports page
type: feat
status: active
date: 2026-05-08
origin: docs/plans/2026-05-08-004-feat-compliance-u11-export-plan.md
---

# U11.U4 — Admin Exports Page

## Summary

Final user-visible piece of the U11 export feature. Adds `/compliance/exports/` with a request dialog (format radio + filter preview), a jobs table (status / requested-at / format / filter summary / Download or Re-export), and 3-second polling on active jobs. Adds "Export this view" button on the events list page that pre-fills the dialog from the current filter. After this PR + dev deploy, the SOC2 export flow is complete end-to-end through the admin UI.

---

## Problem Frame

U11.U1 (#944) shipped the GraphQL contract; U11.U2 (#948) the Terraform infra; U11.U3 (#950) the live runner. The remaining gap is operator UI. This PR closes it.

---

## Requirements

- R1. Typed `createComplianceExport` mutation + `complianceExports` query at `apps/admin/src/lib/compliance/export-queries.ts`.
- R2. Page at `apps/admin/src/routes/_authed/_tenant/compliance/exports/index.tsx` — table + polling every 3s on active jobs (paused otherwise).
- R3. `apps/admin/src/components/compliance/ComplianceExportDialog.tsx` — format radio (CSV / JSON), filter summary preview, Submit.
- R4. "Export this view" button on `apps/admin/src/routes/_authed/_tenant/compliance/index.tsx` — Link to `/compliance/exports?from=current-filter` carrying URL params.
- R5. Status badge with icon + color (CheckCircle/Loader2/AlertCircle).
- R6. Direct browser download via `<a download>`.
- R7. URL-expired detection past `presignedUrlExpiresAt`.
- R8. Operator gating inherited from `/compliance` parent route.
- R9. Codegen after new `graphql()` docs land.

---

## Scope Boundaries

- AppSync subscription — out of scope.
- Email notification — out of scope.
- Mobile — admin-tier only.

### Deferred to Follow-Up Work

- **U11.U5** — final SOC2 export rehearsal + README runbook.

---

## Implementation Units

- U1. **Queries module + dialog**
- U2. **Exports page + table + polling**
- U3. **"Export this view" button on events list**
- U4. **Verify + commit + push + ce-code-review autofix + open PR**

---

## Sources

- **Origin plan:** `docs/plans/2026-05-08-004-feat-compliance-u11-export-plan.md`
- **U11.U1/U2/U3 PRs:** #944, #948, #950 (all merged).
- **U10 admin UI reference:** PR #941.

---
title: "fix: Admin MCP Context Engine dialog"
date: 2026-04-29
status: completed
origin:
  - docs/brainstorms/2026-04-28-context-engine-requirements.md
  - docs/brainstorms/2026-04-29-admin-memory-knowledge-center-requirements.md
---

# fix: Admin MCP Context Engine dialog

## Problem Frame

The MCP server detail dialog currently renders Context Engine tools as tall repeated cards with duplicated chrome, unlabeled safety meaning, and awkward toggle rows. On a connected server with many tools, this makes the most important operator decisions hard to scan: which tools are eligible for Context Engine, which are approved, and which join default search.

This is a focused Admin UI refinement for `Capabilities -> MCP Servers`. It does not change Context Engine data contracts or MCP tool approval semantics.

## Requirements Traceability

- R1. Redesign only the Context Engine section inside the MCP server detail dialog; keep the surrounding server detail, test, auth, approval, and delete workflows intact.
- R2. Preserve tool-level approval/default behavior from Context Engine requirements: MCP providers participate only when read-only/search-safe and tenant-approved (see origin: `docs/brainstorms/2026-04-28-context-engine-requirements.md`).
- R3. Make each tool's name, technical id, eligibility badges, approved state, and default-search state visible in a compact scanning layout.
- R4. Keep disabled behavior obvious: default search remains unavailable until a tool is approved.
- R5. Use the existing admin design system: Tailwind v4 tokens, shadcn/Radix primitives, lucide icons, compact dark-mode-friendly surfaces, and current dialog/button/switch patterns.
- R6. Verify visually in the admin dev server at a real route.

## Existing Patterns

- Primary implementation file: `apps/admin/src/routes/_authed/_tenant/capabilities/mcp-servers.tsx`.
- API surface: `apps/admin/src/lib/mcp-api.ts` already exposes `listMcpContextTools` and `updateMcpContextTool`.
- Design system signals: `apps/admin/components.json`, `apps/admin/src/index.css`, and `apps/admin/src/components/ui/*` establish shadcn/Radix, Tailwind tokens, Geist typography, lucide icons, and compact rounded-md controls.
- Relevant requirements: `docs/brainstorms/2026-04-28-context-engine-requirements.md` R10-R13 and AE3; `docs/brainstorms/2026-04-29-admin-memory-knowledge-center-requirements.md` R5-R8 and R17.

## Design Plan

Visual thesis: restrained operator-console polish, using the existing dark surface hierarchy with a denser control table and small status affordances instead of stacked cards.

Content plan: Context Engine section header with count/loading state, short operational helper text, empty state, then a table-like list with columns for provider, eligibility, approved, and default search.

Interaction plan: keep existing switches and toast behavior, add clearer disabled copy/visual state for default search, use row hover/focus transitions already consistent with table-like admin surfaces.

## Implementation Units

### U1. Redesign Context Engine tool list

Files:

- `apps/admin/src/routes/_authed/_tenant/capabilities/mcp-servers.tsx`

Approach:

- Replace repeated cards with a compact table-like grid that uses a sticky header when scrolling.
- Show a concise description under the section title so operators understand "approved" versus "default search" without reading surrounding docs.
- Render tool display name and `toolName` in one provider column with truncation that handles long CRM method names.
- Render read-only and search-safe as eligibility pills in a dedicated column.
- Render "Approved" and "Default search" switches as aligned columns with small explanatory labels.
- Keep the existing `handleContextToolUpdate` calls and disabled rules unchanged.

Tests:

- Run `pnpm --filter @thinkwork/admin typecheck`.
- Run `pnpm --filter @thinkwork/admin lint` if available.

Scenarios:

- Connected server with nine context tools is scannable without nested cards.
- A long display name and long tool id truncate cleanly.
- Approved switch still sends `{ approved, defaultEnabled: false }` when turning approval off.
- Default search switch is disabled when `tool.approved` is false.
- Loading and empty states remain legible.

### U2. Visual verification

Files:

- No source file ownership beyond U1 unless verification exposes a layout issue.

Approach:

- Copy `apps/admin/.env` from the main checkout if needed.
- Start `pnpm --filter @thinkwork/admin dev` on an available port.
- Open `/capabilities/mcp-servers` and inspect the MCP detail dialog visually.
- If live auth/data blocks direct dialog inspection, add a temporary local-only screenshot harness or use mocked runtime state only for verification, then remove it before finalizing.

Tests:

- Capture a screenshot of the redesigned dialog state.

Scenarios:

- Dialog does not overflow horizontally at desktop modal width.
- Context Engine controls are aligned, readable, and visibly tied to each tool.
- Footer actions remain reachable.

## Risks

- The live admin route depends on deployed tenant data and OAuth state, so visual verification may require an authenticated local session.
- The existing single-file route is large; keep the redesign localized to the Context Engine section to avoid unrelated churn.

## Out of Scope

- Moving this control to the Knowledge center.
- Changing server registration or OAuth flows.
- Changing MCP Context Engine backend storage, API response shape, or approval semantics.
- Adding new dependencies.

---
title: "fix: Tighten Ontology Studio tables and detail sheets"
type: fix
status: active
date: 2026-05-17
origin: user feedback on Ontology Studio UI
---

# fix: Tighten Ontology Studio tables and detail sheets

## Problem Frame

Ontology Studio landed with the right broad concepts, but the Manage page does not yet feel native to the admin shell. The header needs to match established pages such as Artifacts, tabs need breathing room, the Entities and Relationships tables are too wide, and secondary data is causing horizontal scrolling. Details should move behind row-level side sheets where admins can inspect and edit definitions without making the table surface carry every field.

## Scope

In scope:

- Match the standard admin page/header layout used by `apps/admin/src/routes/_authed/_tenant/artifacts.tsx`.
- Add spacing between Ontology Studio tab triggers.
- Reduce Entities and Relationships tables to primary columns only and disable horizontal scrolling.
- Open a right-side sheet when an entity or relationship row is clicked.
- Allow tenant admins to edit entity and relationship definition details from the sheet.
- Add GraphQL mutations and resolver/repository support needed for direct definition edits.

Out of scope:

- Changing suggestion scan semantics.
- Changing change-set approval/reprocess behavior.
- Reworking the broader Company Brain materialization pipeline.
- Adding agent-work ontology surfaces.

## Existing Patterns

- Admin page shell: `apps/admin/src/components/PageLayout.tsx`, `apps/admin/src/components/PageHeader.tsx`, and `apps/admin/src/routes/_authed/_tenant/artifacts.tsx`.
- Tables: `apps/admin/src/components/ui/data-table.tsx` supports `onRowClick`, `tableClassName`, and `allowHorizontalScroll`.
- Detail sheets: `apps/admin/src/components/ui/sheet.tsx`.
- Ontology GraphQL surface: `packages/database-pg/graphql/types/ontology.graphql`, `packages/api/src/graphql/resolvers/ontology/`, `apps/admin/src/lib/graphql-queries.ts`.
- Ontology persistence: `packages/api/src/lib/ontology/repository.ts`.

## Implementation Units

### Unit 1: Native Table Layout

Files:

- `apps/admin/src/routes/_authed/_tenant/ontology.tsx`
- `apps/admin/src/routes/_authed/_tenant/-ontology-route.test.tsx`

Work:

- Use `PageLayout` and `PageHeader` in the same structure as Artifacts.
- Add tab trigger spacing with the existing tabs component.
- Keep entity table columns to Entity, Status, and Broad Type.
- Keep relationship table columns to Relationship, Status, From, and To.
- Disable horizontal scrolling and use fixed/truncated cells.

Tests:

- Assert the route source uses the standard page header and disables horizontal scrolling.
- Assert Description and other secondary table columns are not present as table headers.

### Unit 2: Direct Ontology Definition Updates

Files:

- `packages/database-pg/graphql/types/ontology.graphql`
- `packages/api/src/lib/ontology/repository.ts`
- `packages/api/src/graphql/resolvers/ontology/coercion.ts`
- `packages/api/src/graphql/resolvers/ontology/index.ts`
- `packages/api/src/graphql/resolvers/ontology/updateOntologyEntityType.mutation.ts`
- `packages/api/src/graphql/resolvers/ontology/updateOntologyRelationshipType.mutation.ts`
- `apps/admin/src/lib/graphql-queries.ts`
- generated GraphQL artifacts under relevant workspace packages

Work:

- Add tenant-admin mutations for entity type and relationship type edits.
- Update repository rows by tenant and id, preserving slug identity.
- Support editable fields that are safe for Studio v1: name, description, aliases, guidance notes, broad type or endpoints, inverse name, and lifecycle status.
- Refetch ontology definitions after successful edits.

Tests:

- Extend API resolver tests for successful admin edits and non-admin rejection.
- Update GraphQL contract coverage for the new mutation names.
- Regenerate GraphQL client/server artifacts.

### Unit 3: Clickable Detail Sheets

Files:

- `apps/admin/src/routes/_authed/_tenant/ontology.tsx`
- `apps/admin/src/routes/_authed/_tenant/-ontology-route.test.tsx`

Work:

- Open an entity sheet from entity row click.
- Open a relationship sheet from relationship row click.
- Show secondary details in the sheet instead of the table.
- Let tenant admins save edits; read-only roles can inspect but not save.
- Keep sheet controls compact and consistent with existing admin form components.

Tests:

- Assert row-click handlers are wired to the tables.
- Assert the route contains entity and relationship sheet save flows.

## Verification

- `pnpm --filter @thinkwork/admin test -- src/routes/_authed/_tenant/-ontology-route.test.tsx`
- `pnpm --filter @thinkwork/api test -- src/graphql/resolvers/ontology/ontology.test.ts src/__tests__/graphql-contract.test.ts`
- `pnpm --filter @thinkwork/admin build`
- Browser verification at `http://127.0.0.1:5174/ontology` with the local admin dev server.

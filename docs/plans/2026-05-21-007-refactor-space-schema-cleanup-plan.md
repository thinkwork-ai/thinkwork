---
title: "refactor: Audit and clean up legacy Space fields"
type: refactor
status: proposed
date: 2026-05-21
origin: docs/plans/2026-05-21-005-feat-admin-space-studio-simplification-plan.md
---

# refactor: Audit and clean up legacy Space fields

## Summary

The admin Space Studio simplification removed legacy Space implementation details from the operator UI, but several old fields still remain in the database and public GraphQL contract. This follow-up should decide which fields are still runtime data and which are safe to retire.

Do not start by dropping columns. The first implementation pass should classify callers, update API contracts, then migrate or remove one field group at a time.

## Fields Under Review

- `spaces.kind`
- `spaces.category`
- `spaces.config`
- `spaces.context_config`
- `spaces.connected_data_config`
- `spaces.agent_availability_policy`
- `spaces.trigger_config`
- `spaces.render_diagnostics`

## Current Findings

The admin app no longer selects these fields for Space list, Configuration, Memory, Tools, or Automations. The remaining admin references are generated GraphQL type definitions and source-level tests asserting the fields are absent from Space Studio queries.

The backend still exposes these fields on `Space` in `packages/database-pg/graphql/types/spaces.graphql`. Removing them is therefore a GraphQL contract change and should be done only after downstream caller review.

`spaces.kind` still has a database default, check constraint, GraphQL enum, and resolver/test coverage for customer onboarding Spaces. Treat it as a domain discriminator until the customer-onboarding path is either removed or moved to a different model.

`spaces.config` is still read by customer-onboarding workflow code as a fallback for role assignments and writeback behavior. It is also seeded by default Space creation. This field needs a migration target before removal.

`spaces.agent_availability_policy` is still seeded by the default Space helper. It is no longer first-class in admin Space Studio, but removal should confirm no runtime routing path reads it.

`context_config`, `connected_data_config`, `trigger_config`, and `render_diagnostics` appear to be UI-obsolete after the Space Studio trim. They still exist in Drizzle and GraphQL, so the next step is a full caller audit outside admin-generated code before any schema migration.

## Proposed Implementation Units

1. Build a source audit that distinguishes Drizzle/GraphQL declarations, generated client types, tests, seed data, and true runtime reads for each field.
2. Remove GraphQL fields that have no non-generated callers, regenerate clients, and update contract tests.
3. For fields with runtime callers, move the data into purpose-specific tables or typed config paths, then add nullable-safe migrations.
4. Drop database columns only after the API contract and runtime callers no longer need them.

## Verification

- Source audit output is checked into the PR or summarized in the PR description.
- `pnpm schema:build`
- Codegen for admin, CLI, mobile, and API consumers that have codegen scripts.
- Focused API tests for any moved runtime behavior.
- Database migration dry-run and dev manual-migration drift check when dropping columns or constraints.

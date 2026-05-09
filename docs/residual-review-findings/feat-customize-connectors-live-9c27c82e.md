---
branch: feat/customize-connectors-live
head_sha: 9c27c82e
review_run_id: 20260509-135522-6dde8244
review_artifact: /tmp/compound-engineering/ce-code-review/20260509-135522-6dde8244/
generated_at: 2026-05-09
---

# Residual Review Findings — feat/customize-connectors-live

ce-code-review (autofix mode) produced these residual findings. The P1
collision bug (C-001 / data-migrations-1) was fixed in autofix; the items
below are P2/P3 follow-ups. No tracker sink was available at review time;
when the PR opens, these should migrate into the PR body and this file
can be removed.

## Source

- Plan: `docs/plans/2026-05-09-008-feat-customize-connectors-live-plan.md`
- Reviewers: ce-correctness-reviewer, ce-security-reviewer,
  ce-data-migrations-reviewer, ce-api-contract-reviewer,
  ce-maintainability-reviewer, ce-kieran-typescript-reviewer,
  ce-schema-drift-detector
- 1 P1 fixed in autofix; 7 P2 residuals; 5 P3 advisory
- Verdict: Ready with fixes

## Residual Actionable Work

### P2 — Moderate

- **#1 [P2][manual]** `packages/api/src/graphql/resolvers/customize/enableConnector.mutation.test.ts` — Drizzle `targetWhere` on the partial unique index is only exercised by mocked unit tests. **Suggested fix:** add a live-Postgres integration test that exercises the upsert path against a real partial index, including the no-op case when the row already exists. Reviewers: data-migrations, kieran-typescript.

- **#2 [P2][manual]** `packages/database-pg/drizzle/0080_connectors_catalog_slug.sql` — Backfill is narrow by design (`type == slug`). Production rows whose `type` does not match a seeded catalog slug stay with `catalog_slug = NULL` and are invisible to the Customize page after rollout. **Suggested fix:** post-rollout audit query lists `connectors WHERE catalog_slug IS NULL AND dispatch_target_type = 'computer'`, plus a follow-on PR for any that should be relinked. Reviewer: data-migrations.

- **#3 [P2][gated_auto]** `packages/api/src/graphql/resolvers/customize/enableConnector.mutation.ts` — Error codes (`CUSTOMIZE_CATALOG_NOT_FOUND`, `CUSTOMIZE_MCP_NOT_SUPPORTED`, `COMPUTER_NOT_FOUND`) deviate from the dominant Apollo-standard vocabulary used elsewhere (`BAD_USER_INPUT`, `NOT_FOUND`, `INTERNAL_SERVER_ERROR` — 38/32/7 occurrences vs 1-2 for the new codes). **Suggested fix:** unify to standard codes with a `details` object carrying the domain-specific reason, or document the new codes as the Customize-surface convention when U5/U6 land more mutations. Reviewer: api-contract.

- **#4 [P2][gated_auto]** `packages/database-pg/graphql/types/customize.graphql` — `disableConnector` returns `Boolean!` while existing toggles like `pauseConnector`/`resumeConnector` return the row for symmetry. **Suggested fix:** return the (now-disabled) `ConnectorBinding` row to match the symmetry, or document the asymmetric shape choice. Reviewer: api-contract.

- **#5 [P2][manual]** `packages/api/src/graphql/resolvers/customize/customizeBindings.query.ts` — Semantic flip from `connectors.type == slug` to `connectors.catalog_slug IS NOT NULL` silently drops pre-backfill rows from `connectedConnectorSlugs`. **Suggested fix:** add a comment in the GraphQL schema field documentation noting the post-U4-1 behavior; consider a follow-on backfill audit. Reviewer: api-contract.

- **#6 [P2][gated_auto]** `packages/database-pg/graphql/types/customize.graphql` — `ConnectorBinding` is a parallel projection of an existing `Connector` row with no documented relationship. **Suggested fix:** either reuse `Connector` directly or add schema-level documentation explaining why `ConnectorBinding` is the Customize-page-specific projection. Reviewer: api-contract.

- **#7 [P2][manual]** `packages/api/src/graphql/resolvers/customize/enableConnector.mutation.ts` — Auth + Computer-load preamble (lines ~36-64) is duplicated between `enableConnector` and `disableConnector`. U5/U6 will add 4 more call sites. **Suggested fix:** extract a `loadCallerComputer(ctx, computerId)` helper to `packages/api/src/graphql/resolvers/customize/shared.ts` once a third mutation lands. Reviewer: maintainability.

## Advisory (no action this PR)

- **#8 [P3]** `apps/computer/src/components/customize/use-customize-mutations.ts` — `useConnectorMutation` calls `MyComputerQuery` to resolve `computerId`; `CustomizeBindingsQuery` already returns it. Consolidate to a single source of truth.
- **#9 [P3]** `packages/database-pg/graphql/types/customize.graphql` — Naming overlap with existing `pauseConnector`/`resumeConnector`/`archiveConnector` mutations on the same row.
- **#10 [P3]** `apps/computer/src/components/customize/use-customize-data.ts` — Hand-typed `BindingsResult` / `CatalogConnector` duplicate the GraphQL schema; consider codegen when operation count grows.
- **#11 [P3]** `packages/api/src/graphql/resolvers/customize/enableConnector.mutation.ts` — `slug` arg has no length cap before DB lookup; Drizzle parameterizes (no SQLi) but unbounded text is a tiny CPU surface.
- **#12 [P3]** `packages/api/src/graphql/resolvers/customize/enableConnector.mutation.ts` — `default_config` jsonb copied verbatim from catalog into `connectors.config`; trust boundary depends on catalog seeding staying admin-only.

## Applied autofix (this run)

- `auto-1` **P1**: disambiguate `connectors.name` per Computer with `${catalog.display_name} (${computer.slug})` to avoid `uq_connectors_tenant_name` collision.
- `auto-2` Extract `MCP_VIA_MOBILE_HINT` + `CONNECTOR_TYPENAMES` constants.
- `auto-3` Replace `pendingSlug` with `pendingSlugs: Set<string>` so overlapping toggles don't clobber.
- `auto-4` MCP test fixture uses try/finally cleanup.
- `auto-5` Dedupe `bindingAgentId()` call + drop non-null assertion.

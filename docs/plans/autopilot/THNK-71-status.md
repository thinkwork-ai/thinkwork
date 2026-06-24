---
linear_issue: THNK-71
dispatcher_marker: "automation-ledger:THNK-71"
plan: "Linear document: Plan: Rename Data Integrations plugin to Company ETL"
progress: "Linear document: Progress: Rename Data Integrations plugin to Company ETL"
status: ready_for_verification
started_at: 2026-06-24T20:10:00Z
verified_at: 2026-06-24T21:36:00Z
---

# THNK-71 Autopilot Status

## Scope

Rename the first-party `data-integrations` shell plugin to `company-etl` /
`Company ETL` while preserving shell-only behavior. The work intentionally does
not add connector runtime, ETL jobs, schedules, pipelines, warehouse resources,
analytics UI, MCP servers, skills, credentials, or Terraform resources.

The Linear plan document is the active source of truth. The issue referenced
`docs/plans/2026-06-24-005-refactor-company-etl-plugin-rename-plan.md`, but that
repo-local plan file was not present on fresh `origin/main` during the worker
pass.

## Merged Units

| Unit | PR | Merge commit | Result |
| --- | --- | --- | --- |
| U1 Rename plugin package identity + U2 regenerate catalog wiring | [#2938](https://github.com/thinkwork-ai/thinkwork/pull/2938) | `ce59ed9107c3a86b7a25eb7b4341f0e071483808` | `plugins/company-etl`, `@thinkwork/plugin-company-etl`, `company-etl`, and `Company ETL` are the active shell identity. |
| U3 persisted state migration and compatibility reads | [#2941](https://github.com/thinkwork-ai/thinkwork/pull/2941) | `eaf115e73579de5d99f9873b2c07d9b177f5396a` | Deploy-owned SQL migration, dev marker view, API read compatibility, and web legacy redirect are in place. |
| U4 source-boundary enforcement and active references | [#2942](https://github.com/thinkwork-ai/thinkwork/pull/2942) | `6fa30b814f42e2d66c42dd871390e4f6cbf6d33d` | Source-boundary checks now model `company-etl` as the active plugin boundary and classify remaining old-slug references. |

## Final Verification

Package and catalog identity:

- `pnpm --filter @thinkwork/plugin-company-etl test`
- `pnpm --filter @thinkwork/plugin-company-etl typecheck`
- `pnpm --filter @thinkwork/plugin-catalog test`
- `pnpm --filter @thinkwork/plugin-catalog typecheck`
- `pnpm --filter @thinkwork/plugin-catalog check:plugins`
- `pnpm --filter @thinkwork/plugin-catalog build:catalog -- --key /tmp/thnk-71-u5-plugin-catalog-test-key.pem --out /tmp/thnk-71-u5-plugin-catalog.json`
- `jq -r '.catalog.plugins[].pluginKey' /tmp/thnk-71-u5-plugin-catalog.json`

Signed catalog output listed `company-etl` and did not list `data-integrations`.

Source-boundary and stale-reference checks:

- `node scripts/verify-plugin-source-boundary.mjs`
- `pnpm test:plugin-source-boundary`
- `test ! -e plugins/data-integrations`
- `rg -n "@thinkwork/plugin-data-integrations|plugins/data-integrations|pluginKey: \"data-integrations\"|displayName: \"Data Integrations\"" plugins packages apps pnpm-lock.yaml package.json --glob '!node_modules/**' || true`
- `rg -n "data-integrations|Data Integrations|plugin-data-integrations|@thinkwork/plugin-data-integrations" packages apps plugins scripts terraform pnpm-lock.yaml package.json --glob '!node_modules/**'`

API, database, web, and deploy-owned migration checks:

- `pnpm --filter @thinkwork/api test -- plugins-resolvers.test.ts`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm --filter @thinkwork/database-pg test -- migration-0188-company-etl-plugin-rename.test.ts`
- `pnpm --filter @thinkwork/database-pg typecheck`
- `pnpm --filter @thinkwork/web test -- -t "legacy plugin redirects"`
- `pnpm --filter @thinkwork/web typecheck`
- `bash scripts/db-migrate-manual.sh packages/database-pg/drizzle/0188_company_etl_plugin_rename.sql`

Dev drift reporter result:

```text
public.view_company_etl_plugin_rename_0188 -> view_company_etl_plugin_rename_0188
```

## Remaining Old-Slug References

The final active-source sweep found no active installable `Data Integrations`
identity:

- `plugins/data-integrations` is absent.
- No active package dependency on `@thinkwork/plugin-data-integrations` remains.
- No active manifest with `pluginKey: "data-integrations"` or
  `displayName: "Data Integrations"` remains.

Remaining `data-integrations` / `Data Integrations` references under active
source paths are intentional:

- Web legacy redirect route and generated route tree:
  `apps/web/src/routes/_authed/settings.plugins.data-integrations.tsx` and
  `apps/web/src/routeTree.gen.ts`.
- U3 migration SQL and tests:
  `packages/database-pg/drizzle/0188_company_etl_plugin_rename.sql` and
  `packages/database-pg/__tests__/migration-0188-company-etl-plugin-rename.test.ts`.
- API compatibility constants/tests:
  `packages/api/src/graphql/resolvers/plugins/queries.ts` and
  `packages/api/src/graphql/resolvers/plugins/plugins-resolvers.test.ts`.
- Source-boundary allowlist entry for the legacy redirect only:
  `scripts/plugin-source-boundary-allowlist.mjs`.

Historical references under `docs/plans/` describe earlier Company Data planning
context and are not active installable plugin source.

## Notes

- `pnpm format:check` / `pnpm exec prettier --check ...` could not run in this
  worktree because the workspace install does not expose a `prettier` binary,
  despite the root format scripts referencing it.
- U3 applied the dev migration manually through `psql --single-transaction`
  before merge because the repository's migration drift gate requires new
  hand-rolled migrations to be present in dev before the PR can merge.

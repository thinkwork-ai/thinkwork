# THNK-19 Autopilot Status

Linear issue: THNK-19 — U3: Add canonical Company Brain S3 artifacts and manifests
Target branch: `main`
Implementation branch: `codex/thnk-19-brain-s3-manifests`
Worktree: `.Codex/worktrees/thnk-19-brain-s3-manifests`
Status doc created: 2026-06-14

## Current State

- Parent issue THNK-6 is already `In Progress`.
- Active unit issue THNK-19 was read in `Planning` status and moved to `In Progress` when coding began.
- THNK-15, the Company Brain plugin shell prerequisite, is `Done`.
- THNK-19 has no child issues and no direct Linear comments, attachments, or documents.
- THNK-19 blocks THNK-20 and is blocked by THNK-15, which is complete.
- Implementation is complete locally and focused verification is passing. Review, commit, push, PR, CI, merge, and Linear cleanup are still pending.

## Context Read

- Repo instructions: `AGENTS.md`
- Linear issue: THNK-19
- Parent context: THNK-6, including comments and documents
- Dependency context: THNK-15 and THNK-20
- Linear documents:
  - `Implementation plan: Company Brain physical substrate`
  - `Company Brain physical substrate requirements`
  - `OKF considered and deferred for Company Brain`
  - `Plan: Company Brain Premium Plugin`
  - `Brainstorm: Company Brain Premium Plugin`
- Linear attachment:
  - `2026-06-13-003-feat-company-brain-physical-substrate-plan.md.gz`, exact export of `docs/plans/2026-06-13-003-feat-company-brain-physical-substrate-plan.md`
- Repo-local plans and requirements:
  - `docs/plans/2026-06-13-003-feat-company-brain-physical-substrate-plan.md`
  - `docs/brainstorms/2026-06-13-company-brain-physical-substrate-requirements.md`
  - `docs/plans/2026-06-13-002-feat-company-brain-premium-plugin-plan.md`
  - `docs/brainstorms/2026-06-13-company-brain-premium-plugin-requirements.md`
- Prior solution notes:
  - `docs/solutions/best-practices/cognee-thread-ingest-explorer-2026-06-04.md`
  - `docs/solutions/architecture-patterns/managed-app-mcp-oauth-lifecycle-2026-06-06.md`
  - `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md`
  - `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`
  - `docs/solutions/best-practices/oauth-client-credentials-in-secrets-manager-2026-04-21.md`
  - `docs/solutions/design-patterns/gitkeep-materialization-s3-empty-folders-2026-05-13.md`

## Implementation Units

This issue is one PR-sized implementation unit. Internal chunks:

- U1. Add canonical Brain artifact bucket, env, IAM, and Terraform outputs.
- U2. Add Brain artifact manifest schema, GraphQL types, and replay/redaction helpers.
- U3. Write source artifacts and manifests from Knowledge Graph ingest and vault projection paths.
- U4. Update focused tests, generated schemas, docs, and smoke coverage.

Primary CE plan: `docs/plans/2026-06-14-001-feat-company-brain-artifact-manifests-plan.md`

## Progress Log

- 2026-06-14: Read Compound Engineering `lfg` and `ce-plan` workflow instructions plus Linear skill instructions.
- 2026-06-14: Read `AGENTS.md`.
- 2026-06-14: Fetched THNK-19 with relations. Found parent THNK-6, blocker THNK-15, and blocked issue THNK-20.
- 2026-06-14: Fetched all relevant Linear docs, comments, statuses, and attachment context.
- 2026-06-14: Searched repo for THNK-19, issue title, referenced plan filenames, Company Brain artifact wording, source artifacts, replayable manifests, and wiki export references.
- 2026-06-14: Fetched `origin/main` and created isolated worktree `.Codex/worktrees/thnk-19-brain-s3-manifests` on branch `codex/thnk-19-brain-s3-manifests`.
- 2026-06-14: Added this status doc and the THNK-19 implementation plan.
- 2026-06-14: Moved THNK-19 to `In Progress`.
- 2026-06-14: Added canonical `thinkwork-${stage}-brain-artifacts` S3 bucket, public-access block, versioning, SSE-KMS wiring through the composite stage key, HTTPS-only policy, lifecycle rules by artifact class, Lambda env wiring, IAM grants, and module outputs.
- 2026-06-14: Extended existing `brain.artifact_manifests` with Knowledge Graph ingest-run linkage, source/runtime metadata, source ids, object version/content metadata, ontology mechanism, and JSON metadata via manual migration `0167_company_brain_artifact_manifest_runtime.sql`.
- 2026-06-14: Added GraphQL `KnowledgeGraphArtifactManifestSummary` redacted summaries on `KnowledgeGraphIngestRun` and added `BRAIN` to `KnowledgeGraphSourceKind`; regenerated AppSync schema and CLI/web/mobile GraphQL clients.
- 2026-06-14: Added `packages/api/src/lib/knowledge-graph/artifacts.ts` to write source artifacts, ingestion manifests, and vault projections with checksums and credential-key redaction.
- 2026-06-14: Wired canonical artifact writes into thread/wiki ingest, observations ingest, and wiki export while preserving the existing `wiki_exports` bucket behavior.
- 2026-06-14: Focused API tests passed: `pnpm --filter @thinkwork/api exec vitest run src/lib/knowledge-graph/artifacts.test.ts src/__tests__/knowledge-graph-resolvers.test.ts src/__tests__/knowledge-graph-schema.test.ts src/__tests__/wiki-export.test.ts src/handlers/knowledge-graph-thread-ingest.test.ts src/handlers/knowledge-graph-observations-ingest.test.ts`.
- 2026-06-14: Focused database tests passed: `pnpm --filter @thinkwork/database-pg exec vitest run __tests__/migration-0167-company-brain-artifact-manifests.test.ts __tests__/migration-0166-company-brain-substrate.test.ts __tests__/knowledge-graph-schema.test.ts`.
- 2026-06-14: Typechecks passed for `@thinkwork/api` and `@thinkwork/database-pg`.
- 2026-06-14: Typechecks passed for generated GraphQL consumers `thinkwork-cli` and `@thinkwork/web`.
- 2026-06-14: Affected Lambda bundles built successfully for `knowledge-graph-thread-ingest`, `knowledge-graph-observations-ingest`, and `wiki-export`; generated `dist/` artifacts were removed afterward.
- 2026-06-14: `git diff --check` passed.
- 2026-06-14: Terraform validation passed for `terraform/modules/app/lambda-api`. Standalone validation of `terraform/modules/thinkwork` still reports its existing missing `aws.us_east_1` provider alias when run as a child module.

## Linear State Changes

- 2026-06-14: Moved THNK-19 from `Planning` to `In Progress` when implementation began.

## Decisions

- Treat THNK-19 as one implementation PR because the issue has no child issues and the scope is one cohesive substrate slice.
- Use `docs/plans/2026-06-13-003-feat-company-brain-physical-substrate-plan.md` as the primary upstream CE plan.
- Do not reuse the existing `wiki_exports` bucket; it has export semantics and 30-day lifecycle.
- Reuse and extend the existing `brain.artifact_manifests` substrate ledger from THNK-15 instead of creating a parallel public Knowledge Graph manifest table.
- Keep customer-visible errors redacted. S3 object keys and source ids may appear in internal S3 manifests and database rows for replay, but GraphQL summaries expose only checksums/counts/redacted synthetic references.
- Keep broad structured-source connector ingestion out of scope. The unit defines credential and manifest contracts and applies them to existing thread/wiki/observations/vault paths.

## Blockers

- None currently.

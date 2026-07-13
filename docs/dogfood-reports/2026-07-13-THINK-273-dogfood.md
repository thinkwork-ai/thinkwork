# Dogfood report — THINK-273: Wiki page render persistence + `WikiPage.renderHtml` + backfill (THINK-270 U2)

- **Issue:** [THINK-273](https://linear.app/thinkworkai/issue/THINK-273)
- **Verified:** 2026-07-13, by the verification (judge) worker, independently re-driving the plan's Verification Contract against the deployed **dev** stack.
- **Scope in review:** merged PRs [#3673](https://github.com/thinkwork-ai/thinkwork/pull/3673) (`4c54152c3`) + [#3681](https://github.com/thinkwork-ai/thinkwork/pull/3681) (`9f5cea81f`).
- **Verdict: PASS.** All five verification-contract flows independently confirmed against live dev. Green scenario matrix; no functional or experiential failures. "Decisions for a human" is empty.

## Preconditions

| Check | Result |
|---|---|
| PR #3673 merged | ✅ `MERGED` `4c54152c3` 2026-07-13T11:38:21Z |
| PR #3681 merged (backfill pool-deadlock fix) | ✅ `MERGED` `9f5cea81f` 2026-07-13T11:55:38Z |
| Post-merge Deploy on main green (dev is continuous-CD) | ✅ run 29247954218 `success`, headSha `9f5cea81f` (drift gate green) |

## What changed (diff-scoped)

Enumerated from the two merged PRs:

- **Schema (U1):** `packages/database-pg/drizzle/0245_wiki_page_render.sql` (hand-rolled; `render_html` / `render_plate_slug` / `rendered_at` nullable columns on `wiki.pages`, with `-- creates-column:` markers) + Drizzle schema `packages/database-pg/src/schema/wiki.ts`.
- **Render helper + write-seam hook (U2):** `packages/api/src/lib/wiki/render.ts` (`composeWikiPageRender`, `buildWikiRenderCompile`); hooked at the `upsertSections` `body_md`-rewrite tail in `packages/api/src/lib/wiki/repository.ts` (savepoint guard, NULL-triple on any failure, 256 KiB cap).
- **GraphQL exposure (U3):** `WikiPage.renderHtml` field in `packages/database-pg/graphql/types/wiki.graphql`, resolved detail-only in `packages/api/src/graphql/resolvers/wiki/{wikiPage.query,mappers}.ts`; codegen regenerated in api/web/mobile/cli (`apps/{cli,web,mobile}/.../graphql.ts`).
- **Backfill (U4):** `packages/api/scripts/backfill-wiki-renders.ts` (compositor-only, idempotent; PR #3681 pre-warms a per-`(tenant,pageType)` plate cache outside the page transactions to avoid the max-2 pool deadlock).

## User / data flows the change participates in

1. **Live compile write path** — tenant graph compile → `upsertSections` rewrites `body_md` → same write also composes and persists the plate render (or the NULL triple on failure). Terminal end: `wiki.pages.render_html` populated atomically with the section rewrite.
2. **Client read path** — `wikiPage` detail query exposes `renderHtml`; `wikiSearch` / graph / dossier do **not**. Terminal end: authenticated GraphQL consumer receives a self-contained scriptless HTML plate; codegen field present in web/mobile/cli.
3. **Operator backfill path** — `backfill-wiki-renders.ts` recompiles renders from stored sections, no LLM. Terminal end: previously-compiled pages gain byte-identical, deterministic renders.
4. **Downstream (unblocked, not in this unit):** THINK-274 (web reader) and THINK-275 (mobile reader) consume `renderHtml`. Confirmed they now have live data — **1,683 dev pages carry non-null renders**.

## Scenario matrix & verdicts

Evidence captured against deployed dev: GraphQL endpoint `https://ho7oyksms0.execute-api.us-east-1.amazonaws.com/graphql` (authenticated, refreshed Cognito idToken) and dev Aurora `thinkwork-dev-db` via psql. Tenant `sleek-squirrel-230` = `0015953e-aa13-4cab-8398-2e70f73dda63`.

| # | Scenario (contract flow / requirement) | Functional | Experiential | Evidence |
|---|---|---|---|---|
| 1 | Migration 0245 columns present on dev (R6, drift gate) | ✅ PASS | ✅ | `information_schema`: `render_html text`, `render_plate_slug text`, `rendered_at timestamptz` all present; deploy drift gate green |
| 2 | `wikiPage.renderHtml` returns self-contained scriptless plate (R1, R2, AE3) | ✅ PASS | ✅ | HTTP 200; `renderHtml` starts `<!DOCTYPE html>`, contains `<meta name="tw-plate" content="wiki-entity">`, **no `<script>`**; 6,882 chars / 6,889 bytes; real content (title, `<h1>/<h2>` headings, inline `<style>` palette) |
| 3 | Detail-only exposure — `wikiSearch` carries no render (R4) | ✅ PASS | ✅ | `wikiSearch` returns the page (+1 more) with `page.renderHtml: null` on **all** results |
| 4 | Backfill idempotency (R5, AE4) | ✅ PASS | ✅ | Default/dry-run `eligible=0` (all rendered → skipped); `--force --page` ×2 → md5 `d58b0b18…` identical across the original stored render + both forced runs; `0 errors` |
| 5 | Failure path degrades to NULL triple, never fails write (R3, AE2) | ✅ PASS | ✅ | Appended disallowed `` ```tw:chart `` fence → `--force` logged `DIRECTIVE_GENRE_RESTRICTED`, persisted all-three-NULL triple, `clearedToNull=1 errors=0`, exit 0; section restored (body_md md5 matches backup) → render returned **byte-identical** (`d58b0b18…`) |

### Corroborating fleet-wide checks (beyond the single-page contract)

- **Coverage:** `wiki.pages` = 1,683 rows, **1,683 rendered, 0 NULL**. Dev holds only ENTITY pages for one tenant, so this is 100% of the population (TOPIC/DECISION plates are THINK-272 scope; no such pages exist in dev to exercise).
- **Shape across all 1,683 renders:** every render starts `<!DOCTYPE html>`, `0` contain `<script`, `0` exceed the 256 KiB cap (max 11,119 bytes), all `render_plate_slug = wiki-entity`.
- **Atomicity:** 1,639 rendered rows have `rendered_at = updated_at` (live-compile same-write atomicity); the 44 with `rendered_at <> updated_at` are backfill-only pages (backfill sets `rendered_at`, not `updated_at`) — expected, not a defect.
- **Cross-path determinism:** the live-compiled stored render and the backfill-`--force` render for the chef page share md5 `d58b0b18…` — both write paths are byte-identical, strengthening AE4.
- **Byte/char reconciliation:** GraphQL `renderHtml` = 6,882 chars vs 6,889 stored bytes — the 7-byte delta is multi-byte UTF-8 (accented French content), not truncation.
- **Dev left clean:** after Flow 5's mutate/restore, final census is back to 1,683/1,683, 0 NULL.

## Paper cuts (do not fail verification)

- **Operator backfill against RDS + TLS:** running `backfill-wiki-renders.ts` against Aurora from a workstation trips the pg-driver deprecation where `sslmode=require` is now treated as `verify-full`, failing with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` unless the RDS CA is trusted or `sslmode=no-verify` is used. This is a driver/env concern for the operator-run script (the in-Lambda compile path resolves SSL from the deployed env and is unaffected), but a one-line note in the script's usage header would save the next operator a debugging loop. Minor; a follow-up doc/comment, not a blocker.
- **Coverage limitation (informational):** dev has no TOPIC/DECISION wiki pages, so non-entity plate rendering could not be exercised end-to-end here. Those plates are delivered by THINK-272; this unit only consumes `resolveWikiPlate`. Not a gap in THINK-273.

## Decisions for a human

None. LFG issue; all flows passed with no risky/ambiguous findings.

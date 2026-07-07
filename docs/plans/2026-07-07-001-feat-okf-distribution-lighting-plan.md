# Brain Quality P5 — light OKF/wiki distribution (THINK-200)

**Date:** 2026-07-07
**Ticket:** THINK-200 (parent THINK-193; supersedes THINK-149 item 2)
**Source analysis:** docs/brainstorms/2026-07-06-company-brain-quality-reset-analysis.md §P5

## State found (audit)

- The projection was fully built but **never lit**: okf-materialize and
  okf-efs-refresh Lambdas deployed with EFS/VPC wiring and the Pi runtime
  running `OKF_WIKI_NAVIGATOR_ENABLED=true`, but neither Lambda had ANY
  trigger, and neither had ever run.
- First one-shot run exposed dev drift: hand-rolled migration
  `0183_okf_artifact_manifests.sql` (OKF manifest kinds for the
  `brain_artifact_manifests_kind_allowed` CHECK) had never been applied to
  dev — it predates the migration drift gate. Applied via psql (2026-07-07).
- wiki-compile's only completion side-effect was per-user knowledge packs;
  tenant-scoped compiles had no fan-out. The durable trigger is net-new.

## Shipped

**One-shot (ops, done live on dev):** applied 0183 → `okf-materialize
{tenantId: dev}` (137 pages, 224 objects, 332KB to S3) → `okf-efs-refresh
{tenantSlug: sleek-squirrel-230}` (223 files to
`/mnt/thinkwork-okf/tenants/sleek-squirrel-230/current`) → live Pi turn used
`wiki_ls`/`wiki_read` and summarized `entities/person/atlas.md`. The
navigator tree is populated for the first time.

**Durable chain (code, this PR):** `packages/api/src/lib/okf/chain.ts` —
wiki-compile success → Event-invoke okf-materialize (tenant) →
okf-materialize publish → Event-invoke okf-efs-refresh (published slugs).
Env-gated (`OKF_MATERIALIZE_FN_NAME` / `OKF_EFS_REFRESH_FN_NAME`) so the
chain is inert until terraform wires it; both hops best-effort (a chain
fault never fails the compile — the next compile re-lights). Hooked into all
four wiki-compile success paths (planner jobId/drainer, graph jobId/drainer);
draft compiles excluded (drafts aren't materialized). Terraform: env vars on
both handlers + cross-invoke ARNs in the api-orchestration policy.

## Post-merge verification

1. Deploy applies env + IAM; enqueue a wiki compile (or wait for the
   post-turn enqueue) and confirm the chain fires without manual invocation:
   fresh `[okf-chain]` log lines + new bundleId in the EFS current view.
2. Promotion-gate boundary re-check (ticket scope item 3) with post-P2 data:
   run `startKnowledgeGraphObservationsIngest` on dev after this PR deploys
   (it also carries THINK-199's classifier-context v2) and report the
   exclusion-rate breakdown vs the ~90% personal rate from the audit.

## Notes

- Chain frequency = wiki-compile success frequency; a full dev materialize is
  ~137 pages / 332KB / seconds, acceptable without debounce. Revisit if
  compile volume grows.
- The 137 current pages are pre-reset extraction vintage; content quality
  improves as post-P2 compiles land. Distribution freshness is now
  structural, not manual.

---
title: "Executive dashboard as the connected registry's second route"
date: 2026-06-10
status: parked
topic: executive-dashboard-registry-second-route
source_prompt: "Deliver a custom executive dashboard application that registers with the connected application registry: data pushed into the app's datastore, connected information displayed in an executive UI."
---

# Executive Dashboard as the Connected Registry's Second Route

## Status

Parked 2026-06-10. Prove the registry spine first (Twenty -> Cognee tracer
bullet, `docs/plans/2026-06-08-003-feat-connected-application-registry-plan.md`),
then revisit adding analytics/dashboard managed applications.

**Revisit trigger:** registry Phase 1 deployed and proven — a signed Twenty
`opportunity.updated` event produces a Cognee-backed result through an enabled
binding with an operator-visible flow waterfall.

## Framing

The vision: a dashboard application registers with the connected application
registry, source-app events are pushed into the dashboard's datastore through
policy-approved bindings, and connected information surfaces in an executive
UI. There is existing external interest in this shape of connected application.

Assessment against the merged registry plan: the data plane is enabled as
designed — a dashboard route is structurally identical to the Twenty -> Cognee
tracer bullet (signed ingress, deny-by-default binding with data-class
allowlist, idempotent dispatch, flow observability). The one genuinely new
registry pattern required is an **HTTP target adapter**: v1's only target
adapter writes into ThinkWork-internal Brain/wiki paths, while a dashboard
target invokes the managed app's API over HTTP with a tenant-scoped outbound
credential (mirroring the inbound `webhook_signing_secret` pattern in
`tenant_credentials`).

## Decisions Made During Exploration

- **Push-only data flow.** Pull/scheduled ingestion was considered and cut.
  Sources push events through the registry; no polling architecture.
- **App-owned datastore.** No shared "connected database" capability — the
  dashboard app owns its analytics store, consistent with the registry's
  app-ownership boundary.
- **Repo-authored manifests.** The app does not self-register at runtime;
  ThinkWork authors its manifest. Runtime self-registration remains the
  deferred marketplace phase.
- **Metabase over custom build for the revisit's v1.** Direction changed twice
  during exploration: first a ThinkWork-built premium custom service, then
  Metabase once the MCP landscape was checked. Metabase wins on maturity,
  build cost, and agent synergy. The ThinkWork-built custom dashboard app is
  the _later_ premium play, not the first move.
- **Second-route proof.** When revisited, this route is a better Phase-3
  genericity proof for the registry than the synthetic execution-level
  conformance fixture; it can replace or supplement that test.

## Metabase Findings (verified 2026-06-10)

- The BI MCP gap closed in April 2026: Grafana has an official MCP server
  (`grafana/mcp-grafana`), Metabase v60 ships a native MCP server at
  `/api/mcp`, Superset 5.0 added native MCP. MCP support no longer
  differentiates candidates.
- **Metabase** is the standout for the executive use case: native MCP designed
  for agent-authored questions/dashboards (agent reads DB metadata, writes
  serialized YAML content), single container + Postgres on Fargate,
  business-flavored UX. Registering its `/api/mcp` endpoint through the
  existing managed-MCP pattern (as Twenty does) would let the ThinkWork chat
  agent build dashboards conversationally.
- **Grafana** wins only if dashboards lean ops/telemetry (dashboards-as-JSON
  is the most agent-ergonomic authoring model). **Superset** has the best
  license (Apache-2.0) but the heaviest Fargate footprint (web + Redis +
  Celery) and the clunkiest API authoring.
- **Embedding tiers:** static signed embedding is free in OSS Metabase
  (JWT-signed iframe, locked tenant parameters, read-only, "Powered by
  Metabase" badge) and fits ThinkWork's iframe-isolated applet substrate.
  Interactive embedding, SSO into the Metabase app, and white-labeling
  require a paid Metabase Pro license. Natural v1 posture: static embeds for
  executives inside ThinkWork; direct Metabase access operator/analyst-only.
- **Bundle shape:** data is not pushed "into Metabase" — Metabase is a query
  layer and its application DB holds only dashboard/question config. The
  managed app bundles Metabase plus an app-owned analytics datastore (its own
  Postgres) registered as a Metabase data source; the registry route lands
  events in that datastore. The ingest surface (thin HTTP shim vs direct
  write) is a planning decision.
- **License caution:** Metabase and Grafana are AGPL. Deploying the unmodified
  upstream image as a managed app is standard practice, but a license review
  is required before committing.

## Open When Revisited

- Embed tier: does the premium pitch need interactive drill-down inside
  ThinkWork (Metabase Pro license cost) or do free static embeds suffice?
- Is agent-built dashboards (registering Metabase's native MCP) v1 scope of
  the revisit or a fast-follow?
- Is "premium" entitlement-gated per tenant or positioning-only?
- First feed is Twenty opportunity events (the only live ingress); which
  sources come next, and does the per-pair binding grant UX hold up under
  fan-in? (Already flagged as a deferred question in the registry plan.)

## Sources

- `docs/plans/2026-06-08-003-feat-connected-application-registry-plan.md`
- `docs/plans/2026-06-06-002-feat-worker-contract-tracer-bullet-plan.md`
- `docs/brainstorms/2026-06-08-kestra-managed-application-requirements.md`
  (adjacent managed-app wrap precedent)
- Grafana MCP: https://github.com/grafana/mcp-grafana and
  https://grafana.com/docs/grafana/latest/developer-resources/mcp/
- Metabase native MCP (v60): https://www.metabase.com/docs/latest/ai/mcp
- BI MCP landscape: https://chatforest.com/reviews/bi-reporting-mcp-servers/
- Self-host comparison:
  https://blog.elest.io/apache-superset-vs-metabase-vs-redash-which-open-source-bi-tool-to-self-host-in-2026/

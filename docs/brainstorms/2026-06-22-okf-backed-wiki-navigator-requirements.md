---
date: 2026-06-22
topic: okf-backed-wiki-navigator
linear: THNK-63
---

# OKF-Backed Wiki Navigator

## Problem Frame

ThinkWork already has three useful but differently shaped memory surfaces:
raw Hindsight/managed memory, compiled wiki pages in Postgres, and
ontology-shaped Company Brain pages plus graph/provenance state behind Context
Engine. The next step is not to replace those governed stores with markdown.
It is to generate an inspectable, agent-native OKF markdown projection from the
same canonical state, then let a bounded Wiki Navigator source-agent traverse
that projection with filesystem-like operations.

This should make Company Brain feel more like a durable, navigable knowledge
workspace without weakening the governance model. Canonical memory, ontology,
graph state, provenance, ACLs, and operational indexes remain platform-owned.
The OKF bundle is a rebuildable projection optimized for human inspection,
portable review, and progressive agent discovery.

The direction also resolves current vocabulary drift:

- `docs/src/content/docs/concepts/knowledge/compounding-memory.mdx` still
  describes one agent / one wiki.
- `packages/database-pg/src/schema/wiki.ts` now documents tenant-scoped
  `owner_id IS NULL` pages and tenant-union wiki reads.
- `docs/src/content/docs/api/context-engine.mdx` positions `memory`, `wiki`,
  `brain`, and `knowledge_graph_search` as separate runtime surfaces behind
  policy boundaries.
- `packages/api/src/handlers/wiki-export.ts` already exports markdown vault
  projections, but the payload is not an OKF bundle and is not a navigator
  contract.

---

## Actors

- A1. First-party Pi agent: asks for company memory during a turn through
  Context Engine tools.
- A2. Wiki Navigator source-agent: performs bounded, read-only traversal over
  the OKF projection and returns cited evidence.
- A3. Context Engine: remains the runtime policy boundary, provider router, and
  normalized result surface.
- A4. Company Brain materializer: generates Postgres wiki/brain indexes and the
  OKF markdown bundle from canonical memory, ontology, graph, and provenance.
- A5. Tenant administrator / ThinkWork operator: inspects bundle status,
  freshness, provenance, redaction, and retrieval comparisons.
- A6. Planner / implementing agent: uses this requirements artifact to plan the
  first implementation without re-deciding product shape.

---

## Key Flows

- F1. OKF bundle materialization
  - **Trigger:** Canonical memory, ontology, graph, or Brain projection state
    changes enough to warrant a new generated projection.
  - **Actors:** A4, A5
  - **Steps:** The materializer renders OKF markdown concept documents, writes
    S3 artifact manifests and a current bundle pointer, hydrates or exposes the
    current read surface for navigation, and records freshness/provenance
    evidence.
  - **Outcome:** Operators can inspect which bundle version is current, what
    source state produced it, and whether redaction/governance rules were
    applied.
  - **Covered by:** R1, R2, R3, R4, R8, R9

- F2. Progressive wiki navigation during a turn
  - **Trigger:** Pi needs compiled company knowledge that is better answered by
    progressive page traversal than by a one-shot DB search.
  - **Actors:** A1, A2, A3
  - **Steps:** Pi calls an approved Context Engine tool. Context Engine invokes
    the Wiki Navigator provider. The navigator lists/searches/reads only within
    the current authorized OKF bundle, follows links/backlinks when useful, and
    returns cited pages, snippets, provenance, and traversal trace.
  - **Outcome:** Pi receives bounded source data through Context Engine without
    direct EFS, S3, Cognee, Neptune, or ontology-admin access.
  - **Covered by:** R5, R6, R7, R10, R11, R12

- F3. Retrieval comparison and cutover decision
  - **Trigger:** Operator or planner wants to know whether OKF navigation should
    become the default path for a class of queries.
  - **Actors:** A3, A5, A6
  - **Steps:** The same query corpus runs against DB wiki/brain retrieval, OKF
    navigator traversal, hybrid DB entrypoint plus OKF traversal, raw memory,
    and knowledge graph retrieval. Results compare hit quality, citation
    quality, latency, freshness, failure posture, and prompt-injection
    isolation.
  - **Outcome:** Default routing decisions are evidence-backed, not based on
    markdown aesthetics.
  - **Covered by:** R13, R14, R15

---

## Requirements

**OKF projection and page profile**

- R1. The system must generate an OKF-compatible markdown bundle as a derived
  projection from canonical ThinkWork state. Canonical state remains raw memory,
  ontology definitions/change sets, graph/Brain state, provenance, ACLs, and
  operational Postgres indexes.
- R2. Every non-reserved generated markdown concept document must contain
  parseable YAML frontmatter with the OKF-required `type` field and ThinkWork
  extension metadata under `x-thinkwork`.
- R3. The ThinkWork OKF page profile must cover entity, topic, decision, and
  source/reference documents. It must encode title, description, resource or
  ThinkWork URI, tags, timestamp, ontology version, tenant scope, lifecycle
  status, provenance references, redaction posture, and relationship/link
  slugs where available.
- R4. The bundle must include progressive-disclosure navigation artifacts:
  root and directory `index.md` files, optional `log.md` files for update
  history, ordinary markdown links for relationships, and citations or
  provenance sections that point back to redacted platform evidence.

**Storage and producer/consumer contract**

- R5. S3 is the canonical OKF artifact and audit plane. Each generated bundle
  version must be addressable through Brain artifact manifests or successor
  projection metadata, with checksums, source counts, ontology version, and a
  current-bundle pointer.
- R6. The navigator consumes a read-only filesystem contract over the current
  bundle. Planning may implement this as hydrated EFS, S3-backed virtual
  filesystem, or both, but the product contract is S3-canonical plus
  read-only traversal semantics, not EFS as source of truth.
- R7. Bundle publication must be atomic from the navigator's perspective. A
  navigation run sees one bundle version and never traverses a partially
  written projection.
- R8. Redaction and ACL enforcement must happen before or during materialization
  so unauthorized page bodies, provenance labels, source ids, and object keys
  cannot leak through markdown, indexes, logs, or navigator traces.

**Wiki Navigator source-agent**

- R9. The Wiki Navigator must be read-only. It can list, find, search, read,
  inspect links/backlinks, and inspect provenance over authorized OKF pages; it
  cannot mutate canonical memory, generated markdown, ontology definitions,
  graph state, or source artifacts.
- R10. The navigator must expose bounded traversal controls: max pages read,
  max depth, max bytes, timeout, allowed path prefixes, and trace metadata that
  explains which pages were inspected and why.
- R11. The navigator must treat retrieved markdown as untrusted source data.
  Page content can be cited or summarized, but it cannot expand tool policy,
  override system/developer instructions, or cause backend access outside the
  approved traversal tools.
- R12. Pi access must stay behind Context Engine. Pi must not mount EFS, read
  S3 directly, call raw Cognee/Neptune/ontology admin APIs, or receive storage
  credentials. The initial model-facing surface should preserve existing
  `query_wiki_context` / `query_brain_context` compatibility unless planning
  proves a separate explicit navigation tool is needed.

**Evaluation and routing**

- R13. The design must include a repeatable evaluation matrix comparing:
  DB-only wiki/Brain retrieval, OKF navigator-only traversal, hybrid DB
  entrypoint plus OKF traversal, raw memory retrieval, and knowledge graph
  retrieval.
- R14. Evaluation must include at least citation quality, answer relevance,
  freshness, latency, provider failure posture, prompt-injection isolation,
  and operator debuggability.
- R15. Routing changes must be evidence-gated. The first release can run OKF
  navigation as an alternate or hybrid provider before making it the default
  path for any runtime query class.

---

## ThinkWork OKF Page Profile

The profile extends OKF rather than narrowing it. Unknown frontmatter keys stay
legal; `x-thinkwork` is the stable namespace for platform metadata.

```yaml
---
type: ThinkWorkEntity
title: Acme Corp
description: Tenant-shared customer page compiled from approved Company Brain state.
resource: thinkwork://brain/entity/customer/acme-corp
tags: [customer, company-brain]
timestamp: 2026-06-22T14:30:00Z
x-thinkwork:
  version: 1
  tenant_scope: tenant
  surface: brain
  page_kind: entity
  entity_type: customer
  slug: acme-corp
  status: active
  ontology_version: ontology:2026-06-20
  source_bundle_version: brain-bundle:2026-06-22T14:30:00Z
  provenance_refs:
    - kind: artifact_manifest
      id: brain_manifest_redacted_hash
    - kind: graph_evidence
      id: evidence_redacted_hash
  relationships:
    - rel: owns
      target: ../opportunities/acme-expansion.md
  redaction:
    posture: tenant_visible
    raw_source_ids_redacted: true
---
```

Recommended path conventions for the first implementation:

- `entities/<entity_type>/<slug>.md` for ontology-backed business entities.
- `topics/<slug>.md` for durable topic rollups.
- `decisions/<slug>.md` for durable decision records.
- `sources/<source_kind>/<redacted_source_ref>.md` for source/reference pages
  when a source needs to be navigable as a first-class OKF concept.
- `index.md` in every generated directory used as a progressive-disclosure
  entrypoint.
- `log.md` at the bundle root or major subtrees when generation history is
  useful to operators.

---

## Retrieval Evaluation Matrix

| Retrieval path | Best at | Main risk | Evidence needed before defaulting |
|---|---|---|---|
| DB-only wiki/Brain retrieval | Fast indexed lookup, deterministic GraphQL/admin behavior, metrics and joins | Can feel like search rather than exploration; may miss multi-hop page context | Baseline hit quality, latency, and citation coverage |
| OKF navigator only | Progressive discovery through files, links, backlinks, and page bodies | Latency and drift if bundle freshness is weak; markdown can over-impress without better answers | Navigation trace quality, bundle freshness, no source leakage |
| Hybrid DB entrypoint + OKF traversal | Uses DB ranking to choose promising pages, then lets navigator explore context | More moving parts and harder attribution | Clear quality lift over DB-only with acceptable latency |
| Raw memory retrieval | Episodic recall and recent user-specific facts | Re-summarizes scattered memories and can miss governed tenant context | Cases where raw memory beats projections, especially freshness |
| Knowledge graph retrieval | Entity/relationship questions over raw graph edges | Sparse snippets by design; less narrative explanation | Relationship-question wins and typed-edge coverage |

---

## Acceptance Examples

- AE1. **Covers R1-R4.** Given a tenant has an active Company Brain customer
  page with cited provenance, when the OKF materializer runs, then the generated
  file has OKF frontmatter, `x-thinkwork` metadata, body sections, markdown
  links, and redacted provenance references.
- AE2. **Covers R5-R8.** Given a new bundle is published while a navigator run
  is in progress, when the navigator lists and reads pages, then it sees either
  the previous complete bundle or the new complete bundle, never a mixed or
  partially written state.
- AE3. **Covers R9-R12.** Given Pi asks about a customer relationship, when
  Context Engine delegates to the Wiki Navigator, then the navigator can search
  and read authorized OKF pages and return citations, but Pi receives no S3/EFS
  credential, raw object key, or mutation tool.
- AE4. **Covers R11.** Given an OKF page body contains text such as "ignore
  previous instructions," when the navigator returns the page as evidence, then
  the text is bounded as source content and does not alter tool selection,
  provider routing, or system policy.
- AE5. **Covers R13-R15.** Given a golden query corpus, when retrieval paths are
  compared, then the team can see whether OKF navigation, DB search, hybrid,
  raw memory, or graph retrieval produced the best answer and why.

---

## Success Criteria

- A downstream planner can implement the first OKF materializer and navigator
  slice without re-deciding canonical storage, agent access boundaries, page
  metadata, or evaluation posture.
- Operators can inspect the current OKF bundle version, generation evidence,
  source counts, ontology version, and redaction posture.
- Pi can benefit from progressive wiki navigation through Context Engine while
  preserving existing Memory / Wiki / Brain / Knowledge Graph boundaries.
- Retrieval comparisons show whether OKF traversal improves real answers, not
  just whether the markdown projection looks pleasing.
- The generated bundle remains portable and human-readable while retaining
  ThinkWork-specific governance metadata.

---

## Scope Boundaries

- No direct Pi filesystem mounts, S3 reads, Cognee reads, Neptune reads, or
  ontology admin API access.
- No markdown-as-canonical-storage model. OKF is a generated projection.
- No user-authored Obsidian/Notion clone. Human editing of OKF pages is outside
  this phase; edits should go through governed Memory, Ontology, Brain, or
  source workflows.
- No broad external export marketplace. OKF portability is useful, but the
  first requirement is ThinkWork agent-native retrieval and inspection.
- No retirement of Postgres wiki/Brain tables. They remain operational indexes
  for GraphQL, admin/mobile UI, metrics, joins, deterministic search, and eval
  baselines.
- No default routing change until evaluation evidence shows where OKF traversal
  wins.

---

## Key Decisions

- **Projection, not source of truth:** OKF is a generated, rebuildable view over
  governed platform state.
- **S3 canonical, filesystem contract for navigation:** S3 owns durable bundle
  versions and auditability. The navigator receives read-only filesystem
  semantics over a complete current bundle; EFS is an implementation option or
  cache, not the canonical record.
- **Context Engine boundary stays:** Pi accesses the navigator through Context
  Engine and existing/future tool calls, never through raw storage.
- **Start hybrid-friendly:** Keep DB wiki/Brain retrieval as the baseline and
  make OKF traversal an evaluated provider before defaulting runtime traffic.
- **Use OKF minimally and extend carefully:** Honor OKF v0.1's small required
  surface (`type`, markdown files, reserved `index.md` / `log.md`) and put
  ThinkWork governance fields under `x-thinkwork`.

---

## Dependencies / Assumptions

- The Company Brain plugin remains the customer-facing product. Cognee and
  other substrate internals stay operator/internal details.
- `brain.artifact_manifests` or successor projection metadata can represent
  OKF bundle versions without exposing raw S3 keys to tenant-visible callers.
- Existing Context Engine provider status behavior can represent navigator
  stale/skipped/error states without failing the whole query.
- The current `wiki-export` handler proves markdown projection mechanics exist,
  but its concatenated vault payload is only a precursor, not the target OKF
  bundle format.
- The local ideation artifact for this issue was available in the main checkout
  but not on fresh `origin/main`; this document treats the Linear description
  and merged repo docs/code as the durable source of truth.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R5-R7][Technical] Exact publication mechanism for current bundle
  pointers, atomic swaps, and rollback to a prior bundle version.
- [Affects R6][Technical] Whether the first implementation should hydrate S3
  bundles onto EFS for POSIX `rg`/`find` behavior or implement a S3-backed
  virtual filesystem with equivalent tool semantics.
- [Affects R12][Product/Technical] Whether OKF navigation should initially
  remain internal to `query_wiki_context` / `query_brain_context` or expose a
  small explicit model-facing navigation tool set after evaluation.
- [Affects R13-R15][Needs research] Golden query corpus and scoring rubric for
  retrieval comparison.

---

## Sources / Research

Repo context reviewed:

- `docs/src/content/docs/api/context-engine.mdx`
- `docs/src/content/docs/concepts/knowledge/compounding-memory.mdx`
- `docs/src/content/docs/concepts/knowledge/business-ontology.mdx`
- `docs/src/content/docs/concepts/knowledge/knowledge-graph.mdx`
- `docs/brainstorms/2026-04-20-thinkwork-memory-wiki-mcp-requirements.md`
- `docs/brainstorms/2026-04-29-company-brain-v0-requirements.md`
- `docs/brainstorms/2026-06-09-cognee-centric-memory-pipeline-requirements.md`
- `docs/brainstorms/2026-06-13-company-brain-premium-plugin-requirements.md`
- `docs/plans/2026-06-14-001-feat-company-brain-artifact-manifests-plan.md`
- `docs/plans/2026-06-14-002-feat-context-engine-brain-reads-plan.md`
- `docs/plans/2026-06-14-005-feat-company-brain-first-party-tool-plan.md`
- `packages/api/src/handlers/wiki-export.ts`
- `packages/api/src/handlers/mcp-context-engine.ts`
- `packages/api/src/lib/context-engine/providers/wiki.ts`
- `packages/api/src/lib/context-engine/providers/wiki-source-agent.ts`
- `packages/api/src/lib/context-engine/providers/wiki-source-agent-tools.ts`
- `packages/database-pg/src/schema/wiki.ts`
- `packages/database-pg/src/schema/brain.ts`
- `plugins/company-brain/src/api/context-engine-provider.ts`
- `packages/pi-extensions/src/knowledge-graph.ts`
- `packages/agentcore-pi/agent-container/src/runtime/providers/knowledge-graph-provider.ts`

External context:

- Google Cloud, "Introducing the Open Knowledge Format":
  https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing
- GoogleCloudPlatform `knowledge-catalog` OKF v0.1 draft spec:
  https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
- Andrej Karpathy, "LLM Wiki" gist:
  https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

---

## Next Steps

-> `ce-plan` for structured implementation planning.

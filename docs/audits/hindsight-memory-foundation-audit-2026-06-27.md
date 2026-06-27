---
date: 2026-06-27
topic: hindsight-memory-foundation-audit
origin: docs/brainstorms/2026-06-27-hindsight-memory-foundation-audit-requirements.md
plan: docs/plans/2026-06-27-001-feat-hindsight-memory-foundation-audit-plan.md
---

# Hindsight Memory Foundation Audit

## Executive Summary

Thinkwork's Hindsight implementation is meaningfully beyond a "vector recall" integration. The dev service is healthy, auto-consolidation is enabled, observations exist at scale, per-user banks are the dominant shape, and observation-only recall can return source-fact evidence. The foundation is real.

The next improvement layer is intentionality. Current writes often embed temporal and source signals in content or metadata, but do not consistently pass Hindsight's first-class `timestamp`, `tags`, `document_tags`, or `observation_scopes`. Current reads can retrieve observations, but source-fact evidence is not consistently preserved into operator and downstream surfaces. Bank-level missions, reflect missions, entity labels, mental models, and directives are available Hindsight capabilities but are mostly unused in dev.

The recommendation is to commit to Hindsight as Thinkwork's canonical retained-memory substrate for hosted Thinkwork. Context Engine should remain the governed routing and policy surface for multi-source context, but it should not force Hindsight into a lowest-common-denominator adapter shape that hides observations, source facts, mental models, directives, scopes, bank config, or retain parameters.

- Near term: first-class Hindsight retain fields, legal fact-type override hygiene, source-fact/provenance plumbing, and repeatable aggregate evidence checks.
- Medium term: per-bank/source missions, reflect context/query-time support, mental models, directives, entity labels, and operator verification surfaces.
- Deferred: production-safe dashboards, broad backfills, shared-bank designs, and automated mental-model lifecycle.

This audit does not implement those improvements. It creates the evidence-backed roadmap and acceptance checks for follow-up implementation.

---

## Hindsight Docs Baseline

| Hindsight guidance                                                    | Thinkwork posture                                                                                                                                                        | Classification      | Recommended action                                                                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Retain full/raw content rather than pre-summarized fragments          | `retainConversation` keeps a full replaceable thread document; requester memory uses markdown documents; journal import intentionally retains distilled historical notes | Healthy with caveat | Preserve full-thread and stable-document shapes; distinguish active writer behavior from historical imports.                                     |
| Use stable `document_id` for repeatable document upserts              | Threads, daily memory, requester memory, and requester thread digests have stable IDs                                                                                    | Healthy             | Keep this invariant and add tests when first-class fields are introduced.                                                                        |
| Set `context` to identify source shape                                | Active paths set contexts such as `thinkwork_thread`, `thinkwork_workspace_daily`, `thinkwork_requester_memory`, `explicit_remember`, and `import`                       | Healthy with gaps   | Normalize a source-context inventory and use it in tags/scopes and operator filters.                                                             |
| Set first-class `timestamp` when temporal context exists              | Dev `documents.retain_params` showed 0 documents with `timestamp`; many paths embed timestamps in content/metadata                                                       | Gap                 | Add Hindsight-native caller support for first-class temporal fields, starting with thread, daily, requester, and import paths.                   |
| Use tags for filtering/scope, not metadata filtering                  | MCP retain can pass tags through; most document paths do not use Hindsight tags; dev showed almost all memory units untagged                                             | Gap                 | Define a conservative tag taxonomy for source type, surface, and operator-safe scope.                                                            |
| Use `document_tags` for document-level grouping                       | Dev showed 0 documents with `document_tags`                                                                                                                              | Gap                 | Add document tags for stable source families such as thread, daily, requester, import, mobile, and activation.                                   |
| Use `observation_scopes` to control consolidation boundaries          | Dev showed 0 documents with `observation_scopes`; service-level observations mission is global                                                                           | Gap                 | Introduce scopes cautiously by source family and owner model.                                                                                    |
| Keep banks isolated; one bank per user is common                      | Active model uses `user_<userId>` banks; legacy bank fanout remains opt-in for reads                                                                                     | Healthy             | Continue per-user banks; do not introduce shared banks without strict tag/filter design.                                                         |
| Tune bank missions, reflect missions, dispositions, and entity labels | Dev service has a global observations mission; sampled banks inherit config and have no per-bank mission, reflect mission, dispositions, or entity labels                | Opportunity         | Add per-source/per-bank config only after choosing durable source taxonomy.                                                                      |
| Prefer observations as consolidated, evidence-backed beliefs          | Adapter ranks observations ahead of raw facts on equal score; runtime tool descriptions tell agents to prefer observations                                               | Healthy             | Preserve this, then expose proof/source data where operators need trust.                                                                         |
| Surface source facts when provenance matters                          | Live recall can return `source_fact_ids` and `source_facts`, but current normalized results do not consistently carry full evidence chains                               | Gap                 | Make Hindsight evidence chains first-class in memory APIs and expose them through Context Engine/detail surfaces where policy boundaries matter. |
| Use `reflect` for answer-like synthesis and recall for diagnostics    | Context Engine supports `recall` and `reflect`; Pi raw tools require recall followed by reflect                                                                          | Mostly healthy      | Pass optional reflect context through runtime provider and consider include-facts/schema support for evidence paths.                             |
| Use `query_timestamp` for temporal queries                            | Current recall/reflect callers do not expose query-time anchoring                                                                                                        | Gap                 | Add as Hindsight-specific request option where caller context has a known event time.                                                            |
| Use mental models and directives intentionally                        | Dev has 0 mental models and 0 directives                                                                                                                                 | Opportunity         | Start with operator-reviewed mental models before automation.                                                                                    |
| Use appropriate budgets and metrics                                   | Recall budgets are low/mid/adaptive; `/metrics` reachability still needs a repeatable check                                                                              | Partial             | Keep budget discipline; add the collector and an operator metrics story.                                                                         |

---

## Dev Evidence Snapshot

This section intentionally contains only aggregate and structural evidence.

- Hindsight ECS service was healthy in dev, with 1 desired and 1 running task.
- Health endpoint returned healthy service/database status.
- Service config observed in dev:
  - Bedrock LLM provider for retain/recall/reflect.
  - Reflect model uses a larger Bedrock model than retain/recall.
  - Local embeddings and reranker are configured.
  - Vector backend is pgvector; text search backend is native.
  - Recall budget function is adaptive.
  - Auto-consolidation is enabled.
  - Consolidation dedup threshold is `0.97`.
  - A service-level observations mission is configured.
- Corpus aggregate:
  - 14 banks.
  - 4,490 documents.
  - 17,332 memory units.
  - 12,790 entities.
  - 32,959 entity cooccurrences.
- Fact-type aggregate:
  - 8,089 observations.
  - 7,289 world facts.
  - 1,954 experiences.
- Observation evidence aggregate:
  - All 8,089 observations have proof counts and source memory IDs.
  - 7,960 observations have proof counts matching source-memory count.
  - 129 observations have proof/source count mismatch.
- Retain parameter aggregate:
  - 0 documents had first-class `timestamp`.
  - 0 documents had first-class `tags`.
  - 0 documents had first-class `document_tags`.
  - 0 documents had first-class `observation_scopes`.
- Foundation capability aggregate:
  - 0 mental models.
  - 0 directives.
  - Sampled banks inherit observation behavior but do not set per-bank retain mission, reflect mission, dispositions, or entity labels.
- Live recall shape:
  - Observation-only recall can return `source_fact_ids`.
  - Recall with `include.source_facts` can return a `source_facts` collection.

Reusable evidence collection now lives in
`packages/api/scripts/hindsight-memory-foundation-audit.ts` with redaction tests
in `packages/api/scripts/hindsight-memory-foundation-audit.test.ts`.

The collector is intentionally aggregate-only. It now reports:

- retain parameter coverage globally and by Hindsight document `context`;
- Space-bank document and memory-unit coverage, including Space observations
  with source-memory evidence;
- direct Brain bank posture for `user_*` and `space_*` Hindsight banks;
- observation evidence availability, proof/source match counts, mismatch counts,
  and missing source-memory identifiers;
- optional live recall evidence shape when
  `HINDSIGHT_AUDIT_RECALL_BANK_ID`/`--probe-bank` is supplied.

The optional live recall probe requests `include.source_facts` but records only
structural counts and top-level response keys. It must not persist returned
memory text, source fact bodies, chunks, or user-authored content.

---

## Write Path Inventory

| Path                             | Code                                                                                                                                                                                         | Current Hindsight shape                                                                                                                                                            | Assessment                                                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Post-turn conversation retain    | `packages/api/src/handlers/memory-retain.ts`, `packages/api/src/lib/memory/adapters/hindsight-adapter.ts`, `packages/agentcore-pi/agent-container/src/runtime/tools/memory-retain-client.ts` | Full merged transcript, one replaceable document per thread, `document_id=threadId`, `context=thinkwork_thread`, timestamps embedded in lines, metadata carries tenant/user/thread | Strong foundation. Add first-class `timestamp`, source tags, document tags, and observation scopes at the server-side Hindsight retain boundary.   |
| Legacy turn retain compatibility | `packages/api/src/lib/memory/adapters/hindsight-adapter.ts`                                                                                                                                  | Per-message items, `context=thread_turn`, metadata role/thread ID                                                                                                                  | Compatibility only. Keep as fallback; do not optimize future behavior around it.                                                                   |
| Daily memory                     | `packages/api/src/lib/memory/adapters/hindsight-adapter.ts`                                                                                                                                  | Stable document ID `workspace_daily:<userId>:<date>`, `context=thinkwork_workspace_daily`, date in metadata                                                                        | Healthy upsert shape. Add first-class timestamp/date and document tags.                                                                            |
| Requester thread digest          | `packages/api/src/lib/requester-memory/hindsight-primary.ts`                                                                                                                                 | Stable markdown document, `context=thinkwork_requester_thread_digest`, sync retain, evidence message IDs in metadata                                                               | Healthy source-document shape. Add document tags and a clear observation scope separate from full thread retain.                                   |
| Requester memory markdown        | `packages/api/src/lib/requester-memory/hindsight-sync.ts`                                                                                                                                    | Stable markdown document per memory file, `context=thinkwork_requester_memory`, async retain                                                                                       | Healthy source-document shape. Add document tags/scopes and consider retain mission for durable requester profile memory.                          |
| Mobile quick capture             | `packages/api/src/graphql/resolvers/memory/captureMobileMemory.mutation.ts`                                                                                                                  | `sourceType=explicit_remember`, fact type override for preference/experience/observation, captured timestamp in metadata                                                           | Good explicit capture path. Add first-class timestamp and tag support; keep user-posted observation distinct from engine-synthesized observations. |
| MCP user retain                  | `packages/api/src/handlers/mcp-user-memory.ts`                                                                                                                                               | `sourceType=explicit_remember`, async retain, caller tags in metadata are promoted by adapter to Hindsight tags                                                                    | Good tag-capable path. Needs tag taxonomy and parity with mobile capture.                                                                          |
| Activation/user memory seed      | `packages/api/src/lib/user-storage.ts`                                                                                                                                                       | `sourceType=explicit_remember`, layer metadata, `fact_type_override` values `preference` or `semantic`                                                                             | Gap. Adapter only honors `world`, `experience`, `opinion`, and `observation`, so these overrides silently fall back to `world`.                    |
| Journal/import reload            | `packages/api/src/lib/wiki/journal-import.ts`                                                                                                                                                | Direct adapter retain for historical notes, deterministic content, rich import metadata, terminal compile enqueue                                                                  | Useful import path. Add first-class timestamp from source row and tags/document tags for import provenance.                                        |

### Write Findings

- W1. Full-thread replaceable retain is the right default for Hindsight's full-content guidance.
- W2. Stable document IDs are already present on the highest-value document paths.
- W3. First-class temporal/tag/scope fields are the largest active-path gap.
- W4. Tags are possible today through MCP retain but not treated as a platform taxonomy.
- W5. Activation seeds have an immediate fact-type override mismatch that can be fixed independently of the broader field taxonomy.
- W6. Mobile user-posted `OBSERVATION` captures should not be treated as engine-synthesized observations for Cognee/Brain promotion; the existing observation promotion code already uses `source_memory_ids` for this reason.

---

## Read And Consumer Inventory

| Path                               | Code                                                                                                                                                         | Current Hindsight shape                                                                                       | Assessment                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hindsight memory recall client     | `packages/api/src/lib/memory/adapters/hindsight-adapter.ts`                                                                                                  | Calls `/memories/recall` with budget, max tokens, fact types, optional trace, and optional entity suppression | Healthy retrieval core. Promote query timestamp, tag filters, and evidence include options into first-class Hindsight memory request fields rather than generic adapter metadata.            |
| Hindsight memory reflect client    | `packages/api/src/lib/memory/adapters/hindsight-adapter.ts`                                                                                                  | Calls `/reflect`, maps answer into a synthetic memory hit with `based_on` IDs                                 | Useful synthesis path. Add include-facts/schema options for provenance-sensitive paths and stop flattening Hindsight reflection into a generic memory hit when callers need richer evidence. |
| Pi raw recall/reflect tools        | `packages/pi-extensions/src/memory.ts`, `packages/agentcore-pi/agent-container/src/runtime/providers/hindsight-memory-provider.ts`                           | Recall returns normalized memory items; reflect synthesizes; tool descriptions require recall then reflect    | Good agent-facing behavior. Runtime provider currently ignores optional reflect context.                                                                                                     |
| Proactive grounding recall         | `packages/pi-extensions/src/memory.ts`                                                                                                                       | Best-effort session-start recall injected as reference-only context                                           | Healthy. Keep bounded timeout and reference-only wording.                                                                                                                                    |
| Context Engine memory provider     | `packages/api/src/lib/context-engine/providers/memory.ts`, `packages/pi-extensions/src/context-engine.ts`, `packages/api/src/handlers/mcp-context-engine.ts` | Supports recall/reflect strategy, provider-local status, provenance metadata, optional wiki bridge            | Useful policy/routing boundary. It should carry Hindsight-rich memory results rather than flattening them to the smallest common provider shape.                                             |
| Admin memory search/list/detail    | `apps/web/src/components/memory/MemoryPanel.test.tsx`, `apps/web/src/routes/_authed/_shell/-memory.test.tsx`, GraphQL memory resolvers                       | Uses normalized inspect/search records and graph views                                                        | Needs source-fact and retain-parameter visibility for operator trust.                                                                                                                        |
| MCP user memory recall             | `packages/api/src/handlers/mcp-user-memory.ts`                                                                                                               | Returns memory recall plus optional Wiki results for `wiki:read` scope                                        | Useful external path. Preserve memory/wiki separation and avoid dumping source facts by default.                                                                                             |
| Wiki compile                       | `packages/api/src/handlers/wiki-compile.ts`, `packages/api/src/lib/wiki/*`                                                                                   | Consumes normalized/Hindsight memory records through cursor-driven compile paths                              | Downstream consumer. Needs source evidence links to remain inspectable.                                                                                                                      |
| Cognee/Brain observation promotion | `packages/api/src/lib/knowledge-graph/observations-source.ts`                                                                                                | Reads engine observations with populated `source_memory_ids`, gates before promotion                          | Good safety posture. Continue requiring synthesis provenance rather than `fact_type=observation` alone.                                                                                      |
| Ontology suggestions               | `packages/api/src/lib/ontology/suggestions.ts`                                                                                                               | Converts memory records into suggestion evidence with backend/fact/context metadata                           | Useful consumer. Could benefit from richer source-fact provenance.                                                                                                                           |

### Read Findings

- R1. Recall and reflect budgets are intentionally bounded and should remain so.
- R2. Context Engine is the right policy/routing abstraction for multi-source context, not the canonical model for retained memory itself.
- R3. Hindsight-native tools and APIs should become first-class for memory foundation work; Context Engine should expose or route them with policy, not obscure them.
- R4. Source-fact evidence exists in Hindsight but is not yet a first-class evidence chain through memory APIs, admin, Context Engine detail, Wiki, or Cognee promotion surfaces.
- R5. Optional reflect context is accepted by the Pi extension but not sent by the current runtime Hindsight provider.
- R6. Temporal query anchoring is not exposed through `query_timestamp`.

---

## Bank Configuration And Foundation Capabilities

| Capability                         | Current dev posture                                                  | Recommendation                                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Service-level observations mission | Configured and active                                                | Keep as conservative default.                                                                                             |
| Auto-consolidation                 | Enabled                                                              | Keep enabled; monitor async failures and proof/source mismatch count.                                                     |
| Dedup threshold                    | `0.97`                                                               | Keep until recall quality or duplicate observation metrics justify tuning.                                                |
| Per-bank retain mission            | Not set in sampled banks                                             | Consider after source taxonomy is defined; avoid premature per-user variation.                                            |
| Per-bank reflect mission           | Not set in sampled banks                                             | Add for answer-like memory synthesis once reflect surfaces are clearer.                                                   |
| Dispositions                       | Not customized in sampled banks                                      | Treat as medium-term tuning; start with defaults.                                                                         |
| Entity labels                      | Not set in sampled banks                                             | Candidate for substrate quality and Wiki/Cognee alignment, but needs product vocabulary review.                           |
| Mental models                      | 0 in dev                                                             | Start with operator-reviewed models: user profile, active projects, communication preferences, and technical preferences. |
| Directives                         | 0 in dev                                                             | Use sparingly for bank/source behavior that should outlive a single prompt.                                               |
| Metrics                            | Health endpoint confirmed; metrics reachability still not repeatable | Add `/metrics` or log-based checks to the evidence collector follow-up if network posture blocks direct metrics.          |

---

## Architecture Boundary

The audit updates the memory-foundation thesis:

- Hindsight is the canonical retained-memory substrate for hosted Thinkwork.
- Thinkwork should embrace Hindsight-native concepts as product/platform concepts where they are central to memory quality: observations, source facts, retain params, tags, document tags, observation scopes, bank missions, reflect missions, mental models, directives, and entity labels.
- Context Engine remains valuable as a governed routing, policy, and operator-verification surface across Memory, Wiki, Brain/Cognee, workspace files, knowledge bases, and MCP context tools.
- Context Engine should carry Hindsight-rich memory results when the provider is Hindsight. It should not flatten Hindsight into a generic memory-hit model that erases the foundation's best primitives.
- Company Brain/Cognee remains the governed tenant-shared business/domain substrate.
- Wiki remains a compiled, reviewable projection over retained memory and other source families.
- Raw Cognee, Neptune, and S3 internals should not become ordinary runtime/product APIs. Hindsight is different: it is the chosen memory substrate, so its memory-domain concepts should be first-class even if the HTTP/database internals remain encapsulated.

This means Hindsight-specific improvements should enter through:

- a Hindsight-native memory foundation module/API that is allowed to model Hindsight concepts directly;
- Context Engine provider metadata/detail surfaces when memory participates in multi-source routing;
- explicit operator tooling for Hindsight-native inspection, tuning, and evidence traversal.

---

## Prioritized Roadmap

### Near-Term Hardening

| ID    | Item                                                                                                           | Layer                                                                 | Benefit                                                                          | Acceptance check                                                                                                                                                             |
| ----- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HIN-1 | Add first-class `timestamp`, `tags`, `document_tags`, and `observation_scopes` support for active retain paths | Hindsight memory foundation module and server-side callers            | Better Hindsight extraction, filtering, temporal recall, and consolidation scope | Tests prove thread, daily, requester, mobile, MCP, and import paths produce the intended Hindsight retain params without trusting runtime clients with raw service payloads. |
| HIN-2 | Fix activation seed fact-type overrides                                                                        | `packages/api/src/lib/user-storage.ts`                                | Friction/preference seeds stop silently falling back to `world`                  | Unit test proves legal Hindsight overrides are used and invalid overrides degrade intentionally.                                                                             |
| HIN-3 | Add source-fact evidence envelope to Hindsight recall/reflect results                                          | Hindsight memory foundation module and Context Engine memory provider | Operators and downstream consumers can trace observation-derived claims          | Tests prove source IDs are preserved without exposing raw source text by default.                                                                                            |
| HIN-4 | Pass optional reflect context and query timestamp through Hindsight provider paths                             | Pi runtime provider and Hindsight memory request options              | Better temporal and turn-focused memory synthesis                                | Provider tests prove context/query-time fields are sent only when supplied.                                                                                                  |
| HIN-5 | Keep the aggregate evidence collector runnable and documented                                                  | `packages/api/scripts/hindsight-memory-foundation-audit.ts`           | Repeatable regression evidence for future memory work                            | Fixture tests stay green; dev run emits only aggregate/structural data.                                                                                                      |

### Medium-Term Foundation Upgrades

| ID     | Item                                                            | Layer                                                       | Benefit                                                                    | Acceptance check                                                                                          |
| ------ | --------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| HIN-6  | Define source tag, document tag, and observation-scope taxonomy | Hindsight memory foundation module, docs, operator docs     | Consistent filtering and consolidation behavior                            | Design doc maps each write path to tags/scopes and identifies non-goals.                                  |
| HIN-7  | Add per-bank/source missions and reflect missions               | Hindsight bank config path                                  | More intentional observation and synthesis behavior                        | Bank config tests prove defaults are inherited and configured overrides are lazy/nonblocking.             |
| HIN-8  | Introduce operator-reviewed mental models                       | Hindsight mental models plus admin/operator workflow        | Reflect can use durable, higher-level user/project models before raw facts | Smoke check proves a saved mental model is visible in reflect behavior without raw content leakage.       |
| HIN-9  | Add operator evidence chain surfaces                            | Admin Memory, Context Engine detail, Wiki/Cognee provenance | Memory-derived claims become auditable                                     | Admin/source detail can show observation ID, source IDs, and redacted source metadata.                    |
| HIN-10 | Add metrics/dashboard posture                                   | Hindsight service, logs, or Thinkwork collector             | Operators can detect consolidation stalls and quality drift                | Dashboard or smoke output shows operation state, proof coverage, tag coverage, and retain-param coverage. |

### Deferred Bets

- Production aggregate dashboarding after the dev collector shape is stable.
- Broad corpus backfills after active-path retain params are deployed and validated.
- Shared-bank or tenant-wide Hindsight designs, which require strict tag filtering and product review.
- Automated mental model refresh policies.
- Aggressive entity-label tuning for Wiki/Cognee until the business ontology vocabulary is stable.

---

## Acceptance Checks For Follow-Up Work

| Check                                                                                                                      | Type                    | Covers            |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------- |
| Thread retain emits stable document ID, full content, first-class timestamp, document tags, and observation scope          | Unit/integration test   | AE1, W1, HIN-1    |
| Mobile and MCP explicit memories route tags consistently and reject/normalize malformed scope metadata                     | Unit test               | AE1, HIN-1, HIN-6 |
| Activation seeds use legal Hindsight fact-type overrides                                                                   | Unit test               | W5, HIN-2         |
| Evidence collector emits aggregate counts and omits raw content fields                                                     | Unit test and dev smoke | AE2, HIN-5        |
| Evidence collector reports retain parameter coverage by source context and Space bank                                      | Unit test and dev smoke | AE1, AE2, R11     |
| Evidence collector reports direct `user_*` and `space_*` Brain bank posture                                                | Unit test and dev smoke | R6, R11           |
| Optional recall probe confirms source-fact fetch shape without persisting source text                                      | Env-gated smoke         | AE2, AE4, HIN-3   |
| Observation recall with source facts preserves source IDs in normalized metadata while omitting raw source text by default | Unit test               | AE4, HIN-3        |
| Context Engine memory provider reports Hindsight strategy, provider-local status, and evidence metadata                    | Unit/integration test   | R2, HIN-3, HIN-9  |
| Reflect provider passes optional context and query timestamp where supported                                               | Unit test               | R5, R6, HIN-4     |
| Bank config override failures cool down and do not block retains unless explicitly required                                | Unit test               | HIN-7             |
| Operator detail view can trace a memory-derived Wiki/Cognee claim to Hindsight observation/source identifiers              | Admin verification      | AE4, HIN-9        |
| Metrics or smoke output reports operation health, proof coverage, tag coverage, and retain-param coverage                  | Operational check       | R15, HIN-10       |

---

## Follow-Up Plan Seeds

The strongest next implementation plan is `feat: Harden Hindsight retain and evidence fields`, containing HIN-1 through HIN-4. HIN-2 can be a small first patch or folded into that plan because it is a concrete correctness issue. HIN-6 should happen before broad backfills or per-bank mission work so the platform does not cement ad hoc tags and scopes.

HIN-8 through HIN-10 should wait until the first hardening patch proves better retain/evidence data is flowing.

---

## Source References

- `docs/brainstorms/2026-06-27-hindsight-memory-foundation-audit-requirements.md`
- `docs/plans/2026-06-27-001-feat-hindsight-memory-foundation-audit-plan.md`
- Hindsight docs skill: best practices, Retain API, Recall API, Reflect API, Memory Banks, Observations, Mental Models, Configuration, Performance, and FAQ.
- `packages/api/src/lib/memory/adapters/hindsight-adapter.ts`
- `packages/api/src/handlers/memory-retain.ts`
- `packages/agentcore-pi/agent-container/src/runtime/tools/memory-retain-client.ts`
- `packages/agentcore-pi/agent-container/src/runtime/providers/hindsight-memory-provider.ts`
- `packages/pi-extensions/src/memory.ts`
- `packages/pi-extensions/src/context-engine.ts`
- `packages/api/src/lib/context-engine/providers/memory.ts`
- `packages/api/src/handlers/mcp-context-engine.ts`
- `packages/api/src/handlers/mcp-user-memory.ts`
- `packages/api/src/graphql/resolvers/memory/captureMobileMemory.mutation.ts`
- `packages/api/src/lib/requester-memory/hindsight-primary.ts`
- `packages/api/src/lib/requester-memory/hindsight-sync.ts`
- `packages/api/src/lib/wiki/journal-import.ts`
- `packages/api/src/lib/user-storage.ts`
- `packages/api/src/lib/knowledge-graph/observations-source.ts`
- `packages/api/src/lib/ontology/suggestions.ts`
- `docs/src/content/docs/concepts/knowledge/memory.mdx`
- `docs/src/content/docs/api/context-engine.mdx`
- `docs/solutions/best-practices/context-engine-adapters-operator-verification-2026-04-29.md`
- `docs/solutions/architecture-patterns/company-brain-active-substrate-reads-through-context-engine-2026-06-15.md`
- `docs/solutions/runtime-errors/lambda-web-adapter-in-flight-promise-lifecycle-2026-05-06.md`

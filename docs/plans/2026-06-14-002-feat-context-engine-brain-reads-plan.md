---
title: "feat: Context Engine Company Brain reads"
type: feat
status: completed
date: 2026-06-14
linear: THNK-20
---

# feat: Context Engine Company Brain reads

## Overview

THNK-20 delivers the U5a dogfood proof for Company Brain: first-party agents can call `query_brain_context` through Context Engine, read the active/default Company Brain substrate, receive bounded source data with cited provenance, and avoid falling back to less-governed memory paths when required Brain capabilities are unavailable.

This is not the full migration-aware U5. Production migration/cutover, external Brain MCP registration, external token lifecycle, and broad egress controls remain follow-up work after the active-backend retrieval proof lands.

---

## Problem Frame

The existing MCP handler already exposes `query_brain_context`, but the route currently selects the generic `brain` provider family rather than binding retrieval to the Company Brain substrate state and artifact/provenance contracts from THNK-17 and THNK-19. The dogfood proof needs Context Engine to be the policy boundary: first-party agents should not call Cognee, Neptune, or S3 directly, and retrieved content should be treated as untrusted source material rather than instructions.

---

## Requirements Trace

- R1. `query_brain_context` returns Company Brain context with cited provenance for first-party callers.
- R2. Reads use active/default/current substrate state and do not require production migration.
- R3. Provenance distinguishes graph retrieval, vault projection, source artifacts, and fallback/disabled provider posture.
- R4. Retrieved Brain content is explicitly bounded as untrusted source data and cannot override system/developer/tool policy.
- R5. Disabled/degraded Cognee capabilities produce explicit Context Engine provider status rather than silent fallback.
- R6. Cognee recall/search options for the proof are represented as provider options or metadata: source/dataset scoping, NodeSet/source filters where available, top-k/depth, and only-context behavior.
- R7. A dogfood smoke fixture demonstrates better Company Brain retrieval than the memory-only path for one named workflow.

---

## Scope Boundaries

- No direct Cognee, Neptune, or S3 access from first-party agent runtime callers; all reads stay behind Context Engine.
- No migration-aware U5b routing, replay validation, production cutover, or rollback behavior.
- No external Brain MCP registration, customer token lifecycle, or external egress-control launch.
- No raw Cognee write/delete tools or Brain write-back behavior.
- No customer-facing Cognee branding; Cognee may appear only as internal provider/status evidence.

### Deferred to Follow-Up Work

- Migration-aware active-vs-shadow read routing: THNK-6 U5b after U4 migration orchestration.
- External Brain MCP profile activation, revocation, quotas, and egress controls: later THNK-6 slice.
- Rich operations UI around retrieval health: THNK-6 U6.

---

## Context & Research

### Relevant Code and Patterns

- `packages/api/src/handlers/mcp-context-engine.ts` already exposes `query_brain_context` as a Context Engine MCP tool and formats structured responses.
- `packages/api/src/lib/context-engine/providers/index.ts` builds tenant-specific provider descriptors and applies tenant provider settings.
- `packages/api/src/lib/context-engine/router.ts` handles provider selection, provider-local statuses, ranking, and answer synthesis.
- `packages/api/src/lib/context-engine/providers/wiki.ts` is the closest provider shape for tenant-owned context retrieval from internal persistence.
- `packages/api/src/graphql/resolvers/brain/companyBrainStatus.query.ts` projects THNK-17 substrate status and redacts operator evidence from tenant callers.
- `packages/database-pg/src/schema/brain.ts` defines `brain.substrate_states` and `brain.artifact_manifests`.
- `packages/api/src/lib/knowledge-graph/artifacts.ts` writes THNK-19 canonical Brain artifact manifests and redacts raw S3/source identifiers.

### Institutional Learnings

- `docs/solutions/best-practices/context-engine-adapters-operator-verification-2026-04-29.md`: provider failures should be local statuses, not whole-query failures.
- `docs/solutions/best-practices/cognee-thread-ingest-explorer-2026-06-04.md`: Cognee validation should use ThinkWork GraphQL/Context Engine paths rather than direct private backend access.
- `docs/solutions/design-patterns/replay-recorded-agent-conversations-write-safe.md`: fixtures should prove untrusted retrieved text cannot become instructions.

### Linear Sources

- THNK-20 issue and comment context.
- THNK-6 parent plan and comments, including the product evidence gate and Company Brain branding rule.
- THNK-17 merged substrate contract and status doc.
- THNK-19 merged artifact manifest contract and status doc.
- THNK-15 completed plugin-shell plan/brainstorm, including the Cognee-as-internal-component rule.

---

## Key Technical Decisions

- Add a concrete Company Brain Context Engine provider rather than changing MCP callers to use raw GraphQL, Cognee, S3, or Neptune. Context Engine remains the policy facade.
- Read substrate state directly in the provider so `query_brain_context` can report explicit disabled/degraded provider status before retrieval.
- Use the existing tenant Brain pages as the active/default graph-shaped retrieval surface for U5a, enriched with substrate and artifact manifest provenance. This satisfies active/default dogfood proof without waiting for migration-aware production graph routing.
- Wrap every Brain hit as untrusted source data in metadata/provenance and in the human-readable MCP text. The answer synthesizer should preserve citations and avoid presenting snippets as instructions.
- Represent disabled Cognee capabilities as provider-local `skipped`/`stale`/`error` statuses with metadata, not as silent fallback to memory/wiki providers.

---

## Open Questions

### Resolved During Planning

- THNK-17, THNK-19, and THNK-15 blockers are complete on Linear and merged into `origin/main`.
- THNK-20 has no child issues; implement as one cohesive PR.
- U5a can use active/default substrate and existing Brain pages/artifact manifests; production migration is out of scope.

### Deferred to Implementation

- Exact metadata field names for bounded source wrappers should follow the existing `ContextHit.metadata` and provenance conventions once tests pin the shape.
- Exact dogfood workflow fixture can be synthetic/local unless deployed AWS credentials are available for a live smoke.

---

## Implementation Units

- U1. **Add Company Brain provider substrate gate**

**Goal:** Add a real `brain` Context Engine provider that reads `brain.substrate_states` for the caller's tenant, checks required launch retrieval/provenance capability posture, and reports explicit provider status when Brain is not installed, disabled, degraded, or missing required capabilities.

**Requirements:** R1, R2, R5, R6

**Dependencies:** THNK-17 merged

**Files:**

- Create: `packages/api/src/lib/context-engine/providers/company-brain.ts`
- Modify: `packages/api/src/lib/context-engine/providers/index.ts`
- Test: `packages/api/src/lib/context-engine/providers/company-brain.test.ts`

**Approach:**

- Follow provider descriptor patterns from `wiki.ts`.
- Inject database/search dependencies for tests.
- Treat `active_backend` values `default`, `production`, and `legacy_cognee` as provider metadata but only use direct local Brain-page retrieval for U5a.
- Required launch capabilities for this slice are retrieval/provenance. If disabled, return an explicit status and no hits.

**Test scenarios:**

- Happy path: ready default substrate with retrieval/provenance enabled returns hits and status metadata.
- Error path: no substrate or disabled substrate returns provider status explaining why no direct Brain retrieval ran.
- Error path: retrieval capability disabled returns explicit skipped status and does not fall back to memory/wiki.

**Verification:**

- `query_brain_context` selects a provider that can report active substrate posture independently of Memory.

- U2. **Return bounded Brain provenance**

**Goal:** Return hits from active Brain pages with provenance that distinguishes graph retrieval, vault projection, and source artifacts using THNK-19 artifact manifest summaries where available.

**Requirements:** R1, R3, R4, R6

**Dependencies:** U1, THNK-19 merged

**Files:**

- Modify: `packages/api/src/lib/context-engine/providers/company-brain.ts`
- Test: `packages/api/src/lib/context-engine/providers/company-brain.test.ts`

**Approach:**

- Query active `brain.pages` through existing Brain/search tables or a small provider-local search query.
- Join or separately load recent active `brain.artifact_manifests` for the tenant and include redacted manifest kinds/source hashes/root categories in metadata, not raw S3 keys.
- Mark source content with `instructionBoundary: "untrusted_source_data"` and `retrievalSurface: "company_brain_active_backend"`.

**Test scenarios:**

- Happy path: graph/page hit includes provenance metadata with `retrievalKind: "graph"`.
- Happy path: vault projection manifests add `retrievalKind: "vault_projection"` or related projection metadata without raw S3 keys.
- Error path: source artifact provenance includes redacted hash/manifest kind but no raw source ids or S3 object keys.

**Verification:**

- Structured Context Engine responses can cite where Brain context came from without exposing backend storage details.

- U3. **Harden MCP/answer formatting against prompt injection**

**Goal:** Ensure MCP text and answer synthesis keep retrieved Brain content bounded as citations/source snippets, including malicious text fixtures.

**Requirements:** R1, R4, R5

**Dependencies:** U1, U2

**Files:**

- Modify: `packages/api/src/handlers/mcp-context-engine.ts`
- Modify: `packages/api/src/lib/context-engine/synthesis.ts`
- Test: `packages/api/src/handlers/mcp-context-engine.requester-context.test.ts` or new `packages/api/src/handlers/mcp-context-engine.brain.test.ts`
- Test: `packages/api/src/lib/context-engine/__tests__/service.test.ts`

**Approach:**

- Preserve existing simple answer synthesis but add source-boundary wording/metadata for Brain hits.
- Do not execute or reinterpret retrieved text as policy.
- Test with fixture text such as "ignore previous instructions" and assert it appears only inside bounded source output.

**Test scenarios:**

- Prompt-injection fixture is returned as quoted/bounded source data and does not change tool/provider selection.
- Answer mode cites hit ids and includes the source-boundary marker for Brain hits.
- Provider status for disabled Brain remains visible in MCP text.

**Verification:**

- First-party MCP path returns safe text plus structured metadata for malicious retrieved content.

- U4. **Record dogfood smoke and docs**

**Goal:** Add a lightweight smoke fixture/documentation that demonstrates one named workflow where Company Brain context beats memory-only retrieval.

**Requirements:** R1, R3, R7

**Dependencies:** U1-U3

**Files:**

- Create: `scripts/smoke/company-brain-context-engine-smoke.mjs`
- Modify: `docs/src/content/docs/api/context-engine.mdx`
- Modify: `docs/plans/autopilot/THNK-20-status.md`

**Approach:**

- Keep the smoke script deploy-safe: require explicit stage/API config and avoid production mutation commands.
- For local/unit verification, use seeded/synthetic Context Engine responses showing Brain-provenance answer vs memory-only miss.
- Update docs to describe `query_brain_context` as Context Engine-governed active substrate access.

**Test scenarios:**

- Smoke script validates that Brain providers return cited provenance and memory-only path lacks the named workflow context when configured.
- Docs mention Company Brain/Context Engine boundary and avoid customer-facing Cognee language.

**Verification:**

- Local targeted tests pass; smoke is runnable with deployed stage credentials but does not mutate production.

---

## System-Wide Impact

- **Interaction graph:** first-party MCP tool call -> Context Engine service -> Company Brain provider -> Brain substrate/page/artifact tables -> MCP structured/text response.
- **Error propagation:** provider readiness/capability failures become provider-local statuses; request-level errors remain reserved for auth/validation failures.
- **State lifecycle risks:** retrieval is read-only; no Brain substrate, artifact, or deployment rows should be mutated.
- **API surface parity:** `query_brain_context` remains a split tool backed by Context Engine; generic `query_context` can still select `brain` by family.
- **Integration coverage:** tests should exercise direct service query and MCP tool-call formatting.
- **Unchanged invariants:** no external Brain MCP profile activation, no raw Cognee/Neptune/S3 access, and no migration cutover routing.

---

## Risks & Dependencies

| Risk                                                    | Mitigation                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Disabled capability silently falls back to memory       | The provider returns explicit status and no hits for Brain-only calls.                          |
| Retrieved source text acts like instructions            | Add source-boundary metadata/text and prompt-injection fixtures.                                |
| Provenance leaks S3/source ids                          | Use redacted manifest fields and tests that assert raw keys/source ids are absent.              |
| U5a overreaches into migration-aware production routing | Limit implementation to active/default/current substrate posture and document U5b as follow-up. |
| Dogfood smoke needs deployed AWS credentials            | Keep local tests authoritative and make live smoke opt-in/config-driven.                        |

---

## Documentation / Operational Notes

- Update Context Engine docs to clarify Company Brain is the product/source and Context Engine is the runtime policy layer.
- Record PRs, CI, decisions, and Linear transitions in `docs/plans/autopilot/THNK-20-status.md`.

---

## Sources & References

- Linear issue: THNK-20
- Parent issue/docs: THNK-6, "Implementation plan: Company Brain physical substrate", "Company Brain physical substrate requirements"
- Dependencies: THNK-15, THNK-17, THNK-19
- Related code: `packages/api/src/handlers/mcp-context-engine.ts`
- Related code: `packages/api/src/lib/context-engine/`
- Related code: `packages/database-pg/src/schema/brain.ts`
- Related code: `packages/api/src/lib/knowledge-graph/artifacts.ts`

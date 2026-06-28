---
date: 2026-06-27
topic: hindsight-memory-foundation-audit
---

# Hindsight Memory Foundation Audit

## Problem Frame

Thinkwork already uses Hindsight as the richer retained-memory engine, but the platform needs a focused review to ensure Hindsight is being used as a durable memory foundation rather than merely as a recall endpoint. The review should be grounded in Hindsight's documented best practices for retain, recall, reflect, observations, bank configuration, mental models, tags/scopes, and operations, then verified against dev evidence.

The audit should optimize for a balanced foundation:

- agent answers are grounded and useful during turns;
- Hindsight produces clean observations and evidence chains for downstream Wiki/Cognee;
- operators can inspect, tune, backfill, and prove memory quality.

Initial code and dev evidence shows the current implementation is substantially beyond the old "vector store only" critique: dev Hindsight has 17,332 memory units, including 8,089 observations; auto-consolidation is enabled; per-bank effective config enables observations; and observation-only recall returns `source_fact_ids` plus retrievable source facts. The remaining opportunity is to make the foundation more intentional, observable, and complete across all write/read paths.

---

## Actors

- A1. End user: relies on memory-backed agents to carry context across threads without stale or noisy personalization.
- A2. Thinkwork agent runtime: writes post-turn memory and reads Hindsight through recall/reflect/context tools.
- A3. Operator/admin: inspects memory quality, source routing, graph posture, backfills, and configuration.
- A4. Memory platform engineer: tunes Hindsight integration, validates Hindsight-doc compliance, and plans changes.
- A5. Downstream memory consumers: Wiki, Company Brain/Cognee, Context Engine, mobile/web memory surfaces, and MCP memory clients.

---

## Key Flows

- F1. Best-practice audit
  - **Trigger:** A memory-foundation review begins.
  - **Actors:** A4.
  - **Steps:** Compare each Thinkwork retain/read/config path against Hindsight docs for content format, context, document IDs, timestamps, tags/scopes, observation configuration, reflect behavior, mental models, and operational practices.
  - **Outcome:** Each gap is classified as already healthy, improvement candidate, deliberate non-goal, or needs live evidence.
  - **Covered by:** R1, R2, R3.

- F2. Dev evidence pass
  - **Trigger:** Code/config review makes a claim about live Hindsight behavior.
  - **Actors:** A4, A3.
  - **Steps:** Inspect dev Hindsight service health, service config, sampled bank config, aggregate corpus shape, operation state, observation/source-fact availability, and write-path metadata without exposing sensitive memory content.
  - **Outcome:** The audit distinguishes code intent from live behavior and records evidence as aggregate counts or redacted structural samples.
  - **Covered by:** R4, R5, R6.

- F3. Memory-quality roadmap
  - **Trigger:** Audit findings are synthesized.
  - **Actors:** A3, A4, A5.
  - **Steps:** Group findings by agent-answer quality, substrate quality, and operational control; propose changes that compound across multiple consumers before narrow surface tweaks.
  - **Outcome:** Planning receives a prioritized roadmap that can be implemented incrementally without re-litigating Hindsight's role.
  - **Covered by:** R7, R8, R9, R10.

---

## Requirements

**Audit Baseline**

- R1. The audit MUST use Hindsight docs as the normative baseline, especially best practices for missions, retain content shape, `context`, `document_id`, `timestamp`, tags, observation scopes, recall/reflect selection, mental models, and anti-patterns.
- R2. The audit MUST enumerate every live Thinkwork Hindsight write path: post-turn thread retain, legacy turn retain compatibility, daily memory, requester memory documents, requester thread digests, mobile quick capture, MCP `retain`, activation/user seeds, and journal/import reloads.
- R3. The audit MUST enumerate every live Hindsight read/consumer path: Pi recall/reflect tools, proactive grounding recall, Context Engine memory provider, admin/mobile search/list/detail surfaces, memory graph, MCP recall, Wiki compile, ontology suggestions, and Cognee observation promotion.

**Live Evidence**

- R4. The audit MUST include dev evidence, limited to aggregate counts, structural response shapes, configuration state, status/health, and redacted samples; it MUST NOT paste raw user memory content into the document.
- R5. The audit MUST verify service-level Hindsight configuration in dev, including health, model/provider settings, vector/text search backend, auto-consolidation, and observation mission.
- R6. The audit MUST verify corpus shape in dev: bank count, memory unit count by fact type/context, observation proof/source coverage, tag/timestamp/document parameter usage, mental model/directive usage, and async operation health.

**Findings To Evaluate**

- R7. The audit MUST treat first-class Hindsight `timestamp`, tags, `document_tags`, and `observation_scopes` usage as an explicit review area. Initial dev evidence shows `documents.retain_params` has 0 documents with those parameters, even though Hindsight docs recommend them when context exists.
- R8. The audit MUST evaluate whether service-level observation configuration is sufficient or whether Thinkwork should add per-bank retain missions, reflect missions, dispositions, and entity labels. Initial dev evidence shows sampled banks inherit observation config but have no per-bank mission, reflect mission, entity labels, or customized dispositions.
- R9. The audit MUST evaluate Hindsight mental models and directives as unused foundation capabilities. Initial dev evidence shows 0 `mental_models` and 0 `directives` in dev despite Hindsight docs prioritizing mental models above observations during reflect.
- R10. The audit MUST evaluate whether Thinkwork surfaces Hindsight evidence chains well enough for operators and downstream systems. Initial dev evidence shows observation recall can return `source_fact_ids` and `source_facts`, but current product surfaces may not expose that full audit trail.

**Architecture Thesis**

- R11. The audit MUST restate Hindsight's intended role in the broader memory foundation: personal/episodic retained memory and observation formation, not the sole governed tenant business graph.
- R12. The audit MUST distinguish Hindsight Memory from Company Brain/Cognee and Wiki consumers: Hindsight remains the source of retained observations; Cognee/Brain governs tenant-shared entity/relationship knowledge; Wiki materializes reviewable projections.
- R13. The audit MUST evaluate what it means to commit to Hindsight as hosted Thinkwork's canonical retained-memory substrate. Recommendations should reduce lowest-common-denominator adapter friction and make Hindsight-native memory concepts first-class where they improve foundation quality.

**Output**

- R14. The audit output MUST include a prioritized roadmap with near-term hardening, medium-term foundation upgrades, and deferred bets.
- R15. The audit output MUST include acceptance checks that planning can turn into tests, smoke scripts, admin verification steps, or operational dashboards.

---

## Acceptance Examples

- AE1. **Covers R1, R7.** Given a Hindsight best-practice item such as "set `timestamp` whenever temporal context exists," when the audit reviews Thinkwork's retain paths, then it records whether Thinkwork sends the first-class Hindsight field, embeds the signal in content, or omits it entirely, and recommends a path based on Hindsight docs plus dev evidence.
- AE2. **Covers R4, R6.** Given dev Hindsight contains sensitive memory content, when the audit inspects corpus quality, then it reports aggregate evidence such as fact-type counts, context distribution, tag coverage, proof/source coverage, and operation state without copying memory text.
- AE3. **Covers R8, R9.** Given Hindsight supports bank missions, dispositions, entity labels, directives, and mental models, when the audit compares live dev banks, then it identifies which capabilities are unset by design versus untapped improvements and assigns them to the roadmap.
- AE4. **Covers R10, R15.** Given an observation recall can return source facts, when an operator investigates a memory-derived Wiki/Cognee claim, then the recommended foundation should make the supporting Hindsight evidence reachable through an auditable path.

---

## Success Criteria

- The review produces a concrete, Hindsight-doc-grounded roadmap for improving Thinkwork's memory foundation without planning needing to rediscover the code paths or live evidence.
- The roadmap balances agent answer quality, substrate quality, and operational control rather than over-optimizing a single surface.
- Dev evidence can be re-run or converted into smoke checks for future regressions.
- The output clearly separates already-healthy implementation areas from improvement candidates, so planning does not waste effort on solved problems.

---

## Scope Boundaries

- The audit does not replace Hindsight as the retained-memory substrate.
- The audit does not collapse Hindsight, Wiki, and Company Brain/Cognee into one undifferentiated store.
- The audit does not expose raw sensitive memory content in docs or final summaries.
- The audit does not implement code changes; it produces requirements and a planning-ready improvement roadmap.
- The audit does not require prod content inspection. Dev evidence is in scope; prod-safe aggregate metrics can be a later follow-up.
- The audit does not require removing every memory abstraction immediately; it should identify which abstractions remain useful as policy/routing boundaries and which ones are creating Hindsight friction.

---

## Key Decisions

- **Use a fresh audit doc rather than updating the June 9 Cognee-centric requirements.** The June 9 doc remains prior art, but this review focuses on Hindsight foundation quality across current implementation and live dev behavior.
- **Optimize for balanced foundation.** The review should cover agent answers, memory substrate, and operator control together.
- **Include dev evidence.** Code/config review alone is insufficient because Hindsight behavior depends on live service config, bank config, corpus state, and operation health.
- **Ground on Hindsight docs.** Findings should be framed as compliance, intentional divergence, or opportunity relative to Hindsight's documented model.

---

## Dependencies / Assumptions

- Dev evidence gathered so far:
  - Hindsight ECS service is healthy and connected to the database.
  - Hindsight task config sets Bedrock retain/reflect models, pgvector, native text search, local embeddings/reranker, adaptive recall budget, auto-consolidation, dedup threshold `0.97`, and an observations mission.
  - Dev has 14 Hindsight banks, 4,490 documents, 17,332 memory units, 12,790 entities, and 32,959 entity cooccurrences.
  - Memory unit fact types: 8,089 observations, 7,289 world facts, 1,954 experiences.
  - Context distribution is dominated by `import` and observations with null context: 8,089 observation units with null context, 7,042 import units, 1,583 `thinkwork_thread` units, 555 legacy `thread_turn` units.
  - All 8,089 observations have proof counts and source memory IDs; 7,960 observations have proof counts matching source-memory count and 129 do not.
  - 9,243 non-observation units are marked consolidated; 0 non-observation units have `consolidation_failed_at`.
  - `documents.retain_params` shows 0 documents with first-class `timestamp`, `tags`, `document_tags`, or `observation_scopes`.
  - `mental_models` and `directives` are both empty in dev.
  - Sampled bank config shows `enable_observations=true` and effective observations mission, but no per-bank retain mission, reflect mission, entity labels, or customized dispositions.
- Assumption: dev is representative enough to identify integration gaps, but not enough to prove production memory quality.
- Assumption: some dev banks/imports are historical or test data; planning should avoid overfitting remediation to old corpus artifacts without checking active paths.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R7][Technical] Should Thinkwork pass first-class Hindsight `timestamp` for thread/daily/requester/import documents, or is embedding timestamps in content sufficient for our query patterns?
- [Affects R7][Technical] Which tags and observation scopes should exist if banks remain per-user: source-type tags, user tags, team/tenant tags, topic tags, memory-shape entity labels, or custom observation scopes?
- [Affects R8][Product/technical] Should Hindsight bank missions/dispositions differ for personal agent memory, requester memory, imported journal memory, and business/domain memory, or should Thinkwork keep one conservative global mission?
- [Affects R9][Product/technical] Which mental models are worth creating first: user profile, current projects, communication style, technical preferences, active commitments, or operator-reviewed summaries?
- [Affects R10][Technical] Which product surfaces should expose source-fact evidence chains: admin memory detail, Context Engine source detail, Wiki page provenance, Cognee promotion evidence, or all of them progressively?
- [Affects R15][Needs research] Which Hindsight metrics are available from the deployed `/metrics` endpoint or logs, and which additional Thinkwork-side metrics are needed for operator dashboards?

---

## Next Steps

-> `/ce-plan` for structured implementation planning of the audit and improvement roadmap.

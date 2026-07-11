---
title: Hindsight mental-models spike verdict — Tenant Bank pilot gate (THINK-261 #4)
problem_type: tooling_decision
module: memory
tags:
  [
    hindsight,
    mental-models,
    tenant-bank,
    governed-promotion,
    consolidation,
    think-261,
  ]
severity: high
---

# Hindsight mental-models spike verdict (THINK-261 #4)

**Gate decision: PASS (provisional — content-quality confirmation by product owner pending).** All five checks from the company-brain plan's R4 produced positive evidence on dev against the pinned image 0.8.4. This is the gate for Phase 2 (Tenant Bank pilot, U9–U11) of `docs/plans/2026-07-11-001-feat-hindsight-company-brain-foundation-plan.md`.

## Setup (2026-07-11, thinkwork-dev, dedicated `thinkwork_hindsight` DB)

- Scratch bank `tenant_5b65edd8-951b-45c8-bf91-7b33f385dd07` created with a `banks` registry row (name + mission) cloned from the source space bank's disposition/config.
- 12 real space-bank memories (`space_958bb3f6…`, world/experience types) promoted as **verbatim copies via direct `memory_units` INSERT…SELECT** (embeddings included), each carrying provenance metadata `{sourceBankId, sourceMemoryId, sourceTimestamp, promotedBy, promotedAt, justification}` and original `created_at` — the KTD-6 promotion mechanism, rehearsed end-to-end. 9 parent `documents` rows copied first (the `memory_units_document_fkey` is bank-scoped).
- 3 `pinned` mental models inserted with distinct triggers: cron-only (`*/10`), `refresh_after_consolidation`, and both combined.
- Consolidation and refresh left entirely to the **vendor's native maintenance loop** (functional since the THINK-220 dedicated-DB cutover — the loop that was silently dead on the shared schema).

## The five R4 checks

1. **Content quality vs stub pages — PASS (pending product-owner read).** Within ~7 minutes the engine produced structured markdown syntheses: `topic-summary` (2,637 chars) enumerated the actual deal pipeline (six named deals, values, win rates, conversion metrics) **with inline citations to source unit ids** (`【35bf672c…】`); `risks-concerns` (1,288 chars) produced observation+implication analysis of real pipeline risks. Categorically better than the wiki's "X is tracked in the tenant knowledge graph" fallback stubs, and the citations make the distillation provenance-preserving.
2. **Tenant-bank mechanics rehearsal — PASS.** Bank creation (registry row required — banks are NOT purely implicit when mental models are involved: `fk_mental_models_bank_id`), promotion with provenance, consolidation, and recall-shaped readback all worked against a `tenant_`-prefixed bank id. New adapter learnings for U9/U10: `mental_models.subtype` is CHECK-constrained to `structural|emergent|pinned|learned`; `content` is NOT NULL; documents must be copied with their units.
3. **Provenance survival through consolidation — PASS.** After full consolidation (12/12 units `consolidated_at` set, bank `last_consolidated_at` stamped): 12/12 provenance metadata objects intact, and all 26 engine-derived observations carry `source_memory_ids` lineage back to the promoted copies — provenance chains extend through the derived layer by id-join.
4. **Copy fidelity — PASS.** 12/12 copies byte-identical to their sources both at insert and **after** consolidation; original timestamps preserved 12/12. Consolidation synthesizes new observation rows; it does not rewrite or split raw units. The (sourceBankId, sourceMemoryId) idempotency key design in U10 holds.
5. **Upstream bug probes (#2501, #2453) — NO REPRODUCTION at this scale.** Zero `consolidation_failed_at` across the bank through full consolidation (passive #2453 probe). Mental-model growth across refresh cycles: see cycle-2 measurements below (#2501 delta-refresh probe). Caveat: 12-unit bank + one real-bank dream run is still far below the 18k-unit estate; both bugs remain open upstream and the pilot should keep the probe running (watch `consolidation_failed_at` and mental-model content length on the real tenant bank).

## Cycle-2 refresh measurements (#2501 probe)

- No second refresh occurred within 12+ minutes of the first (`topic-summary` 2,637 chars and `risks-concerns` 1,288 chars unchanged; `last_refreshed_at` static). The SQL-created `{"cron": "*/10 * * * *"}` trigger shape never drove a periodic refresh — `entity-overview` (cron-only) was stamped once pre-consolidation and never regenerated. **`refresh_after_consolidation` is the demonstrated, reliable trigger; cron registration appears to live in the API layer**, so cron-driven refresh must be validated when the pilot creates models through the HTTP API.
- Consequence for #2501 (unbounded delta-refresh growth): not reproducible in this setup — zero repeated refreshes means zero growth observed. The probe stays open for the pilot: watch mental-model content length across refreshes on the real Tenant Bank.
- Pilot guidance: always set `refresh_after_consolidation: true`; treat cron as a supplement to be verified via the API path.

## Caveats

- **Creation-via-HTTP-API untested from this session.** The vendor API endpoint is a VPC-internal ELB; models were created by direct SQL matching the vendor schema. Engine-side generation (the load-bearing question) is exercised identically, but U10/pilot code that creates mental models through the HTTP API should smoke-test that path from inside the VPC.
- Content quality judged by the implementing agent against the audit's stub pages; product-owner confirmation is the final word on the PASS.
- Retain-time extraction behavior (posted items rewritten by the vendor's LLM pipeline) is moot for promotion — KTD-6's direct-insert path bypasses it by design — but remains true for the ordinary retain path.

## Teardown

Scratch bank removal follows the wipe pattern (delete by `bank_id` across `memory_units`, `documents`, `mental_models`, `banks` — dry-run count first). Executed after the cycle-2 measurements; verification query and counts recorded on THINK-261.

## What this unlocks

Phase 2 of the company-brain plan (U9 tenant owner type + recall, U10 Governed Promotion mutation/CLI, U11 pilot observability) is unblocked on product-owner confirmation of this verdict. The parked THINK-250 wiki plan's fork resolves toward **vendor-side distillation**: mental models over promoted evidence, not a ThinkWork-built summarizer.

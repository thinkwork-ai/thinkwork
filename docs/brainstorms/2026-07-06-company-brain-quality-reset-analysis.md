# Company Brain Quality Reset — state analysis and plan of attack

**Date:** 2026-07-06
**Trigger:** operator inspection of the Memory screen surfaced context-free fragment memories ("Both related tasks are overdue", "The user has a memory candidate named 'negative_signal'…") — junk records with no usable context despite the retention design intending whole-thread capture.
**Linear:** THINK-193 (parent). This document is the analysis behind its restructure.

## 1. Verified state of the pipeline (dev, 2026-07-06)

Data basis: direct queries against `hindsight.*` on dev Aurora (18,060 memory units, 4,659 retained documents) plus a full code-path trace.

### What works as designed

- **Retention input is whole-thread.** `memory-retain` Lambda fetches the canonical transcript from Postgres per turn, merges the runtime tail, and ships the **entire conversation** to Hindsight as one document (`document_id = threadId`, `update_mode: replace`). Context is intact at Hindsight's door (`packages/api/src/lib/memory/adapters/hindsight-adapter.ts` `retainConversation`).
- **A partial firewall protects the KG.** The promotion gate only considers *consolidated observations* (`fact_type='observation'`, `source_memory_ids` populated); raw one-liners cannot reach the knowledge graph. Secret scan + public-space structural exclusion + kimi institutional/personal classifier (default-personal) layer in front.
- **Retention bookkeeping is healthy.** 177 retain attempts, 0 failed.

### Where quality is lost

1. **Atomization happens inside the Hindsight service, using a very small model.** Our terraform pins `HINDSIGHT_API_RETAIN_LLM_MODEL = openai.gpt-oss-20b-1:0` (`terraform/modules/app/hindsight-memory/main.tf:289`). Hindsight's internal extraction prompt (not in our repo, `ghcr.io/vectorize-io/hindsight`) shreds the well-formed thread document into referent-less fragments. ThinkWork has **no knob for extraction granularity** — levers are model choice, `observations_mission`, per-bank config.
   - Evidence: median memory-unit text 77–101 chars; `context` column averages 9 chars where populated (null for half); ~4.8 units minted per document; near-duplicate facts from single turns.
2. **Self-referential noise loops.** Dream-state reflection reports are retained as thread documents → the Brain remembers its own memory-management chatter ("memory candidate named 'negative_signal'"). Eval traffic is suppressed from retention; dream/reflection output and dev smoke-test threads are not.
3. **Recall and the Memory UI surface the worst layer.** Raw `world`/`experience` units (96% proof_count=1, never corroborated) are shown unfiltered; consolidated observations exist (9,336 consolidated) but aren't preferred at the display/recall surface.
4. **The promotion classifier judges bare text.** `classifyWithBedrock` sends `{id, text}` only — no thread context — compounding the fragment problem at the gate.
5. **Zero recall evidence.** `access_count = 0` across all 18,060 units. Either recall never touches memory or the counter is dead. No measurement of whether memory helps any turn.
6. **The highest-quality sources aren't ingested.** Emitted documents (compositor output) carry exactly the context fragments lack — author, timestamp, genre, source data, full substance. The Brain-facing digest + colophon→Brain seam was planned (THINK-152 / HTML-docs plan) but **zero implementation exists**. The ingestion mechanism is already built: `ingestSpaceMemoryDocument` / `upsertMarkdownMemoryDocument`.
7. **Distribution has never run.** OKF materialize/EFS refresh never executed; the Pi navigator points at an empty tree. (Deliberately last — distributing current signal would distribute confetti.)

## 2. Diagnosis

The Brain's architecture is sound; its **signal quality is broken at one outsourced link** (Hindsight extraction with a 20B model), **amplified by noise loops we control** (dream exhaust, test traffic), **displayed at its worst layer** (raw units), and **starved of its best inputs** (documents). Distribution work before signal work is inverted priority.

## 3. Plan of attack (phases, each independently shippable)

**P1 — Stop the noise at the source.** Exclude dream/reflection output and internal test traffic from retention. Add a retention eligibility policy (source-type allowlist) beside the existing eval suppression. Cheap, immediate, shrinks the junk denominator.

**P2 — Extraction quality experiment: retain-model upgrade + quality eval harness.** Swap `HINDSIGHT_API_RETAIN_LLM_MODEL` off gpt-oss-20b (candidates: kimi-k2.5, Haiku 4.5, gpt-oss-120b already used for reflect). Build a small **memory-quality eval harness first**: N real dev threads → retain → grade extracted units on referent completeness / dedup / usefulness (LLM-judged with pinned rubric), so before/after is measurable, not vibes. Also tune `observations_mission` and consolidation settings. Exit criteria: fragment class ("dangling referent") rate drops to near-zero on the harness; if no model config reaches acceptable quality, escalate to fork/upstream-PR decision on the Hindsight extraction prompt (explicit decision gate, not default).

**P3 — Documents as first-class memory sources (THINK-152 rescoped).** Every `emit_document` also retains its markdown digest + colophon metadata (who/when/genre/source bindings) via the existing `upsertMarkdownMemoryDocument` path, tagged `scope:document` with provenance. High-context, deliberate, provenance-stamped memory — the plates insight. Wiki/KG then compounds from synthesized deliverables, not just chat fragments.

**P4 — Fix the surfaces + instrument recall.** Memory UI and recall prefer consolidated observations over raw units (or gate raw units behind a debug toggle); show source-thread context on detail; make `access_count` (or equivalent) real so recall utility is measurable. Consider passing thread context to the promotion classifier.

**P5 — Light distribution (OKF/wiki), gated on P2.** One-shot materialize + EFS refresh for dev; chain the trigger off wiki-compile; promotion-gate boundary re-check with post-P2 data. This is THINK-149 item 2, deliberately last.

**Ops tail (parallel, unchanged):** THINK-149 items — docs rewrite to shipped architecture, `brain.*` schema drop decision, ghcr Pi image fix for customer stages, deployment-runner hardening.

## 4. Sequencing & verification

P1 → P2 are the critical path (P1 is an afternoon; P2 is the real work and the gate for everything downstream). P3 can run parallel to P2 (independent input channel). P4 after P2 (no point polishing the display of data being replaced). P5 strictly after P2 passes its exit criteria.

Every phase verifies on dev with live data before merge claims (standing rule: replacement observed live end-to-end before cutover).

## 5. Open questions for the brainstorm/plan cycle

- P2 model candidates and cost envelope (retain fires per turn; extraction model cost scales with chat volume).
- Whether Hindsight per-bank config (`configure_bank`) exposes enough to differentiate user vs space banks' missions.
- P3: digest format — reuse the compositor's agent-facing markdown verbatim, or a Brain-specific distillation?
- P4: does recall ranking already prefer observations (`observationRank`) and only the UI is wrong, or is recall equally polluted?
- Whether flagged-thread eval capture should also be excluded from retention (overlaps THINK-181 item 3).

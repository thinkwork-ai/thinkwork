# Hindsight 0.5.0 → 0.8.4 upgrade — validation evidence (THINK-201, 2026-07-06)

**Verdict: upgrade approved.** Dev was seven releases behind (parent-module pin 0.5.0); the harness had validated 0.5.6+ — that version split caused the THINK-198 Haiku-swap incident.

## Migration rehearsal (real dev data)
- Dumped dev `hindsight` schema (18,054 units / 4,662 documents), restored locally, booted 0.8.4 with `RUN_MIGRATIONS_ON_STARTUP=true`: full alembic chain completed cleanly.
- `backsweep_orphan_observations_v2` deleted 653 orphaned observations (consolidated observations whose source facts no longer exist — broken provenance). Expected on dev too.
- Post-migration integrity: only `bank_id`/`text` are NOT-NULL-without-default on `memory_units` (our direct high-confidence-fact INSERT provides both); `source_memory_ids` provenance intact (7,576 rows) so the KG observations fan-in survives; retain / extraction / recall / per-retain consolidation all verified live over the migrated data. Recall response shape matches the adapter's parser.
- Pre-migration dump preserved locally (52MB) — migrations are one-way; snapshot dev before the first 0.8.4 boot if extra caution wanted.

## Quality re-baseline on 0.8.4 (same frozen 18-thread fixture, same pinned judge)
| Candidate (on 0.8.4) | Dangling % | Dup % | Faithful | Useful |
|---|---|---|---|---|
| gpt-oss-20b | 35.0% | 11.3% | 1.94 | 1.40 |
| **Haiku 4.5** | **12.9%** | 14.3% | 1.99 | **1.54** |
| kimi-k2.5 | 30.0% | 10.7% | 1.99 | 1.35 |

- **The Bedrock-Anthropic extraction schema bug is fixed in 0.8.4** (zero BadRequestError on the Haiku leg) — the THINK-198 blocker is gone.
- **0.8.4 fails retain loudly** (HTTP 500 with detail) instead of 0.5.0's silent zero-unit success — the THINK-181 fail-loud ask, upstream.
- Retain wall-time collapsed (18 threads: 22.5s on 0.8.4-haiku vs 237s on 0.5.6) — same-doc writer serialization + freshness recheck fixes.
- Winning combination: **0.8.4 + Haiku 4.5** → dangling referents ~38% (today's dev) → ~13%, usefulness best-of-any-config. Ship as a follow-up PR after the image bump is observed healthy.

## Known upstream gap (accepted)
Maintenance discovery routines (`banks_needing_consolidation`, `mental_models_with_cron`, `schemas_with_expired_rows`) are installed only for `target_schema=public`; with our `HINDSIGHT_API_DATABASE_SCHEMA=hindsight` they warn and no-op. Primary per-retain consolidation enqueue is unaffected (verified: observations minted post-migration). Candidate upstream issue/PR.

## Compat audit
Full API/SQL inventory: session audit doc. `opinion` fact-type removal is a no-op for us (nothing writes it, recall filters exclude it, zero rows on dev). Latent bug noted: adapter bank-config writer uses PUT where the API expects PATCH, failures swallowed — dormant (env unset), fix alongside any bank-config work.

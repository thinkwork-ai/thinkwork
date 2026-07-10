/**
 * THINK-245 R4/R13 — cost-event source categories.
 *
 * Background (non-conversation) Bedrock consumers tag their cost events with
 * `metadata.source` from this list; dashboards split conversation vs
 * background/system spend on it. Keep in sync with the emitters in wiki,
 * conformance-judge, KG extraction, model-converse, idle-learning, dreaming,
 * and the U7 backfill.
 */
export const SYSTEM_COST_SOURCES = [
  "wiki_compile",
  "conformance_judge",
  "kg_extraction",
  "model_converse",
  "idle_learning",
  "dreaming",
  "backfill_daily_adjustment",
] as const;

/** SQL literal list for `metadata->>'source' IN (...)` predicates. Values are
 * a fixed compile-time allowlist (never user input). */
export const SYSTEM_COST_SOURCES_SQL_LIST = SYSTEM_COST_SOURCES.map(
  (source) => `'${source}'`,
).join(", ");

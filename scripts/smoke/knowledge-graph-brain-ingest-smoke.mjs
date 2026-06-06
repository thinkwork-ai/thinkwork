#!/usr/bin/env node
/**
 * Smoke test source-aware Knowledge Graph ingest for Company Brain pages.
 *
 * Dry-run is the default. Set SMOKE_ENABLE_KNOWLEDGE_GRAPH=1 after deploy to
 * start a real source-aware ingest, poll completion, and verify the
 * source-scoped table/graph/detail reads.
 *
 * Optional live mode:
 *   SMOKE_KG_BRAIN_PAGE_IDS      comma-separated exact brain page ids
 *   SMOKE_KG_SOURCE_LIMIT        auto-selection limit when DATABASE_URL is set
 *   SMOKE_KG_ALLOW_EMPTY=1       report diagnostics instead of failing on no approved rows
 *   SMOKE_KG_FORCE=1             force a new ingest request
 */

import {
  runSourceSmoke,
  selectBrainPageIds,
} from "./knowledge-graph-source-ingest-smoke-lib.mjs";

try {
  await runSourceSmoke({
    sourceKind: "BRAIN",
    scriptName: "scripts/smoke/knowledge-graph-brain-ingest-smoke.mjs",
    pageIdsEnv: "SMOKE_KG_BRAIN_PAGE_IDS",
    optionalEnv: [
      "SMOKE_KG_BRAIN_PAGE_IDS",
      "SMOKE_KG_SOURCE_LIMIT",
      "SMOKE_KG_ALLOW_EMPTY=1",
      "SMOKE_KG_FORCE=1",
      "SMOKE_KG_AGENT_ID with SMOKE_USER_ID for admin-skill impersonation auth",
    ],
    selectPageIds: selectBrainPageIds,
  });
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

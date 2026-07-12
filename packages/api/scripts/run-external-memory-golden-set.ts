#!/usr/bin/env -S tsx
/**
 * THINK-193 U8 — run the external-memory golden set against a deployed DB
 * (and, when HINDSIGHT_ENDPOINT is set, deployed Hindsight recall).
 *
 * Usage:
 *   DATABASE_URL=… [HINDSIGHT_ENDPOINT=…] pnpm -C packages/api exec tsx \
 *     scripts/run-external-memory-golden-set.ts --tenant <uuid> \
 *     [--entity Acme] [--variant "acme corp" --variant "acme inc"] \
 *     [--retracted-fragment "5,000,000"] [--json]
 *
 * Exit code: 0 when every check passes (or is skipped), 1 on any failure.
 * Checks and expectations live in
 * packages/api/src/lib/evals/external-memory-golden-set.ts (pure,
 * unit-tested); this wrapper only supplies the DB/Hindsight readers.
 */

import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  DEFAULT_GOLDEN_EXPECTATIONS,
  collectGoldenSetSnapshot,
  evaluateGoldenSet,
  type GoldenRecallHit,
  type GoldenSetExpectations,
  type GoldenSetReaders,
} from "../src/lib/evals/external-memory-golden-set.js";

interface Args {
  databaseUrl: string;
  tenantId: string;
  entity: string;
  variants: string[];
  retractedFragments: string[];
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(2);
  }
  let tenantId: string | null = null;
  let entity = DEFAULT_GOLDEN_EXPECTATIONS.entityName;
  const variants: string[] = [];
  const retractedFragments: string[] = [];
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--tenant") tenantId = argv[++i] ?? null;
    else if (argv[i] === "--entity") entity = argv[++i] ?? entity;
    else if (argv[i] === "--variant") variants.push(argv[++i] ?? "");
    else if (argv[i] === "--retracted-fragment") {
      retractedFragments.push(argv[++i] ?? "");
    } else if (argv[i] === "--json") json = true;
    else {
      console.error(`unknown argument: ${argv[i]}`);
      process.exit(2);
    }
  }
  if (!tenantId) {
    console.error("--tenant <uuid> is required");
    process.exit(2);
  }
  return {
    databaseUrl,
    tenantId,
    entity,
    variants: variants.filter(Boolean),
    retractedFragments: retractedFragments.filter(Boolean),
    json,
  };
}

function buildReaders(pool: pg.Pool, tenantId: string): GoldenSetReaders {
  return {
    async findCanonicalEntities(nameVariants) {
      const res = await pool.query(
        `SELECT id, display_name, normalized_name, status
           FROM identity.canonical_entities
          WHERE tenant_id = $1 AND normalized_name = ANY($2)`,
        [tenantId, nameVariants],
      );
      return res.rows.map((r) => ({
        id: String(r.id),
        displayName: String(r.display_name),
        normalizedName: String(r.normalized_name),
        status: String(r.status),
      }));
    },

    async listEntityPages(canonicalEntityIds, nameVariants) {
      const res = await pool.query(
        `SELECT p.id, p.canonical_entity_id, p.title, p.status,
                coalesce(array_agg(ss.source_ref)
                  FILTER (WHERE ss.source_ref IS NOT NULL), '{}') AS refs
           FROM wiki.pages p
           LEFT JOIN wiki.page_sections s ON s.page_id = p.id
           LEFT JOIN wiki.section_sources ss ON ss.section_id = s.id
          WHERE p.tenant_id = $1 AND p.owner_id IS NULL AND p.type = 'entity'
            AND (p.canonical_entity_id = ANY($2::uuid[])
                 OR lower(p.title) = ANY($3))
          GROUP BY p.id`,
        [tenantId, canonicalEntityIds, nameVariants],
      );
      return res.rows.map((r) => ({
        id: String(r.id),
        canonicalEntityId:
          r.canonical_entity_id === null ? null : String(r.canonical_entity_id),
        title: String(r.title),
        status: String(r.status),
        sectionSourceRefs: (r.refs as string[]) ?? [],
      }));
    },

    async listClaims(canonicalEntityIds) {
      const res = await pool.query(
        `SELECT c.id, c.subject_key, c.ontology_predicate, c.value_hash,
                c.status, c.effective_to,
                count(e.id) FILTER (WHERE e.status = 'active')::int AS active_edges
           FROM memory_claims c
           LEFT JOIN memory_claim_evidence e ON e.claim_id = c.id
          WHERE c.tenant_id = $1
            AND c.canonical_subject_id = ANY($2::uuid[])
          GROUP BY c.id`,
        [tenantId, canonicalEntityIds],
      );
      return res.rows.map((r) => ({
        id: String(r.id),
        subjectKey: String(r.subject_key),
        ontologyPredicate: String(r.ontology_predicate),
        valueHash: String(r.value_hash),
        status: String(r.status),
        effectiveTo:
          r.effective_to === null ? null : new Date(r.effective_to as string),
        activeEvidenceEdges: Number(r.active_edges ?? 0),
      }));
    },

    async recall(query): Promise<GoldenRecallHit[] | null> {
      if (!process.env.HINDSIGHT_ENDPOINT) return null;
      const { HindsightAdapter } = await import(
        "../src/lib/memory/adapters/hindsight-adapter.js"
      );
      const adapter = new HindsightAdapter({
        endpoint: process.env.HINDSIGHT_ENDPOINT,
      });
      const hits = await adapter.recall({
        tenantId,
        ownerType: "tenant",
        ownerId: tenantId,
        query,
        limit: 25,
      });
      // Flatten conservatively — containment checks only need text.
      return hits.map((hit) => ({ text: JSON.stringify(hit) }));
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const expectations: GoldenSetExpectations = {
    entityName: args.entity,
    nameVariants:
      args.variants.length > 0
        ? args.variants.map((v) => v.toLowerCase())
        : args.entity === DEFAULT_GOLDEN_EXPECTATIONS.entityName
          ? DEFAULT_GOLDEN_EXPECTATIONS.nameVariants
          : [args.entity.toLowerCase()],
    activeClaims: DEFAULT_GOLDEN_EXPECTATIONS.activeClaims,
    retractedValueFragments: args.retractedFragments,
  };
  const pool = new pg.Pool({ connectionString: args.databaseUrl, max: 2 });
  try {
    const snapshot = await collectGoldenSetSnapshot(
      buildReaders(pool, args.tenantId),
      expectations,
    );
    const result = evaluateGoldenSet(snapshot, expectations);
    if (args.json) {
      console.log(JSON.stringify({ result, snapshot }, null, 2));
    } else {
      console.log(
        `Golden set "${result.entityName}" — ${result.pass ? "PASS" : "FAIL"}`,
      );
      for (const check of result.checks) {
        console.log(`  [${check.status.toUpperCase()}] ${check.check}`);
        for (const detail of check.details) console.log(`    - ${detail}`);
      }
    }
    process.exitCode = result.pass ? 0 : 1;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

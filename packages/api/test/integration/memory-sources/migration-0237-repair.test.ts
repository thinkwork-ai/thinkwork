/**
 * Upgrade-migration fixture for drizzle/0237_memory_claims_active_value_uidx
 * (Codex round-5/6 P1): the amended file must deterministically REPAIR
 * pre-existing duplicate ACTIVE claims — pair-safe support-edge merge onto
 * the earliest keeper, interval closure on the losers, hash-collision abort
 * — atomically with the index creation, and re-run idempotently.
 *
 * Integration test — needs a real Postgres (`DATABASE_URL`). It never
 * touches live tables: every run executes the REAL migration SQL against a
 * throwaway schema (the file's `public.` references are rewritten), so it is
 * safe on the dev stack AND exercises the full repair on the CI Postgres
 * service (.github/workflows/memory-claims-integration.yml).
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;

const MIGRATION_SQL = readFileSync(
  new URL(
    "../../../../database-pg/drizzle/0237_memory_claims_active_value_uidx.sql",
    import.meta.url,
  ),
  "utf8",
);

const TENANT = randomUUID();
const TARGET = randomUUID();
const SOURCE = randomUUID();

describe.skipIf(!DATABASE_URL)("migration 0237 duplicate repair", () => {
  const schema = `mig0237_${randomUUID().slice(0, 8)}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pool: any;

  const migrationSqlFor = (targetSchema: string) =>
    MIGRATION_SQL.replaceAll("public.", `${targetSchema}.`).replaceAll(
      "FROM memory_",
      `FROM ${targetSchema}.memory_`,
    );

  async function applyMigration() {
    // Simple-protocol multi-statement execution (BEGIN … COMMIT included).
    try {
      await client.query(
        `SET search_path TO ${schema};\n${migrationSqlFor(schema)}`,
      );
    } catch (err) {
      // The file's explicit BEGIN was aborted mid-flight — clear the failed
      // transaction so later statements on this session work.
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
  }

  async function seedClaim(args: {
    id: string;
    predicate: string;
    valueHash: string;
    value: unknown;
    createdAt: string;
    effectiveFrom?: string | null;
    status?: string;
  }) {
    await client.query(
      `INSERT INTO ${schema}.memory_claims
         (id, tenant_id, target_scope, target_id, subject_key,
          ontology_predicate, value, value_hash, effective_from, status,
          created_at)
       VALUES ($1, $2, 'tenant', $3, 'twenty:company:co-1', $4, $5, $6, $7,
               $8, $9)`,
      [
        args.id,
        TENANT,
        TARGET,
        args.predicate,
        JSON.stringify(args.value),
        args.valueHash,
        args.effectiveFrom ?? null,
        args.status ?? "active",
        args.createdAt,
      ],
    );
  }

  async function seedEdge(args: {
    claimId: string;
    evidenceId: string;
    status?: string;
  }) {
    await client.query(
      `INSERT INTO ${schema}.memory_claim_evidence
         (tenant_id, claim_id, evidence_item_id, source_config_id, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [TENANT, args.claimId, args.evidenceId, SOURCE, args.status ?? "active"],
    );
  }

  beforeAll(async () => {
    const pg = (await import("pg")).default;
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
    client = await pool.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`
      CREATE TABLE ${schema}.memory_claims (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        target_scope text NOT NULL,
        target_id uuid NOT NULL,
        subject_key text NOT NULL,
        subject_entity_type text NOT NULL DEFAULT 'customer',
        ontology_predicate text NOT NULL,
        value jsonb NOT NULL,
        value_hash text NOT NULL,
        effective_from timestamptz,
        effective_to timestamptz,
        status text NOT NULL DEFAULT 'active',
        conflict_state text NOT NULL DEFAULT 'none',
        extraction_version text NOT NULL DEFAULT 'test',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE ${schema}.memory_claim_evidence (
        id bigserial PRIMARY KEY,
        tenant_id uuid NOT NULL,
        claim_id uuid NOT NULL,
        evidence_item_id uuid NOT NULL,
        source_config_id uuid NOT NULL,
        status text NOT NULL DEFAULT 'active',
        created_at timestamptz NOT NULL DEFAULT now(),
        retracted_at timestamptz
      );
      CREATE UNIQUE INDEX memory_claim_evidence_pair_uidx
        ON ${schema}.memory_claim_evidence (claim_id, evidence_item_id);
    `);
  }, 30_000);

  afterAll(async () => {
    if (client) {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
    }
    await pool?.end();
  });

  it("aborts loudly on a same-hash / different-value collision (whole transaction rolls back)", async () => {
    const a = randomUUID();
    const b = randomUUID();
    await seedClaim({
      id: a,
      predicate: "customer.name",
      valueHash: "collide",
      value: { text: "Acme" },
      createdAt: "2026-01-01T00:00:00Z",
    });
    await seedClaim({
      id: b,
      predicate: "customer.name",
      valueHash: "collide",
      value: { text: "DIFFERENT" },
      createdAt: "2026-01-02T00:00:00Z",
    });

    await expect(applyMigration()).rejects.toThrow(/hash collision/i);
    // Nothing landed: no index, both rows untouched.
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM pg_indexes
       WHERE schemaname = $1 AND indexname = 'memory_claims_active_value_uidx'`,
      [schema],
    );
    expect(rows[0].n).toBe(0);
    await client.query(
      `DELETE FROM ${schema}.memory_claims WHERE id IN ($1, $2)`,
      [a, b],
    );
  });

  it("repairs duplicates deterministically: pair-safe edge merge, keeper reactivation, interval closure, then the index", async () => {
    // Fixture (a): THREE duplicate active claims sharing ONE evidence item.
    const evA = randomUUID();
    const [c1, c2, c3] = [randomUUID(), randomUUID(), randomUUID()];
    await seedClaim({
      id: c1, // keeper: earliest created_at
      predicate: "customer.employees",
      valueHash: "emp77",
      value: { count: 77 },
      createdAt: "2026-01-01T00:00:00Z",
      effectiveFrom: "2026-01-01T00:00:00Z",
    });
    await seedClaim({
      id: c2,
      predicate: "customer.employees",
      valueHash: "emp77",
      value: { count: 77 },
      createdAt: "2026-01-02T00:00:00Z",
      effectiveFrom: "2026-01-02T00:00:00Z",
    });
    await seedClaim({
      id: c3,
      predicate: "customer.employees",
      valueHash: "emp77",
      value: { count: 77 },
      createdAt: "2026-01-03T00:00:00Z",
      effectiveFrom: null,
    });
    await seedEdge({ claimId: c1, evidenceId: evA });
    await seedEdge({ claimId: c2, evidenceId: evA });
    await seedEdge({ claimId: c3, evidenceId: evA });

    // Fixture (b): keeper with a PRE-EXISTING RETRACTED edge for the
    // loser's evidence — must be reactivated, not duplicated.
    const evB = randomUUID();
    const [c4, c5] = [randomUUID(), randomUUID()];
    await seedClaim({
      id: c4, // keeper
      predicate: "customer.domain",
      valueHash: "dom1",
      value: { url: "acme.com" },
      createdAt: "2026-01-01T00:00:00Z",
      effectiveFrom: "2026-01-01T00:00:00Z",
    });
    await seedClaim({
      id: c5,
      predicate: "customer.domain",
      valueHash: "dom1",
      value: { url: "acme.com" },
      createdAt: "2026-01-05T00:00:00Z",
      effectiveFrom: "2026-01-05T00:00:00Z",
    });
    await seedEdge({ claimId: c4, evidenceId: evB, status: "retracted" });
    await seedEdge({ claimId: c5, evidenceId: evB });

    await applyMigration();

    // (a) keeper has EXACTLY ONE active edge to evA; losers superseded and
    // closed; no pair-uniqueness violation happened (the migration would
    // have thrown).
    const edgesA = await client.query(
      `SELECT claim_id, status FROM ${schema}.memory_claim_evidence
       WHERE evidence_item_id = $1`,
      [evA],
    );
    const activeA = edgesA.rows.filter(
      (r: { status: string }) => r.status === "active",
    );
    expect(activeA).toHaveLength(1);
    expect(activeA[0].claim_id).toBe(c1);

    const losers = await client.query(
      `SELECT id, status, effective_to FROM ${schema}.memory_claims
       WHERE id IN ($1, $2)`,
      [c2, c3],
    );
    for (const row of losers.rows) {
      expect(row.status).toBe("superseded");
      expect(row.effective_to).not.toBeNull();
    }
    const keeper = await client.query(
      `SELECT status FROM ${schema}.memory_claims WHERE id = $1`,
      [c1],
    );
    expect(keeper.rows[0].status).toBe("active");

    // (b) the keeper's retracted edge was REACTIVATED (exactly one active
    // edge, still one row per pair) and the loser closed.
    const edgesB = await client.query(
      `SELECT claim_id, status FROM ${schema}.memory_claim_evidence
       WHERE evidence_item_id = $1 ORDER BY claim_id`,
      [evB],
    );
    const activeB = edgesB.rows.filter(
      (r: { status: string }) => r.status === "active",
    );
    expect(activeB).toHaveLength(1);
    expect(activeB[0].claim_id).toBe(c4);
    const c4Edges = edgesB.rows.filter(
      (r: { claim_id: string }) => r.claim_id === c4,
    );
    expect(c4Edges).toHaveLength(1); // reactivated, not duplicated

    // Invariants: zero active duplicates; the partial unique index exists.
    const dupes = await client.query(
      `SELECT count(*)::int AS n FROM (
         SELECT 1 FROM ${schema}.memory_claims WHERE status = 'active'
         GROUP BY tenant_id, target_scope, target_id, subject_key,
                  ontology_predicate, value_hash
         HAVING count(*) > 1) t`,
    );
    expect(dupes.rows[0].n).toBe(0);
    const idx = await client.query(
      `SELECT count(*)::int AS n FROM pg_indexes
       WHERE schemaname = $1 AND indexname = 'memory_claims_active_value_uidx'`,
      [schema],
    );
    expect(idx.rows[0].n).toBe(1);
  });

  it("re-running the migration is idempotent (repair finds nothing, index already exists)", async () => {
    await applyMigration();
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM ${schema}.memory_claims
       WHERE status = 'active'`,
    );
    expect(rows[0].n).toBeGreaterThan(0); // keepers untouched
  });
});

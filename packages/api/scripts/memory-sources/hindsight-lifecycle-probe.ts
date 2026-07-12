/**
 * Hindsight 0.8.4 document-lifecycle probe — U1 of the external memory
 * compounding plan (docs/plans/2026-07-11-002).
 *
 * Records replace / delete / orphan behavior against a DISPOSABLE bank so the
 * U2 retraction saga is designed from observed 0.8.4 behavior, not vendor
 * assumptions. Production retraction stays disabled until U2; this probe must
 * only ever run against the local memory-eval harness
 * (packages/api/scripts/memory-eval/docker-compose.yml) or another disposable
 * Hindsight instance — never a deployed stage bank.
 *
 * Usage (from packages/api, harness up per memory-eval/README.md):
 *   HINDSIGHT_ENDPOINT=http://localhost:8888 \
 *   HINDSIGHT_PG_URL=postgresql://postgres:hindsight@localhost:5433/hindsight \
 *   HINDSIGHT_PG_SCHEMA=eval_baseline \
 *     npx tsx scripts/memory-sources/hindsight-lifecycle-probe.ts
 *
 * Output: JSON observations on stdout; exit 1 only on probe-harness errors
 * (unexpected connectivity failures), not on "interesting" Hindsight behavior
 * — surprising lifecycle behavior is a finding to record, not a failure.
 */

import { Client } from "pg";

const endpoint = (
  process.env.HINDSIGHT_ENDPOINT ?? "http://localhost:8888"
).replace(/\/$/, "");
const pgUrl =
  process.env.HINDSIGHT_PG_URL ??
  "postgresql://postgres:hindsight@localhost:5433/hindsight";
const pgSchema = process.env.HINDSIGHT_PG_SCHEMA ?? "eval_baseline";

const bankId = `probe_lifecycle_${Date.now()}`;
const documentId = "external:probe-source-config:company:probe-co-1";

interface StepObservation {
  step: string;
  detail: Record<string, unknown>;
}

const observations: StepObservation[] = [];

function record(step: string, detail: Record<string, unknown>) {
  observations.push({ step, detail });
  console.error(`[probe] ${step}: ${JSON.stringify(detail)}`);
}

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const resp = await fetch(`${endpoint}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  let json: unknown = null;
  try {
    json = await resp.json();
  } catch {
    /* non-JSON body */
  }
  return { status: resp.status, json };
}

async function retain(content: string) {
  return api("POST", `/v1/default/banks/${bankId}/memories`, {
    items: [
      {
        content,
        document_id: documentId,
        update_mode: "replace",
        context: "external_source_projection",
        metadata: { probe: "u1-lifecycle" },
      },
    ],
  });
}

async function recall(query: string) {
  const { status, json } = await api(
    "POST",
    `/v1/default/banks/${bankId}/memories/recall`,
    { query, budget: "low", max_tokens: 800 },
  );
  // 0.8.4 responds {results: [...]}; older builds used {memory_units: [...]}.
  const units = ((json as any)?.results ??
    (json as any)?.memory_units ??
    []) as Array<{ id: string; text: string }>;
  return { status, texts: units.map((u) => u.text) };
}

async function main() {
  const pg = new Client({ connectionString: pgUrl });
  await pg.connect();
  const q = async (sql: string, params: unknown[] = []) =>
    (await pg.query(sql, params)).rows;

  const unitCount = async () =>
    Number(
      (
        await q(
          `SELECT count(*) c FROM ${pgSchema}.memory_units WHERE bank_id = $1`,
          [bankId],
        )
      )[0]?.c ?? -1,
    );
  const documentRows = async () =>
    q(
      `SELECT id, bank_id FROM ${pgSchema}.documents WHERE bank_id = $1 ORDER BY created_at`,
      [bankId],
    );
  const unitsForDocs = async (docIds: string[]) =>
    docIds.length === 0
      ? []
      : q(
          `SELECT id, document_id, left(text, 60) AS text FROM ${pgSchema}.memory_units WHERE document_id = ANY($1::text[])`,
          [docIds],
        );

  // 1. Retain v1 (synchronous — no async flag) and observe extraction.
  const v1 = await retain(
    "# Probe Co\n\nProbe Co is headquartered in Reno. Its ARR is $5M. Its CEO is Dana Probe.",
  );
  record("retain_v1", { status: v1.status });
  const docsAfterV1 = await documentRows();
  const unitsAfterV1 = await unitCount();
  record("state_after_v1", {
    documents: docsAfterV1.length,
    units: unitsAfterV1,
  });

  // 2. Recall v1 fact.
  record("recall_v1", await recall("Where is Probe Co headquartered?"));

  // 3. Replace with v2 (HQ moved, ARR changed) via the SAME document_id.
  const v2 = await retain(
    "# Probe Co\n\nProbe Co is headquartered in Austin. Its ARR is $9M. Its CEO is Dana Probe.",
  );
  record("retain_v2_replace", { status: v2.status });
  const docsAfterV2 = await documentRows();
  const unitsAfterV2Rows = await unitsForDocs(docsAfterV2.map((d) => d.id));
  record("state_after_v2", {
    documents: docsAfterV2.length,
    units: unitsAfterV2Rows.length,
    unitTexts: unitsAfterV2Rows.map((u) => u.text),
  });

  // 4. Does the superseded v1 extraction linger? Recall the OLD value.
  record("recall_after_replace_old_value", await recall("Reno headquarters"));
  record(
    "recall_after_replace_new_value",
    await recall("Where is Probe Co headquartered?"),
  );

  // 5. Consolidate, then check derived observations for orphan behavior after
  //    a later delete.
  const consolidate = await api(
    "POST",
    `/v1/default/banks/${bankId}/consolidate`,
    {},
  );
  record("consolidate", { status: consolidate.status });

  // 6. HTTP delete surface probe — try the plausible delete endpoints and
  //    record what 0.8.4 actually exposes. 404/405 are findings, not errors.
  for (const [method, path] of [
    [
      "DELETE",
      `/v1/default/banks/${bankId}/documents/${encodeURIComponent(documentId)}`,
    ],
    ["DELETE", `/v1/default/banks/${bankId}/memories/${documentId}`],
  ] as const) {
    const res = await api(method, path);
    record("http_delete_probe", { method, path, status: res.status });
  }

  // 7. SQL-level delete (the dream-applier seam): delete units for the
  //    document, then orphan-safe document delete, and see what survives.
  const docIds = (await documentRows()).map((d) => d.id);
  const deletedUnits = await q(
    `DELETE FROM ${pgSchema}.memory_units WHERE bank_id = $1 RETURNING id`,
    [bankId],
  );
  const orphanDocsDeleted = await q(
    `DELETE FROM ${pgSchema}.documents d WHERE d.bank_id = $1
       AND NOT EXISTS (SELECT 1 FROM ${pgSchema}.memory_units mu WHERE mu.document_id = d.id)
     RETURNING d.id`,
    [bankId],
  );
  record("sql_delete", {
    priorDocumentIds: docIds,
    unitsDeleted: deletedUnits.length,
    orphanDocumentsDeleted: orphanDocsDeleted.length,
  });

  // 8. Post-delete recall — does anything still answer?
  record("recall_after_delete", await recall("Probe Co headquarters ARR"));

  // 9. Residue sweep: anything left in this bank across the core tables?
  for (const table of ["documents", "memory_units", "memory_links"]) {
    try {
      const rows = await q(
        `SELECT count(*) c FROM ${pgSchema}.${table} WHERE bank_id = $1`,
        [bankId],
      );
      record("residue", { table, count: Number(rows[0]?.c) });
    } catch (err) {
      record("residue", { table, error: (err as Error).message });
    }
  }

  await pg.end();
  console.log(
    JSON.stringify(
      { endpoint, bankId, documentId, pgSchema, observations },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("[probe] harness failure:", err);
  process.exit(1);
});

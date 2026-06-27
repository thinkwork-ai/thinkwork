#!/usr/bin/env -S tsx
/**
 * Aggregate-only Hindsight memory foundation evidence collector.
 *
 * This script is intentionally safe for audit/report use: it collects service
 * health, bank/config posture, and aggregate database counts without selecting
 * raw memory text, chunks, source-fact bodies, or user-authored content.
 */

import { pathToFileURL } from "node:url";
import { Pool } from "pg";

export interface AuditArgs {
  stage: string;
  endpoint?: string;
  databaseUrl?: string;
  schema: string;
  json: boolean;
  probeBankId?: string;
  probeQuery: string;
}

export interface QueryClient {
  query(sql: string): Promise<{ rows: unknown[] }>;
}

type FetchImpl = typeof fetch;
type ProbeStatus = "ok" | "degraded" | "skipped";

export interface ProbeResult {
  status: ProbeStatus;
  reason?: string;
  error?: string;
  data?: unknown;
  rows?: unknown[];
}

export interface HindsightFoundationAuditReport {
  generatedAt: string;
  stage: string;
  schema: string;
  endpoint?: string;
  probes: Record<string, ProbeResult>;
}

type RunOptions = {
  db?: QueryClient;
  fetchImpl?: FetchImpl;
  now?: () => Date;
};

const DEFAULT_SCHEMA = "hindsight";
const RAW_CONTENT_KEYS = new Set([
  "content",
  "text",
  "summary",
  "value",
  "source_fact",
  "source_facts",
  "sourceFacts",
  "source_fact_text",
  "sourceFactText",
  "source_content",
  "sourceContent",
  "chunks",
  "chunk",
  "raw",
  "raw_content",
  "rawContent",
]);
const IDENTIFIER_KEYS = new Set([
  "id",
  "bank_id",
  "bankId",
  "tenant_id",
  "tenantId",
  "user_id",
  "userId",
  "owner_id",
  "ownerId",
  "document_id",
  "documentId",
]);
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function parseArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): AuditArgs {
  const args: AuditArgs = {
    stage: env.STAGE || "dev",
    endpoint:
      env.HINDSIGHT_ENDPOINT || env.HINDSIGHT_API_ENDPOINT || env.HINDSIGHT_URL,
    databaseUrl: env.DATABASE_URL,
    schema: env.HINDSIGHT_SCHEMA || DEFAULT_SCHEMA,
    json: false,
    probeBankId: env.HINDSIGHT_AUDIT_RECALL_BANK_ID,
    probeQuery:
      env.HINDSIGHT_AUDIT_RECALL_QUERY ||
      "ThinkWork memory foundation evidence",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--stage":
        args.stage = requireValue(argv, ++i, arg);
        break;
      case "--endpoint":
        args.endpoint = requireValue(argv, ++i, arg).replace(/\/$/, "");
        break;
      case "--database-url":
        args.databaseUrl = requireValue(argv, ++i, arg);
        break;
      case "--schema":
        args.schema = requireValue(argv, ++i, arg);
        break;
      case "--probe-bank":
        args.probeBankId = requireValue(argv, ++i, arg);
        break;
      case "--probe-query":
        args.probeQuery = requireValue(argv, ++i, arg);
        break;
      case "--json":
        args.json = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function printHelp(): void {
  console.log(`Usage: hindsight-memory-foundation-audit [options]

Aggregate-only evidence collector for the Hindsight memory foundation audit.

Options:
  --stage <name>          Stage label for the report (default STAGE or dev)
  --endpoint <url>        Hindsight endpoint. Also reads HINDSIGHT_ENDPOINT
  --database-url <url>    PostgreSQL URL. Also reads DATABASE_URL
  --schema <name>         Hindsight schema name (default hindsight)
  --probe-bank <bank>     Optional Hindsight bank for live recall evidence probe
  --probe-query <query>   Query for optional live recall probe
  --json                  Print full JSON report

The collector never selects raw memory text/content/chunks. Missing endpoint or
database config marks the relevant probe group as skipped.`);
}

export function validateSchemaName(schema: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error(`Invalid schema: ${schema}`);
  }
  return schema;
}

export function redactIdentifier(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value.length <= 12) return value;
  const prefix = value.startsWith("user_") ? "user_" : "";
  const withoutPrefix = prefix ? value.slice(prefix.length) : value;
  return `${prefix}${withoutPrefix.slice(0, 8)}...`;
}

export function sanitizeForReport(value: unknown, keyHint?: string): unknown {
  if (keyHint && RAW_CONTENT_KEYS.has(keyHint)) return "[omitted]";
  if (keyHint && IDENTIFIER_KEYS.has(keyHint)) return redactIdentifier(value);

  if (typeof value === "string") {
    return value.replace(EMAIL_PATTERN, "[redacted-email]");
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForReport(item));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = sanitizeForReport(child, key);
    }
    return result;
  }
  return value;
}

export function buildSafeReport(
  report: HindsightFoundationAuditReport,
): HindsightFoundationAuditReport {
  return sanitizeForReport(report) as HindsightFoundationAuditReport;
}

export async function runHindsightFoundationAudit(
  args: AuditArgs,
  options: RunOptions = {},
): Promise<HindsightFoundationAuditReport> {
  const schema = validateSchemaName(args.schema || DEFAULT_SCHEMA);
  const report: HindsightFoundationAuditReport = {
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    stage: args.stage,
    schema,
    ...(args.endpoint ? { endpoint: args.endpoint } : {}),
    probes: {},
  };

  report.probes.serviceHealth = await probeServiceHealth(args, options);
  report.probes.bankConfigSample = await probeBankConfigSample(args, options);
  report.probes.recallEvidenceShape = await probeRecallEvidenceShape(
    args,
    options,
  );

  let pool: Pool | undefined;
  const db =
    options.db ??
    (args.databaseUrl
      ? ((pool = new Pool({
          connectionString: args.databaseUrl,
        })) as QueryClient)
      : undefined);

  if (!db) {
    const skipped = skippedProbe("DATABASE_URL is not configured");
    report.probes.databaseTableCounts = skipped;
    report.probes.factTypes = skipped;
    report.probes.contexts = skipped;
    report.probes.observationEvidence = skipped;
    report.probes.retainParams = skipped;
    report.probes.retainParamsByContext = skipped;
    report.probes.tagTemporalCoverage = skipped;
    report.probes.spaceMemoryRetainCoverage = skipped;
    report.probes.directBrainBankPosture = skipped;
    report.probes.evidenceAvailability = skipped;
    report.probes.foundationTables = skipped;
    report.probes.asyncOperations = skipped;
    return buildSafeReport(report);
  }

  try {
    report.probes.databaseTableCounts = await queryProbe(
      db,
      "databaseTableCounts",
      tableCountsSql(schema),
    );
    report.probes.factTypes = await queryProbe(
      db,
      "factTypes",
      factTypesSql(schema),
    );
    report.probes.contexts = await queryProbe(
      db,
      "contexts",
      contextsSql(schema),
    );
    report.probes.observationEvidence = await queryProbe(
      db,
      "observationEvidence",
      observationEvidenceSql(schema),
    );
    report.probes.retainParams = await queryProbe(
      db,
      "retainParams",
      retainParamsSql(schema),
    );
    report.probes.retainParamsByContext = await queryProbe(
      db,
      "retainParamsByContext",
      retainParamsByContextSql(schema),
    );
    report.probes.tagTemporalCoverage = await queryProbe(
      db,
      "tagTemporalCoverage",
      tagTemporalCoverageSql(schema),
    );
    report.probes.spaceMemoryRetainCoverage = await queryProbe(
      db,
      "spaceMemoryRetainCoverage",
      spaceMemoryRetainCoverageSql(schema),
    );
    report.probes.directBrainBankPosture = await queryProbe(
      db,
      "directBrainBankPosture",
      directBrainBankPostureSql(schema),
    );
    report.probes.evidenceAvailability = await queryProbe(
      db,
      "evidenceAvailability",
      evidenceAvailabilitySql(schema),
    );
    report.probes.foundationTables = await queryProbe(
      db,
      "foundationTables",
      foundationTablesSql(schema),
    );
    report.probes.asyncOperations = await queryProbe(
      db,
      "asyncOperations",
      asyncOperationsSql(schema),
    );
  } finally {
    await pool?.end();
  }

  return buildSafeReport(report);
}

async function probeServiceHealth(
  args: AuditArgs,
  options: RunOptions,
): Promise<ProbeResult> {
  if (!args.endpoint)
    return skippedProbe("Hindsight endpoint is not configured");
  try {
    const response = await (options.fetchImpl ?? fetch)(
      `${args.endpoint.replace(/\/$/, "")}/health`,
      {
        method: "GET",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      return degradedProbe(`health returned HTTP ${response.status}`);
    }
    return {
      status: "ok",
      data: await response.json().catch(() => ({ ok: true })),
    };
  } catch (err) {
    return degradedProbe(errorMessage(err));
  }
}

async function probeBankConfigSample(
  args: AuditArgs,
  options: RunOptions,
): Promise<ProbeResult> {
  if (!args.endpoint)
    return skippedProbe("Hindsight endpoint is not configured");
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = args.endpoint.replace(/\/$/, "");
  try {
    const banksResponse = await fetchImpl(`${endpoint}/v1/default/banks`, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    });
    if (!banksResponse.ok) {
      return degradedProbe(`banks returned HTTP ${banksResponse.status}`);
    }
    const banksData = await banksResponse.json().catch(() => ({}));
    const banks = extractBankIds(banksData).slice(0, 5);
    const configs = [];
    for (const bankId of banks) {
      const configResponse = await fetchImpl(
        `${endpoint}/v1/default/banks/${encodeURIComponent(bankId)}/config`,
        {
          method: "GET",
          signal: AbortSignal.timeout(10_000),
        },
      );
      configs.push({
        bank_id: bankId,
        status: configResponse.ok ? "ok" : `http_${configResponse.status}`,
        data: configResponse.ok
          ? await configResponse.json().catch(() => ({}))
          : undefined,
      });
    }
    return {
      status: "ok",
      data: {
        sampled_bank_count: banks.length,
        configs,
      },
    };
  } catch (err) {
    return degradedProbe(errorMessage(err));
  }
}

async function probeRecallEvidenceShape(
  args: AuditArgs,
  options: RunOptions,
): Promise<ProbeResult> {
  if (!args.endpoint)
    return skippedProbe("Hindsight endpoint is not configured");
  if (!args.probeBankId) {
    return skippedProbe("HINDSIGHT_AUDIT_RECALL_BANK_ID is not configured");
  }

  const endpoint = args.endpoint.replace(/\/$/, "");
  try {
    const response = await (options.fetchImpl ?? fetch)(
      `${endpoint}/v1/default/banks/${encodeURIComponent(args.probeBankId)}/memories/recall`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: args.probeQuery,
          limit: 5,
          budget: "quick",
          fact_types: ["observation"],
          include: { source_facts: true },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) {
      return degradedProbe(`recall returned HTTP ${response.status}`);
    }
    const data = await response.json().catch(() => ({}));
    return {
      status: "ok",
      data: summarizeRecallEvidenceShape(data),
    };
  } catch (err) {
    return degradedProbe(errorMessage(err));
  }
}

function summarizeRecallEvidenceShape(data: unknown): Record<string, unknown> {
  const record = data && typeof data === "object" ? (data as any) : {};
  const results = firstArray(
    record.memories,
    record.results,
    record.items,
    data,
  );
  const topLevelSourceFacts = firstArray(
    record.source_facts,
    record.sourceFacts,
    record.facts,
  );

  let withSourceFactIds = 0;
  let withSourceMemoryIds = 0;
  let withEmbeddedSourceFacts = 0;

  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (arrayLikeLength(row.source_fact_ids ?? row.sourceFactIds) > 0) {
      withSourceFactIds += 1;
    }
    if (arrayLikeLength(row.source_memory_ids ?? row.sourceMemoryIds) > 0) {
      withSourceMemoryIds += 1;
    }
    if (arrayLikeLength(row.source_facts ?? row.sourceFacts) > 0) {
      withEmbeddedSourceFacts += 1;
    }
  }

  return {
    result_count: results.length,
    results_with_source_fact_ids: withSourceFactIds,
    results_with_source_memory_ids: withSourceMemoryIds,
    results_with_embedded_source_facts: withEmbeddedSourceFacts,
    top_level_source_fact_count: topLevelSourceFacts.length,
    top_level_keys: Object.keys(record).sort(),
  };
}

function firstArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function arrayLikeLength(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value).length;
  return 0;
}

function extractBankIds(data: unknown): string[] {
  const record = data && typeof data === "object" ? (data as any) : {};
  const raw = Array.isArray(record.banks)
    ? record.banks
    : Array.isArray(record.items)
      ? record.items
      : Array.isArray(data)
        ? data
        : [];
  return raw
    .map((item: unknown) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        return String(row.id ?? row.bank_id ?? row.bankId ?? row.name ?? "");
      }
      return "";
    })
    .filter((id: string) => id.length > 0);
}

async function queryProbe(
  db: QueryClient,
  _name: string,
  sql: string,
): Promise<ProbeResult> {
  try {
    const result = await db.query(sql);
    return { status: "ok", rows: normalizeRows(result.rows) };
  } catch (err) {
    return degradedProbe(errorMessage(err));
  }
}

function normalizeRows(rows: unknown[]): unknown[] {
  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key] = normalizeScalar(value);
    }
    return normalized;
  });
}

function normalizeScalar(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

function skippedProbe(reason: string): ProbeResult {
  return { status: "skipped", reason };
}

function degradedProbe(message: string): ProbeResult {
  return { status: "degraded", error: message };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function tableCountsSql(schema: string): string {
  const tables = [
    "banks",
    "documents",
    "memory_units",
    "entities",
    "entity_cooccurrences",
    "chunks",
    "async_operations",
    "mental_models",
    "directives",
  ];
  return tables
    .map(
      (table) =>
        `SELECT '${table}' AS table_name, COUNT(*)::text AS row_count FROM ${schema}.${table}`,
    )
    .join("\nUNION ALL\n");
}

function factTypesSql(schema: string): string {
  return `
    SELECT COALESCE(fact_type::text, '(null)') AS fact_type,
           COUNT(*)::text AS row_count
    FROM ${schema}.memory_units
    GROUP BY 1
    ORDER BY COUNT(*) DESC, 1 ASC
  `;
}

function contextsSql(schema: string): string {
  return `
    SELECT COALESCE(NULLIF(context, ''), '(blank/null)') AS context,
           COALESCE(fact_type::text, '(null)') AS fact_type,
           COUNT(*)::text AS row_count
    FROM ${schema}.memory_units
    GROUP BY 1, 2
    ORDER BY COUNT(*) DESC, 1 ASC, 2 ASC
  `;
}

function observationEvidenceSql(schema: string): string {
  return `
    SELECT
      COUNT(*)::text AS observations,
      COUNT(*) FILTER (WHERE proof_count IS NOT NULL)::text AS with_proof_count,
      COUNT(*) FILTER (
        WHERE source_memory_ids IS NOT NULL
          AND array_length(source_memory_ids, 1) > 0
      )::text AS with_source_memory_ids,
      COUNT(*) FILTER (
        WHERE proof_count IS NOT NULL
          AND source_memory_ids IS NOT NULL
          AND proof_count = array_length(source_memory_ids, 1)
      )::text AS proof_matches_source_count
    FROM ${schema}.memory_units
    WHERE fact_type = 'observation'
  `;
}

function retainParamsSql(schema: string): string {
  return `
    SELECT
      COUNT(*)::text AS documents,
      COUNT(*) FILTER (WHERE retain_params ? 'timestamp')::text AS with_timestamp,
      COUNT(*) FILTER (WHERE retain_params ? 'tags')::text AS with_tags,
      COUNT(*) FILTER (WHERE retain_params ? 'document_tags')::text AS with_document_tags,
      COUNT(*) FILTER (WHERE retain_params ? 'observation_scopes')::text AS with_observation_scopes
    FROM ${schema}.documents
  `;
}

function retainParamsByContextSql(schema: string): string {
  return `
    SELECT
      COALESCE(NULLIF(context, ''), '(blank/null)') AS context,
      COUNT(*)::text AS documents,
      COUNT(*) FILTER (WHERE retain_params ? 'timestamp')::text AS with_timestamp,
      COUNT(*) FILTER (WHERE retain_params ? 'tags')::text AS with_tags,
      COUNT(*) FILTER (WHERE retain_params ? 'document_tags')::text AS with_document_tags,
      COUNT(*) FILTER (WHERE retain_params ? 'observation_scopes')::text AS with_observation_scopes
    FROM ${schema}.documents
    GROUP BY 1
    ORDER BY COUNT(*) DESC, 1 ASC
  `;
}

function tagTemporalCoverageSql(schema: string): string {
  return `
    SELECT
      COUNT(*)::text AS memory_units,
      COUNT(*) FILTER (WHERE tags IS NOT NULL AND array_length(tags, 1) > 0)::text AS tagged_units,
      COUNT(*) FILTER (WHERE event_date IS NOT NULL)::text AS with_event_date,
      COUNT(*) FILTER (WHERE occurred_start IS NOT NULL)::text AS with_occurred_start,
      COUNT(*) FILTER (WHERE mentioned_at IS NOT NULL)::text AS with_mentioned_at
    FROM ${schema}.memory_units
  `;
}

function spaceMemoryRetainCoverageSql(schema: string): string {
  return `
    SELECT
      'documents' AS row_type,
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE retain_params ? 'timestamp')::text AS with_timestamp,
      COUNT(*) FILTER (WHERE retain_params ? 'tags')::text AS with_tags,
      COUNT(*) FILTER (WHERE retain_params ? 'document_tags')::text AS with_document_tags,
      COUNT(*) FILTER (WHERE retain_params ? 'observation_scopes')::text AS with_observation_scopes,
      '0' AS observations,
      '0' AS with_source_memory_ids
    FROM ${schema}.documents
    WHERE bank_id LIKE 'space_%'
    UNION ALL
    SELECT
      'memory_units' AS row_type,
      COUNT(*)::text AS total,
      '0' AS with_timestamp,
      COUNT(*) FILTER (WHERE tags IS NOT NULL AND array_length(tags, 1) > 0)::text AS with_tags,
      '0' AS with_document_tags,
      '0' AS with_observation_scopes,
      COUNT(*) FILTER (WHERE fact_type = 'observation')::text AS observations,
      COUNT(*) FILTER (
        WHERE source_memory_ids IS NOT NULL
          AND array_length(source_memory_ids, 1) > 0
      )::text AS with_source_memory_ids
    FROM ${schema}.memory_units
    WHERE bank_id LIKE 'space_%'
  `;
}

function directBrainBankPostureSql(schema: string): string {
  return `
    WITH document_banks AS (
      SELECT
        bank_id,
        COUNT(*) AS documents
      FROM ${schema}.documents
      WHERE bank_id LIKE 'user_%' OR bank_id LIKE 'space_%'
      GROUP BY 1
    ),
    memory_unit_banks AS (
      SELECT
        bank_id,
        COUNT(*) AS memory_units,
        COUNT(*) FILTER (WHERE fact_type = 'observation') AS observations,
        COUNT(*) FILTER (
          WHERE source_memory_ids IS NOT NULL
            AND array_length(source_memory_ids, 1) > 0
        ) AS with_source_memory_ids
      FROM ${schema}.memory_units
      WHERE bank_id LIKE 'user_%' OR bank_id LIKE 'space_%'
      GROUP BY 1
    ),
    joined AS (
      SELECT
        COALESCE(document_banks.bank_id, memory_unit_banks.bank_id) AS bank_id,
        COALESCE(document_banks.documents, 0) AS documents,
        COALESCE(memory_unit_banks.memory_units, 0) AS memory_units,
        COALESCE(memory_unit_banks.observations, 0) AS observations,
        COALESCE(memory_unit_banks.with_source_memory_ids, 0) AS with_source_memory_ids
      FROM document_banks
      FULL OUTER JOIN memory_unit_banks USING (bank_id)
    )
    SELECT
      CASE
        WHEN bank_id LIKE 'space_%' THEN 'space'
        WHEN bank_id LIKE 'user_%' THEN 'user'
        ELSE 'other'
      END AS bank_family,
      COUNT(*)::text AS banks,
      SUM(documents)::text AS documents,
      SUM(memory_units)::text AS memory_units,
      SUM(observations)::text AS observations,
      SUM(with_source_memory_ids)::text AS with_source_memory_ids
    FROM joined
    GROUP BY 1
    ORDER BY 1 ASC
  `;
}

function evidenceAvailabilitySql(schema: string): string {
  return `
    SELECT
      COUNT(*)::text AS observations,
      COUNT(*) FILTER (WHERE proof_count IS NOT NULL)::text AS with_proof_count,
      COUNT(*) FILTER (
        WHERE source_memory_ids IS NOT NULL
          AND array_length(source_memory_ids, 1) > 0
      )::text AS with_source_memory_ids,
      COUNT(*) FILTER (
        WHERE proof_count IS NOT NULL
          AND source_memory_ids IS NOT NULL
          AND proof_count = array_length(source_memory_ids, 1)
      )::text AS proof_matches_source_count,
      COUNT(*) FILTER (
        WHERE proof_count IS NOT NULL
          AND source_memory_ids IS NOT NULL
          AND proof_count <> array_length(source_memory_ids, 1)
      )::text AS proof_source_mismatch_count,
      COUNT(*) FILTER (
        WHERE source_memory_ids IS NULL
          OR array_length(source_memory_ids, 1) = 0
      )::text AS missing_source_memory_ids
    FROM ${schema}.memory_units
    WHERE fact_type = 'observation'
  `;
}

function foundationTablesSql(schema: string): string {
  return `
    SELECT 'mental_models' AS table_name, COUNT(*)::text AS row_count
    FROM ${schema}.mental_models
    UNION ALL
    SELECT 'directives' AS table_name, COUNT(*)::text AS row_count
    FROM ${schema}.directives
  `;
}

function asyncOperationsSql(schema: string): string {
  return `
    SELECT COALESCE(operation_type::text, '(null)') AS operation_type,
           COALESCE(status::text, '(null)') AS status,
           COUNT(*)::text AS row_count
    FROM ${schema}.async_operations
    GROUP BY 1, 2
    ORDER BY COUNT(*) DESC, 1 ASC, 2 ASC
  `;
}

function printMarkdownSummary(report: HindsightFoundationAuditReport): void {
  console.log(`# Hindsight Memory Foundation Evidence (${report.stage})`);
  console.log("");
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Schema: ${report.schema}`);
  if (report.endpoint) console.log(`Endpoint: ${report.endpoint}`);
  console.log("");
  for (const [name, probe] of Object.entries(report.probes)) {
    console.log(`## ${name}`);
    console.log(`Status: ${probe.status}`);
    if (probe.reason) console.log(`Reason: ${probe.reason}`);
    if (probe.error) console.log(`Error: ${probe.error}`);
    if (probe.rows) {
      console.log("");
      console.log("```json");
      console.log(JSON.stringify(probe.rows, null, 2));
      console.log("```");
    } else if (probe.data) {
      console.log("");
      console.log("```json");
      console.log(JSON.stringify(probe.data, null, 2));
      console.log("```");
    }
    console.log("");
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await runHindsightFoundationAudit(args);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printMarkdownSummary(report);
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  main().catch((err) => {
    console.error(
      `[hindsight-memory-foundation-audit] fatal: ${(err as Error).stack ?? err}`,
    );
    process.exit(1);
  });
}

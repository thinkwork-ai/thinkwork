#!/usr/bin/env -S tsx
/**
 * THINK-198 memory-quality eval harness — step 1: export a frozen fixture of
 * real dev threads to replay against candidate Hindsight retain models.
 *
 * Read-only against the dev database. Selection is stratified by transcript
 * size (three buckets, `--count` threads split evenly across them) and
 * excludes eval traffic + smoke/e2e-shaped threads so the fixture reflects
 * real usage. Transcript extraction mirrors the production retain path
 * exactly (`fetchThreadTranscript`,
 * packages/api/src/handlers/memory-retain.ts:813-862): only non-empty
 * `messages.content`, ordered by `created_at`, role coerced to
 * user/assistant/system.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx packages/api/scripts/memory-eval/export-threads.ts \
 *     --count 18 --out /tmp/memory-eval/threads-fixture.json
 *
 * The output is meant to be committed/frozen for the whole P2 experiment —
 * every candidate model replays the identical fixture.
 */

import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Pool } from "pg";

export interface ExportArgs {
  databaseUrl?: string;
  count: number;
  out: string;
  json: boolean;
}

export interface QueryClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface ThreadSelectionRow {
  thread_id: string;
  title: string;
  tenant_id: string;
  msg_count: number;
  char_count: number;
}

export interface FixtureMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
}

export interface FixtureThread {
  threadId: string;
  tenantId: string;
  title: string;
  messages: FixtureMessage[];
}

export interface ThreadsFixture {
  generatedAt: string;
  count: number;
  threads: FixtureThread[];
}

const DEFAULT_COUNT = 18;
const BUCKETS = 3;

/** Excludes eval traffic + smoke/e2e-shaped titles from thread selection. */
const TITLE_EXCLUSION_PATTERN = "(smoke|e2e|eval|test fixture|probe)";

export function parseArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): ExportArgs {
  const args: ExportArgs = {
    databaseUrl: env.DATABASE_URL,
    count: DEFAULT_COUNT,
    out: "/tmp/memory-eval/threads-fixture.json",
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--database-url":
        args.databaseUrl = requireValue(argv, ++i, arg);
        break;
      case "--count":
        args.count = parsePositiveInt(requireValue(argv, ++i, arg), arg);
        break;
      case "--out":
        args.out = requireValue(argv, ++i, arg);
        break;
      case "--json":
        args.json = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
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

function parsePositiveInt(value: string, flag: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${flag} must be a positive integer, got: ${value}`);
  }
  return n;
}

function printHelp(): void {
  console.log(`Usage: export-threads [options]

Options:
  --database-url <url>   Dev Postgres URL. Also reads DATABASE_URL
  --count <n>             Total threads to select, split across 3 size
                          buckets (default ${DEFAULT_COUNT})
  --out <path>            Fixture JSON output path
  --json                  Print the fixture to stdout as well as writing it

Read-only. Excludes threads flagged evalTraffic and titles matching
${TITLE_EXCLUSION_PATTERN}.`);
}

/**
 * Stratified selection SQL: bucket threads into 3 size tiers by total
 * transcript characters, then randomly sample `perBucket` from each tier.
 * `$1` is the per-bucket row-number cutoff.
 */
export function buildSelectionSql(): string {
  return `
    WITH thread_stats AS (
      SELECT m.thread_id,
             t.title,
             t.tenant_id,
             COUNT(*) FILTER (WHERE m.content IS NOT NULL AND length(trim(m.content)) > 0) AS msg_count,
             SUM(length(m.content)) AS char_count
      FROM messages m
      JOIN threads t ON t.id = m.thread_id
      WHERE COALESCE(m.metadata->>'evalTraffic', 'false') NOT IN ('true')
        AND t.title !~* '${TITLE_EXCLUSION_PATTERN}'
      GROUP BY 1, 2, 3
      HAVING COUNT(*) FILTER (WHERE m.content IS NOT NULL AND length(trim(m.content)) > 0) >= 4
    ),
    buckets AS (
      SELECT *, NTILE(${BUCKETS}) OVER (ORDER BY char_count) AS size_bucket
      FROM thread_stats
    )
    SELECT thread_id, title, tenant_id, msg_count, char_count
    FROM (
      SELECT b.*, ROW_NUMBER() OVER (PARTITION BY size_bucket ORDER BY random()) AS rn
      FROM buckets b
    ) x
    WHERE rn <= $1
    ORDER BY size_bucket, char_count
  `;
}

export function buildTranscriptSql(): string {
  return `
    SELECT thread_id, role, content, created_at
    FROM messages
    WHERE thread_id = ANY($1)
      AND content IS NOT NULL AND length(trim(content)) > 0
    ORDER BY thread_id ASC, created_at ASC
  `;
}

/** Mirrors fetchThreadTranscript's role coercion (memory-retain.ts:854-858). */
export function coerceRole(role: unknown): "user" | "assistant" | "system" {
  return role === "assistant" || role === "system"
    ? (role as "assistant" | "system")
    : "user";
}

const CREDENTIAL_PATTERNS: Array<[RegExp, string]> = [
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]"],
  [/\bsk-[A-Za-z0-9]{20,}\b/g, "[REDACTED_API_KEY]"],
  [/\bBearer\s+[A-Za-z0-9._-]{20,}\b/gi, "Bearer [REDACTED_TOKEN]"],
  [
    /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    "[REDACTED_JWT]",
  ],
];

/**
 * Best-effort scrub for obvious credential-shaped strings before the
 * fixture is fed to Bedrock. Not a substitute for a manual review pass —
 * commit a diff review before treating the fixture as safe to reuse.
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of CREDENTIAL_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export async function runExportThreads(
  args: ExportArgs,
  options: { db?: QueryClient } = {},
): Promise<ThreadsFixture> {
  let pool: Pool | undefined;
  const db =
    options.db ??
    (args.databaseUrl
      ? ((pool = new Pool({
          connectionString: args.databaseUrl,
        })) as unknown as QueryClient)
      : undefined);
  if (!db) {
    throw new Error(
      "DATABASE_URL is required (env or --database-url) — export-threads reads dev Postgres",
    );
  }

  try {
    const perBucket = Math.ceil(args.count / BUCKETS);
    const selection = await db.query(buildSelectionSql(), [perBucket]);
    const rows = (selection.rows as ThreadSelectionRow[]).slice(0, args.count);
    if (rows.length === 0) {
      return { generatedAt: new Date().toISOString(), count: 0, threads: [] };
    }

    const threadIds = rows.map((r) => r.thread_id);
    const transcripts = await db.query(buildTranscriptSql(), [threadIds]);
    const byThread = new Map<string, FixtureMessage[]>();
    for (const row of transcripts.rows as Array<{
      thread_id: string;
      role: string;
      content: string;
      created_at: string | Date;
    }>) {
      const list = byThread.get(row.thread_id) ?? [];
      list.push({
        role: coerceRole(row.role),
        content: redactSecrets(row.content.trim()),
        timestamp: new Date(row.created_at).toISOString(),
      });
      byThread.set(row.thread_id, list);
    }

    const threads: FixtureThread[] = rows
      .map((row) => ({
        threadId: row.thread_id,
        tenantId: row.tenant_id,
        title: redactSecrets(row.title),
        messages: byThread.get(row.thread_id) ?? [],
      }))
      .filter((t) => t.messages.length > 0);

    return {
      generatedAt: new Date().toISOString(),
      count: threads.length,
      threads,
    };
  } finally {
    await pool?.end();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const fixture = await runExportThreads(args);

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(fixture, null, 2), "utf8");
  console.log(
    `[export-threads] wrote ${fixture.threads.length} threads to ${args.out}`,
  );

  if (args.json) {
    console.log(JSON.stringify(fixture, null, 2));
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  main().catch((err) => {
    console.error(`[export-threads] fatal: ${(err as Error).stack ?? err}`);
    process.exit(1);
  });
}

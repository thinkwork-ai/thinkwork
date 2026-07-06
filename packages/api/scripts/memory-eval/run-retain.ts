#!/usr/bin/env -S tsx
/**
 * THINK-198 memory-quality eval harness — step 2: replay the frozen fixture's
 * threads through retain against ONE candidate's local Hindsight container,
 * then read back the extracted memory units by document_id.
 *
 * Wire-format parity with production: reproduces
 * `HindsightAdapter.retainConversation` exactly (retainConversation, line
 * 412-441 in packages/api/src/lib/memory/adapters/hindsight-adapter.ts) —
 * one POST per thread with the whole transcript flattened into a single
 * `content` string, lines `"{role} ({ISO timestamp}): {content}"`, joined by
 * `\n`; `document_id` = threadId; `update_mode: "replace"`;
 * `context: "thinkwork_thread"`. Retain is synchronous (no `async: true`) —
 * the request returns only once extraction has completed. Companion
 * `docker-compose.yml` in this directory boots the local Hindsight + pgvector
 * Postgres pair (see README.md for the full recipe).
 *
 * Usage:
 *   npx tsx packages/api/scripts/memory-eval/run-retain.ts \
 *     --candidate gpt-oss-20b-baseline \
 *     --hindsight-url http://localhost:8888 \
 *     --bank evalrun \
 *     --schema eval_gptoss20b \
 *     --fixture /tmp/memory-eval/threads-fixture.json \
 *     --out /tmp/memory-eval/runs/gpt-oss-20b-baseline.units.json
 */

import { pathToFileURL } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Pool } from "pg";
import type { FixtureMessage, ThreadsFixture } from "./export-threads.js";

export interface RunRetainArgs {
  candidate: string;
  hindsightUrl: string;
  bank: string;
  schema: string;
  fixture: string;
  out: string;
  databaseUrl: string;
  timeoutMs: number;
}

export interface QueryClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export type FetchImpl = typeof fetch;

export interface MemoryUnitRow {
  id: string;
  text: string;
  context: string | null;
  fact_type: string | null;
  document_id: string | null;
  created_at: string | Date;
}

export interface RetainThreadResult {
  threadId: string;
  title: string;
  wallMs: number;
  ok: boolean;
  error?: string;
  itemsCount?: number;
  usage?: unknown;
  units: Array<{
    id: string;
    text: string;
    context: string | null;
    factType: string | null;
  }>;
}

export interface RunRetainReport {
  candidate: string;
  generatedAt: string;
  hindsightUrl: string;
  bank: string;
  schema: string;
  totalWallMs: number;
  threads: RetainThreadResult[];
}

const DEFAULT_HINDSIGHT_URL = "http://localhost:8888";
const DEFAULT_BANK = "evalrun";
const DEFAULT_DATABASE_URL =
  "postgresql://postgres:hindsight@localhost:5433/hindsight";
const DEFAULT_TIMEOUT_MS = 300_000;

export function parseArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): RunRetainArgs {
  const args: RunRetainArgs = {
    candidate: env.CANDIDATE || "",
    hindsightUrl: env.HINDSIGHT_URL || DEFAULT_HINDSIGHT_URL,
    bank: env.HINDSIGHT_BANK || DEFAULT_BANK,
    schema: env.CANDIDATE_SCHEMA || "",
    fixture: "",
    out: "",
    databaseUrl: env.EVAL_DATABASE_URL || DEFAULT_DATABASE_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--candidate":
        args.candidate = requireValue(argv, ++i, arg);
        break;
      case "--hindsight-url":
        args.hindsightUrl = requireValue(argv, ++i, arg).replace(/\/$/, "");
        break;
      case "--bank":
        args.bank = requireValue(argv, ++i, arg);
        break;
      case "--schema":
        args.schema = requireValue(argv, ++i, arg);
        break;
      case "--fixture":
        args.fixture = requireValue(argv, ++i, arg);
        break;
      case "--out":
        args.out = requireValue(argv, ++i, arg);
        break;
      case "--database-url":
        args.databaseUrl = requireValue(argv, ++i, arg);
        break;
      case "--timeout-ms":
        args.timeoutMs = Number.parseInt(requireValue(argv, ++i, arg), 10);
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

  if (!args.candidate) throw new Error("--candidate is required");
  if (!args.schema) throw new Error("--schema is required");
  if (!args.fixture) throw new Error("--fixture is required");
  if (!args.out) throw new Error("--out is required");

  return args;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function printHelp(): void {
  console.log(`Usage: run-retain --candidate <name> --schema <pg-schema> --fixture <path> --out <path> [options]

Options:
  --hindsight-url <url>   Local Hindsight base URL (default ${DEFAULT_HINDSIGHT_URL})
  --bank <id>             Hindsight bank id (default ${DEFAULT_BANK})
  --database-url <url>    Local eval Postgres URL for unit readback
                          (default ${DEFAULT_DATABASE_URL}, also EVAL_DATABASE_URL)
  --timeout-ms <n>        Per-thread sync retain timeout (default ${DEFAULT_TIMEOUT_MS})

Replays every thread in the fixture through retain against ONE running
candidate container, then reads extracted units back from
<schema>.memory_units by document_id.`);
}

/**
 * Reproduces HindsightAdapter.retainConversation's exact content
 * serialization (hindsight-adapter.ts:412-424): one line per message,
 * "{role} ({ISO timestamp}): {content}", joined by "\n".
 */
export function serializeTranscript(messages: FixtureMessage[]): string {
  return messages
    .filter((m) => m.content && m.content.trim().length > 0)
    .map(
      (m) =>
        `${m.role} (${new Date(m.timestamp).toISOString()}): ${m.content.trim()}`,
    )
    .join("\n");
}

export async function postRetain(
  fetchImpl: FetchImpl,
  hindsightUrl: string,
  bank: string,
  threadId: string,
  content: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; body: unknown; wallMs: number }> {
  const started = Date.now();
  const resp = await fetchImpl(
    `${hindsightUrl}/v1/default/banks/${encodeURIComponent(bank)}/memories`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            content,
            document_id: threadId,
            update_mode: "replace",
            context: "thinkwork_thread",
          },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  const wallMs = Date.now() - started;
  const body = await resp.json().catch(() => null);
  return { ok: resp.ok, status: resp.status, body, wallMs };
}

function validateSchemaName(schema: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error(`Invalid schema: ${schema}`);
  }
  return schema;
}

export async function fetchUnitsForDocument(
  db: QueryClient,
  schema: string,
  bank: string,
  threadId: string,
): Promise<MemoryUnitRow[]> {
  const safeSchema = validateSchemaName(schema);
  const result = await db.query(
    `SELECT id, text, context, fact_type, document_id, created_at
     FROM ${safeSchema}.memory_units
     WHERE bank_id = $1 AND document_id = $2
     ORDER BY created_at ASC`,
    [bank, threadId],
  );
  return result.rows as MemoryUnitRow[];
}

export async function runRetainForFixture(
  args: RunRetainArgs,
  fixture: ThreadsFixture,
  options: { fetchImpl?: FetchImpl; db?: QueryClient } = {},
): Promise<RunRetainReport> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let pool: Pool | undefined;
  const db =
    options.db ??
    ((pool = new Pool({
      connectionString: args.databaseUrl,
    })) as unknown as QueryClient);

  const threads: RetainThreadResult[] = [];
  let totalWallMs = 0;

  try {
    for (const thread of fixture.threads) {
      const content = serializeTranscript(thread.messages);
      if (!content) continue;

      let ok = true;
      let error: string | undefined;
      let itemsCount: number | undefined;
      let usage: unknown;
      let wallMs = 0;

      try {
        const resp = await postRetain(
          fetchImpl,
          args.hindsightUrl,
          args.bank,
          thread.threadId,
          content,
          args.timeoutMs,
        );
        wallMs = resp.wallMs;
        ok = resp.ok;
        if (!ok) {
          error = `retain ${resp.status}: ${JSON.stringify(resp.body)}`;
        } else if (resp.body && typeof resp.body === "object") {
          const body = resp.body as Record<string, unknown>;
          itemsCount =
            typeof body.items_count === "number" ? body.items_count : undefined;
          usage = body.usage;
        }
      } catch (err) {
        ok = false;
        error = (err as Error).message;
      }

      totalWallMs += wallMs;

      let units: RetainThreadResult["units"] = [];
      if (ok) {
        const rows = await fetchUnitsForDocument(
          db,
          args.schema,
          args.bank,
          thread.threadId,
        );
        units = rows.map((r) => ({
          id: r.id,
          text: r.text,
          context: r.context,
          factType: r.fact_type,
        }));
      }

      threads.push({
        threadId: thread.threadId,
        title: thread.title,
        wallMs,
        ok,
        ...(error ? { error } : {}),
        ...(itemsCount !== undefined ? { itemsCount } : {}),
        ...(usage !== undefined ? { usage } : {}),
        units,
      });
    }
  } finally {
    await pool?.end();
  }

  return {
    candidate: args.candidate,
    generatedAt: new Date().toISOString(),
    hindsightUrl: args.hindsightUrl,
    bank: args.bank,
    schema: args.schema,
    totalWallMs,
    threads,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const fixture: ThreadsFixture = JSON.parse(
    await readFile(args.fixture, "utf8"),
  );

  const report = await runRetainForFixture(args, fixture);

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(report, null, 2), "utf8");

  const failed = report.threads.filter((t) => !t.ok).length;
  const totalUnits = report.threads.reduce((n, t) => n + t.units.length, 0);
  console.log(
    `[run-retain] candidate=${args.candidate} threads=${report.threads.length} failed=${failed} units=${totalUnits} totalWallMs=${report.totalWallMs}`,
  );
  console.log(`[run-retain] wrote ${args.out}`);
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  main().catch((err) => {
    console.error(`[run-retain] fatal: ${(err as Error).stack ?? err}`);
    process.exit(1);
  });
}

/**
 * Journaled Drizzle schema application for packaged installs (U10).
 *
 * Terraform provisions an empty Aurora cluster; nothing on the local deploy
 * path applied the schema (drizzle-kit lives in the monorepo, unavailable to
 * npm/brew installs), so the first GraphQL query and `thinkwork bootstrap`
 * both failed on a fresh stage. The deploy tail now applies the journaled
 * migrations bundled into the CLI package, idempotently, through the Aurora
 * Data API (`aws rds-data`) — no direct DB connectivity or new deps needed.
 *
 * Hand-rolled non-journaled .sql files stay out of scope (they carry
 * `-- creates:` markers and are reported by `pnpm db:migrate-manual`).
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecResult } from "./state-backend.js";

export interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

export interface MigrationsSummary {
  applied: string[];
  skipped: number;
}

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

/** Read the drizzle journal (meta/_journal.json) in application order. */
export function readJournal(drizzleDir: string): JournalEntry[] {
  const journalPath = join(drizzleDir, "meta", "_journal.json");
  if (!existsSync(journalPath)) {
    throw new Error(
      `Bundled migrations journal not found at ${journalPath} — the CLI package may be incomplete.`,
    );
  }
  const parsed = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries?: { idx: number; tag: string; when: number }[];
  };
  return (parsed.entries ?? []).sort((a, b) => a.idx - b.idx);
}

/** Split a migration file on drizzle's statement breakpoints. */
export function splitStatements(sql: string): string[] {
  return sql
    .split(STATEMENT_BREAKPOINT)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Drizzle-compatible migration hash: sha256 of the whole file content. */
export function migrationHash(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

/** Aurora cluster ARN is deterministic: thinkwork-<stage>-db. */
export function clusterArn(
  region: string,
  accountId: string,
  stage: string,
): string {
  return `arn:aws:rds:${region}:${accountId}:cluster:thinkwork-${stage}-db`;
}

function defaultExec(args: string[]): ExecResult {
  const proc = spawnSync("aws", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    status: proc.status ?? 1,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
}

export interface DataApiTarget {
  resourceArn: string;
  secretArn: string;
  database: string;
  region: string;
}

function executeStatement(
  target: DataApiTarget,
  sql: string,
  exec: (args: string[]) => ExecResult,
  tempDir: string,
): ExecResult {
  // Long DDL goes via file:// to stay clear of argv limits.
  const sqlFile = join(tempDir, "statement.sql");
  writeFileSync(sqlFile, sql);
  return exec([
    "rds-data",
    "execute-statement",
    "--resource-arn",
    target.resourceArn,
    "--secret-arn",
    target.secretArn,
    "--database",
    target.database,
    "--region",
    target.region,
    "--sql",
    `file://${sqlFile}`,
    "--output",
    "json",
  ]);
}

/**
 * Apply pending journaled migrations. Idempotent: applied hashes are tracked
 * in drizzle.__drizzle_migrations (drizzle-orm's own table shape), so reruns
 * and partially-migrated databases resume from the journal position.
 */
export async function applyMigrations(options: {
  drizzleDir: string;
  target: DataApiTarget;
  exec?: (args: string[]) => ExecResult;
  log?: (line: string) => void;
}): Promise<MigrationsSummary> {
  const exec = options.exec ?? defaultExec;
  const log = options.log ?? (() => {});
  const tempDir = mkdtempSync(join(tmpdir(), "thinkwork-migrations-"));
  const entries = readJournal(options.drizzleDir);

  const bootstrapSql =
    "CREATE SCHEMA IF NOT EXISTS drizzle; " +
    "CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations " +
    "(id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);";
  const bootstrap = executeStatement(
    options.target,
    bootstrapSql,
    exec,
    tempDir,
  );
  if (bootstrap.status !== 0) {
    throw new Error(
      `Could not prepare the migrations table via the Data API: ${bootstrap.stderr.trim().slice(0, 300)}`,
    );
  }

  const appliedRes = executeStatement(
    options.target,
    "SELECT hash FROM drizzle.__drizzle_migrations;",
    exec,
    tempDir,
  );
  if (appliedRes.status !== 0) {
    throw new Error(
      `Could not read applied migrations: ${appliedRes.stderr.trim().slice(0, 300)}`,
    );
  }
  const appliedHashes = new Set<string>(
    (
      JSON.parse(appliedRes.stdout || "{}") as {
        records?: { stringValue?: string }[][];
      }
    ).records?.map((row) => row[0]?.stringValue ?? "") ?? [],
  );

  const summary: MigrationsSummary = { applied: [], skipped: 0 };
  for (const entry of entries) {
    const file = join(options.drizzleDir, `${entry.tag}.sql`);
    if (!existsSync(file)) {
      throw new Error(
        `Journal names ${entry.tag}.sql but the file is missing from the bundle.`,
      );
    }
    const sql = readFileSync(file, "utf8");
    const hash = migrationHash(sql);
    if (appliedHashes.has(hash)) {
      summary.skipped += 1;
      continue;
    }

    log(`applying ${entry.tag}`);
    for (const statement of splitStatements(sql)) {
      const res = executeStatement(options.target, statement, exec, tempDir);
      if (res.status !== 0) {
        throw new Error(
          `Migration ${entry.tag} failed (rerun \`thinkwork deploy\` to resume from this point): ` +
            res.stderr.trim().slice(0, 500),
        );
      }
    }

    const record = executeStatement(
      options.target,
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('${hash}', ${entry.when});`,
      exec,
      tempDir,
    );
    if (record.status !== 0) {
      throw new Error(
        `Migration ${entry.tag} applied but could not be recorded: ${record.stderr.trim().slice(0, 300)}`,
      );
    }
    summary.applied.push(entry.tag);
  }
  return summary;
}

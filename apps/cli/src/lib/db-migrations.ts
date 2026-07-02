/**
 * Full-history schema application for packaged installs (U10, reworked after
 * harness cycle 7).
 *
 * Terraform provisions an empty Aurora cluster. The original U10 approach —
 * journaled migrations via the Aurora Data API — failed on real greenfield
 * stacks twice over: the journal is frozen at 0019 while ~200 hand-rolled
 * files carry the actual schema history (journaled 0019 even depends on
 * hand-rolled 0018_skill_runs), and the Data API rejects the psql-grade SQL
 * those files use (multi-statements, DO $$ bodies, inline BEGIN/COMMIT).
 *
 * The cluster is publicly accessible by platform design (password auth;
 * `db:push` relies on the same posture), so this runner connects directly
 * with node-postgres and applies EVERY migration file in numeric order with
 * full psql semantics:
 *
 *   - `*_rollback.sql` files are excluded;
 *   - `\`-prefixed psql meta lines (\set, \echo, \if...) are stripped;
 *   - `:'stage'` interpolation resolves to the deploying stage;
 *   - `:'writer_pass' / :'drainer_pass' / :'reader_pass'` (compliance role
 *     bootstrap, 0070) resolve from the stage's Secrets Manager containers —
 *     generated and stored on first use, folding the manual
 *     bootstrap-compliance-roles.sh step into `thinkwork deploy`;
 *   - files needing any OTHER operator-provided psql variable (e.g. the
 *     dev-only 0076 backfill) are skipped with a warning;
 *   - application is hash-tracked in drizzle.__drizzle_migrations (drizzle's
 *     own shape), so reruns resume exactly where they stopped.
 */

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ExecResult } from "./state-backend.js";

export interface MigrationsSummary {
  applied: string[];
  skipped: number;
  /** Files skipped because they need operator-provided psql variables. */
  skippedFiles: string[];
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

/**
 * Every applicable migration file in application order: numeric prefix, then
 * name (matches the order the files were applied to dev over time — same-
 * prefix files sort lexically, e.g. 0018_agent_workspace_overlay before
 * 0018_skill_runs before 0019_*).
 */
export function listMigrationFiles(drizzleDir: string): string[] {
  if (!existsSync(drizzleDir)) {
    throw new Error(
      `Bundled migrations not found at ${drizzleDir} — the CLI package may be incomplete.`,
    );
  }
  return readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql") && !f.endsWith("_rollback.sql"))
    .sort((a, b) => {
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
      return a.localeCompare(b);
    });
}

/** Remove psql meta-command lines (\set, \echo, \if, \endif, ...). */
export function stripPsqlMetaLines(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("\\"))
    .join("\n");
}

/** Distinct psql variable names referenced as :'name' or :{?name}. */
export function findPsqlVariables(sql: string): string[] {
  const names = new Set<string>();
  for (const m of sql.matchAll(/:'([a-z_]+)'/g)) names.add(m[1]);
  for (const m of sql.matchAll(/:\{\?([a-z_]+)\}/g)) names.add(m[1]);
  return [...names];
}

/** SQL-quote a value as a literal ('' escaping). */
function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Split SQL into individual statements, respecting line/block comments,
 * quoted strings/identifiers, and dollar-quoted bodies ($$...$$ / $tag$...).
 * Needed for files that cannot run inside a transaction (CREATE INDEX
 * CONCURRENTLY, procedures that COMMIT) — those must execute one statement
 * at a time in autocommit, exactly as `psql -f` would.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    // Line comment
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end + 1;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }
    // Block comment
    if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }
    // Single-quoted string
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j += 1;
      }
      current += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    // Double-quoted identifier
    if (sql[i] === '"') {
      const end = sql.indexOf('"', i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }
    // Dollar-quoted body ($$ or $tag$)
    const dollar = rest.match(/^\$[A-Za-z_]*\$/);
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (sql[i] === ";") {
      statements.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    current += sql[i];
    i += 1;
  }
  if (current.trim()) statements.push(current.trim());
  return statements.filter((s) => s.length > 0);
}

/** Statements that refuse to run inside any transaction block. */
export function requiresAutocommit(sql: string): boolean {
  return /(CREATE|DROP)\s+INDEX\s+CONCURRENTLY/i.test(sql);
}

const COMPLIANCE_VARS: Record<string, string> = {
  writer_pass: "writer",
  drainer_pass: "drainer",
  reader_pass: "reader",
};

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

/**
 * Resolve (or mint) a compliance role password from the stage's Secrets
 * Manager container. Terraform owns the container; the VALUE is normally
 * operator-populated via bootstrap-compliance-roles.sh — on a fresh stack
 * this generates it so `thinkwork deploy` needs no manual step.
 */
export function ensureCompliancePassword(
  stage: string,
  role: string,
  region: string,
  exec: (args: string[]) => ExecResult = defaultExec,
): string {
  const secretId = `thinkwork/${stage}/compliance/${role}-credentials`;
  const current = exec([
    "secretsmanager",
    "get-secret-value",
    "--secret-id",
    secretId,
    "--region",
    region,
    "--query",
    "SecretString",
    "--output",
    "text",
  ]);
  if (current.status === 0 && current.stdout.trim()) {
    try {
      const parsed = JSON.parse(current.stdout) as { password?: string };
      if (parsed.password) return parsed.password;
    } catch {
      // fall through to minting a fresh value
    }
  }
  const password = randomBytes(24).toString("base64url");
  const put = exec([
    "secretsmanager",
    "put-secret-value",
    "--secret-id",
    secretId,
    "--region",
    region,
    "--secret-string",
    JSON.stringify({ username: `compliance_${role}`, password }),
  ]);
  if (put.status !== 0) {
    throw new Error(
      `Could not populate ${secretId}: ${put.stderr.trim().slice(0, 300)}`,
    );
  }
  return password;
}

export interface PgConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** Minimal query surface so tests can inject a fake client. */
export interface SqlRunner {
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}

async function connectPg(connection: PgConnection): Promise<SqlRunner> {
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    ...connection,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await client.connect();
  return client;
}

function rowsOf(result: unknown): { hash?: string }[] {
  const last = Array.isArray(result) ? result[result.length - 1] : result;
  return ((last as { rows?: { hash?: string }[] })?.rows ?? []) as {
    hash?: string;
  }[];
}

/**
 * Apply the full migration history to the stage database. Idempotent —
 * applied hashes are tracked in drizzle.__drizzle_migrations, so reruns and
 * partially-migrated databases resume from the failure point.
 */
export async function applyMigrations(options: {
  drizzleDir: string;
  stage: string;
  region: string;
  connection: PgConnection;
  connect?: (connection: PgConnection) => Promise<SqlRunner>;
  exec?: (args: string[]) => ExecResult;
  log?: (line: string) => void;
}): Promise<MigrationsSummary> {
  const log = options.log ?? (() => {});
  const exec = options.exec ?? defaultExec;
  const files = listMigrationFiles(options.drizzleDir);
  const runner = await (options.connect ?? connectPg)(options.connection);

  try {
    await runner.query(
      "CREATE SCHEMA IF NOT EXISTS drizzle; " +
        "CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations " +
        "(id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);",
    );
    const appliedRes = await runner.query(
      "SELECT hash FROM drizzle.__drizzle_migrations;",
    );
    const appliedHashes = new Set(
      rowsOf(appliedRes)
        .map((r) => r.hash)
        .filter(Boolean),
    );

    const summary: MigrationsSummary = {
      applied: [],
      skipped: 0,
      skippedFiles: [],
    };

    // Resolve each file to runnable SQL (or a skip) up front.
    const pending: { file: string; hash: string; sql: string }[] = [];
    for (const file of files) {
      const raw = readFileSync(join(options.drizzleDir, file), "utf8");
      const hash = migrationHash(raw);
      if (appliedHashes.has(hash)) {
        summary.skipped += 1;
        continue;
      }

      let sql = stripPsqlMetaLines(raw);
      const unresolved: string[] = [];
      for (const name of findPsqlVariables(raw)) {
        let value: string | null = null;
        if (name === "stage") value = options.stage;
        else if (COMPLIANCE_VARS[name]) {
          value = ensureCompliancePassword(
            options.stage,
            COMPLIANCE_VARS[name],
            options.region,
            exec,
          );
        }
        if (value === null) unresolved.push(name);
        else sql = sql.replaceAll(`:'${name}'`, sqlLiteral(value));
      }
      if (unresolved.length > 0) {
        // Operator-only files (e.g. the dev-only 0076 backfill keyed on a
        // hand-passed variable) are not part of a fresh install.
        summary.skippedFiles.push(file);
        log(
          `skipping ${file} (needs operator-provided psql variable(s): ${unresolved.join(", ")})`,
        );
        continue;
      }
      pending.push({ file, hash, sql });
    }

    // Deferred-retry rounds: numeric file order is NOT reliable application
    // order — recent files sometimes take low numbers (0021_crm_work_links
    // depends on spaces from 0105; harness cycle-7 ledger entry). Apply what
    // succeeds, requeue what fails, and loop while progress is being made:
    // dependency order emerges by trial. Safe because each file runs in the
    // simple protocol's implicit transaction — a failed file rolls back.
    const errors = new Map<string, string>();
    while (pending.length > 0) {
      let progressed = false;
      for (let i = 0; i < pending.length; ) {
        const { file, hash, sql } = pending[i];
        try {
          if (requiresAutocommit(sql)) {
            // CONCURRENTLY (and COMMIT-ing procedures) refuse transaction
            // blocks — run the file one statement at a time in autocommit,
            // as psql -f would. These files are written idempotent
            // (IF NOT EXISTS) so a mid-file failure reruns cleanly.
            for (const statement of splitSqlStatements(sql)) {
              await runner.query(statement);
            }
          } else {
            await runner.query(sql);
          }
        } catch (err) {
          errors.set(file, err instanceof Error ? err.message : String(err));
          i += 1;
          continue;
        }
        await runner.query(
          `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${sqlLiteral(hash)}, ${Date.now()});`,
        );
        log(`applying ${file}`);
        summary.applied.push(file.replace(/\.sql$/, ""));
        errors.delete(file);
        pending.splice(i, 1);
        progressed = true;
      }
      if (!progressed) break;
    }
    if (pending.length > 0) {
      const detail = pending
        .slice(0, 3)
        .map(({ file }) => `${file}: ${errors.get(file) ?? "unknown error"}`)
        .join("\n    ");
      throw new Error(
        `${pending.length} migration(s) failed after dependency-order retries ` +
          `(rerun \`thinkwork deploy\` to resume from this point):\n    ${detail}`,
      );
    }
    return summary;
  } finally {
    await runner.end().catch(() => {});
  }
}

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyMigrations,
  clusterArn,
  ensureCompliancePassword,
  findPsqlVariables,
  listMigrationFiles,
  migrationHash,
  stripPsqlMetaLines,
  type SqlRunner,
} from "../src/lib/db-migrations.js";
import type { ExecResult } from "../src/lib/state-backend.js";

const ok = (stdout = ""): ExecResult => ({ status: 0, stdout, stderr: "" });

function makeDrizzleDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "drizzle-test-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

/** Fake pg client capturing every query; SELECT hash returns `hashes`. */
function fakeRunner(hashes: string[] = []): {
  runner: SqlRunner;
  queries: string[];
} {
  const queries: string[] = [];
  return {
    queries,
    runner: {
      async query(sql: string) {
        queries.push(sql);
        if (sql.includes("SELECT hash FROM")) {
          return { rows: hashes.map((hash) => ({ hash })) };
        }
        return { rows: [] };
      },
      async end() {},
    },
  };
}

describe("listMigrationFiles", () => {
  it("orders by numeric prefix then name, excluding rollbacks (cycle-7)", () => {
    const dir = makeDrizzleDir({
      "0019_condemned_dragon_man.sql": "x",
      "0018_skill_runs.sql": "x",
      "0018_agent_workspace_overlay.sql": "x",
      "0050_brain_v0_entity_subtype_rollback.sql": "x",
      "0012_eval_seed_unique.sql": "x",
      "0102_wiki_brain_owner_repair.sql": "x",
    });
    expect(listMigrationFiles(dir)).toEqual([
      "0012_eval_seed_unique.sql",
      "0018_agent_workspace_overlay.sql",
      "0018_skill_runs.sql",
      "0019_condemned_dragon_man.sql",
      "0102_wiki_brain_owner_repair.sql",
    ]);
  });
});

describe("psql compatibility helpers", () => {
  it("strips \\-prefixed meta lines and keeps SQL", () => {
    const sql = [
      "\\set ON_ERROR_STOP on",
      "BEGIN;",
      "\\if :{?stage}",
      "\\else",
      "\\set stage dev",
      "\\endif",
      "SELECT 1;",
      "COMMIT;",
    ].join("\n");
    const stripped = stripPsqlMetaLines(sql);
    expect(stripped).not.toContain("\\set");
    expect(stripped).toContain("BEGIN;");
    expect(stripped).toContain("SELECT 1;");
  });

  it("finds :'name' and :{?name} variables without matching ::casts", () => {
    const sql =
      "SELECT 'thinkwork-' || :'stage' || '-backups', id::text FROM t; \\if :{?computer_id}";
    expect(findPsqlVariables(sql).sort()).toEqual(["computer_id", "stage"]);
  });
});

describe("applyMigrations (direct pg)", () => {
  it("applies files in order with stage substitution and records hashes", async () => {
    const dir = makeDrizzleDir({
      "0001_b.sql": "CREATE TABLE b (id int);",
      "0000_a.sql":
        "\\set ON_ERROR_STOP on\nSELECT 'thinkwork-' || :'stage' || '-backups';",
    });
    const { runner, queries } = fakeRunner();
    const summary = await applyMigrations({
      drizzleDir: dir,
      stage: "hp1",
      region: "us-east-1",
      connection: {
        host: "h",
        port: 5432,
        user: "u",
        password: "p",
        database: "thinkwork",
      },
      connect: async () => runner,
    });
    expect(summary.applied).toEqual(["0000_a", "0001_b"]);
    expect(summary.skippedFiles).toEqual([]);
    const applied = queries.find((q) => q.includes("-backups"))!;
    expect(applied).toContain("'hp1'");
    expect(applied).not.toContain(":'stage'");
    expect(applied).not.toContain("\\set");
    expect(queries.filter((q) => q.includes("INSERT INTO drizzle"))).toHaveLength(
      2,
    );
  });

  it("skips already-applied hashes (idempotent rerun)", async () => {
    const content = "CREATE TABLE a (id int);";
    const dir = makeDrizzleDir({ "0000_a.sql": content });
    const { runner, queries } = fakeRunner([migrationHash(content)]);
    const summary = await applyMigrations({
      drizzleDir: dir,
      stage: "hp1",
      region: "us-east-1",
      connection: {
        host: "h",
        port: 5432,
        user: "u",
        password: "p",
        database: "thinkwork",
      },
      connect: async () => runner,
    });
    expect(summary.applied).toEqual([]);
    expect(summary.skipped).toBe(1);
    expect(queries.some((q) => q.includes("CREATE TABLE a"))).toBe(false);
  });

  it("skips operator-only files that need unresolvable variables (0076)", async () => {
    const dir = makeDrizzleDir({
      "0076_backfill.sql":
        "\\if :{?computer_id}\nUPDATE jobs SET computer_id = :'computer_id';",
      "0077_real.sql": "CREATE TABLE real (id int);",
    });
    const { runner, queries } = fakeRunner();
    const summary = await applyMigrations({
      drizzleDir: dir,
      stage: "hp1",
      region: "us-east-1",
      connection: {
        host: "h",
        port: 5432,
        user: "u",
        password: "p",
        database: "thinkwork",
      },
      connect: async () => runner,
    });
    expect(summary.skippedFiles).toEqual(["0076_backfill.sql"]);
    expect(summary.applied).toEqual(["0077_real"]);
    expect(queries.some((q) => q.includes("UPDATE jobs"))).toBe(false);
  });

  it("resolves compliance passwords from Secrets Manager (0070)", async () => {
    const dir = makeDrizzleDir({
      "0070_roles.sql":
        "SET LOCAL \"thinkwork.writer_pass\" = :'writer_pass';",
    });
    const { runner, queries } = fakeRunner();
    const execCalls: string[][] = [];
    const summary = await applyMigrations({
      drizzleDir: dir,
      stage: "hp1",
      region: "us-east-1",
      connection: {
        host: "h",
        port: 5432,
        user: "u",
        password: "p",
        database: "thinkwork",
      },
      connect: async () => runner,
      exec: (args) => {
        execCalls.push(args);
        if (args[1] === "get-secret-value") {
          return ok(JSON.stringify({ password: "w-secret" }));
        }
        return ok();
      },
    });
    expect(summary.applied).toEqual(["0070_roles"]);
    const applied = queries.find((q) => q.includes("writer_pass"))!;
    expect(applied).toContain("'w-secret'");
    expect(
      execCalls.some(
        (c) =>
          c[1] === "get-secret-value" &&
          c.includes("thinkwork/hp1/compliance/writer-credentials"),
      ),
    ).toBe(true);
  });

  it("fails with a resume hint when a migration errors", async () => {
    const dir = makeDrizzleDir({ "0000_a.sql": "CREATE TABLE a (id int);" });
    const runner: SqlRunner = {
      async query(sql: string) {
        if (sql.includes("SELECT hash FROM")) return { rows: [] };
        if (sql.includes("CREATE TABLE a")) {
          throw new Error('relation "public.skill_runs" does not exist');
        }
        return { rows: [] };
      },
      async end() {},
    };
    await expect(
      applyMigrations({
        drizzleDir: dir,
        stage: "hp1",
        region: "us-east-1",
        connection: {
          host: "h",
          port: 5432,
          user: "u",
          password: "p",
          database: "thinkwork",
        },
        connect: async () => runner,
      }),
    ).rejects.toThrow(/failed after dependency-order retries/);
  });
});

describe("dependency-order retries", () => {
  it("applies out-of-order files once their dependencies land (0021 vs 0105)", async () => {
    const dir = makeDrizzleDir({
      "0021_crm_work_links.sql": "ALTER TABLE spaces ADD COLUMN crm text;",
      "0105_spaces_domain.sql": "CREATE TABLE spaces (id int);",
    });
    const created = new Set<string>();
    const queries: string[] = [];
    const runner: SqlRunner = {
      async query(sql: string) {
        queries.push(sql);
        if (sql.includes("SELECT hash FROM")) return { rows: [] };
        if (sql.includes("ALTER TABLE spaces") && !created.has("spaces")) {
          throw new Error('relation "public.spaces" does not exist');
        }
        if (sql.includes("CREATE TABLE spaces")) created.add("spaces");
        return { rows: [] };
      },
      async end() {},
    };
    const summary = await applyMigrations({
      drizzleDir: dir,
      stage: "hp1",
      region: "us-east-1",
      connection: {
        host: "h",
        port: 5432,
        user: "u",
        password: "p",
        database: "thinkwork",
      },
      connect: async () => runner,
    });
    expect(summary.applied).toEqual(["0105_spaces_domain", "0021_crm_work_links"]);
  });
});

describe("ensureCompliancePassword", () => {
  it("mints and stores a password when the container is empty", () => {
    const calls: string[][] = [];
    const password = ensureCompliancePassword("hp1", "writer", "us-east-1", (args) => {
      calls.push(args);
      if (args[1] === "get-secret-value") {
        return { status: 254, stdout: "", stderr: "empty" };
      }
      return ok();
    });
    expect(password.length).toBeGreaterThan(20);
    const put = calls.find((c) => c[1] === "put-secret-value")!;
    expect(put).toContain("thinkwork/hp1/compliance/writer-credentials");
    expect(put.join(" ")).toContain(password);
  });
});

describe("clusterArn", () => {
  it("builds the deterministic cluster ARN", () => {
    expect(clusterArn("us-east-1", "123", "prod")).toBe(
      "arn:aws:rds:us-east-1:123:cluster:thinkwork-prod-db",
    );
  });
});

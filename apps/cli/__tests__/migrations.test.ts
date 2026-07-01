import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyMigrations,
  clusterArn,
  migrationHash,
  readJournal,
  splitStatements,
} from "../src/lib/db-migrations.js";
import type { ExecResult } from "../src/lib/state-backend.js";

const M1 =
  'CREATE TABLE "a" (id int);--> statement-breakpoint\nCREATE INDEX a_idx ON "a" (id);';
const M2 = 'CREATE TABLE "b" (id int);';

function makeDrizzleDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "drizzle-test-"));
  mkdirSync(join(dir, "meta"));
  writeFileSync(
    join(dir, "meta", "_journal.json"),
    JSON.stringify({
      entries: [
        { idx: 1, tag: "0001_second", when: 200 },
        { idx: 0, tag: "0000_first", when: 100 },
      ],
    }),
  );
  writeFileSync(join(dir, "0000_first.sql"), M1);
  writeFileSync(join(dir, "0001_second.sql"), M2);
  return dir;
}

const TARGET = {
  resourceArn: clusterArn("us-east-1", "123456789012", "prod"),
  secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:db",
  database: "thinkwork",
  region: "us-east-1",
};

function makeExec(appliedHashes: string[]): {
  exec: (args: string[]) => ExecResult;
  executed: string[];
} {
  const executed: string[] = [];
  const exec = (args: string[]): ExecResult => {
    const sqlFileArg = args[args.indexOf("--sql") + 1];
    const sql = sqlFileArg?.startsWith("file://")
      ? require("node:fs").readFileSync(sqlFileArg.slice(7), "utf8")
      : (sqlFileArg ?? "");
    executed.push(sql);
    if (sql.startsWith("SELECT hash")) {
      return {
        status: 0,
        stdout: JSON.stringify({
          records: appliedHashes.map((h) => [{ stringValue: h }]),
        }),
        stderr: "",
      };
    }
    return { status: 0, stdout: "{}", stderr: "" };
  };
  return { exec, executed };
}

describe("journal + statement helpers", () => {
  it("orders journal entries by idx and constructs the cluster ARN", () => {
    const entries = readJournal(makeDrizzleDir());
    expect(entries.map((e) => e.tag)).toEqual(["0000_first", "0001_second"]);
    expect(clusterArn("us-east-1", "1", "prod")).toBe(
      "arn:aws:rds:us-east-1:1:cluster:thinkwork-prod-db",
    );
  });

  it("splits on drizzle statement breakpoints", () => {
    expect(splitStatements(M1)).toHaveLength(2);
    expect(splitStatements(M2)).toHaveLength(1);
  });
});

describe("applyMigrations", () => {
  it("applies all pending migrations in journal order on a fresh database", async () => {
    const { exec, executed } = makeExec([]);
    const summary = await applyMigrations({
      drizzleDir: makeDrizzleDir(),
      target: TARGET,
      exec,
    });
    expect(summary.applied).toEqual(["0000_first", "0001_second"]);
    expect(summary.skipped).toBe(0);
    // bootstrap + select + (2 stmts + record) + (1 stmt + record)
    expect(executed.filter((s) => s.startsWith("INSERT INTO"))).toHaveLength(2);
    const firstTableIdx = executed.findIndex((s) => s.includes('"a"'));
    const secondTableIdx = executed.findIndex((s) => s.includes('"b"'));
    expect(firstTableIdx).toBeLessThan(secondTableIdx);
  });

  it("resumes a partially-migrated database from the journal position", async () => {
    const { exec, executed } = makeExec([migrationHash(M1)]);
    const summary = await applyMigrations({
      drizzleDir: makeDrizzleDir(),
      target: TARGET,
      exec,
    });
    expect(summary.skipped).toBe(1);
    expect(summary.applied).toEqual(["0001_second"]);
    expect(executed.some((s) => s.includes('"a"'))).toBe(false);
  });

  it("reruns as a no-op when everything is applied", async () => {
    const { exec } = makeExec([migrationHash(M1), migrationHash(M2)]);
    const summary = await applyMigrations({
      drizzleDir: makeDrizzleDir(),
      target: TARGET,
      exec,
    });
    expect(summary.applied).toEqual([]);
    expect(summary.skipped).toBe(2);
  });

  it("names the failing migration and the rerun path on error", async () => {
    const exec = (args: string[]): ExecResult => {
      const sqlFileArg = args[args.indexOf("--sql") + 1];
      const sql = sqlFileArg?.startsWith("file://")
        ? require("node:fs").readFileSync(sqlFileArg.slice(7), "utf8")
        : "";
      if (sql.startsWith("SELECT hash")) {
        return {
          status: 0,
          stdout: JSON.stringify({ records: [] }),
          stderr: "",
        };
      }
      if (sql.includes('"b"')) {
        return { status: 254, stdout: "", stderr: "syntax error near b" };
      }
      return { status: 0, stdout: "{}", stderr: "" };
    };
    await expect(
      applyMigrations({ drizzleDir: makeDrizzleDir(), target: TARGET, exec }),
    ).rejects.toThrow(/0001_second.*rerun/s);
  });
});

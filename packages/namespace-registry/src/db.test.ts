import { beforeEach, describe, expect, it, vi } from "vitest";

const execSync = vi.fn();
vi.mock("node:child_process", () => ({ execSync }));

const { resolveStageDatabaseUrl, DEFAULT_TENANT_DB_STAGE } = await import(
  "./db.js"
);

describe("resolveStageDatabaseUrl", () => {
  beforeEach(() => {
    execSync.mockReset();
  });

  it("builds a stage URL without an sslmode parameter", () => {
    // pg >= 8.20 treats a connection-string sslmode as verify-full and lets it
    // override the client's explicit `ssl` option, so the URL must stay
    // sslmode-free — TLS posture lives on the pg.Client `ssl` option instead.
    execSync
      .mockReturnValueOnce("db.cluster-abc.us-east-1.rds.amazonaws.com\n")
      .mockReturnValueOnce(
        JSON.stringify({ username: "thinkwork", password: "p@ss/word" }) + "\n",
      );

    const url = resolveStageDatabaseUrl("prod", {}, () => {});

    expect(url).toBe(
      "postgresql://thinkwork:p%40ss%2Fword@db.cluster-abc.us-east-1.rds.amazonaws.com:5432/thinkwork",
    );
    expect(url).not.toContain("sslmode");
  });

  it("passes DATABASE_URL through with a loud warning", () => {
    const warnings: string[] = [];
    const url = resolveStageDatabaseUrl(
      DEFAULT_TENANT_DB_STAGE,
      { DATABASE_URL: "postgresql://u:p@elsewhere:5432/thinkwork" },
      (message) => warnings.push(message),
    );

    expect(url).toBe("postgresql://u:p@elsewhere:5432/thinkwork");
    expect(warnings.join(" ")).toContain("BYPASSING");
    expect(execSync).not.toHaveBeenCalled();
  });

  it("rejects invalid stage names before shelling out", () => {
    expect(() => resolveStageDatabaseUrl("Bad Stage!", {}, () => {})).toThrow(
      /invalid stage name/,
    );
    expect(execSync).not.toHaveBeenCalled();
  });
});

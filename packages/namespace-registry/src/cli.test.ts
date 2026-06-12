import { describe, expect, it } from "vitest";
import { runCli, type CliDeps } from "./cli.js";
import {
  CloudflareNamespaceClient,
  type FetchLike,
  type NamespaceDnsApi,
} from "./cloudflare.js";
import { DEFAULT_TENANT_DB_STAGE, type TenantSourceHandle } from "./db.js";
import { FakeDns, FakeTenants } from "./test-fakes.js";

interface Harness {
  deps: CliDeps;
  dns: FakeDns;
  tenants: FakeTenants;
  out: string[];
  err: string[];
  tenantSourceCalls: Array<{ stage: string }>;
}

function makeHarness(
  overrides: { dns?: NamespaceDnsApi; tenantSlugs?: string[] } = {},
): Harness {
  const dns = (overrides.dns as FakeDns) ?? new FakeDns();
  const tenants = new FakeTenants(overrides.tenantSlugs ?? []);
  const out: string[] = [];
  const err: string[] = [];
  const tenantSourceCalls: Array<{ stage: string }> = [];
  const deps: CliDeps = {
    env: { CLOUDFLARE_API_TOKEN: "test-token" },
    stdout: (m) => out.push(m),
    stderr: (m) => err.push(m),
    createDns: () => overrides.dns ?? dns,
    createTenantSource: async ({ stage }): Promise<TenantSourceHandle> => {
      tenantSourceCalls.push({ stage });
      return { source: tenants, close: async () => {} };
    },
    today: () => "2026-06-12",
  };
  return { deps, dns, tenants, out, err, tenantSourceCalls };
}

describe("cli — flag strictness", () => {
  it("rejects claim --skip-db as an unknown flag", async () => {
    const h = makeHarness();
    const code = await runCli(
      ["claim", "tei", "--tenant-slug", "tei", "--skip-db"],
      h.deps,
    );
    expect(code).toBe(2);
    expect(h.err.join("\n")).toContain('unknown flag for "claim": --skip-db');
    expect(h.tenantSourceCalls).toEqual([]);
    expect(h.dns.calls).toEqual([]);
  });

  it("check --skip-db works and flags the skipped leg loudly", async () => {
    const h = makeHarness({ tenantSlugs: ["tei"] });
    const code = await runCli(["check", "tei", "--skip-db"], h.deps);
    expect(code).toBe(0); // available — the DB leg (which would say taken) was skipped
    const stderr = h.err.join("\n");
    expect(stderr).toContain("WARNING");
    expect(stderr).toContain("--skip-db");
    expect(stderr).toContain("SKIPPED");
    expect(h.out.join("\n")).toContain("cloudflare ONLY (--skip-db)");
    // The DB leg must not even be opened.
    expect(h.tenantSourceCalls).toEqual([]);
  });

  it("release does not accept --skip-db either", async () => {
    const h = makeHarness();
    const code = await runCli(
      ["release", "tei", "--owner", "tei", "--skip-db"],
      h.deps,
    );
    expect(code).toBe(2);
    expect(h.err.join("\n")).toContain("unknown flag");
  });
});

describe("cli — tenant DB stage resolution", () => {
  it("defaults the tenants-table authority to production", async () => {
    const h = makeHarness();
    const code = await runCli(["check", "tei"], h.deps);
    expect(code).toBe(0);
    expect(h.tenantSourceCalls).toEqual([{ stage: DEFAULT_TENANT_DB_STAGE }]);
    expect(DEFAULT_TENANT_DB_STAGE).toBe("prod");
    // No override → no warning.
    expect(h.err.join("\n")).not.toContain("WARNING");
  });

  it("--tenant-db-stage override emits the loud warning", async () => {
    const h = makeHarness();
    const code = await runCli(
      ["check", "tei", "--tenant-db-stage", "dev"],
      h.deps,
    );
    expect(code).toBe(0);
    expect(h.tenantSourceCalls).toEqual([{ stage: "dev" }]);
    const stderr = h.err.join("\n");
    expect(stderr).toContain("!!! WARNING");
    expect(stderr).toContain("--tenant-db-stage=dev");
    expect(stderr).toContain("PRODUCTION");
  });

  it("claim uses the production authority by default too", async () => {
    const h = makeHarness();
    const code = await runCli(["claim", "tei", "--tenant-slug", "tei"], h.deps);
    expect(code).toBe(0);
    expect(h.tenantSourceCalls).toEqual([{ stage: "prod" }]);
    expect(h.dns.records).toHaveLength(1);
    expect(h.dns.records[0]!.comment).toBe("deployment:tei created:2026-06-12");
  });
});

describe("cli — outcomes and exit codes", () => {
  it("claim refuses a tenant-slug mismatch before any write (KTD8)", async () => {
    const h = makeHarness();
    const code = await runCli(
      ["claim", "tei", "--tenant-slug", "lastmile-tei"],
      h.deps,
    );
    expect(code).toBe(1);
    expect(h.err.join("\n")).toContain("tenant-slug-mismatch");
    expect(h.dns.writes()).toEqual([]);
  });

  it("claim --dry-run writes nothing and exits 0", async () => {
    const h = makeHarness();
    const code = await runCli(
      ["claim", "tei", "--tenant-slug", "tei", "--dry-run"],
      h.deps,
    );
    expect(code).toBe(0);
    expect(h.out.join("\n")).toContain("would CREATE TXT tei.thinkwork.ai");
    expect(h.dns.records).toHaveLength(0);
  });

  it("claim --set-targets accepts a comma-separated list of 4", async () => {
    const h = makeHarness();
    h.dns.seed({
      type: "TXT",
      name: "tei.thinkwork.ai",
      content: "thinkwork-namespace-reservation",
      comment: "deployment:tei created:2026-06-12",
    });
    const code = await runCli(
      [
        "claim",
        "tei",
        "--tenant-slug",
        "tei",
        "--set-targets",
        "ns-1.awsdns-01.org,ns-2.awsdns-02.com,ns-3.awsdns-03.net,ns-4.awsdns-04.co.uk",
      ],
      h.deps,
    );
    expect(code).toBe(0);
    expect(h.dns.records).toHaveLength(4);
    expect(h.dns.records.every((r) => r.type === "NS")).toBe(true);
  });

  it("check of a taken name exits non-zero", async () => {
    const h = makeHarness({ tenantSlugs: ["acme"] });
    const code = await runCli(["check", "acme"], h.deps);
    expect(code).toBe(1);
    expect(h.out.join("\n")).toContain("taken-tenant");
  });

  it("release refuses a name owned by another comment", async () => {
    const h = makeHarness();
    h.dns.seed({
      type: "TXT",
      name: "tei.thinkwork.ai",
      content: "thinkwork-namespace-reservation",
      comment: "deployment:rival created:2026-06-12",
    });
    const code = await runCli(["release", "tei", "--owner", "tei"], h.deps);
    expect(code).toBe(1);
    expect(h.err.join("\n")).toContain("owned-by-other");
    expect(h.dns.records).toHaveLength(1);
  });

  it("requires CLOUDFLARE_API_TOKEN", async () => {
    const h = makeHarness();
    h.deps.env = {};
    const code = await runCli(["check", "tei"], h.deps);
    expect(code).toBe(2);
    expect(h.err.join("\n")).toContain("CLOUDFLARE_API_TOKEN");
  });
});

describe("cli — Cloudflare error surfacing", () => {
  function failingFetch(status: number, body: unknown): FetchLike {
    return async () => ({
      ok: false,
      status,
      text: async () => JSON.stringify(body),
    });
  }

  it("surfaces the Cloudflare error body as a non-zero exit, with the 10000 token-drift note", async () => {
    const body = {
      success: false,
      result: null,
      errors: [{ code: 10000, message: "Authentication error" }],
    };
    const client = new CloudflareNamespaceClient({
      token: "drifted-token",
      fetchImpl: failingFetch(403, body),
    });
    const h = makeHarness({ dns: client });
    const code = await runCli(["check", "tei"], h.deps);
    expect(code).toBe(1);
    const stderr = h.err.join("\n");
    expect(stderr).toContain("Cloudflare API GET");
    expect(stderr).toContain('"code":10000');
    expect(stderr).toContain("Authentication error");
    expect(stderr).toContain("token has drifted");
  });

  it("surfaces non-10000 Cloudflare errors with the body but no drift note", async () => {
    const body = {
      success: false,
      result: null,
      errors: [{ code: 81044, message: "Record does not exist." }],
    };
    const client = new CloudflareNamespaceClient({
      token: "test-token",
      fetchImpl: failingFetch(404, body),
    });
    const h = makeHarness({ dns: client });
    const code = await runCli(["check", "tei"], h.deps);
    expect(code).toBe(1);
    const stderr = h.err.join("\n");
    expect(stderr).toContain("Record does not exist.");
    expect(stderr).not.toContain("token has drifted");
  });
});

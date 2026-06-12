import { describe, expect, it } from "vitest";
import { formatClaimComment } from "./comment-format.js";
import {
  RESERVATION_TXT_CONTENT,
  checkName,
  claimName,
  releaseName,
  type NamespaceDeps,
} from "./core.js";
import { FakeDns, FakeTenants } from "./test-fakes.js";

const TODAY = "2026-06-12";

function makeDeps(overrides: Partial<NamespaceDeps> = {}): {
  deps: NamespaceDeps;
  dns: FakeDns;
  tenants: FakeTenants;
} {
  const dns = new FakeDns();
  const tenants = new FakeTenants();
  const deps: NamespaceDeps = {
    dns,
    tenants,
    today: () => TODAY,
    ...overrides,
  };
  return { deps, dns: (deps.dns as FakeDns) ?? dns, tenants };
}

const TEI_COMMENT = formatClaimComment({
  kind: "deployment",
  owner: "tei",
  created: TODAY,
});

const NS_TARGETS = [
  "ns-1.awsdns-01.org",
  "ns-2.awsdns-02.com",
  "ns-3.awsdns-03.net",
  "ns-4.awsdns-04.co.uk",
];

describe("claimName — phase one", () => {
  // Covers #15: shape validation precedes both sources.
  it("rejects an invalid name shape before any API call", async () => {
    const { deps, dns, tenants } = makeDeps();
    const result = await claimName(deps, {
      name: "-bad-",
      tenantSlug: "-bad-",
      kind: "deployment",
      owner: "bad",
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid-name" });
    expect(dns.calls).toEqual([]);
    expect(tenants.calls).toEqual([]);
  });

  // An owner the comment grammar can't represent would strand a record
  // postWriteVerify can never attribute back to us — refuse up front.
  it("rejects an owner the comment grammar cannot represent before any API call", async () => {
    const { deps, dns, tenants } = makeDeps();
    const result = await claimName(deps, {
      name: "tei",
      tenantSlug: "tei",
      kind: "deployment",
      owner: "TEI Corp",
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid-owner" });
    expect(dns.calls).toEqual([]);
    expect(tenants.calls).toEqual([]);
  });

  // Covers AE2.
  it("rejects a reserved name (api) before any API call", async () => {
    const { deps, dns, tenants } = makeDeps();
    const result = await claimName(deps, {
      name: "api",
      tenantSlug: "api",
      kind: "deployment",
      owner: "api",
    });
    expect(result).toMatchObject({ ok: false, reason: "reserved" });
    expect(dns.calls).toEqual([]);
    expect(tenants.calls).toEqual([]);
  });

  it("rejects the new 'canary' reserved slug before any API call", async () => {
    const { deps, dns } = makeDeps();
    const result = await claimName(deps, {
      name: "canary",
      tenantSlug: "canary",
      kind: "deployment",
      owner: "canary",
    });
    expect(result).toMatchObject({ ok: false, reason: "reserved" });
    expect(dns.calls).toEqual([]);
  });

  it("writes one TXT reservation carrying the exported comment constant verbatim", async () => {
    const { deps, dns } = makeDeps();
    const result = await claimName(deps, {
      name: "tei",
      tenantSlug: "tei",
      kind: "deployment",
      owner: "tei",
    });
    expect(result).toMatchObject({ ok: true, action: "reserved" });
    expect(dns.records).toHaveLength(1);
    const record = dns.records[0]!;
    expect(record.type).toBe("TXT");
    expect(record.name).toBe("tei.thinkwork.ai");
    expect(record.content).toBe(RESERVATION_TXT_CONTENT);
    expect(record.comment).toBe(TEI_COMMENT);
    expect(record.comment).toBe("deployment:tei created:2026-06-12");
  });

  it("reports taken and writes nothing when any Cloudflare record exists at the name", async () => {
    const { deps, dns } = makeDeps();
    dns.seed({
      type: "A",
      name: "tei.thinkwork.ai",
      content: "203.0.113.7",
      comment: null,
    });
    const result = await claimName(deps, {
      name: "tei",
      tenantSlug: "tei",
      kind: "deployment",
      owner: "tei",
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "taken",
      source: "cloudflare",
    });
    expect(dns.writes()).toEqual([]);
  });

  it("reports taken (DB source) when an existing tenant holds the slug", async () => {
    const { deps, dns, tenants } = makeDeps();
    tenants.slugs.add("tei");
    const result = await claimName(deps, {
      name: "tei",
      tenantSlug: "tei",
      kind: "deployment",
      owner: "tei",
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "taken",
      source: "tenants",
    });
    expect(dns.writes()).toEqual([]);
  });

  it("is idempotent for a re-claim by the same owner", async () => {
    const { deps, dns } = makeDeps();
    dns.seed({
      type: "TXT",
      name: "tei.thinkwork.ai",
      content: RESERVATION_TXT_CONTENT,
      comment: formatClaimComment({
        kind: "deployment",
        owner: "tei",
        created: "2026-06-01",
      }),
    });
    const result = await claimName(deps, {
      name: "tei",
      tenantSlug: "tei",
      kind: "deployment",
      owner: "tei",
    });
    expect(result).toMatchObject({ ok: true, action: "noop" });
    expect(dns.writes()).toEqual([]);
  });

  it("refuses before any write or read when the name does not match the tenant slug (KTD8)", async () => {
    const { deps, dns, tenants } = makeDeps();
    const result = await claimName(deps, {
      name: "tei",
      tenantSlug: "lastmile-tei",
      kind: "deployment",
      owner: "tei",
    });
    expect(result).toMatchObject({ ok: false, reason: "tenant-slug-mismatch" });
    expect(dns.calls).toEqual([]);
    expect(tenants.calls).toEqual([]);
  });

  it("dry-run performs the checks but writes nothing", async () => {
    const { deps, dns } = makeDeps();
    const result = await claimName(deps, {
      name: "tei",
      tenantSlug: "tei",
      kind: "deployment",
      owner: "tei",
      dryRun: true,
    });
    expect(result).toMatchObject({ ok: true, action: "dry-run" });
    expect(dns.writes()).toEqual([]);
    expect(dns.records).toHaveLength(0);
  });
});

describe("claimName — post-write verification (KTD4 / R14)", () => {
  it("deletes its own records and reports taken when a foreign-comment record appears post-write", async () => {
    const { deps, dns } = makeDeps();
    dns.afterCreate = () => {
      // Simulate losing the check-then-create race: a competing claim's
      // record lands between our list and our verify.
      dns.afterCreate = null;
      dns.seed({
        type: "TXT",
        name: "tei.thinkwork.ai",
        content: RESERVATION_TXT_CONTENT,
        comment: formatClaimComment({
          kind: "deployment",
          owner: "rival",
          created: TODAY,
        }),
      });
    };
    const result = await claimName(deps, {
      name: "tei",
      tenantSlug: "tei",
      kind: "deployment",
      owner: "tei",
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "lost-race",
      source: "cloudflare",
    });
    // Our own record was self-released; only the rival's record remains.
    expect(dns.records).toHaveLength(1);
    expect(dns.records[0]!.comment).toContain("deployment:rival");
  });

  it("self-releases and reports taken when a tenant row appears after the Cloudflare write", async () => {
    const { deps, dns, tenants } = makeDeps();
    // First lookup (pre-write): slug free. A tenant row is inserted before
    // the post-write re-check (R14 cross-source leg).
    tenants.beforeLookup = (_slug, callIndex) => {
      if (callIndex === 1) tenants.slugs.add("tei");
    };
    const result = await claimName(deps, {
      name: "tei",
      tenantSlug: "tei",
      kind: "deployment",
      owner: "tei",
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "lost-race",
      source: "tenants",
    });
    expect(tenants.calls).toEqual(["tei", "tei"]);
    expect(dns.records).toHaveLength(0); // self-released
  });

  it("self-releases its NS records when a rival record lands during phase two", async () => {
    const { deps, dns } = makeDeps();
    dns.seed({
      type: "TXT",
      name: "tei.thinkwork.ai",
      content: RESERVATION_TXT_CONTENT,
      comment: TEI_COMMENT,
    });
    dns.afterCreate = () => {
      // Rival claim lands between our first NS write and the verify pass.
      dns.afterCreate = null;
      dns.seed({
        type: "TXT",
        name: "tei.thinkwork.ai",
        content: RESERVATION_TXT_CONTENT,
        comment: formatClaimComment({
          kind: "deployment",
          owner: "rival",
          created: TODAY,
        }),
      });
    };
    const result = await claimName(deps, {
      name: "tei",
      tenantSlug: "tei",
      kind: "deployment",
      owner: "tei",
      targets: NS_TARGETS,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "lost-race",
      source: "cloudflare",
    });
    // Our placeholder TXT and all 4 NS records were self-released; only
    // the rival's record remains.
    expect(dns.records).toHaveLength(1);
    expect(dns.records[0]!.comment).toContain("deployment:rival");
  });
});

describe("claimName — phase two (--set-targets)", () => {
  it("replaces the owner's TXT with 4 comment-stamped NS records", async () => {
    const { deps, dns } = makeDeps();
    dns.seed({
      type: "TXT",
      name: "tei.thinkwork.ai",
      content: RESERVATION_TXT_CONTENT,
      comment: TEI_COMMENT,
    });
    const result = await claimName(deps, {
      name: "tei",
      tenantSlug: "tei",
      kind: "deployment",
      owner: "tei",
      targets: NS_TARGETS,
    });
    expect(result).toMatchObject({ ok: true, action: "targets-set" });
    expect(dns.records).toHaveLength(4);
    expect(dns.records.every((r) => r.type === "NS")).toBe(true);
    expect(dns.records.map((r) => r.content).sort()).toEqual(
      [...NS_TARGETS].sort(),
    );
    expect(dns.records.every((r) => r.comment === TEI_COMMENT)).toBe(true);
  });

  it("repeat invocation with identical targets is idempotent success with no writes", async () => {
    const { deps, dns } = makeDeps();
    dns.seed({
      type: "TXT",
      name: "tei.thinkwork.ai",
      content: RESERVATION_TXT_CONTENT,
      comment: TEI_COMMENT,
    });
    const request = {
      name: "tei",
      tenantSlug: "tei",
      kind: "deployment" as const,
      owner: "tei",
      targets: NS_TARGETS,
    };
    const first = await claimName(deps, request);
    expect(first).toMatchObject({ ok: true, action: "targets-set" });

    dns.calls = [];
    const second = await claimName(deps, request);
    expect(second).toMatchObject({ ok: true, action: "noop" });
    expect(dns.writes()).toEqual([]);
    expect(dns.records).toHaveLength(4);
  });

  it("refuses when the name's records are owned by another claim", async () => {
    const { deps, dns } = makeDeps();
    dns.seed({
      type: "TXT",
      name: "tei.thinkwork.ai",
      content: RESERVATION_TXT_CONTENT,
      comment: formatClaimComment({
        kind: "deployment",
        owner: "rival",
        created: TODAY,
      }),
    });
    const result = await claimName(deps, {
      name: "tei",
      tenantSlug: "tei",
      kind: "deployment",
      owner: "tei",
      targets: NS_TARGETS,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "taken",
      source: "cloudflare",
    });
    expect(dns.writes()).toEqual([]);
  });

  it("rejects target lists that are not exactly 4 distinct nameservers", async () => {
    const { deps, dns } = makeDeps();
    const result = await claimName(deps, {
      name: "tei",
      tenantSlug: "tei",
      kind: "deployment",
      owner: "tei",
      targets: ["ns-1.awsdns-01.org", "ns-2.awsdns-02.com"],
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid-targets" });
    expect(dns.calls).toEqual([]);
  });
});

describe("claimName — tenant-kind claims (ses_tenant_slugs path)", () => {
  it("does not treat the claiming tenant's own row as a conflict", async () => {
    const { deps, dns, tenants } = makeDeps();
    tenants.slugs.add("acme");
    const result = await claimName(deps, {
      name: "acme",
      tenantSlug: "acme",
      kind: "tenant",
      owner: "acme",
    });
    expect(result).toMatchObject({ ok: true, action: "reserved" });
    expect(dns.records).toHaveLength(1);
    expect(dns.records[0]!.comment).toBe(
      formatClaimComment({ kind: "tenant", owner: "acme", created: TODAY }),
    );
  });
});

describe("releaseName", () => {
  it("rejects an owner the comment grammar cannot represent before any API call", async () => {
    const { deps, dns, tenants } = makeDeps();
    const result = await releaseName(deps, {
      name: "tei",
      kind: "deployment",
      owner: "TEI Corp",
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid-owner" });
    expect(dns.calls).toEqual([]);
    expect(tenants.calls).toEqual([]);
  });

  // Covers AE4.
  it("removes exactly the owner's records", async () => {
    const { deps, dns } = makeDeps();
    for (const target of NS_TARGETS) {
      dns.seed({
        type: "NS",
        name: "tei.thinkwork.ai",
        content: target,
        comment: TEI_COMMENT,
      });
    }
    // A record at a DIFFERENT name must be untouched.
    const other = dns.seed({
      type: "TXT",
      name: "acme.thinkwork.ai",
      content: RESERVATION_TXT_CONTENT,
      comment: formatClaimComment({
        kind: "tenant",
        owner: "acme",
        created: TODAY,
      }),
    });
    const result = await releaseName(deps, {
      name: "tei",
      kind: "deployment",
      owner: "tei",
    });
    expect(result).toMatchObject({ ok: true, action: "released", deleted: 4 });
    expect(dns.records).toEqual([other]);
  });

  it("refuses to release a name owned by another comment", async () => {
    const { deps, dns } = makeDeps();
    dns.seed({
      type: "TXT",
      name: "tei.thinkwork.ai",
      content: RESERVATION_TXT_CONTENT,
      comment: formatClaimComment({
        kind: "deployment",
        owner: "rival",
        created: TODAY,
      }),
    });
    const result = await releaseName(deps, {
      name: "tei",
      kind: "deployment",
      owner: "tei",
    });
    expect(result).toMatchObject({ ok: false, reason: "owned-by-other" });
    expect(dns.records).toHaveLength(1);
    expect(dns.writes()).toEqual([]);
  });

  it("deletes only the owner's records when foreign records coexist", async () => {
    const { deps, dns } = makeDeps();
    dns.seed({
      type: "TXT",
      name: "tei.thinkwork.ai",
      content: RESERVATION_TXT_CONTENT,
      comment: TEI_COMMENT,
    });
    const foreign = dns.seed({
      type: "TXT",
      name: "tei.thinkwork.ai",
      content: RESERVATION_TXT_CONTENT,
      comment: formatClaimComment({
        kind: "deployment",
        owner: "rival",
        created: TODAY,
      }),
    });
    const result = await releaseName(deps, {
      name: "tei",
      kind: "deployment",
      owner: "tei",
    });
    expect(result).toMatchObject({
      ok: true,
      action: "released",
      deleted: 1,
      foreignRemaining: 1,
    });
    expect(dns.records).toEqual([foreign]);
  });

  it("is a noop when no records exist", async () => {
    const { deps, dns } = makeDeps();
    const result = await releaseName(deps, {
      name: "tei",
      kind: "deployment",
      owner: "tei",
    });
    expect(result).toMatchObject({ ok: true, action: "noop", deleted: 0 });
    expect(dns.writes()).toEqual([]);
  });

  it("dry-run plans deletions without writing", async () => {
    const { deps, dns } = makeDeps();
    dns.seed({
      type: "TXT",
      name: "tei.thinkwork.ai",
      content: RESERVATION_TXT_CONTENT,
      comment: TEI_COMMENT,
    });
    const result = await releaseName(deps, {
      name: "tei",
      kind: "deployment",
      owner: "tei",
      dryRun: true,
    });
    expect(result).toMatchObject({ ok: true, action: "dry-run" });
    expect(dns.records).toHaveLength(1);
    expect(dns.writes()).toEqual([]);
  });
});

describe("checkName", () => {
  it("reports reserved without touching either source", async () => {
    const { deps, dns, tenants } = makeDeps();
    const result = await checkName(deps, "dev");
    expect(result.status).toBe("reserved");
    expect(dns.calls).toEqual([]);
    expect(tenants.calls).toEqual([]);
  });

  it("reports taken-cloudflare when any record exists at the name", async () => {
    const { deps, dns } = makeDeps();
    dns.seed({
      type: "NS",
      name: "acme.thinkwork.ai",
      content: "ns-1.awsdns-01.org",
      comment: null,
    });
    const result = await checkName(deps, "acme");
    expect(result.status).toBe("taken-cloudflare");
    expect(result.records).toHaveLength(1);
  });

  it("reports taken-tenant from the DB leg", async () => {
    const { deps, tenants } = makeDeps();
    tenants.slugs.add("acme");
    const result = await checkName(deps, "acme");
    expect(result.status).toBe("taken-tenant");
    expect(result.dbChecked).toBe(true);
  });

  it("skipDb skips the tenants leg and reports it", async () => {
    const { deps, tenants } = makeDeps();
    tenants.slugs.add("acme");
    const result = await checkName(deps, "acme", { skipDb: true });
    expect(result.status).toBe("available"); // wrong on purpose — leg skipped
    expect(result.dbChecked).toBe(false);
    expect(tenants.calls).toEqual([]);
  });

  it("works with a null tenants source only when skipDb is set", async () => {
    const dns = new FakeDns();
    const deps: NamespaceDeps = { dns, tenants: null };
    await expect(checkName(deps, "acme")).rejects.toThrow(/tenants source/);
    const result = await checkName(deps, "acme", { skipDb: true });
    expect(result.status).toBe("available");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit-tests the picker query's mapping, installed annotation, and blocklist
// exclusion (plan 2026-06-04-004 U1 / KD4). The DB is mocked per-table so each
// select resolves to its own row set.

const { rowsRef, resolveCallerTenantIdMock } = vi.hoisted(() => ({
  rowsRef: {
    catalog: [] as Array<Record<string, unknown>>,
    agent: [] as Array<Record<string, unknown>>,
    agentSkills: [] as Array<Record<string, unknown>>,
  },
  resolveCallerTenantIdMock: vi.fn(),
}));

vi.mock("../../utils.js", () => {
  const SK = { __t: "skillCatalog" };
  const AG = { __t: "agents" };
  const AS = { __t: "agentSkills" };
  const pick = (t: unknown) =>
    t === SK ? rowsRef.catalog : t === AG ? rowsRef.agent : rowsRef.agentSkills;
  return {
    db: {
      select: () => ({
        from: (t: unknown) => ({
          where: () => Promise.resolve(pick(t)),
        }),
      }),
    },
    eq: () => ({}),
    and: () => ({}),
    skillCatalog: SK,
    agents: AG,
    agentSkills: AS,
  };
});
vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: resolveCallerTenantIdMock,
}));

let mod: typeof import("./tenantSkillCatalog.query.js");

const ctx = () => ({ auth: { authType: "cognito" } }) as never;

const catalogRow = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  displayName: extra.displayName ?? null,
  description: extra.description ?? null,
  category: extra.category ?? null,
  icon: extra.icon ?? null,
  tags: extra.tags ?? null,
});

beforeEach(async () => {
  vi.resetModules();
  rowsRef.catalog = [];
  rowsRef.agent = [];
  rowsRef.agentSkills = [];
  resolveCallerTenantIdMock.mockReset().mockResolvedValue("tenant-1");
  mod = await import("./tenantSkillCatalog.query.js");
});

describe("tenantSkillCatalog", () => {
  it("returns catalog entries with installed=false when no agentId given", async () => {
    rowsRef.catalog = [
      catalogRow("crm-dashboard", { displayName: "CRM Dashboard" }),
      catalogRow("invoice-parser", { displayName: "Invoice Parser" }),
    ];
    const res = await mod.tenantSkillCatalog(null, {}, ctx());
    expect(res).toHaveLength(2);
    expect(res.every((e) => e.installed === false)).toBe(true);
    expect(res.map((e) => e.slug)).toEqual(["crm-dashboard", "invoice-parser"]);
  });

  it("annotates installed=true for skills in the agent's agent_skills", async () => {
    rowsRef.catalog = [
      catalogRow("crm-dashboard"),
      catalogRow("invoice-parser"),
    ];
    rowsRef.agent = [{ id: "a1", blockedTools: [] }];
    rowsRef.agentSkills = [{ skillId: "crm-dashboard" }];
    const res = await mod.tenantSkillCatalog(null, { agentId: "a1" }, ctx());
    const bySlug = Object.fromEntries(res.map((e) => [e.slug, e.installed]));
    expect(bySlug["crm-dashboard"]).toBe(true);
    expect(bySlug["invoice-parser"]).toBe(false);
  });

  it("omits skills blocked on the agent (KD4)", async () => {
    rowsRef.catalog = [catalogRow("crm-dashboard"), catalogRow("danger-skill")];
    rowsRef.agent = [{ id: "a1", blockedTools: ["danger-skill"] }];
    rowsRef.agentSkills = [];
    const res = await mod.tenantSkillCatalog(null, { agentId: "a1" }, ctx());
    expect(res.map((e) => e.slug)).toEqual(["crm-dashboard"]);
  });

  it("returns an empty array for an empty catalog (no throw)", async () => {
    rowsRef.catalog = [];
    const res = await mod.tenantSkillCatalog(null, {}, ctx());
    expect(res).toEqual([]);
  });

  it("sorts by display name, falling back to slug", async () => {
    rowsRef.catalog = [
      catalogRow("zeta", { displayName: "Apple" }),
      catalogRow("alpha", { displayName: "Zebra" }),
      catalogRow("mango"), // no display name → sorts by slug "mango"
    ];
    const res = await mod.tenantSkillCatalog(null, {}, ctx());
    expect(res.map((e) => e.slug)).toEqual(["zeta", "mango", "alpha"]);
  });

  it("throws FORBIDDEN when the caller tenant cannot be resolved", async () => {
    resolveCallerTenantIdMock.mockResolvedValueOnce(null);
    await expect(mod.tenantSkillCatalog(null, {}, ctx())).rejects.toThrow(
      /tenant/i,
    );
  });

  it("throws NOT_FOUND when the named agent does not exist", async () => {
    rowsRef.catalog = [catalogRow("crm-dashboard")];
    rowsRef.agent = [];
    await expect(
      mod.tenantSkillCatalog(null, { agentId: "missing" }, ctx()),
    ).rejects.toThrow(/agent not found/i);
  });
});

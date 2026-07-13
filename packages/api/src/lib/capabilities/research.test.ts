/**
 * Connection research control-plane tests (THINK-280 U2 — R3, R4; F1).
 *
 * DB mocked at the drizzle-operator seam (backfill.test.ts convention):
 * real schema tables are the Map keys, mocked operators produce
 * introspectable conditions, and the injected fake db applies them.
 * External discovery is exercised purely through the injected fetcher
 * seam — no HTTP anywhere.
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  or: (...args: unknown[]) => ({ _or: args }),
  eq: (col: unknown, val: unknown) => ({ _eq: [col, val] }),
  isNull: (col: unknown) => ({ _isNull: col }),
  ilike: (col: unknown, val: unknown) => ({ _ilike: [col, val] }),
  inArray: () => ({}),
  desc: () => ({}),
  asc: () => ({}),
  sql: Object.assign((..._args: unknown[]) => ({}), { raw: () => ({}) }),
  relations: () => ({}),
}));

import {
  capabilityConnectionProposals,
  capabilityDefinitions,
} from "@thinkwork/database-pg/schema";
import { canonicalSha256Hex } from "@thinkwork/capability-contracts";
import {
  createConnectionProposal,
  EXTERNAL_DISCOVERY_MAX_BYTES,
  EXTERNAL_DISCOVERY_TIMEOUT_MS,
  searchCapabilityRuntime,
  STATE_DETAIL_MAX_CHARS,
  type Db,
} from "./research.js";

// ── fake db over real schema tables ─────────────────────────────────────

type Row = Record<string, any>;

function colName(col: unknown): string | null {
  return col && typeof col === "object" && typeof (col as any).name === "string"
    ? (col as any).name
    : null;
}

function rowMatches(row: Row, cond: unknown): boolean {
  if (!cond || typeof cond !== "object") return true;
  const c = cond as {
    _and?: unknown[];
    _or?: unknown[];
    _eq?: [unknown, unknown];
    _isNull?: unknown;
  };
  if (c._and) return c._and.every((child) => rowMatches(row, child));
  if (c._or) return c._or.some((child) => rowMatches(row, child));
  if (c._eq) {
    const name = colName(c._eq[0]);
    return name ? row[name] === c._eq[1] : true;
  }
  if (c._isNull !== undefined) {
    const name = colName(c._isNull);
    return name ? row[name] === null || row[name] === undefined : true;
  }
  return true; // ilike / raw sql fragments: unfiltered — libs re-filter in JS
}

function fakeDb(seed: Array<[unknown, Row[]]> = []) {
  const tables = new Map<unknown, Row[]>(seed);
  const inserts: Array<{ table: unknown; row: Row }> = [];
  const updates: Array<{ table: unknown; values: Row }> = [];
  const rowsFor = (t: unknown) => {
    if (!tables.has(t)) tables.set(t, []);
    return tables.get(t)!;
  };
  const db: any = {
    select: () => ({
      from: (t: unknown) => {
        let rows = [...rowsFor(t)];
        const chain: any = {
          where(cond: unknown) {
            rows = rows.filter((r) => rowMatches(r, cond));
            return chain;
          },
          orderBy() {
            return chain;
          },
          limit(n: number) {
            rows = rows.slice(0, n);
            return chain;
          },
          then(onF: any, onR: any) {
            return Promise.resolve(rows).then(onF, onR);
          },
        };
        return chain;
      },
    }),
    insert: (t: unknown) => ({
      values: (v: Row) => ({
        returning: () => {
          const row: Row = { id: randomUUID(), created_at: new Date(), ...v };
          rowsFor(t).push(row);
          inserts.push({ table: t, row });
          return Promise.resolve([row]);
        },
      }),
    }),
    update: (t: unknown) => ({
      set: (v: Row) => ({
        where: (cond: unknown) => {
          const matched = rowsFor(t).filter((r) => rowMatches(r, cond));
          for (const row of matched) Object.assign(row, v);
          updates.push({ table: t, values: v });
          return {
            returning: () => Promise.resolve([...matched]),
            then: (onF: any, onR: any) =>
              Promise.resolve(undefined).then(onF, onR),
          };
        },
      }),
    }),
    transaction: async (cb: (tx: any) => Promise<any>) => cb(db),
  };
  return { db: db as Db, tables, inserts, updates };
}

const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();

function definitionRow(overrides: Row = {}): Row {
  return {
    id: randomUUID(),
    tenant_id: TENANT,
    namespace: "acme",
    class: "connection",
    slug: "github-rest",
    display_name: "GitHub REST",
    status: "active",
    created_by_user_id: null,
    created_at: new Date("2026-07-01T00:00:00Z"),
    updated_at: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

function proposalRow(overrides: Row = {}): Row {
  return {
    id: randomUUID(),
    tenant_id: TENANT,
    definition_id: null,
    payload_json: { descriptor: { slug: "github-rest" } },
    payload_fingerprint: "f".repeat(64),
    provenance_json: { sourceUrls: ["https://docs.github.com/rest"] },
    status: "draft",
    inbox_item_id: null,
    created_by_actor_type: "agent",
    created_by_actor_id: null,
    decided_at: null,
    decided_by_user_id: null,
    created_at: new Date("2026-07-02T00:00:00Z"),
    ...overrides,
  };
}

describe("searchCapabilityRuntime", () => {
  it("returns tenant + platform definitions and tenant proposals with deterministic ordering", async () => {
    const { db } = fakeDb([
      [
        capabilityDefinitions,
        [
          definitionRow({ namespace: "zeta", slug: "github-mcp" }),
          definitionRow({
            tenant_id: null,
            namespace: "platform",
            slug: "github-rest",
          }),
          definitionRow({ namespace: "acme", slug: "github-rest" }),
          definitionRow({
            tenant_id: OTHER_TENANT,
            namespace: "acme",
            slug: "github-other-tenant",
          }),
        ],
      ],
      [
        capabilityConnectionProposals,
        [
          proposalRow({ created_at: new Date("2026-07-01T00:00:00Z") }),
          proposalRow({ created_at: new Date("2026-07-03T00:00:00Z") }),
          proposalRow({ tenant_id: OTHER_TENANT }),
          proposalRow({
            payload_json: { descriptor: { slug: "slack" } },
          }),
        ],
      ],
    ]);

    const result = await searchCapabilityRuntime(db, {
      tenantId: TENANT,
      query: "github",
    });

    expect(result.state).toBe("ok");
    expect(result.stateDetail).toBeUndefined();
    // Deterministic: namespace, class, slug, id — and never other tenants.
    expect(result.definitions.map((d) => `${d.namespace}/${d.slug}`)).toEqual([
      "acme/github-rest",
      "platform/github-rest",
      "zeta/github-mcp",
    ]);
    expect(
      result.definitions.every(
        (d) => d.tenant_id === TENANT || d.tenant_id === null,
      ),
    ).toBe(true);
    // Proposals: tenant-scoped, matching only, newest first.
    expect(result.proposals).toHaveLength(2);
    expect(result.proposals.every((p) => p.tenant_id === TENANT)).toBe(true);
    expect(result.proposals[0]!.created_at.getTime()).toBeGreaterThan(
      result.proposals[1]!.created_at.getTime(),
    );
  });

  it("matches proposals by payload fingerprint", async () => {
    const fingerprint = "a1b2".padEnd(64, "0");
    const { db } = fakeDb([
      [capabilityDefinitions, []],
      [
        capabilityConnectionProposals,
        [
          proposalRow({
            payload_fingerprint: fingerprint,
            payload_json: { descriptor: { slug: "nothing-here" } },
          }),
        ],
      ],
    ]);
    const result = await searchCapabilityRuntime(db, {
      tenantId: TENANT,
      query: "a1b2",
    });
    expect(result.proposals).toHaveLength(1);
  });

  it("degrades when external discovery is requested but no fetcher is provided — DB results untouched", async () => {
    const { db } = fakeDb([
      [capabilityDefinitions, [definitionRow()]],
      [capabilityConnectionProposals, [proposalRow()]],
    ]);
    const result = await searchCapabilityRuntime(db, {
      tenantId: TENANT,
      query: "github",
      allowExternal: true,
    });
    expect(result.state).toBe("degraded");
    expect(result.stateDetail).toContain("no fetcher");
    expect(result.definitions).toHaveLength(1);
    expect(result.proposals).toHaveLength(1);
  });

  it("calls the fetcher with the exact byte/time bounds and stays ok on success", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, evidence: { x: 1 } });
    const { db } = fakeDb();
    const result = await searchCapabilityRuntime(db, {
      tenantId: TENANT,
      query: "github",
      allowExternal: true,
      externalFetcher: { fetch },
    });
    expect(fetch).toHaveBeenCalledWith("github", {
      maxBytes: EXTERNAL_DISCOVERY_MAX_BYTES,
      timeoutMs: EXTERNAL_DISCOVERY_TIMEOUT_MS,
    });
    expect(EXTERNAL_DISCOVERY_MAX_BYTES).toBe(256 * 1024);
    expect(EXTERNAL_DISCOVERY_TIMEOUT_MS).toBe(8000);
    expect(result.state).toBe("ok");
  });

  it("degrades with a bounded detail when the fetch fails, without affecting DB results", async () => {
    const { db } = fakeDb([[capabilityDefinitions, [definitionRow()]]]);
    const result = await searchCapabilityRuntime(db, {
      tenantId: TENANT,
      query: "github",
      allowExternal: true,
      externalFetcher: {
        fetch: async () => ({ ok: false, reason: "x".repeat(2000) }),
      },
    });
    expect(result.state).toBe("degraded");
    expect(result.stateDetail!.length).toBeLessThanOrEqual(
      STATE_DETAIL_MAX_CHARS,
    );
    expect(result.definitions).toHaveLength(1);
  });

  it("degrades when the fetcher throws", async () => {
    const { db } = fakeDb([[capabilityDefinitions, [definitionRow()]]]);
    const result = await searchCapabilityRuntime(db, {
      tenantId: TENANT,
      query: "github",
      allowExternal: true,
      externalFetcher: {
        fetch: async () => {
          throw new Error("boom");
        },
      },
    });
    expect(result.state).toBe("degraded");
    expect(result.stateDetail).toContain("boom");
    expect(result.definitions).toHaveLength(1);
  });

  it("never invokes the fetcher when allowExternal is not set", async () => {
    const fetch = vi.fn();
    const { db } = fakeDb();
    const result = await searchCapabilityRuntime(db, {
      tenantId: TENANT,
      query: "github",
      externalFetcher: { fetch },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.state).toBe("ok");
  });
});

describe("createConnectionProposal", () => {
  const actor = { type: "agent" as const, id: randomUUID() };
  const payload = { descriptor: { slug: "github-rest" }, note: "evidence" };
  const sourceUrls = ["https://docs.github.com/rest"];

  it("inserts an immutable draft row with the canonical fingerprint and provenance", async () => {
    const { db, inserts } = fakeDb();
    const result = await createConnectionProposal(db, {
      tenantId: TENANT,
      payload,
      sourceUrls,
      actor,
    });
    expect(result.outcome).toBe("applied");
    expect(result.proposal).toBeDefined();
    expect(result.proposal!.status).toBe("draft");
    expect(result.proposal!.payload_fingerprint).toBe(
      canonicalSha256Hex(payload),
    );
    expect(result.proposal!.provenance_json).toEqual({ sourceUrls });
    expect(result.proposal!.created_by_actor_type).toBe("agent");
    expect(result.proposal!.created_by_actor_id).toBe(actor.id);
    // Non-executable evidence: exactly one proposal row, nothing else.
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.table).toBe(capabilityConnectionProposals);
  });

  it("rejects empty sourceUrls", async () => {
    const { db, inserts } = fakeDb();
    const result = await createConnectionProposal(db, {
      tenantId: TENANT,
      payload,
      sourceUrls: [],
      actor,
    });
    expect(result.outcome).toBe("rejected");
    expect(result.reason).toContain("sourceUrls");
    expect(inserts).toHaveLength(0);
  });

  it("rejects non-https and malformed URLs, accumulating every violation", async () => {
    const { db } = fakeDb();
    const result = await createConnectionProposal(db, {
      tenantId: TENANT,
      payload,
      sourceUrls: ["http://docs.github.com", "not a url"],
      actor,
    });
    expect(result.outcome).toBe("rejected");
    expect(result.reason).toContain("sourceUrls[0]: must use https");
    expect(result.reason).toContain(
      "sourceUrls[1]: not a syntactically valid URL",
    );
  });

  it("rejects non-object payloads", async () => {
    const { db } = fakeDb();
    for (const bad of [["array"], "string", 42, null]) {
      const result = await createConnectionProposal(db, {
        tenantId: TENANT,
        payload: bad,
        sourceUrls,
        actor,
      });
      expect(result.outcome).toBe("rejected");
      expect(result.reason).toContain("payload: must be a JSON object");
    }
  });

  it("rejects payloads that cannot be canonicalized", async () => {
    const { db } = fakeDb();
    const result = await createConnectionProposal(db, {
      tenantId: TENANT,
      payload: { bad: undefined },
      sourceUrls,
      actor,
    });
    expect(result.outcome).toBe("rejected");
    expect(result.reason).toContain("not canonicalizable");
  });

  it("rejects an unknown or foreign-tenant definitionId", async () => {
    const foreign = definitionRow({ tenant_id: OTHER_TENANT });
    const { db } = fakeDb([[capabilityDefinitions, [foreign]]]);
    for (const definitionId of [randomUUID(), foreign.id as string]) {
      const result = await createConnectionProposal(db, {
        tenantId: TENANT,
        definitionId,
        payload,
        sourceUrls,
        actor,
      });
      expect(result.outcome).toBe("rejected");
      expect(result.reason).toContain("definitionId");
    }
  });

  it("links a refresh proposal to an existing tenant definition", async () => {
    const definition = definitionRow();
    const { db } = fakeDb([[capabilityDefinitions, [definition]]]);
    const result = await createConnectionProposal(db, {
      tenantId: TENANT,
      definitionId: definition.id as string,
      payload,
      sourceUrls,
      actor,
    });
    expect(result.outcome).toBe("applied");
    expect(result.proposal!.definition_id).toBe(definition.id);
  });
});

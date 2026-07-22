import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const verifyMcpAccessToken = vi.fn();
const executeTwinQuery = vi.fn();
const describeTwinOntology = vi.fn();
const dbSelect = vi.fn();

vi.mock("./mcp-oauth.js", () => ({
  verifyMcpAccessToken: (...args: unknown[]) => verifyMcpAccessToken(...args),
}));
vi.mock("../lib/twin/client.js", () => ({
  executeTwinQuery: (...args: unknown[]) => executeTwinQuery(...args),
}));
vi.mock("../lib/twin/describe-ontology.js", () => ({
  describeTwinOntology: (...args: unknown[]) => describeTwinOntology(...args),
}));
vi.mock("../lib/db.js", () => ({
  db: {
    select: (...args: unknown[]) => dbSelect(...args),
    update: () => ({
      set: () => ({ where: () => Promise.resolve() }),
    }),
  },
}));

import { handler, TWIN_KEY_PREFIX } from "./mcp-twin.js";

const TENANT = "11111111-1111-1111-1111-111111111111";
const KEY = `${TWIN_KEY_PREFIX}test-key-value`;
const KEY_HASH = createHash("sha256").update(KEY).digest("hex");

function keyRow(overrides: Record<string, unknown> = {}) {
  return { id: "key-1", tenant_id: TENANT, ...overrides };
}

function mockKeyLookup(rows: unknown[]) {
  dbSelect.mockReturnValue({
    from: () => ({
      where: () => ({ limit: () => Promise.resolve(rows) }),
    }),
  });
}

function event(
  body: unknown,
  { bearer = KEY, method = "POST" }: { bearer?: string | null; method?: string } = {},
): APIGatewayProxyEventV2 {
  return {
    headers: {
      host: "api.example.com",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    requestContext: { http: { method }, domainName: "api.example.com" },
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

function rpc(method: string, params?: Record<string, unknown>) {
  return { jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) };
}

function parseBody(result: { body?: string }) {
  return JSON.parse(result.body ?? "{}");
}

beforeEach(() => {
  verifyMcpAccessToken.mockReset();
  executeTwinQuery.mockReset();
  describeTwinOntology.mockReset();
  dbSelect.mockReset();
});

describe("mcp-twin — auth", () => {
  it("valid tkt_ key hash-resolves its tenant row and lists tools", async () => {
    mockKeyLookup([keyRow()]);
    const result = await handler(event(rpc("tools/list")));
    expect(result.statusCode ?? 200).toBe(200);
    const body = parseBody(result);
    expect(body.result.tools.map((t: { name: string }) => t.name)).toEqual([
      "twin_describe_ontology",
      "twin_cypher",
      "twin_entity",
    ]);
    expect(verifyMcpAccessToken).not.toHaveBeenCalled();
  });

  it("a revoked/unknown key is refused with 401", async () => {
    mockKeyLookup([]);
    const result = await handler(event(rpc("tools/list")));
    expect(result.statusCode).toBe(401);
  });

  it("missing bearer → 401 with resource metadata header", async () => {
    const result = await handler(event(rpc("tools/list"), { bearer: null }));
    expect(result.statusCode).toBe(401);
    expect(result.headers?.["WWW-Authenticate"]).toContain(
      "oauth-protected-resource/mcp/twin",
    );
  });

  it("OAuth path requires twin:read scope", async () => {
    verifyMcpAccessToken.mockResolvedValue({
      scope: "memory:read",
      tenant_id: TENANT,
    });
    const result = await handler(
      event(rpc("tools/list"), { bearer: "some-oauth-jwt" }),
    );
    expect(result.statusCode).toBe(401);
  });

  it("OAuth token with twin:read resolves tenant from claims", async () => {
    verifyMcpAccessToken.mockResolvedValue({
      scope: "twin:read",
      tenant_id: TENANT,
    });
    describeTwinOntology.mockResolvedValue("# ontology");
    const result = await handler(
      event(rpc("tools/call", { name: "twin_describe_ontology", arguments: {} }), {
        bearer: "some-oauth-jwt",
      }),
    );
    expect(parseBody(result).result.content[0].text).toBe("# ontology");
    expect(describeTwinOntology).toHaveBeenCalledWith({ tenantId: TENANT });
  });
});

describe("mcp-twin — twin_cypher", () => {
  beforeEach(() => mockKeyLookup([keyRow()]));

  it("forwards to the twin client with the row-resolved tenant; body tenant ignored", async () => {
    executeTwinQuery.mockResolvedValue({ ok: true, results: [{ n: 1 }] });
    const result = await handler(
      event(
        rpc("tools/call", {
          name: "twin_cypher",
          arguments: {
            query: "MATCH (n) RETURN n",
            tenantId: "attacker-tenant",
          },
        }),
      ),
    );
    expect(executeTwinQuery).toHaveBeenCalledWith({
      tenantId: TENANT,
      request: { kind: "cypher", query: "MATCH (n) RETURN n" },
    });
    const body = parseBody(result);
    expect(body.result.structuredContent).toMatchObject({ ok: true, rowCount: 1 });
  });

  it("guard rejections come back as readable tool results, not protocol errors", async () => {
    executeTwinQuery.mockResolvedValue({
      ok: false,
      reason: "rejected",
      rule: "mutation_clause",
      message: "CREATE is not allowed: the twin is read-only",
    });
    const result = await handler(
      event(
        rpc("tools/call", {
          name: "twin_cypher",
          arguments: { query: "CREATE (n) RETURN n" },
        }),
      ),
    );
    const body = parseBody(result);
    expect(body.error).toBeUndefined();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("mutation_clause");
    expect(body.result.content[0].text).toContain("read-only");
  });

  it("unavailable twin returns the fixed degrade text", async () => {
    executeTwinQuery.mockResolvedValue({ ok: false, reason: "unavailable" });
    const result = await handler(
      event(
        rpc("tools/call", {
          name: "twin_cypher",
          arguments: { query: "MATCH (n) RETURN n" },
        }),
      ),
    );
    expect(parseBody(result).result.content[0].text).toContain("unavailable");
  });

  it("limited results carry the row-cap note", async () => {
    executeTwinQuery.mockResolvedValue({
      ok: true,
      results: [{ n: 1 }],
      limited: true,
    });
    const result = await handler(
      event(
        rpc("tools/call", {
          name: "twin_cypher",
          arguments: { query: "MATCH (n) RETURN n" },
        }),
      ),
    );
    const body = parseBody(result);
    expect(body.result.content[0].text).toContain("Row cap reached");
    expect(body.result.structuredContent.limited).toBe(true);
  });

  it("missing query is an invalid-params error", async () => {
    const result = await handler(
      event(rpc("tools/call", { name: "twin_cypher", arguments: {} })),
    );
    expect(parseBody(result).error.code).toBe(-32602);
  });
});

describe("mcp-twin — twin_entity", () => {
  beforeEach(() => mockKeyLookup([keyRow()]));

  it("merges entity_get + system_edges through the typed twin path", async () => {
    executeTwinQuery
      .mockResolvedValueOnce({ ok: true, results: [{ n: { displayName: "Acme" } }] })
      .mockResolvedValueOnce({ ok: true, results: [{ system: "lastmile" }] });
    const result = await handler(
      event(
        rpc("tools/call", {
          name: "twin_entity",
          arguments: { canonical_id: "can-1" },
        }),
      ),
    );
    expect(executeTwinQuery).toHaveBeenCalledWith({
      tenantId: TENANT,
      request: { kind: "entity_get", canonicalId: "can-1" },
    });
    expect(executeTwinQuery).toHaveBeenCalledWith({
      tenantId: TENANT,
      request: { kind: "system_edges", canonicalId: "can-1" },
    });
    const body = parseBody(result);
    expect(body.result.structuredContent.systemIdentities).toEqual([
      { system: "lastmile" },
    ]);
  });

  it("unknown id → empty result, not an error", async () => {
    executeTwinQuery.mockResolvedValue({ ok: true, results: [] });
    const result = await handler(
      event(
        rpc("tools/call", {
          name: "twin_entity",
          arguments: { canonical_id: "nope" },
        }),
      ),
    );
    const body = parseBody(result);
    expect(body.result.isError).toBeUndefined();
    expect(body.result.structuredContent.entity).toBeNull();
  });
});

describe("mcp-twin — protocol", () => {
  beforeEach(() => mockKeyLookup([keyRow()]));

  it("initialize returns server info", async () => {
    const result = await handler(event(rpc("initialize")));
    expect(parseBody(result).result.serverInfo.name).toBe(
      "thinkwork-digital-twin",
    );
  });

  it("tool listing contains exactly the three read tools (R14 structural)", async () => {
    const result = await handler(event(rpc("tools/list")));
    const names = parseBody(result).result.tools.map(
      (t: { name: string }) => t.name,
    );
    expect(names).toHaveLength(3);
    expect(names.join(" ")).not.toMatch(/write|create|update|delete/i);
  });

  it("unknown tool name is an invalid-params error", async () => {
    const result = await handler(
      event(rpc("tools/call", { name: "twin_write", arguments: {} })),
    );
    expect(parseBody(result).error.code).toBe(-32602);
  });
});

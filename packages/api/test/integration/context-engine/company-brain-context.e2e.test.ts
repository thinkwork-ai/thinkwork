import { describe, expect, it } from "vitest";

const API_URL = process.env.API_URL?.replace(/\/$/, "") ?? "";
const API_AUTH_SECRET = process.env.API_AUTH_SECRET ?? "";
const TENANT_ID = process.env.TENANT_ID ?? "";
const USER_ID = process.env.USER_ID ?? "";
const AGENT_ID = process.env.AGENT_ID ?? "";
const QUERY =
  process.env.CONTEXT_ENGINE_E2E_QUERY ?? "favorite restaurant in paris";
const REQUIRE_WIKI_HIT =
  process.env.CONTEXT_ENGINE_E2E_REQUIRE_WIKI_HIT === "true";
const PROVIDER_IDS = (
  process.env.CONTEXT_ENGINE_E2E_PROVIDER_IDS ??
  [
    "memory",
    "wiki",
    "wiki-source-agent",
    "workspace-files",
    "bedrock-knowledge-base",
    "erp-customer",
    "crm-opportunity",
    "support-case",
    "catalog",
  ].join(",")
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const REQUIRED_FAMILIES = (
  process.env.CONTEXT_ENGINE_E2E_EXPECT_FAMILIES ??
  "memory,wiki,workspace,knowledge-base,sub-agent"
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const canRun = Boolean(API_URL && API_AUTH_SECRET && TENANT_ID && USER_ID);

type JsonRpcResult = {
  result?: {
    structuredContent?: any;
    content?: Array<{ text?: string }>;
  };
  error?: { message?: string };
};

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const response = await fetch(`${API_URL}/mcp/context-engine`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${API_AUTH_SECRET}`,
      "x-tenant-id": TENANT_ID,
      "x-user-id": USER_ID,
      ...(AGENT_ID ? { "x-agent-id": AGENT_ID } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `context-engine-e2e-${name}`,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const body = await response.text();
  expect(response.status, body).toBe(200);
  const payload = JSON.parse(body) as JsonRpcResult;
  if (payload.error) throw new Error(payload.error.message ?? "JSON-RPC error");
  return payload.result?.structuredContent;
}

describe.skipIf(!canRun)("Company Brain Context Engine live E2E", () => {
  it("fans out across every selected source family and exposes provider diagnostics", async () => {
    const listed = await callTool("list_context_providers");
    const providers = listed.providers as Array<{
      id: string;
      family: string;
      enabled: boolean;
      displayName: string;
      subAgent?: { seamState?: string };
    }>;
    expect(providers.length).toBeGreaterThan(0);

    const selectedIds = providers
      .filter((provider) => provider.enabled !== false)
      .filter((provider) => PROVIDER_IDS.includes(provider.id))
      .map((provider) => provider.id);
    expect(selectedIds).toEqual(expect.arrayContaining(["memory", "wiki"]));

    const result = await callTool("query_context", {
      query: QUERY,
      mode: "results",
      scope: "auto",
      depth: "deep",
      limit: 20,
      providers: { ids: selectedIds },
      ...(AGENT_ID ? { agentId: AGENT_ID } : {}),
    });

    const statuses = result.providers as Array<{
      providerId: string;
      family: string;
      state: string;
      hitCount?: number;
      reason?: string;
      error?: string;
    }>;
    const hits = result.hits as Array<{ providerId: string; family: string }>;

    for (const family of REQUIRED_FAMILIES) {
      expect(
        statuses.some((status) => status.family === family),
        `missing provider diagnostics for family ${family}: ${JSON.stringify(statuses)}`,
      ).toBe(true);
    }

    expect(hits.length, JSON.stringify({ statuses, hits })).toBeGreaterThan(0);
    expect(statuses.filter((status) => status.state === "error")).toEqual([]);

    if (REQUIRE_WIKI_HIT) {
      expect(
        hits.some((hit) => hit.family === "wiki"),
        `expected at least one wiki hit for ${USER_ID}; statuses=${JSON.stringify(statuses)}`,
      ).toBe(true);
    }
  });
});

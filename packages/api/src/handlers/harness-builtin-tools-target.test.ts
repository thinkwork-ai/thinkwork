import { describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  createHarnessBuiltinToolsHandler,
  type HarnessBuiltinToolsDeps,
} from "./harness-builtin-tools-target.js";
import type { ToolExecutionEventInsert } from "../lib/harness/tool-execution-ledger.js";

const claims = {
  sub: "user-1",
  participant_id: "user-1",
  tenant_id: "tenant-1",
  space_id: "space-1",
  agent_id: "agent-1",
  thread_id: "thread-1",
  turn_id: "turn-1",
  session_generation: 1,
};

function event(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = { authorization: "Bearer valid" },
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: `POST ${path}`,
    rawPath: path,
    rawQueryString: "",
    headers,
    requestContext: {
      accountId: "account",
      apiId: "api",
      domainName: "example.test",
      domainPrefix: "example",
      http: {
        method: "POST",
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "gateway-tool-1",
      routeKey: "route",
      stage: "$default",
      time: "",
      timeEpoch: 0,
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function setup(overrides: Partial<HarnessBuiltinToolsDeps> = {}) {
  const rows: ToolExecutionEventInsert[] = [];
  let now = 1_000;
  const deps: HarnessBuiltinToolsDeps = {
    verifyAccessToken: vi.fn(() => claims),
    resolveCanonicalContext: vi.fn(async () => ({
      tenantId: "tenant-1",
      userId: "user-1",
      agentId: "agent-1",
      threadId: "thread-1",
      turnId: "turn-1",
      triggeringMessageId: "message-1",
      spaceId: "space-1",
    })),
    resolveBuiltinTools: vi.fn<HarnessBuiltinToolsDeps["resolveBuiltinTools"]>(
      async () => ({
        webSearch: { provider: "exa", apiKey: "exa-secret" },
        webExtract: { provider: "firecrawl", apiKey: "firecrawl-secret" },
      }),
    ),
    search: vi.fn(async () => [
      {
        title: "Austin events",
        url: "https://example.test/austin",
        snippet: "Current weekend listings",
        score: 0.9,
        raw: { secretProviderPayload: true },
      },
    ]),
    extract: vi.fn(async () => ({
      url: "https://example.test/austin",
      title: "Austin events",
      markdown: "# Austin events\n\nCurrent listings",
      metadata: { sourceURL: "https://example.test/austin", private: true },
    })),
    ledgerStore: {
      async append(row) {
        rows.push(row);
        return { id: rows.length };
      },
    },
    policyRevision: "builtin-web-v1",
    now: () => (now += 10),
    ...overrides,
  };
  return { handler: createHarnessBuiltinToolsHandler(deps), deps, rows };
}

describe("Harness governed built-in tools target", () => {
  it("runs tenant-configured Exa search for the canonical participant without exposing raw provider data", async () => {
    const { handler, deps, rows } = setup();
    const result = await handler(
      event("/agentcore/capabilities/web/search", {
        query: "Austin events this weekend",
        limit: 5,
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body!)).toEqual({
      provider: "exa",
      results: [
        {
          title: "Austin events",
          url: "https://example.test/austin",
          snippet: "Current weekend listings",
          score: 0.9,
        },
      ],
    });
    expect(deps.search).toHaveBeenCalledWith({
      provider: "exa",
      apiKey: "exa-secret",
      query: "Austin events this weekend",
      limit: 5,
    });
    expect(JSON.stringify(result)).not.toContain("secretProviderPayload");
    expect(JSON.stringify(rows)).not.toContain("Austin events this weekend");
    expect(JSON.stringify(rows)).not.toContain("exa-secret");
    expect(rows.map((row) => row.event_type)).toEqual(["started", "completed"]);
  });

  it("runs tenant-configured Firecrawl extraction and returns bounded sanitized content", async () => {
    const { handler, deps, rows } = setup();
    const result = await handler(
      event("/agentcore/capabilities/web/extract", {
        url: "https://example.test/austin",
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body!)).toEqual({
      provider: "firecrawl",
      url: "https://example.test/austin",
      title: "Austin events",
      markdown: "# Austin events\n\nCurrent listings",
      truncated: false,
    });
    expect(deps.extract).toHaveBeenCalledWith({
      provider: "firecrawl",
      apiKey: "firecrawl-secret",
      url: "https://example.test/austin",
    });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(rows.map((row) => row.event_type)).toEqual(["started", "completed"]);
  });

  it("fails closed when the current agent policy or tenant configuration does not expose the requested built-in", async () => {
    const { handler, deps, rows } = setup({
      resolveBuiltinTools: vi.fn(async () => ({
        webSearch: undefined,
        webExtract: undefined,
      })),
    });
    const result = await handler(
      event("/agentcore/capabilities/web/search", {
        query: "Austin events this weekend",
      }),
    );
    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body!)).toEqual({
      error: "web_search_not_authorized",
    });
    expect(deps.search).not.toHaveBeenCalled();
    expect(rows.map((row) => row.event_type)).toEqual(["started", "failed"]);
  });

  it("rejects header identity overrides before resolving live runtime policy", async () => {
    const { handler, deps, rows } = setup();
    const result = await handler(
      event(
        "/agentcore/capabilities/web/search",
        { query: "Austin" },
        {
          authorization: "Bearer valid",
          "x-thinkwork-user-id": "user-2",
        },
      ),
    );
    expect(result.statusCode).toBe(400);
    expect(deps.resolveCanonicalContext).not.toHaveBeenCalled();
    expect(deps.resolveBuiltinTools).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it("rejects model-supplied tenant identity before resolving live runtime policy", async () => {
    const { handler, deps, rows } = setup();
    const result = await handler(
      event("/agentcore/capabilities/web/search", {
        tenant_id: "tenant-2",
        query: "Austin",
      }),
    );
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body!)).toEqual({
      error: "identity_override_rejected",
    });
    expect(deps.resolveCanonicalContext).not.toHaveBeenCalled();
    expect(deps.resolveBuiltinTools).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });
});

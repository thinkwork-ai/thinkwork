/**
 * THINK-626 — per-call `on_behalf_of` assertion for the Pi MCP client.
 *
 * Exercised against a REAL MCP SDK server over an in-memory transport, so
 * the assertions read the `params._meta` the server actually received
 * rather than a hand-rolled stand-in of the wire.
 *
 * The load-bearing cases are the negative ones: the consumer
 * (company-brain brain-mcp) rejects an assertion carrying any field other
 * than `sub`/`email`, and treats an absent assertion as "run under the
 * key's own grants". So "nothing is sent" must be provably the default —
 * for servers that did not opt in, and for turns with no signed-in human.
 */

import { afterEach, describe, expect, it } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  buildOnBehalfOfMeta,
  createConnectMcpServer,
  ON_BEHALF_OF_META_KEY,
  type OnBehalfOfIdentity,
} from "../src/mcp-connect.js";
import { buildMcpTools, HandleStore } from "../src/mcp.js";

const TOOL_NAME = "brain_search_meaning";
const SUB = "11111111-2222-4333-8444-555555555555";
const EMAIL = "person@customer.example";

interface FakeServer {
  clientTransport: Transport;
  /** Full `params` of every tools/call, in call order. */
  receivedParams: Array<Record<string, unknown>>;
  stop: () => Promise<void>;
}

async function startFakeMcpServer(): Promise<FakeServer> {
  const server = new Server(
    { name: "fake-brain", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );
  const receivedParams: Array<Record<string, unknown>> = [];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: TOOL_NAME,
        description: "Searches the company brain.",
        inputSchema: { type: "object" as const },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    receivedParams.push(request.params as Record<string, unknown>);
    return { content: [{ type: "text" as const, text: "ok" }] };
  });

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  return {
    clientTransport,
    receivedParams,
    stop: async () => {
      await server.close().catch(() => undefined);
    },
  };
}

const running: FakeServer[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.stop()));
});

async function connectTools(args: {
  server: FakeServer;
  onBehalfOf?: OnBehalfOfIdentity | null;
}) {
  const factory = createConnectMcpServer({
    cleanup: [],
    transportFactory: () => args.server.clientTransport,
  });
  return factory({
    url: "https://brain.example.com/mcp",
    headers: {},
    serverName: "digital-twin",
    onBehalfOf: args.onBehalfOf ?? null,
  });
}

function metaOf(params: Record<string, unknown>): unknown {
  return (params._meta as Record<string, unknown> | undefined)?.[
    ON_BEHALF_OF_META_KEY
  ];
}

describe("buildOnBehalfOfMeta", () => {
  it("emits only sub and email, trimmed", () => {
    expect(
      buildOnBehalfOfMeta({ sub: `  ${SUB} `, email: ` ${EMAIL}` }),
    ).toEqual({ [ON_BEHALF_OF_META_KEY]: { sub: SUB, email: EMAIL } });
  });

  it("emits a single field when only one is known", () => {
    expect(buildOnBehalfOfMeta({ email: EMAIL })).toEqual({
      [ON_BEHALF_OF_META_KEY]: { email: EMAIL },
    });
    expect(buildOnBehalfOfMeta({ sub: SUB })).toEqual({
      [ON_BEHALF_OF_META_KEY]: { sub: SUB },
    });
  });

  it("returns null when there is nothing to assert", () => {
    expect(buildOnBehalfOfMeta(null)).toBeNull();
    expect(buildOnBehalfOfMeta(undefined)).toBeNull();
    expect(buildOnBehalfOfMeta({})).toBeNull();
    expect(buildOnBehalfOfMeta({ sub: "   ", email: "" })).toBeNull();
    expect(buildOnBehalfOfMeta({ sub: null, email: null })).toBeNull();
  });
});

describe("createConnectMcpServer — on_behalf_of assertion (THINK-626)", () => {
  it("attaches the assertion to tools/call params when an identity is supplied", async () => {
    const server = await startFakeMcpServer();
    running.push(server);

    const tools = await connectTools({
      server,
      onBehalfOf: { sub: SUB, email: EMAIL },
    });
    await tools[0]!.execute("call-1", { query: "pricing" });

    const params = server.receivedParams[0]!;
    expect(metaOf(params)).toEqual({ sub: SUB, email: EMAIL });
    // Identity ONLY — a grant-shaped field here would be rejected by the
    // consumer and would be a privilege-escalation surface if it weren't.
    expect(Object.keys(metaOf(params) as object).sort()).toEqual([
      "email",
      "sub",
    ]);
    // The assertion rides beside `arguments`, never inside them.
    expect(params.arguments).toEqual({ query: "pricing" });
  });

  it("repeats the assertion on every call, not just the first", async () => {
    const server = await startFakeMcpServer();
    running.push(server);

    const tools = await connectTools({ server, onBehalfOf: { email: EMAIL } });
    await tools[0]!.execute("call-1", {});
    await tools[0]!.execute("call-2", {});

    expect(server.receivedParams).toHaveLength(2);
    for (const params of server.receivedParams) {
      expect(metaOf(params)).toEqual({ email: EMAIL });
    }
  });

  it("sends NO _meta when no identity is available", async () => {
    const server = await startFakeMcpServer();
    running.push(server);

    const tools = await connectTools({ server, onBehalfOf: null });
    await tools[0]!.execute("call-1", { query: "pricing" });

    const params = server.receivedParams[0]!;
    expect(params._meta).toBeUndefined();
    expect(Object.keys(params).sort()).toEqual(["arguments", "name"]);
  });

  it("sends NO _meta when the identity carries no usable field", async () => {
    const server = await startFakeMcpServer();
    running.push(server);

    const tools = await connectTools({ server, onBehalfOf: { email: "  " } });
    await tools[0]!.execute("call-1", {});

    expect(server.receivedParams[0]!._meta).toBeUndefined();
  });
});

describe("buildMcpTools — per-server opt-in gate (THINK-626)", () => {
  const identity: OnBehalfOfIdentity = { sub: SUB, email: EMAIL };

  async function connectArgsFor(config: Record<string, unknown>) {
    const captured: Array<Record<string, unknown>> = [];
    await buildMcpTools({
      mcpConfigs: [
        {
          serverName: "srv",
          url: "https://srv.example.com/mcp",
          bearer: "secret-bearer",
          ...config,
        } as never,
      ],
      handleStore: new HandleStore(),
      connectMcpServer: async (args) => {
        captured.push(args as unknown as Record<string, unknown>);
        return [];
      },
      onBehalfOfIdentity: identity,
    });
    return captured[0]!;
  }

  it("forwards the identity only to servers that opted in", async () => {
    expect((await connectArgsFor({ onBehalfOf: true })).onBehalfOf).toEqual(
      identity,
    );
  });

  it("withholds the identity from every server that did not opt in", async () => {
    expect((await connectArgsFor({})).onBehalfOf).toBeNull();
    expect((await connectArgsFor({ onBehalfOf: false })).onBehalfOf).toBeNull();
  });

  it("passes null to an opted-in server when the turn has no signed-in human", async () => {
    const captured: Array<Record<string, unknown>> = [];
    await buildMcpTools({
      mcpConfigs: [
        {
          serverName: "srv",
          url: "https://srv.example.com/mcp",
          bearer: "secret-bearer",
          onBehalfOf: true,
        } as never,
      ],
      handleStore: new HandleStore(),
      connectMcpServer: async (args) => {
        captured.push(args as unknown as Record<string, unknown>);
        return [];
      },
    });
    expect(captured[0]!.onBehalfOf).toBeNull();
  });
});

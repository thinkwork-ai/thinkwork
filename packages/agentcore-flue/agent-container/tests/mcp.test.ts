/**
 * Plan §005 U7 — vitest coverage for MCP wiring.
 *
 * The cornerstone is the **contract test**: `JSON.stringify(toolDefs)` must
 * never expose a bearer. Bearers live only in the trusted handler's in-memory
 * `HandleStore`; what crosses the worker-thread boundary into ToolDef
 * serialization is a handle.
 *
 * Test-first per the plan execution note.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import {
  buildMcpTools,
  HandleStore,
  HandleStoreError,
  McpHandleAuthScheme,
  type ConnectMcpServerFn,
  type McpServerConfig,
} from "../src/mcp.js";

// ---------------------------------------------------------------------------
// Bearer fixtures — realistic shapes that real OAuth servers actually emit.
// The contract test greps for any of these in the serialized ToolDef tree.
// ---------------------------------------------------------------------------

// Synthetic bearer fixtures for the leak-contract grep. These are
// deliberately broken-format vs real OAuth tokens (no all-digit
// segments, obvious "FAKE" markers) so that GitHub secret-scanning
// push protection does not flag them — while still preserving the
// bearer-prefix shapes the contract test cares about.
const BEARER_FIXTURES = {
  jwt:
    "eyFAKEjwt.eyFAKE_PAYLOAD_FOR_TEST_FIXTURE_ONLY." +
    "FakeSignatureForTestFixtureOnly_NotARealToken",
  slack: "xoxb-FAKETEST-FAKETEST-FakeSlackBearerForTestFixtureOnly",
  githubPat: "ghp_FakeGithubPATForTestFixtureOnly_NotARealToken",
  google: "ya29.FakeGoogleBearerForTestFixtureOnly_NotARealToken",
  notion: "secret_FakeNotionBearerForTestFixtureOnly_NotARealToken",
};

const ALL_BEARERS = Object.values(BEARER_FIXTURES);

function makeFakeTool(name: string, headers: Record<string, string>): AgentTool<any> {
  return {
    name: `mcp_${name}`,
    label: `mcp_${name}`,
    description: `Fake MCP tool from ${name}`,
    parameters: Type.Object({}),
    // Capture the headers in a closure (not serialized properties), simulating
    // how a real MCP client closes over auth and uses it only at fetch time.
    execute: async () => {
      return {
        content: [
          {
            type: "text" as const,
            text: `would call with ${JSON.stringify(headers)}`,
          },
        ],
        details: {},
      };
    },
  };
}

function captureFakeConnect(
  capture: { url?: string; headers?: Record<string, string>; transport?: string },
): ConnectMcpServerFn {
  return async (args) => {
    capture.url = args.url;
    capture.headers = { ...args.headers };
    capture.transport = args.transport;
    return [makeFakeTool("captured", args.headers)];
  };
}

// ---------------------------------------------------------------------------
// HandleStore — mint/resolve/revoke/clear lifecycle.
// ---------------------------------------------------------------------------

describe("HandleStore — lifecycle", () => {
  it("mint returns a fresh handle that resolves back to the bearer", () => {
    const store = new HandleStore();
    const handle = store.mint(BEARER_FIXTURES.jwt);
    expect(typeof handle).toBe("string");
    expect(handle).not.toBe(BEARER_FIXTURES.jwt);
    expect(handle).not.toContain(BEARER_FIXTURES.jwt);
    expect(store.resolve(handle)).toBe(BEARER_FIXTURES.jwt);
  });

  it("each mint produces a distinct handle even for the same bearer", () => {
    const store = new HandleStore();
    const h1 = store.mint(BEARER_FIXTURES.jwt);
    const h2 = store.mint(BEARER_FIXTURES.jwt);
    expect(h1).not.toBe(h2);
    expect(store.resolve(h1)).toBe(BEARER_FIXTURES.jwt);
    expect(store.resolve(h2)).toBe(BEARER_FIXTURES.jwt);
  });

  it("handles look like UUIDs (lowercased hex with dashes)", () => {
    const store = new HandleStore();
    const handle = store.mint(BEARER_FIXTURES.slack);
    expect(handle).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("resolve throws HandleStoreError when the handle was never minted", () => {
    const store = new HandleStore();
    expect(() => store.resolve("00000000-0000-0000-0000-000000000000")).toThrow(
      HandleStoreError,
    );
  });

  it("resolve throws after revoke", () => {
    const store = new HandleStore();
    const handle = store.mint(BEARER_FIXTURES.jwt);
    store.revoke(handle);
    expect(() => store.resolve(handle)).toThrow(HandleStoreError);
    expect(() => store.resolve(handle)).toThrow(/not found/i);
  });

  it("clear drops every minted handle", () => {
    const store = new HandleStore();
    const h1 = store.mint(BEARER_FIXTURES.jwt);
    const h2 = store.mint(BEARER_FIXTURES.slack);
    store.clear();
    expect(() => store.resolve(h1)).toThrow(HandleStoreError);
    expect(() => store.resolve(h2)).toThrow(HandleStoreError);
  });

  it("revoke is a no-op for an unknown handle (idempotent cleanup)", () => {
    const store = new HandleStore();
    expect(() => store.revoke("not-a-real-handle")).not.toThrow();
  });

  it("size reports the number of live handles", () => {
    const store = new HandleStore();
    expect(store.size).toBe(0);
    store.mint(BEARER_FIXTURES.jwt);
    store.mint(BEARER_FIXTURES.slack);
    expect(store.size).toBe(2);
    store.clear();
    expect(store.size).toBe(0);
  });
});

describe("HandleStore — defensive validation", () => {
  it("mint rejects an empty bearer", () => {
    const store = new HandleStore();
    expect(() => store.mint("")).toThrow(HandleStoreError);
    expect(() => store.mint("   ")).toThrow(HandleStoreError);
  });

  it("mint rejects a non-string bearer", () => {
    const store = new HandleStore();
    expect(() => store.mint(null as unknown as string)).toThrow(HandleStoreError);
    expect(() => store.mint(undefined as unknown as string)).toThrow(
      HandleStoreError,
    );
  });

  it("mint rejects bearers containing CR, LF, or NUL", () => {
    const store = new HandleStore();
    expect(() => store.mint("token\r\nX-Forwarded-For: evil")).toThrow(
      /CR, LF, or NUL/,
    );
    expect(() => store.mint("token\nstuff")).toThrow(HandleStoreError);
    expect(() => store.mint("token\0null")).toThrow(HandleStoreError);
  });
});

// ---------------------------------------------------------------------------
// buildMcpTools — Flue-shaped contract.
// ---------------------------------------------------------------------------

describe("buildMcpTools — Authorization shape", () => {
  it("passes a Handle scheme Authorization header, never a Bearer", async () => {
    const store = new HandleStore();
    const captured: any = {};
    const connect = captureFakeConnect(captured);
    const config: McpServerConfig = {
      serverName: "slack",
      url: "https://mcp.slack.example/mcp",
      bearer: BEARER_FIXTURES.slack,
    };

    await buildMcpTools({
      mcpConfigs: [config],
      handleStore: store,
      connectMcpServer: connect,
    });

    expect(captured.url).toBe("https://mcp.slack.example/mcp");
    expect(captured.headers?.Authorization).toMatch(/^Handle [0-9a-f-]{36}$/);
    expect(captured.headers?.Authorization).not.toContain(
      BEARER_FIXTURES.slack,
    );
  });

  it("the handle in the Authorization header resolves back to the bearer via the store", async () => {
    const store = new HandleStore();
    const captured: any = {};
    const config: McpServerConfig = {
      serverName: "github",
      url: "https://mcp.github.example/mcp",
      bearer: BEARER_FIXTURES.githubPat,
    };

    await buildMcpTools({
      mcpConfigs: [config],
      handleStore: store,
      connectMcpServer: captureFakeConnect(captured),
    });

    const handle = (captured.headers!.Authorization as string).slice(
      McpHandleAuthScheme.length + 1,
    );
    expect(store.resolve(handle)).toBe(BEARER_FIXTURES.githubPat);
  });

  it("preserves additional caller-supplied headers without overriding Authorization", async () => {
    const store = new HandleStore();
    const captured: any = {};
    await buildMcpTools({
      mcpConfigs: [
        {
          serverName: "notion",
          url: "https://mcp.notion.example/mcp",
          bearer: BEARER_FIXTURES.notion,
          extraHeaders: {
            "x-notion-version": "2025-09-03",
            // Even if the caller tries to inject their own Authorization,
            // the handle-shaped one must win — bearers must NEVER reach
            // the connect call.
            Authorization: `Bearer ${BEARER_FIXTURES.notion}`,
          },
        },
      ],
      handleStore: store,
      connectMcpServer: captureFakeConnect(captured),
    });
    expect(captured.headers?.["x-notion-version"]).toBe("2025-09-03");
    expect(captured.headers?.Authorization).toMatch(/^Handle /);
    expect(captured.headers?.Authorization).not.toContain(
      BEARER_FIXTURES.notion,
    );
  });

  it("strips lowercase 'authorization' from extraHeaders so the bearer cannot ride alongside the handle", async () => {
    // HTTP header keys are case-insensitive on the wire. Without case-
    // normalisation a JS object would carry both keys, and downstream
    // HTTP clients may serialise the lowercase one. Strip any auth-
    // shaped key BEFORE merging in the handle-shaped Authorization.
    const store = new HandleStore();
    const captured: any = {};
    await buildMcpTools({
      mcpConfigs: [
        {
          serverName: "slack",
          url: "https://mcp.slack.example/mcp",
          bearer: BEARER_FIXTURES.slack,
          extraHeaders: {
            authorization: `Bearer ${BEARER_FIXTURES.slack}`,
            AUTHORIZATION: `Bearer ${BEARER_FIXTURES.slack}`,
            "Proxy-Authorization": `Bearer ${BEARER_FIXTURES.slack}`,
            "x-trace-id": "trace-123",
          },
        },
      ],
      handleStore: store,
      connectMcpServer: captureFakeConnect(captured),
    });

    // The merged header set should carry only the handle-shaped
    // Authorization plus benign x-trace-id; no lowercase, all-caps,
    // or proxy variant survives.
    const headerKeys = Object.keys(captured.headers ?? {});
    const authKeys = headerKeys.filter((k) =>
      k.toLowerCase().includes("authorization"),
    );
    expect(authKeys).toEqual(["Authorization"]);
    expect(captured.headers?.Authorization).toMatch(/^Handle /);
    expect(captured.headers?.Authorization).not.toContain(
      BEARER_FIXTURES.slack,
    );
    expect(captured.headers?.["x-trace-id"]).toBe("trace-123");

    // The bearer MUST NOT appear anywhere in the merged headers.
    const headerJson = JSON.stringify(captured.headers);
    expect(headerJson).not.toContain(BEARER_FIXTURES.slack);
  });

  it("forwards transport hint through to connectMcpServer", async () => {
    const store = new HandleStore();
    const captured: any = {};
    await buildMcpTools({
      mcpConfigs: [
        {
          serverName: "sse-server",
          url: "https://mcp.sse.example/mcp",
          bearer: BEARER_FIXTURES.jwt,
          transport: "sse",
        },
      ],
      handleStore: store,
      connectMcpServer: captureFakeConnect(captured),
    });
    expect(captured.transport).toBe("sse");
  });
});

// ---------------------------------------------------------------------------
// CONTRACT TEST — JSON.stringify(toolDefs) must not contain any bearer.
// ---------------------------------------------------------------------------

describe("buildMcpTools — bearer-leak contract", () => {
  it("JSON.stringify(toolDefs) contains no bearer-shaped string for any fixture", async () => {
    const store = new HandleStore();
    const configs: McpServerConfig[] = [
      {
        serverName: "slack",
        url: "https://mcp.slack.example/mcp",
        bearer: BEARER_FIXTURES.slack,
      },
      {
        serverName: "github",
        url: "https://mcp.github.example/mcp",
        bearer: BEARER_FIXTURES.githubPat,
      },
      {
        serverName: "google",
        url: "https://mcp.google.example/mcp",
        bearer: BEARER_FIXTURES.google,
      },
      {
        serverName: "notion",
        url: "https://mcp.notion.example/mcp",
        bearer: BEARER_FIXTURES.notion,
      },
      {
        serverName: "jwt-server",
        url: "https://mcp.jwt.example/mcp",
        bearer: BEARER_FIXTURES.jwt,
      },
    ];

    const tools = await buildMcpTools({
      mcpConfigs: configs,
      handleStore: store,
      connectMcpServer: async (args) => [makeFakeTool("captured", args.headers)],
    });

    const serialized = JSON.stringify(tools);
    for (const bearer of ALL_BEARERS) {
      expect(serialized).not.toContain(bearer);
    }
    // Sanity: we actually got tools back (the contract would pass
    // trivially if the connect impl returned an empty array). Real
    // ToolDefs hold their auth headers in the execute() closure, NOT
    // in a serializable property — so JSON.stringify legitimately
    // omits them. The contract above is the load-bearing assertion.
    expect(tools).toHaveLength(configs.length);
  });

  it("contract holds even when the bearer contains characters that look like a UUID", async () => {
    // Pathological: a bearer that itself looks UUID-ish. The contract is
    // about the EXACT bearer value not appearing, not about regex evasion.
    const sneakyBearer = "00000000-0000-0000-0000-000000000abc-real-bearer";
    const store = new HandleStore();
    const tools = await buildMcpTools({
      mcpConfigs: [
        {
          serverName: "sneaky",
          url: "https://mcp.sneaky.example/mcp",
          bearer: sneakyBearer,
        },
      ],
      handleStore: store,
      connectMcpServer: async (args) => [makeFakeTool("sneaky", args.headers)],
    });
    expect(JSON.stringify(tools)).not.toContain(sneakyBearer);
  });
});

// ---------------------------------------------------------------------------
// Multi-server fan-out + per-server failure isolation.
// ---------------------------------------------------------------------------

describe("buildMcpTools — multi-server", () => {
  it("returns ToolDefs from every server in the manifest", async () => {
    const store = new HandleStore();
    const connect: ConnectMcpServerFn = async (args) => [
      makeFakeTool(`from_${new URL(args.url).hostname}`, args.headers),
    ];
    const tools = await buildMcpTools({
      mcpConfigs: [
        {
          serverName: "a",
          url: "https://a.example/mcp",
          bearer: BEARER_FIXTURES.jwt,
        },
        {
          serverName: "b",
          url: "https://b.example/mcp",
          bearer: BEARER_FIXTURES.slack,
        },
      ],
      handleStore: store,
      connectMcpServer: connect,
    });
    expect(tools.map((t) => t.name)).toEqual([
      "mcp_from_a.example",
      "mcp_from_b.example",
    ]);
  });

  it("a single server failure does not block other servers (fail-isolated)", async () => {
    const store = new HandleStore();
    const connect: ConnectMcpServerFn = async (args) => {
      if (args.url.includes("broken")) {
        throw new Error("MCP server unavailable");
      }
      return [makeFakeTool(args.url.includes("a.example") ? "a" : "b", args.headers)];
    };
    const tools = await buildMcpTools({
      mcpConfigs: [
        {
          serverName: "a",
          url: "https://a.example/mcp",
          bearer: BEARER_FIXTURES.jwt,
        },
        {
          serverName: "broken",
          url: "https://broken.example/mcp",
          bearer: BEARER_FIXTURES.slack,
        },
        {
          serverName: "b",
          url: "https://b.example/mcp",
          bearer: BEARER_FIXTURES.notion,
        },
      ],
      handleStore: store,
      connectMcpServer: connect,
    });
    expect(tools.map((t) => t.name).sort()).toEqual(["mcp_a", "mcp_b"]);
  });

  it("revokes handles for servers whose connect attempt fails", async () => {
    const store = new HandleStore();
    const beforeMint = store.size;
    await buildMcpTools({
      mcpConfigs: [
        {
          serverName: "broken",
          url: "https://broken.example/mcp",
          bearer: BEARER_FIXTURES.jwt,
        },
      ],
      handleStore: store,
      connectMcpServer: async () => {
        throw new Error("MCP server unavailable");
      },
    });
    // Failed servers should not leave their handle stranded in the store.
    expect(store.size).toBe(beforeMint);
  });

  it("returns an empty array when the manifest is empty", async () => {
    const store = new HandleStore();
    const connect = vi.fn();
    const tools = await buildMcpTools({
      mcpConfigs: [],
      handleStore: store,
      connectMcpServer: connect as unknown as ConnectMcpServerFn,
    });
    expect(tools).toEqual([]);
    expect(connect).not.toHaveBeenCalled();
  });

  it("invokes onConnectError when a server's connect throws", async () => {
    const store = new HandleStore();
    const errors: Array<{ err: unknown; serverName: string }> = [];
    const connect: ConnectMcpServerFn = async (args) => {
      if (args.url.includes("broken")) throw new Error("MCP timeout");
      return [makeFakeTool("ok", args.headers)];
    };
    const tools = await buildMcpTools({
      mcpConfigs: [
        {
          serverName: "broken",
          url: "https://broken.example/mcp",
          bearer: BEARER_FIXTURES.jwt,
        },
        {
          serverName: "ok",
          url: "https://ok.example/mcp",
          bearer: BEARER_FIXTURES.slack,
        },
      ],
      handleStore: store,
      connectMcpServer: connect,
      onConnectError: (err, config) => {
        errors.push({ err, serverName: config.serverName });
      },
    });
    expect(tools.map((t) => t.name)).toEqual(["mcp_ok"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.serverName).toBe("broken");
    expect((errors[0]!.err as Error).message).toBe("MCP timeout");
  });
});

// ---------------------------------------------------------------------------
// Fail-closed validation.
// ---------------------------------------------------------------------------

describe("buildMcpTools — fail-closed validation", () => {
  it("skips configs missing url or serverName (does not throw the whole build)", async () => {
    const store = new HandleStore();
    const captured: any[] = [];
    const connect: ConnectMcpServerFn = async (args) => {
      captured.push(args);
      return [makeFakeTool("ok", args.headers)];
    };
    const tools = await buildMcpTools({
      mcpConfigs: [
        { serverName: "", url: "https://no-name.example/mcp", bearer: BEARER_FIXTURES.jwt },
        { serverName: "no-url", url: "", bearer: BEARER_FIXTURES.jwt },
        {
          serverName: "valid",
          url: "https://valid.example/mcp",
          bearer: BEARER_FIXTURES.jwt,
        },
      ],
      handleStore: store,
      connectMcpServer: connect,
    });
    expect(captured).toHaveLength(1);
    expect(tools.map((t) => t.name)).toEqual(["mcp_ok"]);
  });

  it("skips configs with empty bearer rather than calling connect with no auth", async () => {
    const store = new HandleStore();
    const connect = vi.fn();
    const tools = await buildMcpTools({
      mcpConfigs: [
        { serverName: "noauth", url: "https://noauth.example/mcp", bearer: "" },
      ],
      handleStore: store,
      connectMcpServer: connect as unknown as ConnectMcpServerFn,
    });
    expect(tools).toEqual([]);
    expect(connect).not.toHaveBeenCalled();
  });

  it("skips whitespace-only bearer without throwing past buildMcpTools", async () => {
    // Regression test: a "   " bearer is truthy in JS, so a naive
    // !config.bearer check passes — but HandleStore.mint then throws
    // on whitespace, killing the entire build for one bad config.
    const store = new HandleStore();
    const captured: any = {};
    const tools = await buildMcpTools({
      mcpConfigs: [
        { serverName: "bad", url: "https://bad.example/mcp", bearer: "   " },
        {
          serverName: "good",
          url: "https://good.example/mcp",
          bearer: BEARER_FIXTURES.jwt,
        },
      ],
      handleStore: store,
      connectMcpServer: captureFakeConnect(captured),
    });
    expect(tools).toHaveLength(1);
    expect(captured.url).toBe("https://good.example/mcp");
  });

  it("surfaces CRLF-bearer rejection through onConnectError without aborting the build", async () => {
    const store = new HandleStore();
    const captured: any = {};
    const errors: Array<{ err: unknown; serverName: string }> = [];
    const tools = await buildMcpTools({
      mcpConfigs: [
        {
          serverName: "tampered",
          url: "https://tampered.example/mcp",
          bearer: "valid-prefix\r\nX-Injected: evil",
        },
        {
          serverName: "clean",
          url: "https://clean.example/mcp",
          bearer: BEARER_FIXTURES.jwt,
        },
      ],
      handleStore: store,
      connectMcpServer: captureFakeConnect(captured),
      onConnectError: (err, config) => {
        errors.push({ err, serverName: config.serverName });
      },
    });
    expect(tools).toHaveLength(1);
    expect(captured.url).toBe("https://clean.example/mcp");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.serverName).toBe("tampered");
    expect((errors[0]!.err as Error).message).toMatch(/CR, LF, or NUL/);
  });
});

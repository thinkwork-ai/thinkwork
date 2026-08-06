/**
 * THINK-623 — long-call + progress behavior for the Pi MCP client.
 *
 * These exercise `createConnectMcpServer` against a REAL MCP SDK server over
 * an in-memory transport pair, so the assertions cover the SDK's actual
 * timeout bookkeeping (progress-token routing, `resetTimeoutOnProgress`,
 * `maxTotalTimeout`) rather than a hand-rolled stand-in.
 *
 * Timeouts here are milliseconds rather than the production minutes: the
 * behaviors under test are relative (does a progress notification push the
 * wall out; does the total ceiling still win), not absolute.
 */

import { afterEach, describe, expect, it } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createConnectMcpServer } from "../src/mcp-connect.js";

const TOOL_NAME = "slow_search";
const PER_ATTEMPT_MS = 200;
const MAX_TOTAL_MS = 700;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface FakeServerOptions {
  /** Milliseconds between progress notifications; omit to send none. */
  progressEveryMs?: number;
  /** How many progress notifications to send before returning. */
  progressCount: number;
  /** Extra wall time before the final result, after the progress run. */
  trailingDelayMs?: number;
}

interface FakeServer {
  clientTransport: Transport;
  /** Progress tokens the client attached, in call order. */
  progressTokens: Array<string | number | undefined>;
  stop: () => Promise<void>;
}

/**
 * A real MCP server whose single tool optionally streams progress
 * notifications before returning. Records the `_meta.progressToken` the
 * client attached so tests can assert on the SDK's token plumbing.
 */
async function startFakeMcpServer(
  options: FakeServerOptions,
): Promise<FakeServer> {
  const server = new Server(
    { name: "fake-long-call", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );
  const progressTokens: Array<string | number | undefined> = [];
  let stopped = false;

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: TOOL_NAME,
        description: "Takes its time.",
        inputSchema: { type: "object" as const },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const progressToken = request.params._meta?.progressToken;
    progressTokens.push(progressToken);
    const every = options.progressEveryMs;
    if (every !== undefined && progressToken !== undefined) {
      for (let sent = 0; sent < options.progressCount; sent += 1) {
        await delay(every);
        if (stopped) break;
        await extra.sendNotification({
          method: "notifications/progress",
          params: {
            progressToken,
            progress: sent + 1,
            total: options.progressCount,
          },
        });
      }
    } else if (every !== undefined) {
      await delay(every * options.progressCount);
    }
    if (options.trailingDelayMs) await delay(options.trailingDelayMs);
    return { content: [{ type: "text" as const, text: "done" }] };
  });

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  return {
    clientTransport,
    progressTokens,
    stop: async () => {
      stopped = true;
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
  longRunning?: boolean;
}) {
  const factory = createConnectMcpServer({
    cleanup: [],
    callToolTimeoutMs: PER_ATTEMPT_MS,
    longCallMaxTotalTimeoutMs: MAX_TOTAL_MS,
    transportFactory: () => args.server.clientTransport,
  });
  return factory({
    url: "https://mcp.example.com/",
    headers: {},
    serverName: "fake",
    ...(args.longRunning ? { longRunning: true } : {}),
  });
}

describe("createConnectMcpServer — long-call profile (THINK-623)", () => {
  it("completes a call that outlives the per-attempt wall when the server streams progress", async () => {
    // 5 notifications × 120ms ≈ 600ms of wall — triple the 200ms per-attempt
    // timeout, which the legacy fixed-wall path could not survive.
    const server = await startFakeMcpServer({
      progressEveryMs: 120,
      progressCount: 5,
    });
    running.push(server);

    const tools = await connectTools({ server, longRunning: true });
    const started = Date.now();
    const result = await tools[0]!.execute("call-1", {});

    expect(Date.now() - started).toBeGreaterThan(PER_ATTEMPT_MS);
    expect(result.content[0]).toMatchObject({ text: "done" });
    // `onprogress` is what makes the SDK attach the token; without it the
    // server could not have routed a resetting notification back.
    expect(server.progressTokens[0]).toBeDefined();
  });

  it("still times out at the per-attempt wall when the server sends no progress", async () => {
    const server = await startFakeMcpServer({
      progressCount: 0,
      trailingDelayMs: PER_ATTEMPT_MS * 4,
    });
    running.push(server);

    const tools = await connectTools({ server, longRunning: true });
    const started = Date.now();
    await expect(tools[0]!.execute("call-1", {})).rejects.toThrow(/timed out/i);
    expect(Date.now() - started).toBeLessThan(MAX_TOTAL_MS);
  });

  it("enforces maxTotalTimeout even while progress keeps arriving", async () => {
    // Progress every 80ms forever-ish: the per-attempt wall never fires, so
    // only the total ceiling can end this call.
    const server = await startFakeMcpServer({
      progressEveryMs: 80,
      progressCount: 100,
    });
    running.push(server);

    const tools = await connectTools({ server, longRunning: true });
    const started = Date.now();
    await expect(tools[0]!.execute("call-1", {})).rejects.toThrow(
      /Maximum total timeout exceeded/i,
    );
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(MAX_TOTAL_MS);
    expect(elapsed).toBeLessThan(MAX_TOTAL_MS * 3);
  });

  it("leaves non-opted-in servers on the fixed wall (no progress token, no reset)", async () => {
    const server = await startFakeMcpServer({
      progressEveryMs: 120,
      progressCount: 5,
    });
    running.push(server);

    const tools = await connectTools({ server });
    await expect(tools[0]!.execute("call-1", {})).rejects.toThrow(/timed out/i);
    // No `onprogress` supplied → the SDK sends no `_meta.progressToken`.
    expect(server.progressTokens[0]).toBeUndefined();
  });

  it("fails fast when the MCP server never answers `initialize`", async () => {
    // A transport that accepts sends and never replies — the cold /
    // unreachable server case. Without an explicit connect timeout the SDK
    // default would stall the whole tool build for 60s.
    const silentTransport = {
      start: async () => {},
      send: async () => {},
      close: async () => {},
    } as unknown as Transport;

    const factory = createConnectMcpServer({
      cleanup: [],
      connectTimeoutMs: 150,
      transportFactory: () => silentTransport,
    });

    const started = Date.now();
    await expect(
      factory({
        url: "https://mcp.example.com/",
        headers: {},
        serverName: "cold",
      }),
    ).rejects.toThrow(/timed out/i);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

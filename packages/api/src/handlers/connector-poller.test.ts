import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRunConnectorDispatchTick = vi.hoisted(() => vi.fn());

vi.mock("../lib/connectors/runtime.js", () => ({
  runConnectorDispatchTick: mockRunConnectorDispatchTick,
}));

import {
  buildTickOptions,
  handler,
  summarizeResults,
} from "./connector-poller.js";

const NOW = "2026-05-06T18:00:00.000Z";

describe("connector-poller handler", () => {
  beforeEach(() => {
    mockRunConnectorDispatchTick.mockReset();
    delete process.env.CONNECTOR_POLLER_LIMIT;
  });

  it("runs a bounded connector dispatch tick with scheduler defaults", async () => {
    mockRunConnectorDispatchTick.mockResolvedValueOnce([
      {
        status: "dispatched",
        connectorId: "connector-1",
        executionId: "execution-1",
        externalRef: "TECH-55",
        threadId: "thread-1",
        messageId: "message-1",
      },
      {
        status: "duplicate",
        connectorId: "connector-1",
        executionId: "execution-2",
        externalRef: "TECH-54",
      },
    ]);

    const result = await handler();

    expect(mockRunConnectorDispatchTick).toHaveBeenCalledWith({
      tenantId: undefined,
      connectorId: undefined,
      limit: 50,
      force: false,
      now: undefined,
    });
    expect(result).toMatchObject({
      ok: true,
      options: {
        limit: 50,
        force: false,
      },
      resultCount: 2,
      counts: {
        dispatched: 1,
        duplicate: 1,
        unsupported_target: 0,
        skipped: 0,
        failed: 0,
      },
    });
  });

  it("passes explicit tenant, connector, force, limit, and clock filters", async () => {
    mockRunConnectorDispatchTick.mockResolvedValueOnce([]);

    await handler({
      tenantId: " tenant-a ",
      connectorId: " connector-1 ",
      limit: 5,
      force: true,
      now: NOW,
    });

    expect(mockRunConnectorDispatchTick).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      connectorId: "connector-1",
      limit: 5,
      force: true,
      now: new Date(NOW),
    });
  });

  it("uses the environment default limit but caps oversized batches", () => {
    process.env.CONNECTOR_POLLER_LIMIT = "250";

    expect(buildTickOptions({})).toMatchObject({
      limit: 100,
      force: false,
    });
    expect(buildTickOptions({ limit: "7" })).toMatchObject({
      limit: 7,
      force: false,
    });
  });

  it("rejects malformed manual clock overrides", () => {
    expect(() => buildTickOptions({ now: "nope" })).toThrow(
      "Invalid connector poller now value",
    );
  });

  it("summarizes every dispatch status", () => {
    expect(
      summarizeResults([
        {
          status: "skipped",
          connectorId: "connector-1",
          reason: "no_dispatch_candidates",
        },
        {
          status: "failed",
          connectorId: "connector-2",
          error: "Linear credential not found",
        },
        {
          status: "unsupported_target",
          connectorId: "connector-3",
          executionId: "execution-3",
          externalRef: "TECH-56",
          targetType: "routine",
        },
      ]),
    ).toEqual({
      dispatched: 0,
      duplicate: 0,
      unsupported_target: 1,
      skipped: 1,
      failed: 1,
    });
  });

  it("rethrows runtime failures so Lambda records the invocation as failed", async () => {
    mockRunConnectorDispatchTick.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(handler()).rejects.toThrow("database unavailable");
  });
});

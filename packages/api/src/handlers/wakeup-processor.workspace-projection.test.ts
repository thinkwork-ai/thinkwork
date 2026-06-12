import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWorkspaceTupleForWakeup } from "./wakeup-processor.js";

/**
 * U6 (plan 2026-06-12-002) — wakeup dispatch parity for the per-turn
 * workspace projection snapshot.
 *
 * wakeup-processor has TWO dispatch sites that reuse the SAME
 * thread_turn_id (`run.id`): the primary `agentCorePayload` invoke and the
 * turn-loop re-invoke. The render happens ONCE, pre-loop, so the projection
 * snapshot is recorded exactly once before the primary invoke — an in-loop
 * re-record would be a redundant UPDATE with identical inputs. Fetch events
 * appended across loop iterations survive because the writer object-merges
 * instead of replacing (covered behaviorally in
 * `../lib/workspace-projection-snapshot.test.ts`).
 */

const mocks = vi.hoisted(() => ({
  lambdaSend: vi.fn(),
}));

vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: vi.fn(() => ({ send: mocks.lambdaSend })),
  InvokeCommand: vi.fn((input) => ({ input })),
}));

const okPayload = {
  ok: true,
  renderedPrefix: "tenants/acme/rendered/agents/main/spaces/growth/t1/",
  cacheStatus: "hit",
  hydrateManifest: {
    version: 1,
    renderedPrefix: "tenants/acme/rendered/agents/main/spaces/growth/t1/",
    generatedAt: "2026-06-12T01:02:03.000Z",
    sources: [{ owner: "space", prefix: "tenants/acme/spaces/growth/" }],
    files: [
      {
        path: "SPACE.md",
        owner: "space",
        sourcePrefix: "tenants/acme/spaces/growth/",
        etag: "e3",
      },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKSPACE_RENDERER_FUNCTION_NAME", "ws-renderer");
});

describe("renderWorkspaceTupleForWakeup — hydrate manifest passthrough", () => {
  it("surfaces the renderer Lambda's hydrateManifest on the result (chat parity)", async () => {
    mocks.lambdaSend.mockResolvedValue({
      Payload: new TextEncoder().encode(JSON.stringify(okPayload)),
    });
    const result = await renderWorkspaceTupleForWakeup({
      tenantId: "t",
      agentId: "a",
      spaceId: "s",
    });
    expect(result.rendered).toBe(true);
    expect(result.hydrateManifest).toEqual(okPayload.hydrateManifest);
  });

  it("drops a malformed hydrateManifest instead of failing the render", async () => {
    mocks.lambdaSend.mockResolvedValue({
      Payload: new TextEncoder().encode(
        JSON.stringify({ ...okPayload, hydrateManifest: ["not", "valid"] }),
      ),
    });
    const result = await renderWorkspaceTupleForWakeup({
      tenantId: "t",
      agentId: "a",
      spaceId: "s",
    });
    expect(result.rendered).toBe(true);
    expect(result.hydrateManifest).toBeUndefined();
  });
});

describe("wakeup dispatch sites (source contract)", () => {
  const source = readFileSync(
    new URL("./wakeup-processor.ts", import.meta.url),
    "utf8",
  );

  it("records the projection snapshot exactly once (render happens once, pre-loop)", () => {
    expect(
      source.match(/recordDispatchWorkspaceProjectionSnapshot\(\{/g),
    ).toHaveLength(1);
    expect(source.match(/source: "wakeup-processor",/g)).toHaveLength(1);
    // The single write targets the shared turn id + tenant scope.
    expect(source).toContain("threadTurnId: run.id,");
  });

  it("the single write lands after render success and BEFORE the primary invoke", () => {
    const renderAt = source.indexOf(
      "renderedWorkspace = await renderWorkspaceTupleForWakeup(",
    );
    const writeAt = source.indexOf(
      "recordDispatchWorkspaceProjectionSnapshot({",
    );
    const primaryInvokeAt = source.indexOf("await invokeAgentCore(");
    expect(renderAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(renderAt);
    expect(primaryInvokeAt).toBeGreaterThan(writeAt);
  });

  it("the turn-loop RE-dispatch does NOT re-record the snapshot (identical inputs; merge-writer preserves fetches)", () => {
    const loopAt = source.indexOf("while (loopToolsCalled.length > 0");
    expect(loopAt).toBeGreaterThan(-1);
    // No write inside or after the loop: the pre-loop snapshot persists for
    // the whole turn, and fetch events appended between iterations survive
    // because writeWorkspaceProjectionSnapshot object-merges (see
    // ../lib/workspace-projection-snapshot.test.ts).
    expect(
      source.indexOf("recordDispatchWorkspaceProjectionSnapshot({", loopAt),
    ).toBe(-1);
  });
});

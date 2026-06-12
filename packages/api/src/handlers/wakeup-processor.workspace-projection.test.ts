import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWorkspaceTupleForWakeup } from "./wakeup-processor.js";

/**
 * U6 (plan 2026-06-12-002) — wakeup dispatch parity for the per-turn
 * workspace projection snapshot.
 *
 * wakeup-processor has TWO dispatch sites that reuse the SAME
 * thread_turn_id (`run.id`): the primary `agentCorePayload` invoke and the
 * turn-loop re-invoke. Both must record the projection through the shared
 * recorder (same shape as chat-agent-invoke), and the RE-dispatch write
 * must run through the merge-semantics writer so fetch events appended
 * earlier in the turn survive (covered behaviorally in
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

  it("BOTH builders record the projection snapshot (main + turn-loop re-dispatch)", () => {
    expect(
      source.match(/recordDispatchWorkspaceProjectionSnapshot\(\{/g),
    ).toHaveLength(2);
    // Both writes target the shared turn id and tenant scope.
    expect(
      source.match(/threadTurnId: run\.id,/g)?.length,
    ).toBeGreaterThanOrEqual(2);
    expect(source.match(/source: "wakeup-processor",/g)).toHaveLength(2);
  });

  it("primary write lands after render success and BEFORE the primary invoke", () => {
    const renderAt = source.indexOf(
      "renderedWorkspace = await renderWorkspaceTupleForWakeup(",
    );
    const firstWriteAt = source.indexOf(
      "recordDispatchWorkspaceProjectionSnapshot({",
    );
    const primaryInvokeAt = source.indexOf("await invokeAgentCore(");
    expect(renderAt).toBeGreaterThan(-1);
    expect(firstWriteAt).toBeGreaterThan(renderAt);
    expect(primaryInvokeAt).toBeGreaterThan(firstWriteAt);
  });

  it("turn-loop RE-dispatch re-records the snapshot inside the loop, before the re-invoke", () => {
    const loopAt = source.indexOf("while (loopToolsCalled.length > 0");
    const secondWriteAt = source.indexOf(
      "recordDispatchWorkspaceProjectionSnapshot({",
      loopAt,
    );
    const loopInvokeAt = source.indexOf(
      "const loopResponse = await invokeAgentCore(",
    );
    expect(loopAt).toBeGreaterThan(-1);
    expect(secondWriteAt).toBeGreaterThan(loopAt);
    expect(loopInvokeAt).toBeGreaterThan(secondWriteAt);
  });
});

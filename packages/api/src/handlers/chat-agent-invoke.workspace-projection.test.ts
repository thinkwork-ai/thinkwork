import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { renderWorkspaceTupleForInvoke } from "./chat-agent-invoke.js";

/**
 * U6 (plan 2026-06-12-002) — chat dispatch records a workspace projection
 * snapshot at DISPATCH time.
 *
 * Behavioral coverage of the snapshot writer (SQL shape, fetch
 * preservation, failure tolerance) lives in
 * `../lib/workspace-projection-snapshot.test.ts`. This suite covers the
 * handler seam: the renderer Lambda's hydrate manifest reaches the result,
 * and the dispatch site calls the recorder in the right place (the
 * source-level convention the dispatch-parity suite established).
 */

function fakeLambda(payload: Record<string, unknown>) {
  return {
    send: vi.fn(async () => ({
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    })),
  };
}

const okPayload = {
  ok: true,
  renderedPrefix: "tenants/acme/rendered/agents/main/spaces/growth/t1/",
  cacheStatus: "miss",
  hydrateManifest: {
    version: 1,
    renderedPrefix: "tenants/acme/rendered/agents/main/spaces/growth/t1/",
    generatedAt: "2026-06-12T01:02:03.000Z",
    sources: [{ owner: "agent", prefix: "tenants/acme/agents/main/" }],
    files: [
      {
        path: "AGENTS.md",
        owner: "agent",
        sourcePrefix: "tenants/acme/agents/main/",
        etag: "e1",
      },
    ],
  },
};

describe("renderWorkspaceTupleForInvoke — hydrate manifest passthrough", () => {
  it("surfaces the renderer Lambda's hydrateManifest on the result", async () => {
    const result = await renderWorkspaceTupleForInvoke(
      { tenantId: "t", agentId: "a", spaceId: "s" },
      { lambda: fakeLambda(okPayload), functionName: "ws-renderer" },
    );
    expect(result.rendered).toBe(true);
    expect(result.hydrateManifest).toEqual(okPayload.hydrateManifest);
  });

  it("drops a malformed hydrateManifest instead of failing the render", async () => {
    const result = await renderWorkspaceTupleForInvoke(
      { tenantId: "t", agentId: "a", spaceId: "s" },
      {
        lambda: fakeLambda({ ...okPayload, hydrateManifest: "garbage" }),
        functionName: "ws-renderer",
      },
    );
    expect(result.rendered).toBe(true);
    expect(result.hydrateManifest).toBeUndefined();
  });
});

describe("chat dispatch site (source contract)", () => {
  const source = readFileSync(
    new URL("./chat-agent-invoke.ts", import.meta.url),
    "utf8",
  );

  it("records the projection snapshot exactly once, on the rendered-success path", () => {
    expect(
      source.match(/recordDispatchWorkspaceProjectionSnapshot\(\{/g),
    ).toHaveLength(1);
    // It passes the turn + tenant scope and the rendered output.
    expect(source).toContain("threadTurnId: turnId,");
    expect(source).toContain(
      "hydrateManifest: renderedWorkspace.hydrateManifest,",
    );
    expect(source).toContain(`source: "chat-agent-invoke",`);
  });

  it("populates activeSkills via the shared writer (U7 dispatch parity)", () => {
    // Mirror of the wakeup-processor parity assertion — both dispatch
    // builders pass activeSkills through the same writer.
    expect(source).toContain(
      "activeSkills: skillsConfig.map((s) => s.skillId)",
    );
  });

  it("writes the snapshot BEFORE the AgentCore invoke (crashed turns keep it)", () => {
    const writeAt = source.indexOf(
      "recordDispatchWorkspaceProjectionSnapshot({",
    );
    const invokeAt = source.indexOf("const invokeStart = Date.now();");
    expect(writeAt).toBeGreaterThan(-1);
    expect(invokeAt).toBeGreaterThan(-1);
    expect(writeAt).toBeLessThan(invokeAt);
  });
});

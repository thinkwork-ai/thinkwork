import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildAgentDispatchControlFields,
  REQUIRED_DISPATCH_FIELDS,
  type AgentDispatchControlFieldArgs,
} from "../lib/agent-dispatch-payload.js";

/**
 * Standing dispatch-payload parity contract (plan 2026-06-12-002 U1).
 *
 * The #2395 bug class: a dispatch-critical field is added to
 * chat-agent-invoke's payload and silently missed in one of the TWO
 * wakeup-processor builders (`agentCorePayload` and the turn-loop
 * re-invoke), so resume/automation turns lose extension tools or model
 * governance. This suite fails when any builder drifts:
 *
 * 1. The helper's output keys must exactly match REQUIRED_DISPATCH_FIELDS —
 *    a field added to the helper without updating the list (or vice versa)
 *    fails here.
 * 2. All three dispatch sites must spread the helper.
 * 3. No dispatch-critical field may be assembled inline in a handler — the
 *    only path onto the wire is the shared helper, which reaches all three
 *    builders at once.
 */

// The helper deliberately takes resolved values instead of reading
// process.env / getConfig itself: call sites pass call-time reads
// (thinkworkApiUrl(), getApiAuthSecret()), which sidesteps the
// module-load env-capture gotcha entirely.
function baseArgs(
  overrides: Partial<AgentDispatchControlFieldArgs> = {},
): AgentDispatchControlFieldArgs {
  return {
    thinkworkApiUrl: "https://api.example.com",
    apiAuthSecret: "test-secret",
    threadId: "thread-1",
    threadTurnId: "turn-1",
    agentProfiles: [],
    modelRoutingPolicy: undefined,
    approvedModelIds: undefined,
    renderedWorkspacePrefix: "spaces/research/thread-1",
    turnContext: {
      spaceId: "space-1",
      tenantSlug: "acme",
      spaceSlug: "research",
    },
    includeFinalizeCallback: false,
    ...overrides,
  };
}

function handlerSource(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
}

describe("dispatch payload parity (chat-agent-invoke vs wakeup-processor)", () => {
  it("helper emits exactly the REQUIRED_DISPATCH_FIELDS keys", () => {
    const fields = buildAgentDispatchControlFields(baseArgs());
    expect(Object.keys(fields).sort()).toEqual(
      [...REQUIRED_DISPATCH_FIELDS].sort(),
    );
  });

  it("all three dispatch builders spread the shared helper", () => {
    const wakeupSource = handlerSource("wakeup-processor.ts");
    const chatSource = handlerSource("chat-agent-invoke.ts");

    // wakeup-processor has TWO payload builders: agentCorePayload and the
    // turn-loop re-invoke. Both must spread the helper.
    expect(
      wakeupSource.match(/\.\.\.buildAgentDispatchControlFields\(/g),
    ).toHaveLength(2);
    expect(
      chatSource.match(/\.\.\.buildAgentDispatchControlFields\(/g),
    ).toHaveLength(1);
  });

  it("no dispatch-critical field is assembled inline in either handler", () => {
    // If a future field lands inline in chat-agent-invoke instead of the
    // helper, this fails and forces it through the helper — which is what
    // carries it to both wakeup builders.
    const sources = [
      handlerSource("wakeup-processor.ts"),
      handlerSource("chat-agent-invoke.ts"),
    ];
    for (const source of sources) {
      for (const field of REQUIRED_DISPATCH_FIELDS) {
        // Word-boundary guard: `current_thread_turn_id:` must not match
        // `thread_turn_id`.
        const inlineKey = new RegExp(`(?<![\\w.])${field}\\s*:`);
        expect(source).not.toMatch(inlineKey);
      }
    }
  });

  it("wakeup payloads carry the extension-gate wiring (api url/secret + turn id)", () => {
    const fields = buildAgentDispatchControlFields(baseArgs());
    expect(fields.thinkwork_api_url).toBe("https://api.example.com");
    expect(fields.thinkwork_api_secret).toBe("test-secret");
    expect(fields.thread_turn_id).toBe("turn-1");
  });

  it("tenant with no profiles ships agent_profiles as [] — present after JSON serialization, not absent", () => {
    const fields = buildAgentDispatchControlFields(
      baseArgs({ agentProfiles: [] }),
    );
    const wire = JSON.parse(JSON.stringify(fields)) as Record<string, unknown>;
    expect("agent_profiles" in wire).toBe(true);
    expect(wire.agent_profiles).toEqual([]);
  });

  it("builds the activity callback on every path but the finalize callback only when opted in", () => {
    const wakeupStyle = buildAgentDispatchControlFields(
      baseArgs({ includeFinalizeCallback: false }),
    );
    // Activity streaming is best-effort and never alters the synchronous
    // response — safe on the RequestResponse wakeup path.
    expect(wakeupStyle.activity_callback_url).toBe(
      "https://api.example.com/api/threads/thread-1/activity",
    );
    expect(wakeupStyle.activity_callback_secret).toBe("test-secret");
    // Finalize flips response ownership (the runtime answers
    // {finalize_dispatched: true} instead of the turn body) — the wakeup
    // path owns writeback synchronously, so it must NOT configure it.
    expect(wakeupStyle.finalize_callback_url).toBeUndefined();
    expect(wakeupStyle.finalize_callback_secret).toBeUndefined();

    const chatStyle = buildAgentDispatchControlFields(
      baseArgs({ includeFinalizeCallback: true }),
    );
    expect(chatStyle.finalize_callback_url).toBe(
      "https://api.example.com/api/threads/thread-1/finalize",
    );
    expect(chatStyle.finalize_callback_secret).toBe("test-secret");
  });

  it("strips a trailing slash from the API URL when building callback URLs", () => {
    const fields = buildAgentDispatchControlFields(
      baseArgs({
        thinkworkApiUrl: "https://api.example.com/",
        includeFinalizeCallback: true,
      }),
    );
    expect(fields.finalize_callback_url).toBe(
      "https://api.example.com/api/threads/thread-1/finalize",
    );
    expect(fields.activity_callback_url).toBe(
      "https://api.example.com/api/threads/thread-1/activity",
    );
  });

  it("omits callback values without an active turn id (chat gating preserved)", () => {
    const fields = buildAgentDispatchControlFields(
      baseArgs({ threadTurnId: undefined, includeFinalizeCallback: true }),
    );
    expect(fields.thread_turn_id).toBeUndefined();
    expect(fields.finalize_callback_url).toBeUndefined();
    expect(fields.finalize_callback_secret).toBeUndefined();
    expect(fields.activity_callback_url).toBeUndefined();
    expect(fields.activity_callback_secret).toBeUndefined();
  });

  it("omits callback URLs when the thread id is unresolved (email-style wakeups)", () => {
    const fields = buildAgentDispatchControlFields(
      baseArgs({ threadId: undefined }),
    );
    expect(fields.activity_callback_url).toBeUndefined();
    // The extension gate wiring is independent of the thread id.
    expect(fields.thinkwork_api_url).toBe("https://api.example.com");
    expect(fields.thread_turn_id).toBe("turn-1");
  });

  it("builds turn_context with the rendered prefix, or undefined outside a Space", () => {
    const withSpace = buildAgentDispatchControlFields(baseArgs());
    expect(withSpace.turn_context).toEqual({
      spaceId: "space-1",
      tenantSlug: "acme",
      spaceSlug: "research",
      renderedWorkspacePrefix: "spaces/research/thread-1",
    });

    const withoutSpace = buildAgentDispatchControlFields(
      baseArgs({ turnContext: null }),
    );
    expect("turn_context" in withoutSpace).toBe(true);
    expect(withoutSpace.turn_context).toBeUndefined();
  });

  it("passes model routing policy and approved model ids through unchanged", () => {
    const routes = [
      {
        tool: "workspace_skill",
        match: { slug: "research" },
        model: "us.amazon.nova-micro-v1:0",
        sourceOwner: "user" as const,
        sourcePath: "/workspace/User/TOOLS.md",
        precedence: 300,
      },
    ];
    const fields = buildAgentDispatchControlFields(
      baseArgs({
        modelRoutingPolicy: { routes },
        approvedModelIds: ["us.amazon.nova-micro-v1:0"],
      }),
    );
    expect(fields.model_routing_policy).toEqual({ routes });
    expect(fields.approved_model_ids).toEqual(["us.amazon.nova-micro-v1:0"]);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  CHAIN_DEPTH_CAP,
  classifyChain,
  classifyWorkspaceReview,
  type AgentChainNode,
  type ClassifyChainStore,
} from "../lib/workspace-events/classify-review.js";

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT = "22222222-2222-2222-2222-222222222222";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function node(
  id: string,
  parent: string | null,
  human_pair_id: string | null,
  source: "user" | "system",
  level: number,
): AgentChainNode {
  return { id, parent_agent_id: parent, human_pair_id, source, level };
}

describe("classifyChain (pure)", () => {
  it("paired: agent has human_pair_id and no parent (AE1)", () => {
    const chain: AgentChainNode[] = [node("a", null, USER_A, "user", 0)];
    expect(classifyChain(chain)).toEqual({
      kind: "paired",
      responsibleUserId: USER_A,
    });
  });

  it("paired: sub-agent inherits via parent's human_pair_id (AE2)", () => {
    const chain: AgentChainNode[] = [
      node("sub", "parent", null, "user", 0),
      node("parent", null, USER_A, "user", 1),
    ];
    expect(classifyChain(chain)).toEqual({
      kind: "paired",
      responsibleUserId: USER_A,
    });
  });

  it("paired: deep chain resolves at grandparent", () => {
    const chain: AgentChainNode[] = [
      node("ssub", "sub", null, "user", 0),
      node("sub", "gp", null, "user", 1),
      node("gp", null, USER_B, "user", 2),
    ];
    expect(classifyChain(chain)).toEqual({
      kind: "paired",
      responsibleUserId: USER_B,
    });
  });

  it("system: terminator is source=system with no human_pair_id (AE3)", () => {
    const chain: AgentChainNode[] = [node("eval", null, null, "system", 0)];
    expect(classifyChain(chain)).toEqual({
      kind: "system",
      responsibleUserId: null,
    });
  });

  it("unrouted: orphan user-source agent with no human_pair_id", () => {
    const chain: AgentChainNode[] = [node("orphan", null, null, "user", 0)];
    expect(classifyChain(chain)).toEqual({
      kind: "unrouted",
      responsibleUserId: null,
    });
  });

  it("system: chain hits source=system ancestor before any human_pair_id", () => {
    const chain: AgentChainNode[] = [
      node("child", "sys-parent", null, "user", 0),
      node("sys-parent", null, null, "system", 1),
    ];
    expect(classifyChain(chain)).toEqual({
      kind: "system",
      responsibleUserId: null,
    });
  });

  it("unrouted: chain truncated at depth cap with parent_agent_id still set (cycle/long-chain)", () => {
    const chain: AgentChainNode[] = Array.from(
      { length: CHAIN_DEPTH_CAP },
      (_, i) =>
        node(
          `lvl${i}`,
          // every node still points at a parent — caller hit the cap before terminator
          `lvl${i + 1}`,
          null,
          "user",
          i,
        ),
    );
    expect(classifyChain(chain)).toEqual({
      kind: "unrouted",
      responsibleUserId: null,
    });
  });

  it("classifies by deepest reachable agent when parent_agent_id points at missing row", () => {
    // CTE walked as far as it could; chain stops at level 1, but level 1 has parent_agent_id
    // pointing at a deleted/missing row (the row is not in `chain`).
    const chain: AgentChainNode[] = [
      node("child", "missing-parent", null, "user", 0),
      // level 1 row missing — chain ends here; classifier sees only what was reachable
    ];
    expect(classifyChain(chain)).toEqual({
      kind: "unrouted",
      responsibleUserId: null,
    });
  });

  it("depth exactly CHAIN_DEPTH_CAP-1 with terminator resolves normally", () => {
    // Last node has parent_agent_id null, depth = CAP-1 → terminator is reached, classify normally
    const lastLevel = CHAIN_DEPTH_CAP - 1;
    const chain: AgentChainNode[] = [];
    for (let i = 0; i < lastLevel; i++) {
      chain.push(node(`lvl${i}`, `lvl${i + 1}`, null, "user", i));
    }
    chain.push(node(`lvl${lastLevel}`, null, USER_A, "user", lastLevel));
    expect(classifyChain(chain)).toEqual({
      kind: "paired",
      responsibleUserId: USER_A,
    });
  });

  it("unrouted: empty chain (agent not found at all)", () => {
    expect(classifyChain([])).toEqual({
      kind: "unrouted",
      responsibleUserId: null,
    });
  });
});

describe("classifyWorkspaceReview (orchestrator)", () => {
  function fakeStore(
    chainsByKey: Record<string, AgentChainNode[]>,
  ): ClassifyChainStore {
    return {
      fetchAgentChain: vi.fn(async (tenantId, agentId, depthCap) => {
        const key = `${tenantId}:${agentId}`;
        const stored = chainsByKey[key] ?? [];
        return stored.slice(0, depthCap);
      }),
    };
  }

  it("returns unrouted when the agent's tenant does not match (isolation)", async () => {
    // Chain exists under TENANT; caller passes OTHER_TENANT.
    const store = fakeStore({
      [`${TENANT}:agent-1`]: [node("agent-1", null, USER_A, "user", 0)],
    });

    const result = await classifyWorkspaceReview(store, {
      tenantId: OTHER_TENANT,
      agentId: "agent-1",
    });

    expect(result).toEqual({ kind: "unrouted", responsibleUserId: null });
    expect(store.fetchAgentChain).toHaveBeenCalledWith(
      OTHER_TENANT,
      "agent-1",
      CHAIN_DEPTH_CAP,
    );
  });

  it("composes store + classifier for a paired sub-agent", async () => {
    const store = fakeStore({
      [`${TENANT}:sub`]: [
        node("sub", "parent", null, "user", 0),
        node("parent", null, USER_A, "user", 1),
      ],
    });

    const result = await classifyWorkspaceReview(store, {
      tenantId: TENANT,
      agentId: "sub",
    });

    expect(result).toEqual({ kind: "paired", responsibleUserId: USER_A });
  });

  it("respects an explicit depthCap override", async () => {
    const store = fakeStore({
      [`${TENANT}:agent-1`]: [node("agent-1", null, USER_A, "user", 0)],
    });

    await classifyWorkspaceReview(store, {
      tenantId: TENANT,
      agentId: "agent-1",
      depthCap: 4,
    });

    expect(store.fetchAgentChain).toHaveBeenCalledWith(
      TENANT,
      "agent-1",
      4,
    );
  });
});

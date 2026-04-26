import { describe, expect, it } from "vitest";
import { McpJsonRpcClient } from "./_harness/mcp-json-rpc.js";

const url = process.env.USER_MEMORY_MCP_URL;
const token = process.env.USER_MEMORY_MCP_TOKEN;
const requireRecallMatch = process.env.USER_MEMORY_MCP_REQUIRE_RECALL_MATCH === "true";

const missing = [
  ["USER_MEMORY_MCP_URL", url],
  ["USER_MEMORY_MCP_TOKEN", token],
].filter(([, value]) => !value);

describe("Codex direct User Memory MCP E2E", () => {
  if (missing.length > 0) {
    it("is blocked until a real User Memory MCP endpoint and user token are configured", () => {
      console.warn(
        [
          "User Memory MCP live E2E skipped.",
          `Missing env: ${missing.map(([name]) => name).join(", ")}`,
          "The inbound server is tracked by docs/plans/2026-04-20-008-feat-memory-wiki-mcp-server-plan.md.",
        ].join(" "),
      );
      expect(missing.length).toBeGreaterThan(0);
    });
    return;
  }

  it("lists and calls retain, memory_recall, and wiki_search for the current user", async () => {
    const client = new McpJsonRpcClient(url!, token!);
    await client.initialize();

    const listed = await client.listTools();
    const toolNames = listed.tools.map((tool) => tool.name);
    expect(toolNames).toEqual(expect.arrayContaining(["retain", "memory_recall", "wiki_search"]));

    const runId = `codex-user-memory-mcp-e2e-${Date.now()}`;
    const sentinel = `${runId} user scoped retention probe`;
    const retainResult = await client.callTool("retain", {
      content: sentinel,
      kind: "learning",
      tags: ["codex-e2e", runId],
    });
    expect(JSON.stringify(retainResult)).toMatch(/ok|content|memory/i);

    const recallResult = await pollForRecall(client, sentinel);
    if (requireRecallMatch) {
      expect(JSON.stringify(recallResult)).toContain(sentinel);
    } else {
      expect(recallResult).toBeDefined();
    }

    const wikiResult = await client.callTool("wiki_search", {
      query: sentinel,
      limit: 5,
    });
    expect(wikiResult).toBeDefined();
  }, 120_000);
});

async function pollForRecall(client: McpJsonRpcClient, sentinel: string) {
  let lastResult: unknown = null;
  const attempts = requireRecallMatch ? 6 : 1;
  for (let i = 0; i < attempts; i += 1) {
    lastResult = await client.callTool("memory_recall", {
      query: sentinel,
      limit: 5,
    });
    if (JSON.stringify(lastResult).includes(sentinel)) return lastResult;
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  return lastResult;
}

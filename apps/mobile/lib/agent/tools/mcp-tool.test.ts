import { describe, expect, it, vi } from "vitest";
import { createMcpTool } from "./mcp-tool";
import { runAgentTurn } from "../loop";
import { ToolRegistry } from "../tool-registry";
import {
  MockModelProvider,
  textResponse,
  toolResponse,
} from "../providers/mock";
import type { Message } from "../types";

const user = (content: string): Message => ({ role: "user", content });

const DEF = {
  name: "create_crm_opportunity",
  description: "Create a CRM opportunity",
  parameters: { type: "object", properties: { name: { type: "string" } } },
};

describe("createMcpTool", () => {
  it("advertises the MCP tool's spec to the model", () => {
    const tool = createMcpTool(DEF, async () => ({}));
    expect(tool.spec).toEqual(DEF);
  });

  it("stringifies an object result as tool content", async () => {
    const call = vi.fn().mockResolvedValue({ id: "opp_1", ok: true });
    const tool = createMcpTool(DEF, call);
    const res = await tool.execute({ name: "Acme" }, {});
    expect(call).toHaveBeenCalledWith("create_crm_opportunity", {
      name: "Acme",
    });
    expect(res).toEqual({ content: JSON.stringify({ id: "opp_1", ok: true }) });
  });

  it("passes a string result through unwrapped", async () => {
    const tool = createMcpTool(DEF, async () => "done");
    expect(await tool.execute({}, {})).toEqual({ content: "done" });
  });

  it("returns an isError result when the MCP call throws (loop can recover)", async () => {
    const tool = createMcpTool(DEF, async () => {
      throw new Error("MCP request failed (500)");
    });
    const res = await tool.execute({}, {});
    expect(res.isError).toBe(true);
    expect(res.content).toContain("MCP request failed (500)");
  });

  it("executes inside a loop turn and feeds the result back to the model", async () => {
    const call = vi.fn().mockResolvedValue({ id: "opp_42" });
    const registry = new ToolRegistry([createMcpTool(DEF, call)]);
    const provider = new MockModelProvider([
      toolResponse(
        "c1",
        "create_crm_opportunity",
        { name: "Acme" },
        "creating",
      ),
      textResponse("created opportunity opp_42"),
    ]);

    const result = await runAgentTurn({
      provider,
      registry,
      messages: [user("add Acme to CRM")],
    });

    expect(result.stopReason).toBe("completed");
    expect(result.finalText).toBe("created opportunity opp_42");
    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toBe(JSON.stringify({ id: "opp_42" }));
  });
});

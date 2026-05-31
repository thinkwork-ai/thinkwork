import { describe, expect, it, vi } from "vitest";
import { webSearchExtension } from "../web-search-extension";
import { loadExtensions } from "../load-extensions";

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("webSearchExtension", () => {
  it("registers a direct web_search tool backed by the platform proxy", async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            result_count: 1,
            results: [{ title: "OpenAI News" }],
          }),
        },
      ],
    });
    const loaded = await loadExtensions(
      [
        webSearchExtension({
          agentId: "agent-1",
          deps: { callTool },
        }),
      ],
      { logger: silentLogger },
    );

    expect(loaded.tools.map((tool) => tool.name)).toEqual(["web_search"]);
    const result = await loaded.tools[0].execute({
      query: "OpenAI News",
      num_results: 3,
    });

    expect(callTool).toHaveBeenCalledWith(
      {
        agentId: "agent-1",
        query: "OpenAI News",
        numResults: 3,
      },
      expect.any(Object),
    );
    expect(result).toEqual({
      content: expect.stringContaining("OpenAI News"),
      isError: false,
    });
    expect(JSON.stringify(callTool.mock.calls)).not.toContain("Bearer");
  });

  it("adds guidance to use web_search for current lookup", async () => {
    const loaded = await loadExtensions(
      [
        webSearchExtension({
          agentId: "agent-1",
          deps: { callTool: vi.fn() },
        }),
      ],
      { logger: silentLogger },
    );

    const composed = await loaded.dispatch("before_agent_start", {
      systemPrompt: "base",
    });
    expect(composed.systemPrompt).toContain("direct `web_search` tool");
    expect(composed.systemPrompt).toContain("instead of answering from memory");
  });
});

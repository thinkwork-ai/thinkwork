import { describe, expect, it, vi } from "vitest";
import { buildBrowserAutomationTool } from "../src/runtime/tools/browser-automation.js";

describe("buildBrowserAutomationTool", () => {
  it("starts AgentCore Browser, navigates, captures a screenshot, and stops", async () => {
    const commandNames: string[] = [];
    const client = {
      send: vi.fn(async (command: { constructor: { name: string } }) => {
        commandNames.push(command.constructor.name);
        if (command.constructor.name === "StartBrowserSessionCommand") {
          return { sessionId: "session-1" };
        }
        if (command.constructor.name === "InvokeBrowserCommand") {
          return {
            result: {
              screenshot: {
                data: new Uint8Array([1, 2, 3]),
              },
            },
          };
        }
        return {};
      }),
    };
    const tool = buildBrowserAutomationTool({
      client: client as never,
      browserIdentifier: "aws.browser.v1",
      traceId: "trace-1",
      settleDelayMs: 0,
    });

    const result = await tool.execute("call-1", {
      url: "https://example.com",
      task: "confirm the page opens",
    });

    expect(commandNames).toEqual([
      "StartBrowserSessionCommand",
      "InvokeBrowserCommand",
      "InvokeBrowserCommand",
      "InvokeBrowserCommand",
      "InvokeBrowserCommand",
      "StopBrowserSessionCommand",
    ]);
    expect(result.details).toMatchObject({
      runtime: "pi",
      session_id: "session-1",
      screenshot_bytes: 3,
      tool_costs: [
        expect.objectContaining({
          provider: "agentcore_browser",
          event_type: "agentcore_browser_session",
        }),
      ],
    });
    const content = result.content.find((item) => item.type === "text");
    expect(content?.text).toContain("Opened https://example.com/");
  });

  it("returns structured evidence when the browser session cannot start", async () => {
    const commandNames: string[] = [];
    const client = {
      send: vi.fn(async (command: { constructor: { name: string } }) => {
        commandNames.push(command.constructor.name);
        throw new Error("browser quota exceeded");
      }),
    };
    const tool = buildBrowserAutomationTool({
      client: client as never,
      browserIdentifier: "aws.browser.v1",
      settleDelayMs: 0,
    });

    const result = await tool.execute("call-1", {
      url: "https://example.com",
      task: "confirm the page opens",
    });

    expect(commandNames).toEqual(["StartBrowserSessionCommand"]);
    expect(result.details).toMatchObject({
      runtime: "pi",
      ok: false,
      browser_identifier: "aws.browser.v1",
      url: "https://example.com/",
      error: "BrowserAutomationError",
      error_message: "browser quota exceeded",
      tool_costs: [],
    });
  });
});

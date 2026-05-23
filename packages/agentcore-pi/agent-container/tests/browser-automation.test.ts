import { describe, expect, it, vi } from "vitest";
import { buildBrowserAutomationTool } from "../src/runtime/tools/browser-automation.js";

function browserResultFor(command: {
  input?: { action?: Record<string, unknown> };
}): unknown {
  const action = command.input?.action ?? {};
  if ("keyShortcut" in action) return { result: { keyShortcut: { status: "SUCCESS" } } };
  if ("keyType" in action) return { result: { keyType: { status: "SUCCESS" } } };
  if ("keyPress" in action) return { result: { keyPress: { status: "SUCCESS" } } };
  return {
    result: {
      screenshot: {
        status: "SUCCESS",
        data: new Uint8Array([1, 2, 3]),
      },
    },
  };
}

describe("buildBrowserAutomationTool", () => {
  it("starts AgentCore Browser, navigates, captures a screenshot, and stops", async () => {
    const commandNames: string[] = [];
    const client = {
      send: vi.fn(async (command: {
        constructor: { name: string };
        input?: { action?: Record<string, unknown> };
      }) => {
        commandNames.push(command.constructor.name);
        if (command.constructor.name === "StartBrowserSessionCommand") {
          return { sessionId: "session-1" };
        }
        if (command.constructor.name === "InvokeBrowserCommand") {
          return browserResultFor(command);
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
      url: "https://example.com/?token=secret&ok=1",
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
      url: "https://example.com/?token=%5Bredacted%5D&ok=1",
      screenshot_bytes: 3,
      tool_costs: [
        expect.objectContaining({
          provider: "agentcore_browser",
          event_type: "agentcore_browser_session",
          metadata: expect.objectContaining({
            url: "https://example.com/?token=%5Bredacted%5D&ok=1",
          }),
        }),
      ],
    });
    const content = result.content.find((item) => item.type === "text");
    expect(content?.text).toContain(
      "Opened https://example.com/?token=%5Bredacted%5D&ok=1",
    );
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

  it("returns structured evidence and stops the session when a browser action fails", async () => {
    const commandNames: string[] = [];
    const client = {
      send: vi.fn(async (command: {
        constructor: { name: string };
        input?: { action?: Record<string, unknown> };
      }) => {
        commandNames.push(command.constructor.name);
        if (command.constructor.name === "StartBrowserSessionCommand") {
          return { sessionId: "session-1" };
        }
        if (
          command.constructor.name === "InvokeBrowserCommand" &&
          command.input?.action &&
          "keyType" in command.input.action
        ) {
          return {
            result: {
              keyType: {
                status: "FAILED",
                error: "keyboard input failed",
              },
            },
          };
        }
        if (command.constructor.name === "InvokeBrowserCommand") {
          return browserResultFor(command);
        }
        return {};
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

    expect(commandNames).toEqual([
      "StartBrowserSessionCommand",
      "InvokeBrowserCommand",
      "InvokeBrowserCommand",
      "StopBrowserSessionCommand",
    ]);
    expect(result.details).toMatchObject({
      runtime: "pi",
      ok: false,
      session_id: "session-1",
      error: "BrowserAutomationError",
      error_message: "Type browser URL failed: keyboard input failed",
      tool_costs: [
        expect.objectContaining({
          metadata: expect.objectContaining({
            error: "Type browser URL failed: keyboard input failed",
          }),
        }),
      ],
    });
  });

  it("preserves the tool result when browser cleanup fails", async () => {
    const client = {
      send: vi.fn(async (command: {
        constructor: { name: string };
        input?: { action?: Record<string, unknown> };
      }) => {
        if (command.constructor.name === "StartBrowserSessionCommand") {
          return { sessionId: "session-1" };
        }
        if (command.constructor.name === "InvokeBrowserCommand") {
          return browserResultFor(command);
        }
        throw new Error("stop failed");
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

    expect(result.details).toMatchObject({
      runtime: "pi",
      session_id: "session-1",
      screenshot_bytes: 3,
      cleanup_failed: true,
      cleanup_error: "stop failed",
      cleanup_trace_id: "trace-1",
    });
  });

  it.each([
    "https://169.254.169.254/latest/meta-data",
    "https://127.0.0.1/",
    "https://10.0.0.1/",
    "https://[fd00::1]/",
    "https://user:pass@example.com/",
  ])("rejects private or credential-bearing browser URLs: %s", async (url) => {
    const client = { send: vi.fn() };
    const tool = buildBrowserAutomationTool({
      client: client as never,
      browserIdentifier: "aws.browser.v1",
      settleDelayMs: 0,
    });

    await expect(
      tool.execute("call-1", {
        url,
        task: "blocked",
      }),
    ).rejects.toThrow(/browser_automation/);
    expect(client.send).not.toHaveBeenCalled();
  });
});

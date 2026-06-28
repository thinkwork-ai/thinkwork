import { describe, expect, it, vi } from "vitest";
import {
  MCP_APP_HOST_CONTEXT_CHANGED_METHOD,
  MCP_APP_INITIALIZE_METHOD,
  MCP_APP_INITIALIZED_METHOD,
  McpAppFrameBridge,
} from "./mcp-app-frame-bridge";
import { MCP_APPS_PROTOCOL_VERSION } from "./mcp-app-host-context";

function createFrameWindow() {
  return {
    postMessage: vi.fn(),
  } as unknown as Window & { postMessage: ReturnType<typeof vi.fn> };
}

function bridgeFor(frameWindow: Window, theme: "light" | "dark" = "dark") {
  return new McpAppFrameBridge({
    channelId: "channel-1",
    frameWindow: () => frameWindow,
    getHostContext: () => ({
      theme,
      styles: { variables: { "--color-background-primary": "#111111" } },
    }),
    hostInfo: { name: "thinkwork-test", version: "0.0.0" },
  });
}

function messageEvent(source: Window, data: unknown) {
  return new MessageEvent("message", { source, data });
}

describe("McpAppFrameBridge", () => {
  it("replies to ui/initialize with host context", () => {
    const frame = createFrameWindow();
    const bridge = bridgeFor(frame);

    bridge.handleMessage(
      messageEvent(frame, {
        jsonrpc: "2.0",
        id: "init-1",
        method: MCP_APP_INITIALIZE_METHOD,
        params: { appCapabilities: {} },
      }),
    );

    expect(frame.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        jsonrpc: "2.0",
        id: "init-1",
        result: expect.objectContaining({
          protocolVersion: MCP_APPS_PROTOCOL_VERSION,
          hostInfo: { name: "thinkwork-test", version: "0.0.0" },
          hostContext: expect.objectContaining({ theme: "dark" }),
        }),
      }),
      "*",
    );
  });

  it("drops messages from the wrong window", () => {
    const frame = createFrameWindow();
    const other = createFrameWindow();
    const bridge = bridgeFor(frame);

    bridge.handleMessage(
      messageEvent(other, {
        id: "init-1",
        method: MCP_APP_INITIALIZE_METHOD,
      }),
    );

    expect(frame.postMessage).not.toHaveBeenCalled();
  });

  it("drops messages with the wrong optional channel id", () => {
    const frame = createFrameWindow();
    const bridge = bridgeFor(frame);

    bridge.handleMessage(
      messageEvent(frame, {
        id: "init-1",
        method: MCP_APP_INITIALIZE_METHOD,
        twMcpAppChannel: "other-channel",
      }),
    );

    expect(frame.postMessage).not.toHaveBeenCalled();
  });

  it("does not notify before the View is initialized", () => {
    const frame = createFrameWindow();
    const bridge = bridgeFor(frame);

    bridge.notifyHostContextChanged();

    expect(frame.postMessage).not.toHaveBeenCalled();
  });

  it("sends host-context-changed after initialized", () => {
    const frame = createFrameWindow();
    const bridge = bridgeFor(frame, "light");

    bridge.handleMessage(
      messageEvent(frame, { method: MCP_APP_INITIALIZED_METHOD }),
    );
    bridge.notifyHostContextChanged();

    expect(frame.postMessage).toHaveBeenCalledWith(
      {
        jsonrpc: "2.0",
        method: MCP_APP_HOST_CONTEXT_CHANGED_METHOD,
        params: {
          theme: "light",
          styles: {
            variables: { "--color-background-primary": "#111111" },
          },
        },
      },
      "*",
    );
  });

  it("does not include secret-shaped fields in outbound payloads", () => {
    const frame = createFrameWindow();
    const bridge = bridgeFor(frame);

    bridge.handleMessage(
      messageEvent(frame, { id: 1, method: MCP_APP_INITIALIZE_METHOD }),
    );

    expect(JSON.stringify(frame.postMessage.mock.calls)).not.toMatch(
      /tenant|user|credential|authorization|token|secret/i,
    );
  });
});

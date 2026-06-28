import {
  MCP_APPS_PROTOCOL_VERSION,
  type McpAppHostContext,
} from "./mcp-app-host-context";

export const MCP_APP_INITIALIZE_METHOD = "ui/initialize";
export const MCP_APP_INITIALIZED_METHOD = "ui/notifications/initialized";
export const MCP_APP_HOST_CONTEXT_CHANGED_METHOD =
  "ui/notifications/host-context-changed";

export interface McpAppFrameBridgeOptions {
  channelId: string;
  frameWindow: () => Window | null;
  getHostContext: () => McpAppHostContext;
  hostInfo?: { name: string; version: string };
}

export class McpAppFrameBridge {
  private initialized = false;
  private hostInfo: { name: string; version: string };

  constructor(private readonly options: McpAppFrameBridgeOptions) {
    this.hostInfo = options.hostInfo ?? { name: "thinkwork", version: "1.0.0" };
  }

  handleMessage(event: MessageEvent) {
    if (!this.matchesFrame(event)) return;
    const message = recordValue(event.data);
    if (!message) return;
    const method = stringValue(message?.method);

    if (method === MCP_APP_INITIALIZE_METHOD) {
      this.replyToInitialize(message);
      return;
    }

    if (method === MCP_APP_INITIALIZED_METHOD) {
      this.initialized = true;
    }
  }

  notifyHostContextChanged(hostContext = this.options.getHostContext()) {
    if (!this.initialized) return;
    this.post({
      jsonrpc: "2.0",
      method: MCP_APP_HOST_CONTEXT_CHANGED_METHOD,
      params: hostContext,
    });
  }

  private replyToInitialize(message: Record<string, unknown>) {
    const id = message.id;
    if (!isJsonRpcId(id)) return;
    this.post({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: MCP_APPS_PROTOCOL_VERSION,
        hostCapabilities: {},
        hostInfo: this.hostInfo,
        hostContext: this.options.getHostContext(),
      },
    });
  }

  private post(message: Record<string, unknown>) {
    this.options.frameWindow()?.postMessage(message, "*");
  }

  private matchesFrame(event: MessageEvent) {
    if (event.source !== this.options.frameWindow()) return false;
    const message = recordValue(event.data);
    if (!message) return false;
    const channel =
      stringValue(message.twMcpAppChannel) ?? stringValue(message.channelId);
    return !channel || channel === this.options.channelId;
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isJsonRpcId(value: unknown): value is string | number | null {
  return (
    typeof value === "string" || typeof value === "number" || value === null
  );
}

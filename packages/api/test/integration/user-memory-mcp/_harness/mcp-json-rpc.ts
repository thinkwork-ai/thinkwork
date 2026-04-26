export interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id?: string | number | null;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export class McpJsonRpcClient {
  #nextId = 1;
  #sessionId: string | null = null;

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  async initialize() {
    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "thinkwork-codex-user-memory-e2e", version: "0.0.0" },
    });
    await this.notify("notifications/initialized", {});
  }

  async listTools() {
    return this.request<{ tools: Array<{ name: string }> }>("tools/list", {});
  }

  async callTool(name: string, args: Record<string, unknown>) {
    return this.request("tools/call", { name, arguments: args });
  }

  async request<T = unknown>(method: string, params: Record<string, unknown>) {
    const response = await this.post({
      jsonrpc: "2.0",
      id: this.#nextId++,
      method,
      params,
    });
    if (response.error) {
      throw new Error(`${method} failed: ${response.error.code} ${response.error.message}`);
    }
    return response.result as T;
  }

  async notify(method: string, params: Record<string, unknown>) {
    await this.post({ jsonrpc: "2.0", method, params });
  }

  private async post(body: Record<string, unknown>) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.#sessionId) headers["Mcp-Session-Id"] = this.#sessionId;

    const res = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const sessionId = res.headers.get("mcp-session-id");
    if (sessionId) this.#sessionId = sessionId;
    const text = await res.text();

    if (!res.ok) {
      throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    if (!text.trim()) return { jsonrpc: "2.0", result: null } satisfies JsonRpcResponse;

    return parseMcpBody(text, res.headers.get("content-type") ?? "");
  }
}

function parseMcpBody(text: string, contentType: string): JsonRpcResponse {
  if (!contentType.includes("text/event-stream")) {
    return JSON.parse(text) as JsonRpcResponse;
  }

  const dataLines = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter(Boolean);
  if (dataLines.length === 0) {
    throw new Error(`MCP event-stream response had no data lines: ${text.slice(0, 500)}`);
  }
  return JSON.parse(dataLines.at(-1)!) as JsonRpcResponse;
}

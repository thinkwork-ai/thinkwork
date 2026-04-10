/**
 * MCP Client — calls the Thinkwork Builder MCP server.
 *
 * URL and auth token are read from env vars:
 *   EXPO_PUBLIC_MCP_BUILDER_URL  (default: https://api.thinkwork.ai/mcp/builder)
 *   EXPO_PUBLIC_MCP_AUTH_TOKEN   (Bearer token)
 */

const MCP_URL =
  process.env.EXPO_PUBLIC_MCP_BUILDER_URL ||
  "https://api.thinkwork.ai/mcp/builder";

const MCP_TOKEN = process.env.EXPO_PUBLIC_MCP_AUTH_TOKEN || "";

/**
 * Call an MCP tool on the Builder server via JSON-RPC 2.0.
 * Parses the first text content block from the tool result.
 */
export async function callMcpTool<T = unknown>(
  toolName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (MCP_TOKEN) {
    headers["Authorization"] = `Bearer ${MCP_TOKEN}`;
  }

  const resp = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`MCP request failed (${resp.status}): ${text.slice(0, 200)}`);
  }

  const data = await resp.json();

  if (data.error) {
    throw new Error(data.error.message || "MCP tool error");
  }

  const result = data.result;
  if (result?.isError) {
    const errText = result.content?.[0]?.text || "Tool execution failed";
    throw new Error(errText);
  }

  // Parse the text content block
  const textBlock = result?.content?.find((c: any) => c.type === "text");
  if (!textBlock?.text) {
    throw new Error("No text content in MCP response");
  }

  return JSON.parse(textBlock.text) as T;
}

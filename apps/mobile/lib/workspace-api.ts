const API_BASE = (
  process.env.EXPO_PUBLIC_GRAPHQL_URL ?? ""
).replace(/\/graphql$/, "");

const AUTH_TOKEN = process.env.EXPO_PUBLIC_MCP_AUTH_TOKEN ?? "";

export async function workspaceApi(body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}/internal/workspace-files`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Workspace API: ${res.status}`);
  return res.json();
}

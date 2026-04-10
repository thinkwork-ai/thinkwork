interface APIGatewayProxyEvent {
  headers?: Record<string, string | undefined>;
  body?: string | null;
}

interface APIGatewayProxyResult {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

type ListAgentSkillsRequest = {
  agentId?: string;
  gatewayId?: string;
  gatewayBaseUrl?: string;
  gatewayToken?: string;
  sourcePath?: string;
};

type ListEntry = { name: string; type: "file" | "dir" };

function json(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function authToken(headers?: Record<string, string | undefined>) {
  const auth = headers?.authorization || headers?.Authorization;
  if (!auth) return null;
  return auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : null;
}

async function listDir(baseUrl: string, token: string, path: string): Promise<ListEntry[]> {
  const qs = new URLSearchParams({ path }).toString();
  const res = await fetch(`${baseUrl}/files/list?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to read ${path}: ${res.status} ${body || "Gateway error"}`);
  }

  const data = (await res.json()) as { files?: ListEntry[] };
  return Array.isArray(data?.files) ? data.files : [];
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

function errorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown error";
  const name = (error as { name?: string }).name || "Error";
  const message = (error as { message?: string }).message || "";
  return message ? `${name}: ${message}` : name;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const expectedSecret = process.env.API_AUTH_SECRET;
  const token = authToken(event.headers);
  if (!expectedSecret || !token || token !== expectedSecret) {
    return json(401, { ok: false, error: "Unauthorized" });
  }

  let body: ListAgentSkillsRequest;
  try {
    body = event.body ? (JSON.parse(event.body) as ListAgentSkillsRequest) : {};
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  const agentId = body.agentId;
  const sourcePath = body.sourcePath || "/skills";

  if (!agentId && !body.gatewayId) {
    return json(400, {
      ok: false,
      sourcePath,
      skillIds: [],
      error: "agentId or gatewayId is required",
    });
  }

  if (!body.gatewayBaseUrl || !body.gatewayToken) {
    return json(400, {
      ok: false,
      sourcePath,
      skillIds: [],
      error: "gatewayBaseUrl and gatewayToken are required",
    });
  }

  const gatewayBaseUrl = normalizeBaseUrl(body.gatewayBaseUrl);
  const gatewayToken = body.gatewayToken;

  try {
    const topLevel = await listDir(gatewayBaseUrl, gatewayToken, sourcePath);
    const queue: string[] = topLevel
      .filter((entry) => entry.type === "dir")
      .map((entry) => `${sourcePath}/${entry.name}`);

    const discovered = new Set<string>();

    while (queue.length > 0) {
      const dirPath = queue.shift()!;
      const entries = await listDir(gatewayBaseUrl, gatewayToken, dirPath);

      if (entries.some((entry) => entry.type === "file" && entry.name === "SKILL.md")) {
        const skillId = dirPath.replace(/^\/skills\//, "");
        if (skillId) discovered.add(skillId);
      }

      for (const entry of entries) {
        if (entry.type === "dir") queue.push(`${dirPath}/${entry.name}`);
      }
    }

    return json(200, {
      ok: true,
      agentId,
      sourcePath,
      skillIds: Array.from(discovered).sort((a, b) => a.localeCompare(b)),
    });
  } catch (error: unknown) {
    return json(500, {
      ok: false,
      agentId,
      sourcePath,
      skillIds: [],
      error: `Agent skills list failed: ${errorMessage(error)}`,
    });
  }
}

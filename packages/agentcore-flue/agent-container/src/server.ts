import http from "node:http";
import { snapshotRuntimeEnv } from "./runtime/env-snapshot.js";
import { runPiAgent } from "./runtime/pi-loop.js";

const PORT = Number(process.env.PORT || 8080);

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown) {
  const encoded = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(encoded),
  });
  res.end(encoded);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleInvocation(
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  const body = await readBody(req);
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    sendJson(res, 400, { error: "invalid json" });
    return;
  }

  try {
    const env = snapshotRuntimeEnv();
    const result = await runPiAgent(payload, env);
    sendJson(res, 200, result);
  } catch (err) {
    console.error("[agentcore-flue] invocation failed", err);
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : String(err),
      runtime: "pi",
    });
  }
}

export function createServer() {
  return http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/ping") {
      sendJson(res, 200, {
        status: "Healthy",
        runtime: "pi",
        time_of_last_update: Math.floor(Date.now() / 1000),
      });
      return;
    }

    if (req.method === "POST" && req.url === "/invocations") {
      void handleInvocation(req, res);
      return;
    }

    sendJson(res, 404, { error: "not found" });
  });
}

if (process.env.NODE_ENV !== "test") {
  createServer().listen(PORT, "0.0.0.0", () => {
    console.log(`[agentcore-flue] listening on :${PORT}`);
  });
}

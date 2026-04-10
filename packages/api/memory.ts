/**
 * Memory Lambda — Proxies Hindsight memory operations.
 *
 * PRD-41B Phase 5: Replaces AgentCore Memory proxy with Hindsight
 * (direct Postgres queries + Hindsight recall API).
 */

interface APIGatewayProxyEvent {
  headers?: Record<string, string | undefined>;
  body?: string | null;
}

interface APIGatewayProxyResult {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

type MemoryAction = "listSession" | "listAssistant" | "listByStrategy" | "delete" | "update";

type MemoryRequest = {
  action?: MemoryAction;
  assistantId?: string;
  sessionId?: string;
  recordId?: string;
  content?: string;
  strategy?: "semantic" | "preferences" | "summaries" | "episodes" | "archived";
};

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

async function queryHindsightDB(sqlText: string, params: any[]): Promise<any[]> {
  const { RDSDataClient, ExecuteStatementCommand } = await import("@aws-sdk/client-rds-data");
  const rds = new RDSDataClient({ region: process.env.AWS_REGION || "us-east-1" });

  const result = await rds.send(
    new ExecuteStatementCommand({
      resourceArn: process.env.DATABASE_CLUSTER_ARN!,
      secretArn: process.env.DATABASE_SECRET_ARN!,
      database: process.env.DATABASE_NAME || "thinkwork",
      sql: sqlText,
      parameters: params,
    }),
  );
  return result.records ?? [];
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const expectedSecret = process.env.API_AUTH_SECRET;
  const token = authToken(event.headers);
  if (!expectedSecret || !token || token !== expectedSecret) {
    return json(401, { ok: false, error: "Unauthorized" });
  }

  let body: MemoryRequest;
  try {
    body = event.body ? (JSON.parse(event.body) as MemoryRequest) : {};
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  const { action, assistantId } = body;
  if (!action || !assistantId) {
    return json(400, { ok: false, error: "action and assistantId are required" });
  }

  try {
    // List memories for an agent (bank_id = assistantId/slug)
    if (action === "listSession" || action === "listAssistant" || action === "listByStrategy") {
      const rows = await queryHindsightDB(
        `SELECT id, text, context, created_at, updated_at, metadata
         FROM hindsight.memory_units
         WHERE bank_id = :bankId
         ORDER BY created_at DESC
         LIMIT 200`,
        [{ name: "bankId", value: { stringValue: assistantId } }],
      );

      const records = rows.map((row: any) => ({
        memoryRecordId: row[0]?.stringValue || "",
        content: { text: row[1]?.stringValue || "" },
        context: row[2]?.stringValue || "",
        createdAt: row[3]?.stringValue || null,
        updatedAt: row[4]?.stringValue || null,
      }));

      return json(200, { ok: true, records });
    }

    if (action === "delete") {
      if (!body.recordId) {
        return json(400, { ok: false, error: "recordId is required for delete" });
      }
      await queryHindsightDB(
        `DELETE FROM hindsight.memory_units WHERE id = :id::uuid`,
        [{ name: "id", value: { stringValue: body.recordId } }],
      );
      return json(200, { ok: true });
    }

    if (action === "update") {
      if (!body.recordId || body.content === undefined) {
        return json(400, { ok: false, error: "recordId and content are required for update" });
      }
      await queryHindsightDB(
        `UPDATE hindsight.memory_units SET text = :txt, updated_at = NOW() WHERE id = :id::uuid`,
        [
          { name: "txt", value: { stringValue: body.content } },
          { name: "id", value: { stringValue: body.recordId } },
        ],
      );
      return json(200, { ok: true });
    }

    return json(400, { ok: false, error: "Unsupported action" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return json(500, { ok: false, error: `Memory operation failed: ${message}` });
  }
}

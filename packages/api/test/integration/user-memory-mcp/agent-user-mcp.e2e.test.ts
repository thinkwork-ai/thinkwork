import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { Client as PgClient } from "pg";
import { describe, expect, it } from "vitest";

const env = {
  stage: process.env.STAGE,
  awsRegion: process.env.AWS_REGION ?? "us-east-1",
  databaseUrl: process.env.DATABASE_URL,
  tenantId: process.env.USER_MEMORY_MCP_E2E_TENANT_ID,
  agentId: process.env.USER_MEMORY_MCP_E2E_AGENT_ID,
  threadId: process.env.USER_MEMORY_MCP_E2E_THREAD_ID,
  messageId: process.env.USER_MEMORY_MCP_E2E_MESSAGE_ID,
  prompt:
    process.env.USER_MEMORY_MCP_E2E_PROMPT ??
    "Call the configured user-memory MCP probe tool and summarize the result.",
  expectedTool: process.env.USER_MEMORY_MCP_E2E_EXPECTED_TOOL,
};

const missing = [
  ["STAGE", env.stage],
  ["DATABASE_URL", env.databaseUrl],
  ["USER_MEMORY_MCP_E2E_TENANT_ID", env.tenantId],
  ["USER_MEMORY_MCP_E2E_AGENT_ID", env.agentId],
  ["USER_MEMORY_MCP_E2E_THREAD_ID", env.threadId],
].filter(([, value]) => !value);

describe("agent outbound user MCP E2E", () => {
  if (missing.length > 0) {
    it("is blocked until a deployed-stage agent/MCP fixture is configured", () => {
      console.warn(
        [
          "Agent user MCP live E2E skipped.",
          `Missing env: ${missing.map(([name]) => name).join(", ")}`,
          "Configure an agent assigned to a user-authorized MCP server, then rerun this suite.",
        ].join(" "),
      );
      expect(missing.length).toBeGreaterThan(0);
    });
    return;
  }

  it("invokes the configured agent and records an MCP tool call for the user", async () => {
    const startedAt = new Date();
    const lambda = new LambdaClient({ region: env.awsRegion });
    const result = await lambda.send(
      new InvokeCommand({
        FunctionName: `thinkwork-${env.stage}-api-chat-agent-invoke`,
        InvocationType: "RequestResponse",
        Payload: new TextEncoder().encode(
          JSON.stringify({
            tenantId: env.tenantId,
            agentId: env.agentId,
            threadId: env.threadId,
            messageId: env.messageId,
            userMessage: env.prompt,
          }),
        ),
      }),
    );
    expect(result.FunctionError).toBeUndefined();
    expect(result.StatusCode).toBeGreaterThanOrEqual(200);
    expect(result.StatusCode).toBeLessThan(300);

    const turn = await waitForTurn(startedAt);
    expect(turn.status).toBe("succeeded");
    if (env.expectedTool) {
      expect(turn.toolInvocations).toContain(env.expectedTool);
    } else {
      expect(turn.toolInvocations).toMatch(/mcp|server|tool/i);
    }
  }, 180_000);
});

async function waitForTurn(startedAt: Date): Promise<{ status: string; toolInvocations: string }> {
  const deadline = Date.now() + 120_000;
  let last: { status: string; toolInvocations: string } | null = null;

  while (Date.now() < deadline) {
    const client = new PgClient({ connectionString: env.databaseUrl });
    await client.connect();
    try {
      const result = await client.query(
        `SELECT status, COALESCE(tool_invocations::text, '') AS "toolInvocations"
           FROM thread_turns
          WHERE thread_id = $1::uuid AND started_at >= $2
          ORDER BY started_at DESC
          LIMIT 1`,
        [env.threadId, startedAt.toISOString()],
      );
      last = result.rows[0] ?? last;
      if (last && last.status !== "running") return last;
    } finally {
      await client.end();
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error(`agent user MCP turn did not complete within 120s; last=${JSON.stringify(last)}`);
}

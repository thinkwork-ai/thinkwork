/**
 * Cost-cap circuit breaker E2E — R6.
 *
 * Pre-seeds the tenant's daily counter at cap=1 so the very first
 * execute_code call hits the `WHERE count < cap` guard and rejects
 * with SandboxCapExceeded, without needing a per-tenant cap override
 * surface that doesn't exist yet. The fixture factory's tenantDailyCap
 * option handles this seeding.
 *
 * Plan: docs/plans/2026-04-22-009-test-agentcore-code-sandbox-e2e-plan.md Unit 5.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client as PgClient } from "pg";
import { HarnessEnvError, newRunId, readHarnessEnv } from "./_harness/index.js";
import { createSandboxFixtures, type Fixtures } from "./_harness/fixtures.js";
import {
  assertCapExceeded,
  assertSandboxInvocation,
} from "./_harness/assertions.js";

describe("sandbox cap breach E2E — tenant daily cap enforcement", () => {
  let env: ReturnType<typeof readHarnessEnv>;
  let fixtures: Fixtures;
  const runId = newRunId();

  beforeAll(async () => {
    try {
      env = readHarnessEnv();
    } catch (err) {
      if (err instanceof HarnessEnvError) {
        throw new Error(
          `[sandbox-e2e] cannot run — missing env: ${err.missing.join(", ")}`,
        );
      }
      throw err;
    }
    // cap=1 pre-seeded; the very first invocation hits cap_exceeded.
    // If a per-tenant cap override surface lands later, switch to
    // setting the override + leaving the counter at 0.
    fixtures = await createSandboxFixtures({
      runId,
      env,
      suffix: "cap",
      tenantDailyCap: 1,
    });
  });

  afterAll(async () => {
    if (fixtures) await fixtures.teardown();
  });

  it("rejects the first execute_code call when the tenant-daily counter is already at cap", async () => {
    const startedAt = new Date();
    const response = await sendChatAndWait(
      env,
      fixtures,
      "Use execute_code to compute 1+1 and print the result.",
      startedAt,
    );

    // The turn itself should complete — sandbox_cap rejections don't
    // unwind the agent loop; they land as a structured tool result
    // the agent can react to.
    expect(response.turnStatus).toMatch(/complete/);

    // Sandbox_invocations audit row carries exit_status=cap_exceeded.
    const audit = await assertSandboxInvocation(env, {
      tenantId: fixtures.tenantId,
      since: startedAt,
      expectedExitStatus: "cap_exceeded",
      runId,
    });
    expect(audit.exit_status).toBe("cap_exceeded");

    // Agent response mentions the cap (defense-in-depth — covers the
    // case where the tool surfaced the error but the agent didn't
    // echo it verbatim).
    assertCapExceeded({
      runId,
      agentResponse: response.assistantText,
      toolResult: undefined,
    });
  });
});

// ---------------------------------------------------------------------------
// Inline helpers — same shape as sandbox-pilot's; duplication kept because
// each test file has slightly different timing expectations and consolidating
// them early before the patterns have stabilized would lock in the wrong shape.
// ---------------------------------------------------------------------------

interface ChatResponse {
  threadId: string;
  turnStatus: string;
  assistantText: string | undefined;
}

async function sendChatAndWait(
  env: ReturnType<typeof readHarnessEnv>,
  fixtures: Fixtures,
  message: string,
  startedAt: Date,
): Promise<ChatResponse> {
  const threadId = await createThread(env, fixtures);
  await insertUserMessage(env, fixtures, threadId, message);

  const lambda = new LambdaClient({ region: env.awsRegion });
  await lambda.send(
    new InvokeCommand({
      FunctionName: `thinkwork-${env.stage}-api-chat-agent-invoke`,
      InvocationType: "RequestResponse",
      Payload: new TextEncoder().encode(
        JSON.stringify({
          requestContext: { http: { method: "POST", path: "/invocations" } },
          body: JSON.stringify({
            tenantId: fixtures.tenantId,
            agentId: fixtures.agentId,
            threadId,
            userId: fixtures.userId,
            userMessage: message,
          }),
        }),
      ),
    }),
  );

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const turn = await readLatestTurn(env, threadId, startedAt);
    if (turn && turn.status !== "running") {
      const assistantText = await readLatestAssistantMessage(env, threadId, startedAt);
      return { threadId, turnStatus: turn.status, assistantText };
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`[sandbox-e2e cap] turn did not complete within 90s`);
}

async function createThread(
  env: ReturnType<typeof readHarnessEnv>,
  fixtures: Fixtures,
): Promise<string> {
  const db = await openDb(env);
  try {
    const result = await db.execute(
      sql`INSERT INTO threads (tenant_id, agent_id, title, status, created_at, updated_at)
          VALUES (${fixtures.tenantId}::uuid, ${fixtures.agentId}::uuid, ${"sandbox-e2e cap thread"}, 'active', NOW(), NOW())
          RETURNING id`,
    );
    const rows = Array.isArray(result) ? result : ((result as any).rows ?? []);
    return rows[0].id;
  } finally {
    await closeDb(db);
  }
}

async function insertUserMessage(
  env: ReturnType<typeof readHarnessEnv>,
  fixtures: Fixtures,
  threadId: string,
  message: string,
): Promise<void> {
  const db = await openDb(env);
  try {
    await db.execute(
      sql`INSERT INTO messages (tenant_id, thread_id, agent_id, role, content, created_at, updated_at)
          VALUES (${fixtures.tenantId}::uuid, ${threadId}::uuid, ${fixtures.agentId}::uuid, 'user', ${message}, NOW(), NOW())`,
    );
  } finally {
    await closeDb(db);
  }
}

async function readLatestTurn(
  env: ReturnType<typeof readHarnessEnv>,
  threadId: string,
  since: Date,
): Promise<{ status: string } | null> {
  const db = await openDb(env);
  try {
    const result = await db.execute(
      sql`SELECT status FROM thread_turns
          WHERE thread_id = ${threadId}::uuid AND started_at >= ${since}
          ORDER BY started_at DESC LIMIT 1`,
    );
    const rows = Array.isArray(result) ? result : ((result as any).rows ?? []);
    return rows[0] ?? null;
  } finally {
    await closeDb(db);
  }
}

async function readLatestAssistantMessage(
  env: ReturnType<typeof readHarnessEnv>,
  threadId: string,
  since: Date,
): Promise<string | undefined> {
  const db = await openDb(env);
  try {
    const result = await db.execute(
      sql`SELECT content FROM messages
          WHERE thread_id = ${threadId}::uuid AND role = 'assistant' AND created_at >= ${since}
          ORDER BY created_at DESC LIMIT 1`,
    );
    const rows = Array.isArray(result) ? result : ((result as any).rows ?? []);
    return rows[0]?.content;
  } finally {
    await closeDb(db);
  }
}

async function openDb(env: ReturnType<typeof readHarnessEnv>) {
  const client = new PgClient({ connectionString: env.databaseUrl });
  const db = drizzle(client, { schema: {} as any });
  (db as any)._client = client;
  await client.connect();
  return db;
}

async function closeDb(db: Awaited<ReturnType<typeof openDb>>): Promise<void> {
  const client = (db as any)._client as PgClient;
  try {
    await client.end();
  } catch {
    /* idempotent */
  }
}

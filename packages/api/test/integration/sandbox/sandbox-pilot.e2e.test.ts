/**
 * Sandbox flagship end-to-end test — R1, R2, R3, R5.
 *
 * Creates a disposable tenant, sends the SKILL.md sample prompt via the
 * chat API, waits for the turn, asserts every post-turn signal from
 * the operator runbook.
 *
 * Plan: docs/plans/2026-04-22-009-test-agentcore-code-sandbox-e2e-plan.md Unit 4.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client as PgClient } from "pg";
import { HarnessEnvError, newRunId, readHarnessEnv } from "./_harness/index.js";
import {
  createSandboxFixtures,
  type Fixtures,
} from "./_harness/fixtures.js";
import {
  assertSandboxInvocation,
  assertNoTokenLeak,
  readTenantDailyCounter,
} from "./_harness/assertions.js";

describe("sandbox-pilot E2E — flagship demo", () => {
  let env: ReturnType<typeof readHarnessEnv>;
  let fixtures: Fixtures;
  const runId = newRunId();

  beforeAll(async () => {
    try {
      env = readHarnessEnv();
    } catch (err) {
      if (err instanceof HarnessEnvError) {
        throw new Error(
          `[sandbox-e2e] cannot run — missing env: ${err.missing.join(", ")}. ` +
            "See packages/api/test/integration/sandbox/README.md.",
        );
      }
      throw err;
    }
    fixtures = await createSandboxFixtures({ runId, env });
  });

  afterAll(async () => {
    if (fixtures) await fixtures.teardown();
  });

  it("provisions fixtures and records agent turn + audit row + quota counter + no token leak", async () => {
    const startedAt = new Date();

    // Send the sample prompt from SKILL.md. We don't literally fetch
    // SKILL.md at test time to avoid a filesystem race during deploy
    // windows; the prompt shape is stable.
    const samplePrompt =
      "Run the sandbox pilot: use execute_code to pandas-summarise " +
      "the skill_runs I just fetched, plot counts per skill_id, save to /tmp/pilot.png, " +
      "upload to S3 with boto3, and post the URL to Slack.";

    const turn = await sendChatAndWait(env, fixtures, samplePrompt, startedAt);

    expect(turn.status).toBe("completed");

    const audit = await assertSandboxInvocation(env, {
      tenantId: fixtures.tenantId,
      since: startedAt,
      expectedExitStatus: "ok",
      runId,
    });

    // Proof the tool actually ran: the hash is 64 hex chars (SHA-256
    // of user code) and byte counts are non-null.
    expect(audit.executed_code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(audit.stdout_bytes).not.toBeNull();

    // Quota counter advanced by the one call we made.
    const counter = await readTenantDailyCounter(env, fixtures.tenantId);
    expect(counter).not.toBeNull();
    expect(counter!.count).toBeGreaterThanOrEqual(1);

    // No token leak in CloudWatch for this turn's session.
    if (audit.session_id) {
      await assertNoTokenLeak(env, {
        sessionId: audit.session_id,
        startTime: startedAt,
        endTime: new Date(startedAt.getTime() + 120_000),
        forbiddenValues: [
          fixtures.syntheticTokens.github,
          fixtures.syntheticTokens.slack,
        ],
        runId,
      });
    } else {
      throw new Error(
        `[sandbox-e2e run=${runId}] sandbox_invocations.session_id is null — the StartSession path did not execute. ` +
          "Runbook: docs/guides/sandbox-environments.md → SandboxProvisioning.",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers — chat message + turn wait. Kept inline because they depend on the
// deployed stage's chat-agent-invoke Lambda naming convention.
// ---------------------------------------------------------------------------

interface ThreadTurn {
  id: string;
  status: string;
}

async function sendChatAndWait(
  env: ReturnType<typeof readHarnessEnv>,
  fixtures: Fixtures,
  message: string,
  startedAt: Date,
): Promise<ThreadTurn> {
  // Create a thread via direct DB insert — simpler than driving the
  // mobile chat-start flow end-to-end. The chat-agent-invoke handler
  // reads thread_id from its payload, not from a sessions table.
  const threadId = await createThread(env, fixtures);

  await insertUserMessage(env, fixtures, threadId, message);

  // Invoke the chat-agent Lambda directly (same pattern the resolver
  // uses). Naming is deterministic: `thinkwork-${stage}-api-chat-agent-invoke`.
  const lambda = new LambdaClient({ region: env.awsRegion });
  const payload = {
    requestContext: { http: { method: "POST", path: "/invocations" } },
    body: JSON.stringify({
      tenantId: fixtures.tenantId,
      agentId: fixtures.agentId,
      threadId,
      userId: fixtures.userId,
      userMessage: message,
    }),
  };
  await lambda.send(
    new InvokeCommand({
      FunctionName: `thinkwork-${env.stage}-api-chat-agent-invoke`,
      InvocationType: "RequestResponse",
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    }),
  );

  // Poll thread_turns until completed or timeout (90s matches plan's
  // testTimeout budget minus vitest overhead).
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const turn = await readLatestTurn(env, threadId, startedAt);
    if (turn && (turn.status === "complete" || turn.status === "completed" || turn.status === "failed")) {
      return { ...turn, status: turn.status === "complete" ? "completed" : turn.status };
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(
    `[sandbox-e2e] chat turn did not complete within 90s for thread ${threadId}`,
  );
}

async function createThread(
  env: ReturnType<typeof readHarnessEnv>,
  fixtures: Fixtures,
): Promise<string> {
  const db = await openDb(env);
  try {
    const result = await db.execute(
      sql`INSERT INTO threads (tenant_id, agent_id, title, status, created_at, updated_at)
          VALUES (${fixtures.tenantId}::uuid, ${fixtures.agentId}::uuid, ${"sandbox-e2e thread"}, 'active', NOW(), NOW())
          RETURNING id`,
    );
    const rows = Array.isArray(result) ? result : ((result as any).rows ?? []);
    const id = rows[0]?.id;
    if (!id) throw new Error("sandbox-e2e: could not create thread");
    return id;
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
): Promise<ThreadTurn | null> {
  const db = await openDb(env);
  try {
    const result = await db.execute(
      sql`SELECT id::text AS id, status
          FROM thread_turns
          WHERE thread_id = ${threadId}::uuid AND started_at >= ${since}
          ORDER BY started_at DESC
          LIMIT 1`,
    );
    const rows = Array.isArray(result) ? result : ((result as any).rows ?? []);
    return rows[0] ?? null;
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
    // idempotent
  }
}

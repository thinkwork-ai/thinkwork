/**
 * Cross-tenant isolation E2E — R4.
 *
 * Stands up two disposable tenants, runs one execute_code turn in each,
 * asserts each tenant's sandbox_invocations query returns only its own
 * rows. Structural proof of the per-tenant IAM boundary the plan's R1
 * delivers.
 *
 * Plan: docs/plans/2026-04-22-009-test-agentcore-code-sandbox-e2e-plan.md Unit 6.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client as PgClient } from "pg";
import { HarnessEnvError, newRunId, readHarnessEnv } from "./_harness/index.js";
import { createSandboxFixtures, type Fixtures } from "./_harness/fixtures.js";
import {
  assertSandboxInvocation,
  assertTenantIsolation,
} from "./_harness/assertions.js";

describe("sandbox cross-tenant E2E — tenant_id scoping", () => {
  let env: ReturnType<typeof readHarnessEnv>;
  let tenantA: Fixtures;
  let tenantB: Fixtures;
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
    // Two tenants with the same runId prefix so cleanup can sweep
    // both if teardown goes sideways. Suffixes disambiguate.
    tenantA = await createSandboxFixtures({ runId, env, suffix: "a" });
    tenantB = await createSandboxFixtures({ runId, env, suffix: "b" });
  });

  afterAll(async () => {
    if (tenantB) await tenantB.teardown();
    if (tenantA) await tenantA.teardown();
  });

  it("each tenant's sandbox_invocations query returns only its own rows", async () => {
    const startedAt = new Date();

    await Promise.all([
      runTurn(env, tenantA, "Use execute_code to print(1+1).", startedAt),
      runTurn(env, tenantB, "Use execute_code to print(2+2).", startedAt),
    ]);

    // Each tenant has exactly one ok sandbox_invocations row.
    const auditA = await assertSandboxInvocation(env, {
      tenantId: tenantA.tenantId,
      since: startedAt,
      expectedExitStatus: "ok",
      runId,
    });
    const auditB = await assertSandboxInvocation(env, {
      tenantId: tenantB.tenantId,
      since: startedAt,
      expectedExitStatus: "ok",
      runId,
    });

    // Cross-refs don't overlap.
    expect(auditA.tenant_id).toBe(tenantA.tenantId);
    expect(auditB.tenant_id).toBe(tenantB.tenantId);
    expect(auditA.user_id).not.toBe(auditB.user_id);
    expect(auditA.agent_id).not.toBe(auditB.agent_id);
    expect(auditA.session_id).not.toBe(auditB.session_id);

    // Belt-and-suspenders — assertion-level isolation check.
    await assertTenantIsolation(env, {
      tenantA: tenantA.tenantId,
      tenantB: tenantB.tenantId,
      since: startedAt,
      runId,
    });
  });
});

// ---------------------------------------------------------------------------
// Inline helpers (same as sandbox-pilot; duplication intentional for now)
// ---------------------------------------------------------------------------

async function runTurn(
  env: ReturnType<typeof readHarnessEnv>,
  fixtures: Fixtures,
  message: string,
  startedAt: Date,
): Promise<void> {
  const threadId = await createThread(env, fixtures);
  const messageId = await insertUserMessage(env, fixtures, threadId, message);
  const lambda = new LambdaClient({ region: env.awsRegion });
  const invoke = await lambda.send(
    new InvokeCommand({
      FunctionName: `thinkwork-${env.stage}-api-chat-agent-invoke`,
      InvocationType: "RequestResponse",
      Payload: new TextEncoder().encode(
        JSON.stringify({
          tenantId: fixtures.tenantId,
          agentId: fixtures.agentId,
          threadId,
          userMessage: message,
          messageId,
        }),
      ),
    }),
  );
  assertLambdaInvokeSucceeded(invoke);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const turn = await readLatestTurn(env, threadId, startedAt);
    if (turn && turn.status !== "running") return;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(
    `[sandbox-e2e cross-tenant] turn did not complete within 90s for tenant ${fixtures.tenantId}`,
  );
}

async function createThread(
  env: ReturnType<typeof readHarnessEnv>,
  fixtures: Fixtures,
): Promise<string> {
  const db = await openDb(env);
  try {
    const result = await db.execute(
      sql`INSERT INTO threads (tenant_id, agent_id, user_id, number, identifier, title, status, created_by_type, created_by_id, created_at, updated_at)
          VALUES (${fixtures.tenantId}::uuid, ${fixtures.agentId}::uuid, ${fixtures.userId}::uuid, 1, ${`${fixtures.names.tenantSlug}-1`}, ${"sandbox-e2e cross-tenant thread"}, 'active', 'user', ${fixtures.userId}, NOW(), NOW())
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
): Promise<string> {
  const db = await openDb(env);
  try {
    const result = await db.execute(
      sql`INSERT INTO messages (tenant_id, thread_id, role, content, sender_type, sender_id, created_at)
          VALUES (${fixtures.tenantId}::uuid, ${threadId}::uuid, 'user', ${message}, 'user', ${fixtures.userId}::uuid, NOW())
          RETURNING id`,
    );
    const rows = Array.isArray(result) ? result : ((result as any).rows ?? []);
    const id = rows[0]?.id;
    if (!id) throw new Error("sandbox-e2e: could not create user message");
    return id;
  } finally {
    await closeDb(db);
  }
}

function assertLambdaInvokeSucceeded(invoke: {
  FunctionError?: string;
  Payload?: Uint8Array;
}): void {
  if (!invoke.FunctionError) return;
  const payload = invoke.Payload
    ? new TextDecoder().decode(invoke.Payload)
    : "";
  throw new Error(
    `chat-agent-invoke failed: ${invoke.FunctionError} ${payload}`,
  );
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

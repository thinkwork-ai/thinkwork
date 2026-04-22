/**
 * Sandbox E2E fixture factory.
 *
 * `createSandboxFixtures({ runId, env })` stands up everything a sandbox
 * turn needs — tenant, template, agent, user, connections — via the
 * live GraphQL endpoint (exercising the same resolvers production
 * uses). Returns a Fixtures handle with a `teardown()` that removes
 * every resource in reverse order, swallowing "already gone" errors
 * so partial setups still clean up.
 *
 * Plan: docs/plans/2026-04-22-009-test-agentcore-code-sandbox-e2e-plan.md Unit 2.
 */

import { and, eq, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client as PgClient } from "pg";
import {
  BedrockAgentCoreControlClient,
  CreateCodeInterpreterCommand,
  DeleteCodeInterpreterCommand,
} from "@aws-sdk/client-bedrock-agentcore-control";
import {
  SecretsManagerClient,
  CreateSecretCommand,
  DeleteSecretCommand,
  PutSecretValueCommand,
  ResourceExistsException,
  ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";
import {
  FIXTURE_NAME_PREFIX,
  nameFixtures,
  type FixtureName,
  type HarnessEnv,
} from "./index.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FixtureOptions {
  runId: string;
  env: HarnessEnv;
  /** Override for per-tenant quota overrides (cap-breach test). */
  tenantDailyCap?: number;
  /** Suffix so a single test file can create two tenants (cross-tenant test). */
  suffix?: string;
  /**
   * When true, skip the manual CreateCodeInterpreter fallback and
   * require that createTenant's Lambda invocation populated the
   * interpreter IDs. Flip to true once the agentcore-admin Lambda
   * deploys; default false keeps the harness working during the
   * transition.
   */
  requireAutomaticProvisioning?: boolean;
}

export interface Fixtures {
  runId: string;
  suffix?: string;
  tenantId: string;
  userId: string;
  templateId: string;
  agentId: string;
  names: FixtureName;
  connectionIds: {
    github: string;
    slack: string;
  };
  interpreterPublicId: string;
  interpreterInternalId: string;
  /** The synthetic token values written into Secrets Manager. The
   * token-leak assertion confirms these strings never appear in
   * CloudWatch events under the run's session id. */
  syntheticTokens: {
    github: string;
    slack: string;
  };
  teardown(): Promise<void>;
}

/**
 * Build a Fixtures handle. Every network/DB call is awaited sequentially
 * so partial failure leaves a consistent state for teardown to clean.
 *
 * Designed to be called from `beforeAll`. Throws a concrete error with a
 * runbook-cross-reference on any upstream failure.
 */
export async function createSandboxFixtures(opts: FixtureOptions): Promise<Fixtures> {
  const names = nameFixtures(opts.runId, opts.suffix);
  const created: Partial<Fixtures> & { env: HarnessEnv } = { env: opts.env } as any;

  try {
    // ---- 1. Tenant -----------------------------------------------------
    const tenantGql = await runGql<{ createTenant: { id: string } }>(opts.env, {
      query:
        "mutation($input: CreateTenantInput!) { createTenant(input: $input) { id } }",
      variables: {
        input: { name: names.tenantName, slug: names.tenantSlug, plan: "pro" },
      },
    });
    const tenantId = tenantGql.createTenant.id;
    (created as any).tenantId = tenantId;

    // ---- 2. Policy: flip sandbox on, leave tier=standard --------------
    await runGql(opts.env, {
      query:
        "mutation($tenantId: ID!, $input: UpdateTenantPolicyInput!) { updateTenantPolicy(tenantId: $tenantId, input: $input) { id sandboxEnabled } }",
      variables: {
        tenantId,
        input: { sandboxEnabled: true },
      },
    });

    // ---- 3. Interpreter IDs — compensate if provisioning Lambda absent --
    const { publicId, internalId } = await ensureInterpreters(opts, tenantId);
    (created as any).interpreterPublicId = publicId;
    (created as any).interpreterInternalId = internalId;

    // ---- 4. User + connections + synthetic SM tokens ------------------
    const userId = await createFixtureUser(opts.env, tenantId, names);
    (created as any).userId = userId;

    const syntheticGithub = `ghp_${opts.runId}E2ESyntheticTokenNotARealSecret`;
    const syntheticSlack = `xoxb-${opts.runId}-e2e-synthetic-token`;
    const connectionIds = await seedConnections(
      opts,
      tenantId,
      userId,
      {
        github: syntheticGithub,
        slack: syntheticSlack,
      },
    );
    (created as any).connectionIds = connectionIds;
    (created as any).syntheticTokens = { github: syntheticGithub, slack: syntheticSlack };

    // ---- 5. Agent template with sandbox opt-in -------------------------
    const templateGql = await runGql<{ createAgentTemplate: { id: string } }>(
      opts.env,
      {
        query:
          "mutation($input: CreateAgentTemplateInput!) { createAgentTemplate(input: $input) { id } }",
        variables: {
          input: {
            tenantId,
            name: names.templateName,
            slug: names.templateSlug,
            description: "sandbox-e2e harness template",
            category: "reference",
            model: "us.anthropic.claude-sonnet-4-6",
            sandbox: {
              environment: "default-public",
              required_connections: ["github", "slack"],
            },
          },
        },
      },
    );
    const templateId = templateGql.createAgentTemplate.id;
    (created as any).templateId = templateId;

    // ---- 6. Agent ------------------------------------------------------
    const agentGql = await runGql<{ createAgentFromTemplate: { id: string } }>(
      opts.env,
      {
        query:
          "mutation($input: CreateAgentFromTemplateInput!) { createAgentFromTemplate(input: $input) { id } }",
        variables: {
          input: {
            templateId,
            name: names.agentName,
            slug: names.agentSlug,
          },
        },
      },
    );
    const agentId = agentGql.createAgentFromTemplate.id;
    (created as any).agentId = agentId;

    // ---- 7. Pair user as agent.human_pair_id so wakeup flows see them --
    await pairAgentToUser(opts.env, agentId, userId);

    // ---- 8. Optional: per-tenant cap override for cap-breach test -----
    if (opts.tenantDailyCap !== undefined) {
      await setTenantCapOverride(opts.env, tenantId, opts.tenantDailyCap);
    }

    const teardown = async () => {
      await teardownFixtures(opts, {
        tenantId,
        userId,
        agentId,
        templateId,
        interpreterPublicId: publicId,
        interpreterInternalId: internalId,
        connectionIds,
      });
    };

    return {
      runId: opts.runId,
      suffix: opts.suffix,
      tenantId,
      userId,
      templateId,
      agentId,
      names,
      connectionIds,
      interpreterPublicId: publicId,
      interpreterInternalId: internalId,
      syntheticTokens: { github: syntheticGithub, slack: syntheticSlack },
      teardown,
    };
  } catch (err) {
    // Best-effort partial teardown on setup failure.
    if ((created as any).tenantId) {
      await teardownFixtures(opts, {
        tenantId: (created as any).tenantId,
        userId: (created as any).userId,
        agentId: (created as any).agentId,
        templateId: (created as any).templateId,
        interpreterPublicId: (created as any).interpreterPublicId,
        interpreterInternalId: (created as any).interpreterInternalId,
        connectionIds: (created as any).connectionIds,
      }).catch((tdErr) => {
        console.warn("sandbox-e2e partial teardown failed:", tdErr);
      });
    }
    throw err;
  }
}

/**
 * Sweep stale `sandbox-e2e-*` fixtures older than `maxAgeMs`. Called
 * via the --cleanup-only flag; safe to invoke any time.
 */
export async function cleanupStaleFixtures(
  env: HarnessEnv,
  maxAgeMs: number = 24 * 60 * 60 * 1000,
): Promise<{ cleaned: number; skipped: number }> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const db = await openDb(env);
  try {
    // Raw SQL because the harness doesn't have Drizzle schema imports
    // wired; a LIKE sweep over tenants.slug is the narrow shape.
    const stale = await db.execute(
      sql`SELECT id FROM tenants WHERE slug LIKE ${`${FIXTURE_NAME_PREFIX}%`} AND created_at < ${cutoff}`,
    );
    const rows = Array.isArray(stale) ? stale : ((stale as any).rows ?? []);
    let cleaned = 0;
    for (const row of rows) {
      try {
        await deleteTenantCascade(env, row.id);
        cleaned++;
      } catch (err) {
        console.warn("cleanupStaleFixtures: tenant", row.id, "failed:", err);
      }
    }
    return { cleaned, skipped: rows.length - cleaned };
  } finally {
    await closeDb(db);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function runGql<T>(
  env: HarnessEnv,
  body: { query: string; variables?: Record<string, unknown> },
): Promise<T> {
  const resp = await fetch(`${env.thinkworkApiUrl.replace(/\/$/, "")}/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.apiAuthSecret}`,
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`GraphQL non-JSON response: ${resp.status} ${text.slice(0, 300)}`);
  }
  if (parsed.errors?.length) {
    throw new Error(
      `GraphQL error: ${parsed.errors.map((e: any) => e.message).join("; ")}`,
    );
  }
  return parsed.data as T;
}

async function ensureInterpreters(
  opts: FixtureOptions,
  tenantId: string,
): Promise<{ publicId: string; internalId: string }> {
  // First: poll the tenants row for up to 60s to see if the
  // createTenant Lambda invoke populated IDs.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const row = await readTenantInterpreterIds(opts.env, tenantId);
    if (row.public && row.internal) {
      return { publicId: row.public, internalId: row.internal };
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }

  if (opts.requireAutomaticProvisioning) {
    throw new Error(
      "sandbox-e2e: tenant sandbox_interpreter_*_id not populated after 60s. " +
        "The agentcore-admin Lambda is expected to provision automatically. " +
        "See docs/guides/sandbox-environments.md → SandboxProvisioning.",
    );
  }

  console.warn(
    "[sandbox-e2e] automatic provisioning didn't populate interpreter IDs; " +
      "falling back to manual CreateCodeInterpreter. This is expected until the " +
      "agentcore-admin Lambda terraform PR lands.",
  );

  const aci = new BedrockAgentCoreControlClient({ region: opts.env.awsRegion });

  const pub: any = await aci.send(
    new CreateCodeInterpreterCommand({
      name: `sandbox-e2e-${opts.runId}-pub`,
      networkConfiguration: { networkMode: "PUBLIC" },
      description: `sandbox-e2e fallback interpreter (public) for tenant ${tenantId}`,
      tags: { Stage: opts.env.stage, TenantId: tenantId, Environment: "default-public" },
      clientToken: `${opts.runId}-pub`,
    }),
  );
  const int: any = await aci.send(
    new CreateCodeInterpreterCommand({
      name: `sandbox-e2e-${opts.runId}-int`,
      networkConfiguration: { networkMode: "SANDBOX" },
      description: `sandbox-e2e fallback interpreter (internal) for tenant ${tenantId}`,
      tags: { Stage: opts.env.stage, TenantId: tenantId, Environment: "internal-only" },
      clientToken: `${opts.runId}-int`,
    }),
  );
  const publicId = pub.codeInterpreterId ?? pub.codeInterpreterArn;
  const internalId = int.codeInterpreterId ?? int.codeInterpreterArn;
  await writeTenantInterpreterIds(opts.env, tenantId, publicId, internalId);
  return { publicId, internalId };
}

async function createFixtureUser(
  env: HarnessEnv,
  tenantId: string,
  names: FixtureName,
): Promise<string> {
  const db = await openDb(env);
  try {
    const email = `${names.tenantSlug}@sandbox-e2e.local`;
    const result = await db.execute(
      sql`INSERT INTO users (tenant_id, email, name) VALUES (${tenantId}::uuid, ${email}, ${names.tenantName}) RETURNING id`,
    );
    const rows = Array.isArray(result) ? result : ((result as any).rows ?? []);
    const userId = rows[0]?.id;
    if (!userId) throw new Error("sandbox-e2e: could not create fixture user");
    return userId;
  } finally {
    await closeDb(db);
  }
}

async function seedConnections(
  opts: FixtureOptions,
  tenantId: string,
  userId: string,
  tokens: { github: string; slack: string },
): Promise<{ github: string; slack: string }> {
  const db = await openDb(opts.env);
  const sm = new SecretsManagerClient({ region: opts.env.awsRegion });
  try {
    const providerIds = await readProviderIds(db);
    if (!providerIds.github || !providerIds.slack) {
      throw new Error(
        "sandbox-e2e: github / slack rows missing from connect_providers. " +
          "Re-run scripts/seed-dev.sql against the stage's DB.",
      );
    }
    const connectionIds = { github: "", slack: "" };
    for (const provider of ["github", "slack"] as const) {
      const result = await db.execute(
        sql`INSERT INTO connections (tenant_id, user_id, provider_id, status, connected_at)
            VALUES (${tenantId}::uuid, ${userId}::uuid, ${providerIds[provider]}::uuid, 'active', NOW())
            RETURNING id`,
      );
      const rows = Array.isArray(result) ? result : ((result as any).rows ?? []);
      const connId = rows[0]?.id as string;
      connectionIds[provider] = connId;

      const path = `thinkwork/${opts.env.stage}/oauth/${connId}`;
      await putSecret(sm, path, tokens[provider]);
    }
    return connectionIds;
  } finally {
    await closeDb(db);
  }
}

async function pairAgentToUser(
  env: HarnessEnv,
  agentId: string,
  userId: string,
): Promise<void> {
  const db = await openDb(env);
  try {
    await db.execute(
      sql`UPDATE agents SET human_pair_id = ${userId}::uuid WHERE id = ${agentId}::uuid`,
    );
  } finally {
    await closeDb(db);
  }
}

async function setTenantCapOverride(
  env: HarnessEnv,
  tenantId: string,
  cap: number,
): Promise<void> {
  // Placeholder: the plan notes (Unit 5 Approach) that per-tenant cap
  // overrides may need a new table or JSON column. For v1, we
  // short-circuit by pre-seeding the counter row at count=cap, so the
  // very first invocation hits `WHERE count < cap` as false.
  const db = await openDb(env);
  try {
    await db.execute(
      sql`INSERT INTO sandbox_tenant_daily_counters (tenant_id, utc_date, invocations_count, updated_at)
          VALUES (${tenantId}::uuid, CURRENT_DATE, ${cap}, NOW())
          ON CONFLICT (tenant_id, utc_date) DO UPDATE SET invocations_count = ${cap}`,
    );
  } finally {
    await closeDb(db);
  }
}

async function teardownFixtures(
  opts: FixtureOptions,
  fx: Partial<{
    tenantId: string;
    userId: string;
    agentId: string;
    templateId: string;
    interpreterPublicId: string;
    interpreterInternalId: string;
    connectionIds: { github: string; slack: string };
  }>,
): Promise<void> {
  // Reverse order, swallow ResourceNotFound-class errors.
  const sm = new SecretsManagerClient({ region: opts.env.awsRegion });

  // Delete SM secrets first (they're the most isolated)
  for (const connId of Object.values(fx.connectionIds ?? {})) {
    const path = `thinkwork/${opts.env.stage}/oauth/${connId}`;
    try {
      await sm.send(
        new DeleteSecretCommand({ SecretId: path, ForceDeleteWithoutRecovery: true }),
      );
    } catch (err) {
      if (!(err instanceof ResourceNotFoundException)) {
        console.warn(`teardown: DeleteSecret ${path} failed:`, err);
      }
    }
  }

  // Delete code interpreters (manual fallback path only creates them;
  // when the Lambda path lands, the deprovision handler owns cleanup).
  if (fx.interpreterPublicId || fx.interpreterInternalId) {
    const aci = new BedrockAgentCoreControlClient({ region: opts.env.awsRegion });
    for (const id of [fx.interpreterPublicId, fx.interpreterInternalId]) {
      if (!id) continue;
      try {
        await aci.send(new DeleteCodeInterpreterCommand({ codeInterpreterId: id }));
      } catch (err: any) {
        if (err?.name !== "ResourceNotFoundException") {
          console.warn(`teardown: DeleteCodeInterpreter ${id} failed:`, err);
        }
      }
    }
  }

  // Cascade-delete DB rows tied to the tenant. One query covers every
  // FK path because all our rows reference tenant_id.
  if (fx.tenantId) {
    await deleteTenantCascade(opts.env, fx.tenantId);
  }
}

async function deleteTenantCascade(env: HarnessEnv, tenantId: string): Promise<void> {
  const db = await openDb(env);
  try {
    // Order matters — FK cascades handle most of it, but a few tables
    // don't cascade (agent_skills, agent_knowledge_bases, agents → template_id).
    // Do the non-cascading ones explicitly, then the rest falls through
    // the tenants row delete.
    await db.execute(
      sql`DELETE FROM agent_skills WHERE tenant_id = ${tenantId}::uuid`,
    );
    await db.execute(
      sql`DELETE FROM agent_knowledge_bases WHERE tenant_id = ${tenantId}::uuid`,
    );
    await db.execute(sql`DELETE FROM agents WHERE tenant_id = ${tenantId}::uuid`);
    await db.execute(
      sql`DELETE FROM agent_templates WHERE tenant_id = ${tenantId}::uuid`,
    );
    await db.execute(
      sql`DELETE FROM connections WHERE tenant_id = ${tenantId}::uuid`,
    );
    await db.execute(sql`DELETE FROM users WHERE tenant_id = ${tenantId}::uuid`);
    await db.execute(
      sql`DELETE FROM sandbox_invocations WHERE tenant_id = ${tenantId}::uuid`,
    );
    await db.execute(
      sql`DELETE FROM sandbox_tenant_daily_counters WHERE tenant_id = ${tenantId}::uuid`,
    );
    await db.execute(
      sql`DELETE FROM sandbox_agent_hourly_counters WHERE tenant_id = ${tenantId}::uuid`,
    );
    await db.execute(
      sql`DELETE FROM tenant_policy_events WHERE tenant_id = ${tenantId}::uuid`,
    );
    await db.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`);
  } finally {
    await closeDb(db);
  }
}

async function readTenantInterpreterIds(
  env: HarnessEnv,
  tenantId: string,
): Promise<{ public: string | null; internal: string | null }> {
  const db = await openDb(env);
  try {
    const result = await db.execute(
      sql`SELECT sandbox_interpreter_public_id, sandbox_interpreter_internal_id FROM tenants WHERE id = ${tenantId}::uuid`,
    );
    const rows = Array.isArray(result) ? result : ((result as any).rows ?? []);
    const row = rows[0];
    return {
      public: row?.sandbox_interpreter_public_id ?? null,
      internal: row?.sandbox_interpreter_internal_id ?? null,
    };
  } finally {
    await closeDb(db);
  }
}

async function writeTenantInterpreterIds(
  env: HarnessEnv,
  tenantId: string,
  publicId: string,
  internalId: string,
): Promise<void> {
  const db = await openDb(env);
  try {
    await db.execute(
      sql`UPDATE tenants
          SET sandbox_interpreter_public_id = ${publicId},
              sandbox_interpreter_internal_id = ${internalId}
          WHERE id = ${tenantId}::uuid`,
    );
  } finally {
    await closeDb(db);
  }
}

async function readProviderIds(
  db: Awaited<ReturnType<typeof openDb>>,
): Promise<{ github?: string; slack?: string }> {
  const result = await db.execute(
    sql`SELECT name, id FROM connect_providers WHERE name IN ('github', 'slack')`,
  );
  const rows = Array.isArray(result) ? result : ((result as any).rows ?? []);
  const out: { github?: string; slack?: string } = {};
  for (const row of rows) {
    if (row.name === "github") out.github = row.id;
    if (row.name === "slack") out.slack = row.id;
  }
  return out;
}

async function putSecret(
  sm: SecretsManagerClient,
  path: string,
  value: string,
): Promise<void> {
  try {
    await sm.send(new PutSecretValueCommand({ SecretId: path, SecretString: value }));
    return;
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }
  try {
    await sm.send(
      new CreateSecretCommand({
        Name: path,
        SecretString: value,
        Description: "sandbox-e2e synthetic OAuth token",
      }),
    );
  } catch (err) {
    if (!(err instanceof ResourceExistsException)) throw err;
    await sm.send(new PutSecretValueCommand({ SecretId: path, SecretString: value }));
  }
}

// ---------------------------------------------------------------------------
// Thin Drizzle/pg wrapper — one connection per call so the harness doesn't
// carry long-lived DB handles across assertions.
// ---------------------------------------------------------------------------

async function openDb(env: HarnessEnv) {
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

export const _testOnly = {
  // Exposed for unit tests that don't want to stand up a real DB.
  FIXTURE_NAME_PREFIX,
};

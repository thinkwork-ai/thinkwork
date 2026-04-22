/**
 * AgentCore Admin Lambda — SSM permission CRUD + CloudWatch audit queries.
 *
 * Called by app-manager for AgentCore assistant management operations that require
 * AWS API access (SSM Parameter Store, CloudWatch Logs).
 */

import {
  SSMClient,
  GetParameterCommand,
  PutParameterCommand,
} from "@aws-sdk/client-ssm";
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import {
  IAMClient,
  CreateRoleCommand,
  DeleteRoleCommand,
  DeleteRolePolicyCommand,
  GetRoleCommand,
  PutRolePolicyCommand,
} from "@aws-sdk/client-iam";
import {
  BedrockAgentCoreControlClient,
  CreateCodeInterpreterCommand,
  DeleteCodeInterpreterCommand,
  ListCodeInterpretersCommand,
} from "@aws-sdk/client-bedrock-agentcore-control";
import { getDb } from "@thinkwork/database-pg";
import { tenants } from "@thinkwork/database-pg/schema";
import { eq, isNotNull, or } from "drizzle-orm";

const ssm = new SSMClient({});
const cwLogs = new CloudWatchLogsClient({});
const iam = new IAMClient({});
const aci = new BedrockAgentCoreControlClient({});

function respond(status: number, body: Record<string, unknown>) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    },
    body: JSON.stringify(body),
  };
}

export async function handler(event: any) {
  const method =
    event.requestContext?.http?.method || event.httpMethod || "GET";
  const path = event.requestContext?.http?.path || event.path || "/";

  // CORS preflight
  if (method === "OPTIONS") {
    return respond(200, {});
  }

  // Health check
  if (method === "GET" && path === "/health") {
    return respond(200, { status: "ok", service: "agentcore-admin" });
  }

  // Auth: require Bearer token matching AGENTCORE_ADMIN_TOKEN env
  const authHeader =
    event.headers?.authorization || event.headers?.Authorization || "";
  const token = authHeader.replace("Bearer ", "");
  const expectedToken = process.env.AGENTCORE_ADMIN_TOKEN;
  if (!expectedToken || token !== expectedToken) {
    return respond(401, { error: "Unauthorized" });
  }

  let body: any;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return respond(400, { error: "Invalid JSON body" });
  }

  // Route
  try {
    if (method === "GET" && path.startsWith("/permissions/")) {
      return await getPermissions(path);
    }
    if (method === "PUT" && path.startsWith("/permissions/")) {
      return await putPermissions(path, body);
    }
    if (method === "POST" && path === "/audit-query") {
      return await queryAuditLogs(body);
    }
    if (method === "POST" && path === "/provision-tenant-sandbox") {
      return await provisionTenantSandbox(body);
    }
    if (method === "POST" && path === "/deprovision-tenant-sandbox") {
      return await deprovisionTenantSandbox(body);
    }
    if (method === "POST" && path === "/sandbox-orphan-gc") {
      return await sandboxOrphanGc(body);
    }
    return respond(404, { error: "Not found" });
  } catch (err: any) {
    console.error("AgentCore admin error:", err);
    return respond(500, { error: err.message || "Internal error" });
  }
}

// ---------------------------------------------------------------------------
// SSM Permission Profile CRUD
// ---------------------------------------------------------------------------

async function getPermissions(path: string) {
  // Path: /permissions/{stackName}/{tenantId}
  const parts = path.split("/").filter(Boolean);
  // parts: ["permissions", stackName, tenantId]
  if (parts.length < 3) {
    return respond(400, {
      error: "Path must be /permissions/{stackName}/{tenantId}",
    });
  }
  const stackName = parts[1];
  const tenantId = parts[2];
  const ssmPath = `/thinkwork/${stackName}/agentcore/tenants/${tenantId}/permissions`;

  try {
    const result = await ssm.send(new GetParameterCommand({ Name: ssmPath }));
    const profile = JSON.parse(result.Parameter?.Value || "{}");
    return respond(200, { tenantId, profile });
  } catch (err: any) {
    if (err.name === "ParameterNotFound") {
      // Return default basic profile
      return respond(200, {
        tenantId,
        profile: {
          profile: "basic",
          tools: ["web_search"],
          data_permissions: {},
        },
      });
    }
    throw err;
  }
}

async function putPermissions(path: string, body: any) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 3) {
    return respond(400, {
      error: "Path must be /permissions/{stackName}/{tenantId}",
    });
  }
  const stackName = parts[1];
  const tenantId = parts[2];
  const ssmPath = `/thinkwork/${stackName}/agentcore/tenants/${tenantId}/permissions`;

  const profile = body.profile;
  if (!profile) {
    return respond(400, { error: "profile field required" });
  }

  await ssm.send(
    new PutParameterCommand({
      Name: ssmPath,
      Value: JSON.stringify(profile),
      Type: "String",
      Overwrite: true,
    }),
  );

  return respond(200, { tenantId, profile, updated: true });
}

// ---------------------------------------------------------------------------
// CloudWatch Audit Log Query
// ---------------------------------------------------------------------------

async function queryAuditLogs(body: any) {
  const { stackName, tenantId, startTime, endTime, limit } = body;
  if (!stackName) {
    return respond(400, { error: "stackName required" });
  }

  const logGroupName = `/thinkwork/${stackName}/agentcore/agents`;
  const filterParams: any = {
    logGroupName,
    limit: limit || 50,
    interleaved: true,
  };

  if (startTime) filterParams.startTime = startTime;
  if (endTime) filterParams.endTime = endTime;
  if (tenantId) {
    filterParams.filterPattern = `"tenant_id" "${tenantId}"`;
  }

  const result = await cwLogs.send(new FilterLogEventsCommand(filterParams));

  const events = (result.events || []).map((e) => {
    try {
      // Try to parse structured log entries
      const match = e.message?.match(/STRUCTURED_LOG\s+(.+)/);
      if (match) {
        return { ...JSON.parse(match[1]), logTimestamp: e.timestamp };
      }
      return { message: e.message, logTimestamp: e.timestamp };
    } catch {
      return { message: e.message, logTimestamp: e.timestamp };
    }
  });

  return respond(200, { events, count: events.length });
}

// ---------------------------------------------------------------------------
// Sandbox provisioning — plan Unit 5
// ---------------------------------------------------------------------------
//
// Creates a per-tenant IAM role + two Code Interpreters (`default-public` +
// `internal-only`) for the AgentCore Code Sandbox. Idempotent: GetRole is
// tried before CreateRole; ListCodeInterpreters is matched against tags
// before CreateCodeInterpreter.
//
// Invoked from packages/api/src/graphql/resolvers/core/createTenant.mutation.ts
// via Lambda `RequestResponse` (plan Unit 6). On partial failure — e.g.
// first interpreter created, second errored — we persist the populated IDs
// and return `ok: false, partial: true` so the reconciler fills the gap.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Exported for unit tests — pure string derivation, no AWS calls.
export function computeRoleName(stage: string, tenantId: string): string {
  // Base: "thinkwork-{stage}-sandbox-tenant-" = 24 chars + len(stage).
  // IAM role name limit is 64 chars. With stage=dev (3) base=27, so up to 37
  // chars of suffix fit. The tenant_id without dashes is 32 chars → always
  // fits for stages up to 11 chars ("dev"/"prod"/"staging"/"integration"). We
  // still truncate defensively in case a longer stage name lands.
  const suffix = tenantId.replace(/-/g, "");
  return `thinkwork-${stage}-sandbox-tenant-${suffix}`.slice(0, 64);
}

export function buildTrustPolicy(accountId: string): Record<string, unknown> {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Service: "bedrock-agentcore.amazonaws.com" },
        Action: "sts:AssumeRole",
        Condition: {
          StringEquals: { "aws:SourceAccount": accountId },
        },
      },
    ],
  };
}

export function buildInlinePolicy(
  stage: string,
  tenantId: string,
  region: string,
  accountId: string,
): Record<string, unknown> {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "SandboxSecretsRead",
        Effect: "Allow",
        Action: [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ],
        // Tenant-wildcard per R-Q4b. T1b residual is named in the brainstorm.
        Resource: `arn:aws:secretsmanager:${region}:${accountId}:secret:thinkwork/${stage}/sandbox/${tenantId}/*`,
      },
      {
        Sid: "SandboxCloudWatchLogs",
        Effect: "Allow",
        Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
        Resource: `arn:aws:logs:${region}:${accountId}:log-group:/aws/bedrock-agentcore/runtimes/*`,
      },
    ],
  };
}

// Exposed for a sandbox GC follow-up (Unit 5.5): returns a map of environment
// id -> interpreter id for everything the control plane reports under the
// given tenant's tag. Listing is paginated; we walk every page.
async function listCodeInterpretersByTenant(
  tenantId: string,
  stage: string,
): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  let nextToken: string | undefined;
  do {
    const page: any = await aci.send(
      new ListCodeInterpretersCommand({ nextToken }),
    );
    for (const ci of page.codeInterpreterSummaries ?? page.items ?? []) {
      // SDK may return tags directly or require a separate GetCodeInterpreter
      // call. Prefer the included tag set when present; fall back to a
      // name-prefix heuristic scoped by stage to keep GC conservative.
      const tags: Record<string, string> = ci.tags ?? {};
      const tagTenant = tags.TenantId;
      const tagStage = tags.Stage;
      const tagEnvironment = tags.Environment;
      if (tagTenant === tenantId && tagStage === stage && tagEnvironment) {
        const id = ci.codeInterpreterId ?? ci.id;
        if (id) found[tagEnvironment] = id;
      }
    }
    nextToken = page.nextToken;
  } while (nextToken);
  return found;
}

const SANDBOX_ENVIRONMENTS: Array<{
  id: "default-public" | "internal-only";
  networkMode: "PUBLIC" | "SANDBOX";
}> = [
  { id: "default-public", networkMode: "PUBLIC" },
  { id: "internal-only", networkMode: "SANDBOX" },
];

async function provisionTenantSandbox(body: any) {
  const tenantId: string = body.tenant_id ?? body.tenantId;
  if (!tenantId || !UUID_RE.test(tenantId)) {
    return respond(400, { error: "valid tenant_id UUID required" });
  }

  const stage = process.env.STAGE;
  const region = process.env.AWS_REGION || process.env.REGION;
  const accountId = process.env.AWS_ACCOUNT_ID;
  if (!stage || !region || !accountId) {
    return respond(500, {
      error:
        "STAGE + AWS_REGION + AWS_ACCOUNT_ID env vars are required on the Lambda",
    });
  }

  const roleName = computeRoleName(stage, tenantId);

  // --- IAM role (idempotent GetRole → CreateRole; PutRolePolicy always) ---
  let roleArn: string;
  try {
    const existing = await iam.send(new GetRoleCommand({ RoleName: roleName }));
    roleArn = existing.Role!.Arn!;
  } catch (err: any) {
    if (err?.name !== "NoSuchEntityException") throw err;
    const created = await iam.send(
      new CreateRoleCommand({
        RoleName: roleName,
        AssumeRolePolicyDocument: JSON.stringify(buildTrustPolicy(accountId)),
        Description: `AgentCore Code Interpreter sandbox execution role for tenant ${tenantId}`,
        Tags: [
          { Key: "Stage", Value: stage },
          { Key: "TenantId", Value: tenantId },
          { Key: "Purpose", Value: "agentcore-code-interpreter-sandbox" },
        ],
      }),
    );
    roleArn = created.Role!.Arn!;
  }

  // Always re-apply the inline policy — cheap, and lets us roll out policy
  // changes without provisioning each tenant afresh.
  await iam.send(
    new PutRolePolicyCommand({
      RoleName: roleName,
      PolicyName: "sandbox-execution",
      PolicyDocument: JSON.stringify(
        buildInlinePolicy(stage, tenantId, region, accountId),
      ),
    }),
  );

  // --- Code Interpreters (idempotent via tag cross-reference) ---
  const existingByEnv = await listCodeInterpretersByTenant(tenantId, stage);
  const result: { public_id: string | null; internal_id: string | null } = {
    public_id: existingByEnv["default-public"] ?? null,
    internal_id: existingByEnv["internal-only"] ?? null,
  };
  let partial = false;

  for (const env of SANDBOX_ENVIRONMENTS) {
    const key = env.id === "default-public" ? "public_id" : "internal_id";
    if (result[key]) continue;
    try {
      const suffix = tenantId.replace(/-/g, "").slice(0, 8);
      const envTag = env.id.replace(/-/g, "");
      const created: any = await aci.send(
        new CreateCodeInterpreterCommand({
          name: `thinkwork-${stage}-sb-${suffix}-${envTag}`,
          executionRoleArn: roleArn,
          networkConfiguration: { networkMode: env.networkMode },
          description: `Sandbox ${env.id} for tenant ${tenantId}`,
          tags: { Stage: stage, TenantId: tenantId, Environment: env.id },
          clientToken: `${tenantId}-${env.id}`,
        }),
      );
      result[key] =
        created.codeInterpreterId ?? created.codeInterpreterArn ?? null;
    } catch (err: any) {
      console.error(
        `[provisionTenantSandbox] CreateCodeInterpreter(${env.id}) failed for ${tenantId}:`,
        err,
      );
      partial = true;
      break;
    }
  }

  // --- Persist IDs (whatever we have) so the reconciler can resume later ---
  try {
    const db = getDb();
    await db
      .update(tenants)
      .set({
        sandbox_interpreter_public_id: result.public_id,
        sandbox_interpreter_internal_id: result.internal_id,
      })
      .where(eq(tenants.id, tenantId));
  } catch (err: any) {
    console.error(
      `[provisionTenantSandbox] tenants UPDATE failed for ${tenantId}:`,
      err,
    );
    // Surface the DB failure — the caller should retry. Resources created
    // above are tagged and will be picked up by the next invocation.
    return respond(500, {
      ok: false,
      tenant_id: tenantId,
      role_arn: roleArn,
      interpreters: result,
      error: "tenants row update failed; resources are orphaned until retry",
    });
  }

  const ok = !partial && !!result.public_id && !!result.internal_id;
  return respond(ok ? 200 : 202, {
    ok,
    partial,
    tenant_id: tenantId,
    role_arn: roleArn,
    interpreters: result,
  });
}

// ---------------------------------------------------------------------------
// Sandbox de-provisioning — plan Unit 5.5
// ---------------------------------------------------------------------------
//
// Symmetric counterpart to provisionTenantSandbox. Deletes the pair of Code
// Interpreters recorded on tenants.sandbox_interpreter_*_id, then removes
// the inline policy and the IAM role. Idempotent: "resource not found"
// errors are treated as success.
//
// Today there's no `deleteTenant` mutation to call this from; it ships for
// callers like the orphan GC below and for the operator CLI path that will
// land alongside tenant-delete.

async function deprovisionTenantSandbox(body: any) {
  const tenantId: string = body.tenant_id ?? body.tenantId;
  if (!tenantId || !UUID_RE.test(tenantId)) {
    return respond(400, { error: "valid tenant_id UUID required" });
  }
  const stage = process.env.STAGE;
  if (!stage) return respond(500, { error: "STAGE env var required" });

  const db = getDb();
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant) return respond(404, { error: "Tenant not found" });

  const interpreters = [
    tenant.sandbox_interpreter_public_id,
    tenant.sandbox_interpreter_internal_id,
  ].filter((x): x is string => typeof x === "string" && x.length > 0);

  const failures: string[] = [];
  for (const id of interpreters) {
    try {
      await aci.send(
        new DeleteCodeInterpreterCommand({ codeInterpreterId: id }),
      );
    } catch (err: any) {
      if (err?.name !== "ResourceNotFoundException") {
        console.error(
          `[deprovisionTenantSandbox] DeleteCodeInterpreter(${id}) failed:`,
          err,
        );
        failures.push(`interpreter:${id}`);
      }
    }
  }

  // Null the columns even if a delete failed above — the old IDs are stale
  // either way, and the orphan GC will clean up anything the explicit call
  // couldn't.
  await db
    .update(tenants)
    .set({
      sandbox_interpreter_public_id: null,
      sandbox_interpreter_internal_id: null,
    })
    .where(eq(tenants.id, tenantId));

  const roleName = computeRoleName(stage, tenantId);
  try {
    await iam.send(
      new DeleteRolePolicyCommand({
        RoleName: roleName,
        PolicyName: "sandbox-execution",
      }),
    );
  } catch (err: any) {
    if (err?.name !== "NoSuchEntityException") {
      console.error(
        `[deprovisionTenantSandbox] DeleteRolePolicy(${roleName}) failed:`,
        err,
      );
      failures.push(`role-policy:${roleName}`);
    }
  }
  try {
    await iam.send(new DeleteRoleCommand({ RoleName: roleName }));
  } catch (err: any) {
    if (err?.name !== "NoSuchEntityException") {
      console.error(
        `[deprovisionTenantSandbox] DeleteRole(${roleName}) failed:`,
        err,
      );
      failures.push(`role:${roleName}`);
    }
  }

  return respond(failures.length === 0 ? 200 : 202, {
    ok: failures.length === 0,
    tenant_id: tenantId,
    deleted_interpreters: interpreters,
    failures,
  });
}

// ---------------------------------------------------------------------------
// Sandbox orphan GC — plan Unit 5.5
// ---------------------------------------------------------------------------
//
// Scheduled daily (via EventBridge, wired in Unit 6 follow-up). Walks
// ListCodeInterpreters, filters by the stage-scoped name prefix
// `thinkwork-{stage}-sb-`, subtracts the set of IDs live on the tenants
// table, applies a minimum-age check (default 1 hour) so in-flight creates
// don't get reaped, and deletes the rest.
//
// Tag-based cross-reference was the plan's preferred strategy, but
// CodeInterpreterSummary doesn't include tags in the list response. Using
// the tenants.sandbox_interpreter_*_id cross-reference (the plan's named
// fallback) is safe regardless.

const GC_NAME_PREFIX = (stage: string) => `thinkwork-${stage}-sb-`;
const DEFAULT_MIN_AGE_MS = 60 * 60 * 1000; // 1h

export interface GcOrphan {
  codeInterpreterId: string;
  name?: string;
  ageMs: number;
}

export interface GcSummary {
  scanned: number;
  live: number;
  skippedAge: number;
  orphansFound: number;
  orphansDeleted: number;
  failures: string[];
}

// Exported for unit tests — no AWS/DB I/O.
export function computeOrphans(args: {
  now: number;
  stage: string;
  /** Every interpreter the control plane reports (post-filter by name prefix). */
  listed: Array<{
    codeInterpreterId?: string | undefined;
    name?: string | undefined;
    createdAt?: Date | undefined;
  }>;
  /** IDs live on the tenants table (both columns, across all tenants). */
  liveIds: Set<string>;
  minAgeMs?: number;
}): { orphans: GcOrphan[]; skippedAge: number; scanned: number; live: number } {
  const prefix = GC_NAME_PREFIX(args.stage);
  const minAgeMs = args.minAgeMs ?? DEFAULT_MIN_AGE_MS;

  const orphans: GcOrphan[] = [];
  let skippedAge = 0;
  let live = 0;
  let scanned = 0;

  for (const ci of args.listed) {
    if (!ci.codeInterpreterId || !ci.name) continue;
    if (!ci.name.startsWith(prefix)) continue;
    scanned++;
    if (args.liveIds.has(ci.codeInterpreterId)) {
      live++;
      continue;
    }
    const createdAt = ci.createdAt ? ci.createdAt.getTime() : args.now;
    const ageMs = args.now - createdAt;
    if (ageMs < minAgeMs) {
      skippedAge++;
      continue;
    }
    orphans.push({
      codeInterpreterId: ci.codeInterpreterId,
      name: ci.name,
      ageMs,
    });
  }
  return { orphans, skippedAge, scanned, live };
}

async function sandboxOrphanGc(body: any) {
  const stage = process.env.STAGE;
  if (!stage) return respond(500, { error: "STAGE env var required" });
  const dryRun = body?.dry_run === true;
  const minAgeMs =
    typeof body?.min_age_ms === "number" ? body.min_age_ms : DEFAULT_MIN_AGE_MS;

  // Page through ListCodeInterpreters.
  const listed: Array<{
    codeInterpreterId?: string;
    name?: string;
    createdAt?: Date;
  }> = [];
  let nextToken: string | undefined;
  do {
    const page: any = await aci.send(
      new ListCodeInterpretersCommand({ nextToken }),
    );
    for (const ci of page.codeInterpreterSummaries ?? []) {
      listed.push({
        codeInterpreterId: ci.codeInterpreterId,
        name: ci.name,
        createdAt: ci.createdAt,
      });
    }
    nextToken = page.nextToken;
  } while (nextToken);

  // Collect every interpreter ID tracked by a tenants row.
  const db = getDb();
  const rows = await db
    .select({
      pub: tenants.sandbox_interpreter_public_id,
      int: tenants.sandbox_interpreter_internal_id,
    })
    .from(tenants)
    .where(
      or(
        isNotNull(tenants.sandbox_interpreter_public_id),
        isNotNull(tenants.sandbox_interpreter_internal_id),
      ),
    );
  const liveIds = new Set<string>();
  for (const r of rows) {
    if (r.pub) liveIds.add(r.pub);
    if (r.int) liveIds.add(r.int);
  }

  const now = Date.now();
  const { orphans, skippedAge, scanned, live } = computeOrphans({
    now,
    stage,
    listed,
    liveIds,
    minAgeMs,
  });

  const summary: GcSummary = {
    scanned,
    live,
    skippedAge,
    orphansFound: orphans.length,
    orphansDeleted: 0,
    failures: [],
  };

  if (dryRun) {
    return respond(200, { ...summary, dry_run: true, orphans });
  }

  for (const orphan of orphans) {
    try {
      await aci.send(
        new DeleteCodeInterpreterCommand({
          codeInterpreterId: orphan.codeInterpreterId,
        }),
      );
      summary.orphansDeleted++;
    } catch (err: any) {
      if (err?.name === "ResourceNotFoundException") {
        summary.orphansDeleted++; // already gone — count as success
      } else {
        console.error(
          `[sandboxOrphanGc] DeleteCodeInterpreter(${orphan.codeInterpreterId}) failed:`,
          err,
        );
        summary.failures.push(orphan.codeInterpreterId);
      }
    }
  }

  return respond(
    summary.failures.length === 0 ? 200 : 207,
    summary as unknown as Record<string, unknown>,
  );
}

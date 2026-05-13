/**
 * Workspace files Lambda — composer-backed, Cognito-authenticated.
 *
 * Route: POST /api/workspaces/files (via the /api/workspaces/{proxy+} API
 * Gateway route). Replaces the previous `API_AUTH_SECRET`-bearer handler;
 * the bearer path is gone — every caller sends a Cognito ID token.
 *
 * Request shape (Unit 5):
 *   { action: "get" | "list" | "put" | "delete" | "regenerate-map" | "update-identity-field",
 *     agentId?: string, templateId?: string, computerId?: string, defaults?: true,
 *     path?: string, content?: string, acceptTemplateUpdate?: boolean }
 *
 *   Exactly one of agentId / templateId / computerId / defaults:true
 *   identifies the target surface. Tenant identity is derived from the
 *   caller's JWT via `resolveCallerFromAuth` — the handler NEVER trusts a
 *   tenantSlug body field. Requests that still include one are rejected
 *   (400) so buggy clients surface loud instead of drifting silently across
 *   tenants.
 *
 * Responses:
 *   get  → { ok: true, content, source, sha256 }
 *   list → { ok: true, files: Array<{ path, source, sha256, overridden }> }
 *   put  → { ok: true }
 *   delete → { ok: true }
 *   regenerate-map → { ok: true }
 *   errors → { ok: false, error }
 *
 * Auth model:
 *   - Cognito JWT required. Unauthenticated → 401.
 *   - Caller's tenant is resolved via resolveCallerFromAuth. Missing → 401.
 *   - agentId / templateId are validated against the caller's tenant.
 *     Mismatch → 404 (no "this exists in another tenant" leakage).
 *   - Put on a pinned file via agentId without `acceptTemplateUpdate: true`
 *     returns 403. The acceptTemplateUpdate GraphQL mutation (Unit 9) is
 *     the intended path; the flag here keeps the door open for admin-UI
 *     diff-preview flows that write a new override after accepting.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { authenticate, type AuthResult } from "./src/lib/cognito-auth.js";
import { resolveCallerFromAuth } from "./src/graphql/resolvers/core/resolve-auth-user.js";
import { isReservedFolderSegment } from "./src/lib/reserved-folder-names.js";
import { appendRoutingRowIfMissing } from "./src/lib/workspace-map-generator.js";
import { PINNED_FILES } from "@thinkwork/workspace-defaults";
import {
  isPinnedWorkspacePath,
  normalizeWorkspacePath,
} from "./src/lib/pinned-versions.js";
import { regenerateManifest } from "./src/lib/workspace-manifest.js";
import { bootstrapAgentWorkspace } from "./src/lib/workspace-bootstrap.js";
import { deriveAgentSkills } from "./src/lib/derive-agent-skills.js";
import { isBuiltinToolWorkspacePath } from "./src/lib/builtin-tool-slugs.js";
import {
  agents,
  agentTemplates,
  and,
  computerTasks,
  computers,
  db,
  eq,
  tenantMembers,
  tenants,
} from "./src/graphql/utils.js";
import { emitAuditEvent } from "./src/lib/compliance/emit.js";
import {
  enqueueComputerTask,
  type ComputerTaskType,
} from "./src/lib/computers/tasks.js";

// ---------------------------------------------------------------------------
// API Gateway shims
// ---------------------------------------------------------------------------

interface APIGatewayProxyEvent {
  headers?: Record<string, string | undefined>;
  body?: string | null;
  requestContext?: { http?: { method?: string } };
}

interface APIGatewayProxyResult {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

// CORS headers mirror packages/api/src/lib/response.ts so the admin SPA
// (localhost:5175 in dev, the static-site bucket in prod) and the mobile
// app can hit this endpoint from the browser / WebView. The API Gateway
// has tenant-scoped cors_configuration too, but HTTP API proxy
// integrations forward OPTIONS to the Lambda — so we must respond 2xx
// ourselves or the browser preflight fails.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-api-key, x-tenant-id, x-principal-id",
  "Access-Control-Max-Age": "3600",
};

function json(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    body: JSON.stringify(body),
  };
}

function corsPreflight(): APIGatewayProxyResult {
  return { statusCode: 204, headers: CORS_HEADERS, body: "" };
}

// ---------------------------------------------------------------------------
// S3 client
// ---------------------------------------------------------------------------

const s3 = new S3Client({
  region:
    process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
});

function bucket(): string {
  return process.env.WORKSPACE_BUCKET || "";
}

// ---------------------------------------------------------------------------
// Key builders (must match workspace-overlay.ts / workspace-copy.ts)
// ---------------------------------------------------------------------------

function agentKey(tenantSlug: string, agentSlug: string, path: string): string {
  const clean = path.replace(/^\/+/, "");
  return `tenants/${tenantSlug}/agents/${agentSlug}/workspace/${clean}`;
}

function agentPrefix(tenantSlug: string, agentSlug: string): string {
  return `tenants/${tenantSlug}/agents/${agentSlug}/workspace/`;
}

function templateKey(
  tenantSlug: string,
  templateSlug: string,
  path: string,
): string {
  const clean = path.replace(/^\/+/, "");
  return `tenants/${tenantSlug}/agents/_catalog/${templateSlug}/workspace/${clean}`;
}

function templatePrefix(tenantSlug: string, templateSlug: string): string {
  return `tenants/${tenantSlug}/agents/_catalog/${templateSlug}/workspace/`;
}

function defaultsKey(tenantSlug: string, path: string): string {
  const clean = path.replace(/^\/+/, "");
  return `tenants/${tenantSlug}/agents/_catalog/defaults/workspace/${clean}`;
}

function defaultsPrefix(tenantSlug: string): string {
  return `tenants/${tenantSlug}/agents/_catalog/defaults/workspace/`;
}

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

interface AgentTarget {
  kind: "agent";
  tenantSlug: string;
  agentSlug: string;
  agentId: string;
  prefix: string;
  key: (path: string) => string;
}

interface TemplateTarget {
  kind: "template";
  tenantSlug: string;
  templateSlug: string;
  prefix: string;
  key: (path: string) => string;
}

interface DefaultsTarget {
  kind: "defaults";
  tenantSlug: string;
  prefix: string;
  key: (path: string) => string;
}

interface ComputerTarget {
  kind: "computer";
  computerId: string;
  tenantId: string;
}

type Target = AgentTarget | TemplateTarget | DefaultsTarget | ComputerTarget;

async function resolveAgentTarget(
  tenantId: string,
  agentId: string,
): Promise<AgentTarget | null> {
  const [agent] = await db
    .select({
      id: agents.id,
      slug: agents.slug,
      tenant_id: agents.tenant_id,
    })
    .from(agents)
    .where(eq(agents.id, agentId));
  if (!agent || agent.tenant_id !== tenantId || !agent.slug) return null;

  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, agent.tenant_id));
  if (!tenant?.slug) return null;

  const slug = agent.slug;
  const tSlug = tenant.slug;
  return {
    kind: "agent",
    tenantSlug: tSlug,
    agentSlug: slug,
    agentId: agent.id,
    prefix: agentPrefix(tSlug, slug),
    key: (path) => agentKey(tSlug, slug, path),
  };
}

async function resolveTemplateTarget(
  tenantId: string,
  templateId: string,
): Promise<TemplateTarget | null> {
  const [template] = await db
    .select({
      id: agentTemplates.id,
      slug: agentTemplates.slug,
      tenant_id: agentTemplates.tenant_id,
    })
    .from(agentTemplates)
    .where(eq(agentTemplates.id, templateId));
  if (!template || template.tenant_id !== tenantId || !template.slug)
    return null;

  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant?.slug) return null;

  const tSlug = tenant.slug;
  const tmplSlug = template.slug;
  return {
    kind: "template",
    tenantSlug: tSlug,
    templateSlug: tmplSlug,
    prefix: templatePrefix(tSlug, tmplSlug),
    key: (path) => templateKey(tSlug, tmplSlug, path),
  };
}

async function resolveDefaultsTarget(
  tenantId: string,
): Promise<DefaultsTarget | null> {
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant?.slug) return null;
  const tSlug = tenant.slug;
  return {
    kind: "defaults",
    tenantSlug: tSlug,
    prefix: defaultsPrefix(tSlug),
    key: (path) => defaultsKey(tSlug, path),
  };
}

async function resolveComputerTarget(
  tenantId: string,
  computerId: string,
): Promise<ComputerTarget | null> {
  const [computer] = await db
    .select({
      id: computers.id,
      tenant_id: computers.tenant_id,
    })
    .from(computers)
    .where(eq(computers.id, computerId));
  if (!computer || computer.tenant_id !== tenantId) return null;
  return {
    kind: "computer",
    computerId: computer.id,
    tenantId: computer.tenant_id,
  };
}

// ---------------------------------------------------------------------------
// Authz — REST analogue of requireTenantAdmin (mirrors plugin-upload.ts)
// ---------------------------------------------------------------------------

const WRITE_ACTIONS = new Set([
  "put",
  "delete",
  "create-sub-agent",
  "regenerate-map",
  "update-identity-field",
  "rematerialize",
]);

async function callerIsTenantAdmin(
  tenantId: string,
  principalId: string | null,
): Promise<boolean> {
  if (!principalId) return false;
  const rows = await db
    .select({ role: tenantMembers.role })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenant_id, tenantId),
        eq(tenantMembers.principal_id, principalId),
      ),
    )
    .limit(1);
  const role = rows[0]?.role;
  return role === "owner" || role === "admin";
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

interface HandlerDeps {
  auth: AuthResult;
  tenantId: string;
  target: Target;
}

async function handleGet(
  deps: HandlerDeps,
  path: string,
): Promise<APIGatewayProxyResult> {
  const { target } = deps;
  if (target.kind === "computer") {
    return await handleComputerGet(target, path);
  }
  // Per docs/plans/2026-04-27-003: every target tier (agent / template /
  // defaults) reads its own prefix directly. No overlay walk, no
  // template/defaults fallback for agents — the agent prefix is the
  // source of truth.
  try {
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: bucket(), Key: target.key(path) }),
    );
    const content = (await resp.Body?.transformToString("utf-8")) ?? "";
    return json(200, {
      ok: true,
      content,
      source: target.kind,
      sha256: "",
    });
  } catch (err) {
    if (isNoSuchKey(err)) {
      return json(200, {
        ok: true,
        content: null,
        source: target.kind,
        sha256: "",
      });
    }
    throw err;
  }
}

async function handleList(
  deps: HandlerDeps,
  includeContent: boolean,
): Promise<APIGatewayProxyResult> {
  const { target } = deps;
  if (target.kind === "computer") {
    return await handleComputerList(target, includeContent);
  }
  // Per docs/plans/2026-04-27-003: every tier reads its own prefix
  // directly. The agent prefix IS the agent's workspace — no overlay,
  // no fallback, no `agent-override` vs `template` source labels.
  // Operational artifacts (manifest.json, _defaults_version) are
  // filtered so callers don't accidentally treat them as workspace
  // files.
  const paths = await listPrefix(target.prefix);
  const visiblePaths = paths.filter(
    (p) =>
      p !== "manifest.json" &&
      p !== "_defaults_version" &&
      !isBuiltinToolWorkspacePath(p),
  );

  if (!includeContent) {
    return json(200, {
      ok: true,
      files: visiblePaths.map((p) => ({
        path: p,
        source: target.kind,
        sha256: "",
        overridden: false,
      })),
    });
  }

  // includeContent: fetch each file. The Strands / Pi runtime cold-start
  // path sends includeContent=true and writes each file.content to its
  // local /tmp/workspace (per the runtime bootstrap helpers in U6 / U12
  // of the plan).
  const files = await Promise.all(
    visiblePaths.map(async (p) => {
      try {
        const resp = await s3.send(
          new GetObjectCommand({ Bucket: bucket(), Key: target.key(p) }),
        );
        const content = (await resp.Body?.transformToString("utf-8")) ?? "";
        return {
          path: p,
          source: target.kind,
          sha256: "",
          overridden: false,
          content,
        };
      } catch (err) {
        // Object disappeared between list and get — return empty
        // rather than failing the whole batch.
        if (isNoSuchKey(err)) {
          return {
            path: p,
            source: target.kind,
            sha256: "",
            overridden: false,
            content: "",
          };
        }
        throw err;
      }
    }),
  );
  return json(200, { ok: true, files });
}

// Computer list/get bypass the computer_tasks queue and read EFS directly
// via the workspace-files-efs sidecar Lambda. This keeps the admin
// Workspace tab independent of the Computer runtime's heartbeat / write-
// queue backlog — operators see files even when the runtime is hung or
// restarting. Writes (handleComputerPut / handleComputerDelete) stay on
// the queue path because they have ordering semantics with the runtime's
// in-process state.
async function handleComputerList(
  target: ComputerTarget,
  includeContent: boolean,
): Promise<APIGatewayProxyResult> {
  const result = await invokeWorkspaceFilesEfs({
    action: "list",
    tenantId: target.tenantId,
    computerId: target.computerId,
    includeContent,
  });
  if (!result.ok) {
    return json(result.status, { ok: false, error: result.error });
  }
  return json(200, { ok: true, files: result.files });
}

async function handleComputerGet(
  target: ComputerTarget,
  path: string,
): Promise<APIGatewayProxyResult> {
  const result = await invokeWorkspaceFilesEfs({
    action: "get",
    tenantId: target.tenantId,
    computerId: target.computerId,
    path,
  });
  if (!result.ok) {
    return json(result.status, { ok: false, error: result.error });
  }
  return json(200, {
    ok: true,
    content: result.content,
    source: "computer",
    sha256: "",
  });
}

async function handleComputerPut(
  target: ComputerTarget,
  path: string,
  content: string,
): Promise<APIGatewayProxyResult> {
  await runComputerWorkspaceTask(target, "workspace_file_write", {
    path,
    content,
  });
  return json(200, { ok: true });
}

async function handleComputerDelete(
  target: ComputerTarget,
  path: string,
): Promise<APIGatewayProxyResult> {
  await runComputerWorkspaceTask(target, "workspace_file_delete", { path });
  return json(200, { ok: true });
}

const COMPUTER_WORKSPACE_TASK_TIMEOUT_MS = 12_000;
const COMPUTER_WORKSPACE_TASK_POLL_MS = 300;

async function runComputerWorkspaceTask(
  target: ComputerTarget,
  taskType: ComputerTaskType,
  taskInput?: unknown,
): Promise<unknown> {
  const task = await enqueueComputerTask({
    tenantId: target.tenantId,
    computerId: target.computerId,
    taskType,
    taskInput,
    idempotencyKey: null,
  });
  const taskId = task.id;
  const deadline = Date.now() + COMPUTER_WORKSPACE_TASK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const [row] = await db
      .select({
        status: computerTasks.status,
        output: computerTasks.output,
        error: computerTasks.error,
      })
      .from(computerTasks)
      .where(
        and(
          eq(computerTasks.tenant_id, target.tenantId),
          eq(computerTasks.computer_id, target.computerId),
          eq(computerTasks.id, taskId),
        ),
      )
      .limit(1);

    if (row?.status === "completed") return row.output;
    if (row?.status === "failed") {
      throw new Error(
        `Computer workspace task failed: ${JSON.stringify(row.error ?? {})}`,
      );
    }
    await delay(COMPUTER_WORKSPACE_TASK_POLL_MS);
  }

  throw new Error(
    "Computer runtime did not complete the workspace operation in time",
  );
}

function asWorkspaceListOutput(output: unknown): {
  files: Array<{ path: string }>;
} {
  const files = (output as { files?: unknown })?.files;
  if (!Array.isArray(files)) return { files: [] };
  return {
    files: files
      .map((file) => ({
        path: String((file as { path?: unknown }).path ?? ""),
      }))
      .filter((file) => file.path),
  };
}

function asWorkspaceReadOutput(output: unknown): { content: string | null } {
  const content = (output as { content?: unknown })?.content;
  return { content: typeof content === "string" ? content : null };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// workspace-files-efs sidecar invoker
// ---------------------------------------------------------------------------

type WorkspaceFilesEfsListPayload = {
  action: "list";
  tenantId: string;
  computerId: string;
  includeContent: boolean;
};

type WorkspaceFilesEfsGetPayload = {
  action: "get";
  tenantId: string;
  computerId: string;
  path: string;
};

type WorkspaceFilesEfsPayload =
  | WorkspaceFilesEfsListPayload
  | WorkspaceFilesEfsGetPayload;

type WorkspaceFilesEfsResponse =
  | {
      ok: true;
      files: Array<{
        path: string;
        source: "computer";
        sha256: string;
        overridden: false;
        content?: string;
      }>;
    }
  | {
      ok: true;
      content: string | null;
      source: "computer";
      sha256: string;
    }
  | { ok: false; status: number; error: string };

let lambdaClient: LambdaClient | null = null;

function getLambdaClient(): LambdaClient {
  if (!lambdaClient) lambdaClient = new LambdaClient({});
  return lambdaClient;
}

/**
 * Lambda → Lambda RequestResponse invoke of the workspace-files-efs
 * sidecar. The sidecar mounts the shared EFS at /mnt/efs and reads the
 * per-Computer subpath directly, bypassing the computer_tasks queue.
 *
 * Caller has already validated tenant + Computer existence + permission;
 * the sidecar only enforces path-safety (UUID-shaped ids + no traversal).
 *
 * Failure modes mapped to admin-facing error payloads:
 *   - missing env var → 500 (deployment misconfig)
 *   - InvocationException → 502 (sidecar crashed or VPC unreachable)
 *   - non-ok body → pass through the sidecar's {status,error}
 */
async function invokeWorkspaceFilesEfs(
  payload: WorkspaceFilesEfsListPayload,
): Promise<
  | {
      ok: true;
      files: Array<{
        path: string;
        source: "computer";
        sha256: string;
        overridden: false;
        content?: string;
      }>;
    }
  | { ok: false; status: number; error: string }
>;
async function invokeWorkspaceFilesEfs(
  payload: WorkspaceFilesEfsGetPayload,
): Promise<
  | { ok: true; content: string | null; source: "computer"; sha256: string }
  | { ok: false; status: number; error: string }
>;
async function invokeWorkspaceFilesEfs(
  payload: WorkspaceFilesEfsPayload,
): Promise<WorkspaceFilesEfsResponse> {
  const fnArn = process.env.WORKSPACE_FILES_EFS_FN_ARN;
  if (!fnArn) {
    return {
      ok: false,
      status: 500,
      error:
        "WORKSPACE_FILES_EFS_FN_ARN is not configured on the workspace-files Lambda",
    };
  }
  let result;
  try {
    result = await getLambdaClient().send(
      new InvokeCommand({
        FunctionName: fnArn,
        InvocationType: "RequestResponse",
        Payload: new TextEncoder().encode(JSON.stringify(payload)),
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 502,
      error: `workspace-files-efs invoke failed: ${message}`,
    };
  }
  if (result.FunctionError) {
    const message = result.Payload
      ? new TextDecoder().decode(result.Payload)
      : result.FunctionError;
    return {
      ok: false,
      status: 502,
      error: `workspace-files-efs returned an error: ${message}`,
    };
  }
  if (!result.Payload) {
    return {
      ok: false,
      status: 502,
      error: "workspace-files-efs returned an empty payload",
    };
  }
  const body = JSON.parse(
    new TextDecoder().decode(result.Payload),
  ) as WorkspaceFilesEfsResponse;
  return body;
}

function isSkillMarkerPath(path: string): boolean {
  return /(?:^|\/)skills\/[^/]+\/SKILL\.md$/.test(path);
}

/**
 * Top-level governance / identity / capability files that, when
 * edited, materially change agent behavior. Edits to these files emit
 * `workspace.governance_file_edited` audit rows. SKILL.md is included
 * because SKILL.md edits change effective agent capabilities (they
 * trigger derive-agent-skills); auditing the underlying file write
 * captures the action even if the post-derive `agent.skills_changed`
 * emit drops (telemetry-tier).
 *
 * Implementer note: this list mirrors the top-level files shipped in
 * `packages/system-workspace/`. Add new governance files here when
 * they're added to the workspace defaults bundle.
 */
const GOVERNANCE_FILE_BASENAMES: ReadonlySet<string> = new Set([
  "AGENTS.md",
  "GUARDRAILS.md",
  "CAPABILITIES.md",
  "PLATFORM.md",
  "MEMORY_GUIDE.md",
  "USER.md",
]);

function isGovernanceFilePath(cleanPath: string): boolean {
  // Top-level governance files: exact basename match (no nesting).
  if (GOVERNANCE_FILE_BASENAMES.has(cleanPath)) return true;
  // SKILL.md markers anywhere under skills/<slug>/ are also
  // governance-tier — they change agent capability.
  if (isSkillMarkerPath(cleanPath)) return true;
  return false;
}


function isProtectedOrchestrationWritePath(path: string): boolean {
  return (
    path.startsWith("work/inbox/") ||
    path.startsWith("review/") ||
    /^work\/runs\/[^/]+\/events\//.test(path) ||
    path.startsWith("events/intents/") ||
    path.startsWith("events/audit/")
  );
}

async function handlePut(
  deps: HandlerDeps,
  path: string,
  content: string,
  acceptTemplateUpdate: boolean,
): Promise<APIGatewayProxyResult> {
  const { target, tenantId, auth } = deps;
  let cleanPath: string;
  try {
    cleanPath = normalizeWorkspacePath(path);
  } catch (err) {
    return json(400, {
      ok: false,
      error: err instanceof Error ? err.message : "Invalid workspace path",
    });
  }

  if (isBuiltinToolWorkspacePath(cleanPath)) {
    return json(403, {
      ok: false,
      error:
        "Built-in tools are configured through the Built-in Tools API, not workspace skill files.",
    });
  }

  if (target.kind === "computer") {
    return await handleComputerPut(target, cleanPath, content);
  }

  if (target.kind === "agent" && isProtectedOrchestrationWritePath(cleanPath)) {
    return json(403, {
      ok: false,
      error: "use orchestration writer",
    });
  }

  // Resolve audit actor once per request. apikey path → system,
  // cognito path → user with resolved users.id.
  const auditActor = await resolveAuditActor(auth);

  if (target.kind === "agent") {
    // Guardrail-class files require accept-update flag. Unit 9 will wire
    // this up through a GraphQL mutation that bumps the pinned hash
    // atomically; the flag here keeps the door open for admin-UI
    // diff-preview flows that write an override after the operator
    // accepts.
    if (isPinnedWorkspacePath(cleanPath) && !acceptTemplateUpdate) {
      return json(403, {
        ok: false,
        error: `Cannot write pinned file ${cleanPath} without acceptTemplateUpdate. Use the acceptTemplateUpdate mutation (Unit 9) or pass acceptTemplateUpdate: true if you have already reviewed the diff.`,
      });
    }

    if (isGovernanceFilePath(cleanPath)) {
      // Governance file edit: emit audit row inside a tx, then run the
      // S3 put inside the same tx callback so an S3 throw rolls back
      // the audit row. Emit FIRST, S3 second — emit failure prevents
      // the S3 write entirely. Cost: pool slot held across the S3
      // round-trip (acknowledged tradeoff per master plan U5 risks).
      try {
        await db.transaction(async (tx) => {
          await emitAuditEvent(tx, {
            tenantId,
            actorId: auditActor.actorId,
            actorType: auditActor.actorType,
            eventType: "workspace.governance_file_edited",
            source: "lambda",
            payload: {
              file: cleanPath,
              content,
              workspaceId: target.tenantSlug,
            },
            resourceType: "workspace_file",
            resourceId: `${target.tenantSlug}/${target.agentSlug}/${cleanPath}`,
            action: "edit",
            outcome: "success",
          });
          await s3.send(
            new PutObjectCommand({
              Bucket: bucket(),
              Key: target.key(cleanPath),
              Body: content,
              ContentType: "text/plain; charset=utf-8",
            }),
          );
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[workspace-files] governance PUT failed: ${message}`);
        return json(500, {
          ok: false,
          error: `Governance file edit could not be safely audited: ${message}`,
        });
      }
    } else {
      // Non-governance files (notes, free-form data): unaudited
      // unwrapped S3 put, preserving today's hot-path behavior.
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket(),
          Key: target.key(cleanPath),
          Body: content,
          ContentType: "text/plain; charset=utf-8",
        }),
      );
    }

    await regenerateManifest(bucket(), target.tenantSlug, target.agentSlug);

    // Skills are activated by first-class workspace folders. After a
    // successful SKILL.md marker write we re-derive the agent_skills table
    // from the workspace tree. The S3 put has already landed by this point —
    // if derive fails we return 500 so the caller knows the DB is stale; the
    // next skill marker save retries the derive.
    if (isSkillMarkerPath(cleanPath)) {
      try {
        const result = await deriveAgentSkills({ tenantId }, target.agentId);
        const summary =
          `agent=${target.agentId} skill_paths=${result.agentsMdPathsScanned.length} ` +
          `changed=${result.changed} added=${result.addedSlugs.join(",") || "-"} ` +
          `removed=${result.removedSlugs.join(",") || "-"}`;
        console.log(`[derive-agent-skills] ${summary}`);

        // Emit `agent.skills_changed` (telemetry tier) when the
        // derived membership actually changed. The wrapping tx
        // covers ONLY the audit row — derive's own writes already
        // committed, so an emit failure does not roll back the
        // skill-state mutation. The underlying SKILL.md edit is
        // separately audited as `workspace.governance_file_edited`
        // above, so an emit-miss here does not lose evidence of the
        // capability change.
        if (result.changed) {
          try {
            await db.transaction(async (tx) => {
              await emitAuditEvent(tx, {
                tenantId,
                actorId: auditActor.actorId,
                actorType: auditActor.actorType,
                eventType: "agent.skills_changed",
                source: "lambda",
                payload: {
                  agentId: target.agentId,
                  addedSkills: result.addedSlugs,
                  removedSkills: result.removedSlugs,
                  reason: "workspace_skill_marker_change",
                },
                resourceType: "agent",
                resourceId: target.agentId,
                action: "update",
                outcome: "success",
              });
            });
          } catch (emitErr) {
            console.error(
              `[agent.skills_changed] audit emit failed (telemetry-tier; not blocking): ${
                emitErr instanceof Error ? emitErr.message : String(emitErr)
              }`,
            );
          }
        }

        if (result.warnings.length > 0) {
          return json(200, {
            ok: true,
            deriveWarnings: result.warnings,
          });
        }
        return json(200, { ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[derive-agent-skills] failed: ${message}`);
        return json(500, {
          ok: false,
          error:
            "Skill file persisted but agent_skills derive failed: " + message,
        });
      }
    }

    return json(200, { ok: true });
  }

  // Template / defaults: tenant already validated at target resolution.
  // Invalidate every agent in the tenant — the base layer moved.
  // Governance-file template edits (e.g., a tenant's default AGENTS.md)
  // also emit; non-governance template files take the unwrapped path.
  if (isGovernanceFilePath(cleanPath)) {
    try {
      await db.transaction(async (tx) => {
        await emitAuditEvent(tx, {
          tenantId,
          actorId: auditActor.actorId,
          actorType: auditActor.actorType,
          eventType: "workspace.governance_file_edited",
          source: "lambda",
          payload: {
            file: cleanPath,
            content,
            workspaceId: target.tenantSlug,
          },
          resourceType: "workspace_template",
          resourceId: `${target.tenantSlug}/${cleanPath}`,
          action: "edit",
          outcome: "success",
        });
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket(),
            Key: target.key(cleanPath),
            Body: content,
            ContentType: "text/plain; charset=utf-8",
          }),
        );
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[workspace-files] governance template PUT failed: ${message}`);
      return json(500, {
        ok: false,
        error: `Governance template edit could not be safely audited: ${message}`,
      });
    }
  } else {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: target.key(cleanPath),
        Body: content,
        ContentType: "text/plain; charset=utf-8",
      }),
    );
  }
  return json(200, { ok: true });
}

/**
 * Resolve the audit actor for the request:
 *   apikey path → actorType: "system", actorId: "platform-credential"
 *     (do NOT trust event.headers["x-principal-id"] — it's an
 *     unverified self-assertion per tenant-membership.ts:112-114)
 *   cognito path → actorType: "user", actorId: resolved users.id
 *     (or principalId fallback when the users-lookup misses)
 */
async function resolveAuditActor(
  auth: AuthResult,
): Promise<{ actorId: string; actorType: "user" | "system" }> {
  if (auth.authType === "apikey") {
    return { actorId: "platform-credential", actorType: "system" };
  }
  const { userId } = await resolveCallerFromAuth(auth);
  return {
    actorId: userId ?? auth.principalId ?? "unknown",
    actorType: "user",
  };
}

const SUB_AGENT_SLUG_RE = /^[a-z][a-z0-9-]{0,31}$/;

async function handleCreateSubAgent(
  deps: HandlerDeps,
  slug: string,
  contextContent: string,
): Promise<APIGatewayProxyResult> {
  const { target, tenantId } = deps;
  if (target.kind !== "agent") {
    return json(400, { ok: false, error: "create-sub-agent requires agentId" });
  }

  const cleanSlug = slug.trim();
  if (!SUB_AGENT_SLUG_RE.test(cleanSlug)) {
    return json(400, {
      ok: false,
      error:
        "Slug must start with lowercase letter and contain only a-z, 0-9, and hyphens.",
    });
  }
  if (isReservedFolderSegment(cleanSlug)) {
    return json(400, {
      ok: false,
      error: `\`${cleanSlug}\` is a reserved folder name.`,
    });
  }
  // Read directly from the agent prefix — under the materialize-at-
  // write-time model, the agent prefix is the source of truth.
  const existingPaths = await listPrefix(target.prefix);
  const existingTopFolders = new Set(
    existingPaths
      .filter((path) => path.includes("/"))
      .map((path) => path.split("/")[0])
      .filter((segment): segment is string => Boolean(segment)),
  );
  if (existingTopFolders.has(cleanSlug)) {
    return json(409, {
      ok: false,
      error: `A folder named \`${cleanSlug}\` already exists at this agent's root.`,
    });
  }

  let agentsMd = defaultAgentsMd();
  try {
    const resp = await s3.send(
      new GetObjectCommand({
        Bucket: bucket(),
        Key: target.key("AGENTS.md"),
      }),
    );
    agentsMd = (await resp.Body?.transformToString("utf-8")) ?? agentsMd;
  } catch (err) {
    if (!isNoSuchKey(err)) throw err;
  }

  const nextAgentsMd = appendRoutingRowIfMissing(agentsMd, {
    task: `${cleanSlug} specialist`,
    goTo: `${cleanSlug}/`,
    read: `${cleanSlug}/CONTEXT.md`,
    skills: [],
  });

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: target.key(`${cleanSlug}/CONTEXT.md`),
      Body: contextContent,
      ContentType: "text/plain; charset=utf-8",
    }),
  );
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: target.key("AGENTS.md"),
      Body: nextAgentsMd,
      ContentType: "text/plain; charset=utf-8",
    }),
  );

  await regenerateManifest(bucket(), target.tenantSlug, target.agentSlug);

  try {
    const result = await deriveAgentSkills({ tenantId }, target.agentId);
    if (result.warnings.length > 0) {
      return json(200, {
        ok: true,
        deriveWarnings: result.warnings,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[derive-agent-skills] failed: ${message}`);
    return json(500, {
      ok: false,
      error: "AGENTS.md persisted but agent_skills derive failed: " + message,
    });
  }

  return json(200, { ok: true });
}

async function handleDelete(
  deps: HandlerDeps,
  path: string,
): Promise<APIGatewayProxyResult> {
  const { target, tenantId } = deps;
  if (target.kind === "computer") {
    return await handleComputerDelete(target, path);
  }
  await s3.send(
    new DeleteObjectCommand({ Bucket: bucket(), Key: target.key(path) }),
  );
  if (target.kind === "agent") {
    await regenerateManifest(bucket(), target.tenantSlug, target.agentSlug);
    if (isSkillMarkerPath(path)) {
      try {
        const result = await deriveAgentSkills({ tenantId }, target.agentId);
        const summary =
          `agent=${target.agentId} skill_paths=${result.agentsMdPathsScanned.length} ` +
          `changed=${result.changed} added=${result.addedSlugs.join(",") || "-"} ` +
          `removed=${result.removedSlugs.join(",") || "-"}`;
        console.log(`[derive-agent-skills] ${summary}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[derive-agent-skills] failed: ${message}`);
        return json(500, {
          ok: false,
          error:
            "Skill file deleted but agent_skills derive failed: " + message,
        });
      }
    }
  } else {
  }
  return json(200, { ok: true });
}

// Line-surgery anchors for IDENTITY.md personality fields. Only these 4
// lines are editable via `update-identity-field`; the Name line is
// reserved for `update_agent_name` (which goes through the updateAgent
// mutation + writeIdentityMdForAgent). Never exposing Name here is a
// narrow-scope guarantee — the tool's Literal type is backed by this
// server-side whitelist.
const IDENTITY_FIELD_ANCHORS: Record<
  "creature" | "vibe" | "emoji" | "avatar",
  RegExp
> = {
  creature: /^- \*\*Creature:\*\*.*$/m,
  vibe: /^- \*\*Vibe:\*\*.*$/m,
  emoji: /^- \*\*Emoji:\*\*.*$/m,
  avatar: /^- \*\*Avatar:\*\*.*$/m,
};

function identityFieldLabel(
  field: keyof typeof IDENTITY_FIELD_ANCHORS,
): string {
  return field.charAt(0).toUpperCase() + field.slice(1);
}

async function handleUpdateIdentityField(
  deps: HandlerDeps,
  field: string,
  value: string,
): Promise<APIGatewayProxyResult> {
  const { target, tenantId } = deps;
  if (target.kind !== "agent") {
    return json(400, {
      ok: false,
      error: "update-identity-field requires agentId",
    });
  }
  // Service-auth (apikey) callers must present x-agent-id matching the
  // target agent. Mirrors the updateAgent mutation's authz guard —
  // without this, any apikey holder in the tenant can edit another
  // agent's IDENTITY.md personality fields.
  if (deps.auth.authType === "apikey") {
    if (!deps.auth.agentId || deps.auth.agentId !== target.agentId) {
      return json(403, {
        ok: false,
        error:
          "Service-auth callers must present x-agent-id matching the target agent",
      });
    }
  }
  if (!Object.prototype.hasOwnProperty.call(IDENTITY_FIELD_ANCHORS, field)) {
    return json(400, {
      ok: false,
      error: `Unknown identity field '${field}'. Allowed: creature, vibe, emoji, avatar.`,
    });
  }
  if (typeof value !== "string") {
    return json(400, { ok: false, error: "value must be a string" });
  }
  // Defensive sanitization — mirror writeIdentityMdForAgent's name-line
  // treatment. Newlines collapsed to spaces so a value can't inject
  // extra markdown bullets; the regex replacer function form prevents
  // `$&`, `$'`, `` $` ``, `$1` from expanding as backreferences.
  // Includes U+2028 LINE SEPARATOR + U+2029 PARAGRAPH SEPARATOR — these
  // are treated as line breaks by some Markdown renderers and can
  // otherwise inject a forged bullet past the \r\n guard.
  const safeValue = value.replace(/[\r\n\u2028\u2029]+/g, " ").trim();
  const typedField = field as keyof typeof IDENTITY_FIELD_ANCHORS;
  const anchor = IDENTITY_FIELD_ANCHORS[typedField];
  const label = identityFieldLabel(typedField);

  const identityKey = target.key("IDENTITY.md");
  let existing: string | null = null;
  try {
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: bucket(), Key: identityKey }),
    );
    existing = (await resp.Body?.transformToString("utf-8")) ?? "";
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    const status = (err as { $metadata?: { httpStatusCode?: number } } | null)
      ?.$metadata?.httpStatusCode;
    const isNotFound =
      err instanceof NoSuchKey ||
      name === "NoSuchKey" ||
      name === "NotFound" ||
      status === 404;
    if (!isNotFound) throw err;
  }

  if (!existing || !anchor.test(existing)) {
    return json(422, {
      ok: false,
      error: `IDENTITY.md is missing the ${label} line anchor; have your human rerun the template migration.`,
    });
  }

  const rendered = existing.replace(
    anchor,
    () => `- **${label}:** ${safeValue}`,
  );

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: identityKey,
      Body: rendered,
      ContentType: "text/plain; charset=utf-8",
    }),
  );
  return json(200, { ok: true });
}

async function handleRegenerateMap(
  deps: HandlerDeps,
): Promise<APIGatewayProxyResult> {
  const { target } = deps;
  if (target.kind !== "agent") {
    return json(400, { ok: false, error: "regenerate-map requires agentId" });
  }
  const { regenerateWorkspaceMap } =
    await import("./src/lib/workspace-map-generator.js");
  await regenerateWorkspaceMap(target.agentId);
  return json(200, { ok: true });
}

/**
 * Re-copy the agent's template + defaults into its S3 prefix in
 * `overwrite` mode. Operator-triggered: used to refresh an agent after
 * a template edit, or to recover an agent whose prefix drifted.
 *
 * Per docs/plans/2026-04-27-003: this replaces the old "accept template
 * update" pin-bump dance. Operator chooses per-agent; auto-propagation
 * is intentionally not a thing.
 */
async function handleRematerialize(
  deps: HandlerDeps,
): Promise<APIGatewayProxyResult> {
  const { target } = deps;
  if (target.kind !== "agent") {
    return json(400, { ok: false, error: "rematerialize requires agentId" });
  }
  const result = await bootstrapAgentWorkspace(target.agentId, {
    mode: "overwrite",
  });
  return json(200, { ok: true, ...result });
}

// ---------------------------------------------------------------------------
// Handler entry point
// ---------------------------------------------------------------------------

interface RequestBody {
  action?: string;
  agentId?: string;
  templateId?: string;
  computerId?: string;
  defaults?: boolean;
  path?: string;
  content?: string;
  acceptTemplateUpdate?: boolean;
  /**
   * Unit 7 (Strands container cold-start) needs composed content inline
   * with the list to avoid N round-trips. The composer returns it when
   * this flag is true.
   */
  includeContent?: boolean;
  /** For `update-identity-field`: creature | vibe | emoji | avatar. */
  field?: string;
  /** For `update-identity-field`: the new line content. */
  value?: string;
  /** For `create-sub-agent`: top-level sub-agent folder slug. */
  slug?: string;
  /** For `create-sub-agent`: seeded {slug}/CONTEXT.md content. */
  contextContent?: string;
  // Legacy shape — rejected loudly so buggy clients surface.
  tenantSlug?: string;
  instanceId?: string;
}

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  // Short-circuit CORS preflight BEFORE auth. The API Gateway forwards
  // OPTIONS to the Lambda on proxy integrations, so we have to answer
  // with a 2xx + CORS headers ourselves or browser preflight fails.
  const method = event.requestContext?.http?.method;
  if (method === "OPTIONS") {
    return corsPreflight();
  }

  if (!bucket()) {
    return json(500, { ok: false, error: "WORKSPACE_BUCKET not configured" });
  }

  const headers = normalizeHeaders(event.headers);
  const auth = await authenticate(headers);
  if (!auth) {
    return json(401, { ok: false, error: "Unauthorized" });
  }

  let body: RequestBody;
  try {
    body = event.body ? (JSON.parse(event.body) as RequestBody) : {};
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  if (body.tenantSlug !== undefined || body.instanceId !== undefined) {
    return json(400, {
      ok: false,
      error:
        "tenantSlug / instanceId are no longer accepted — send agentId, templateId, or defaults: true. Tenant is derived from the caller's token.",
    });
  }

  const { userId, tenantId } = await resolveCallerFromAuth(auth);
  if (!tenantId) {
    return json(401, { ok: false, error: "Could not resolve caller tenant" });
  }

  const action = body.action;
  if (!action) {
    return json(400, { ok: false, error: "action is required" });
  }

  const targetCount =
    (body.agentId ? 1 : 0) +
    (body.templateId ? 1 : 0) +
    (body.computerId ? 1 : 0) +
    (body.defaults ? 1 : 0);
  if (targetCount !== 1) {
    return json(400, {
      ok: false,
      error:
        "Exactly one of agentId, templateId, computerId, defaults is required",
    });
  }

  let target: Target | null = null;
  if (body.agentId) {
    target = await resolveAgentTarget(tenantId, body.agentId);
  } else if (body.templateId) {
    target = await resolveTemplateTarget(tenantId, body.templateId);
  } else if (body.computerId) {
    target = await resolveComputerTarget(tenantId, body.computerId);
  } else if (body.defaults) {
    target = await resolveDefaultsTarget(tenantId);
  }
  if (!target) {
    // 404 rather than 403 so the response doesn't leak whether a row
    // exists in another tenant.
    return json(404, { ok: false, error: "Target not found in your tenant" });
  }

  // Write actions require admin/owner role (U31). Reads stay open to any
  // tenant member. The apikey path bypasses the role check — it's the
  // platform-credential trust boundary used by the Strands container and
  // CI/ops bootstrap; per-tenant role doesn't apply.
  //
  // Use the resolved users.id, NOT auth.principalId. tenantMembers.principal_id
  // holds users.id, and Google-federated users have users.id ≠ Cognito sub.
  if (WRITE_ACTIONS.has(action) && auth.authType !== "apikey") {
    const isAdmin = await callerIsTenantAdmin(tenantId, userId);
    if (!isAdmin) {
      return json(403, {
        ok: false,
        error: "Caller is not a tenant admin or owner",
      });
    }
  }

  const deps: HandlerDeps = { auth, tenantId, target };

  try {
    switch (action) {
      case "get": {
        if (!body.path)
          return json(400, { ok: false, error: "path is required for get" });
        return await handleGet(deps, body.path);
      }
      case "list":
        return await handleList(deps, body.includeContent === true);
      case "put": {
        if (!body.path || body.content === undefined) {
          return json(400, {
            ok: false,
            error: "path and content are required for put",
          });
        }
        return await handlePut(
          deps,
          body.path,
          body.content,
          body.acceptTemplateUpdate === true,
        );
      }
      case "create-sub-agent": {
        if (!body.slug || body.contextContent === undefined) {
          return json(400, {
            ok: false,
            error: "slug and contextContent are required for create-sub-agent",
          });
        }
        return await handleCreateSubAgent(deps, body.slug, body.contextContent);
      }
      case "delete": {
        if (!body.path)
          return json(400, { ok: false, error: "path is required for delete" });
        return await handleDelete(deps, body.path);
      }
      case "regenerate-map":
        return await handleRegenerateMap(deps);
      case "rematerialize":
        return await handleRematerialize(deps);
      case "update-identity-field": {
        if (!body.field || body.value === undefined) {
          return json(400, {
            ok: false,
            error: "field and value are required for update-identity-field",
          });
        }
        return await handleUpdateIdentityField(
          deps,
          String(body.field),
          String(body.value),
        );
      }
      default:
        return json(400, { ok: false, error: `Unknown action: ${action}` });
    }
  } catch (err) {
    return json(500, {
      ok: false,
      error: `Workspace operation failed: ${errorMessage(err)}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeHeaders(
  raw: Record<string, string | undefined> | undefined,
): Record<string, string | undefined> {
  if (!raw) return {};
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key.toLowerCase()] = value;
    out[key] = value;
  }
  return out;
}

function isNoSuchKey(err: unknown): boolean {
  if (err instanceof NoSuchKey) return true;
  const name = (err as { name?: string } | null)?.name;
  return name === "NoSuchKey";
}

async function listPrefix(prefix: string): Promise<string[]> {
  const paths: string[] = [];
  let continuationToken: string | undefined;
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket(),
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of resp.Contents ?? []) {
      if (!obj.Key) continue;
      const rel = obj.Key.slice(prefix.length);
      if (!rel) continue;
      if (rel === "manifest.json") continue;
      if (rel === "_defaults_version") continue;
      paths.push(rel);
    }
    continuationToken = resp.IsTruncated
      ? resp.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return paths;
}

function errorMessage(err: unknown): string {
  if (!err || typeof err !== "object") return "unknown error";
  const name = (err as { name?: string }).name || "Error";
  const message = (err as { message?: string }).message || "";
  return message ? `${name}: ${message}` : name;
}

function defaultAgentsMd(): string {
  return `# AGENTS.md

## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
`;
}

// PINNED_FILES is re-exported for callers/tests that want to assert on
// the guardrail-class set without pulling in workspace-defaults directly.
export { PINNED_FILES };

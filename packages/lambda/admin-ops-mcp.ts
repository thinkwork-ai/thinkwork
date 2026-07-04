/**
 * Admin-Ops MCP Server — Lambda handler.
 *
 * Exposes Thinkwork admin operations as MCP tools over a stateless
 * Streamable-HTTP-style transport. Each POST is one JSON-RPC request;
 * the Lambda returns a single JSON-RPC response body. No session state.
 *
 * Wire protocol: https://spec.modelcontextprotocol.io/specification/basic/
 *
 * Supported methods (tool-server subset):
 *   - initialize              → server info + capabilities
 *   - notifications/initialized (no reply)
 *   - tools/list              → list of tools with JSON Schema
 *   - tools/call              → invoke one tool, return content block
 *   - ping                    → liveness check
 *
 * Auth: Bearer <API_AUTH_SECRET> in the Authorization header. The same
 * secret is reused to call the Thinkwork REST API downstream.
 *
 * This is the agent-facing surface of the @thinkwork/admin-ops package.
 * Keep tool definitions mechanical wrappers over imported functions.
 */

import { getConfig, getApiAuthSecret } from "@thinkwork/runtime-config";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { createHash } from "node:crypto";
import { eq, isNull, and } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { tenantMcpAdminKeys } from "@thinkwork/database-pg/schema";
import {
  commitRoutine,
  listGitRoutines,
  listRoutineRuns,
  readRoutineRepo,
  runRoutineFixtures,
  type CommitRoutineInput,
} from "./routine-repo-tools.js";
import { getAutomation, listAutomations } from "./automations-tools.js";
import {
  AdminOpsError,
  createClient,
  tenants as tenantOps,
  users as userOps,
  artifacts as artifactOps,
  routines as routineOps,
  workflows as workflowOps,
} from "@thinkwork/admin-ops";

const MCP_PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "thinkwork-admin-ops";
const SERVER_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// JSON-RPC types (minimal)
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const JsonRpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

function buildTools(auth: AuthResult): ToolDefinition[] {
  const apiUrl = getConfig("THINKWORK_API_URL") ?? "";
  const authSecret = getApiAuthSecret();

  // Tenant pinning: a tenant-scoped key forces tenantId on every downstream
  // call regardless of what the caller passed. A superuser (API_AUTH_SECRET)
  // falls back to the caller-supplied tenantId — reserved for bootstrap.
  //
  // Principal fallback: GraphQL resolvers gated on tenant-admin look up
  // ctx.auth.principalId against tenant_members. Resolve priority:
  //   1. args.principalId — MCP tool caller (Strands runtime) asserts the
  //      real invoking human. Matches the Python skill's CURRENT_USER_ID.
  //   2. auth.createdByUserId — the user the tenant's admin key was minted
  //      against (defaulted to the tenant's first owner on provision).
  //      Ensures every MCP call has some admin principal even when the
  //      caller doesn't thread one through.
  //   3. undefined — the apikey branch in authenticate() will set
  //      ctx.auth.principalId to null, and resolvers that require admin
  //      role will refuse. Expected behavior for unprovisioned keys.
  const clientFor = (args: Record<string, unknown>) => {
    const pinnedTenantId = auth.tenantId;
    const argTenantId =
      typeof args.tenantId === "string" ? args.tenantId : undefined;
    const tenantId = pinnedTenantId ?? argTenantId;

    const argPrincipalId =
      typeof args.principalId === "string" ? args.principalId : undefined;
    const principalId = argPrincipalId ?? auth.createdByUserId;

    return createClient({
      apiUrl,
      authSecret,
      principalId,
      principalEmail:
        typeof args.principalEmail === "string"
          ? args.principalEmail
          : undefined,
      tenantId,
      agentId: typeof args.agentId === "string" ? args.agentId : undefined,
    });
  };

  return [
    {
      name: "tenants_list",
      description:
        "List tenants (workspaces) visible to the caller. Returns id, name, slug, plan, createdAt for each.",
      inputSchema: {
        type: "object",
        properties: {
          principalId: {
            type: "string",
            description:
              "Invoking user's UUID (optional; used for audit attribution).",
          },
        },
        additionalProperties: false,
      },
      async handler(args) {
        return tenantOps.listTenants(clientFor(args));
      },
    },
    {
      name: "tenants_get",
      description:
        "Fetch a single tenant by id (UUID) or slug. Returns the full tenant record.",
      inputSchema: {
        type: "object",
        properties: {
          idOrSlug: {
            type: "string",
            description: "Tenant UUID or slug.",
          },
          principalId: {
            type: "string",
            description: "Invoking user's UUID (optional).",
          },
        },
        required: ["idOrSlug"],
        additionalProperties: false,
      },
      async handler(args) {
        const { idOrSlug } = args as { idOrSlug: string };
        const isUuid =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            idOrSlug,
          );
        const client = clientFor(args);
        return isUuid
          ? tenantOps.getTenant(client, idOrSlug)
          : tenantOps.getTenantBySlug(client, idOrSlug);
      },
    },
    {
      name: "tenants_update",
      description:
        "Update a tenant's name, plan, or issue_prefix. Returns the updated tenant record. At least one of name/plan/issue_prefix must be provided.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Tenant UUID." },
          name: { type: "string" },
          plan: {
            type: "string",
            description: "Plan tier (free, team, enterprise, …).",
          },
          issue_prefix: { type: "string" },
          principalId: {
            type: "string",
            description: "Invoking user's UUID (optional).",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
      async handler(args) {
        const { id, name, plan, issue_prefix } = args as {
          id: string;
          name?: string;
          plan?: string;
          issue_prefix?: string;
        };
        const input: Record<string, string> = {};
        if (name !== undefined) input.name = name;
        if (plan !== undefined) input.plan = plan;
        if (issue_prefix !== undefined) input.issue_prefix = issue_prefix;
        if (Object.keys(input).length === 0) {
          throw new Error(
            "At least one of name, plan, or issue_prefix is required",
          );
        }
        return tenantOps.updateTenant(clientFor(args), id, input);
      },
    },

    // -------------------------------------------------------------------
    // Self / user reads
    // -------------------------------------------------------------------
    {
      name: "me",
      description: "Return the caller's own User record.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async handler(args) {
        return userOps.me(clientFor(args));
      },
    },
    {
      name: "users_get",
      description: "Fetch a user by id.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "User UUID." } },
        required: ["id"],
        additionalProperties: false,
      },
      async handler(args) {
        return userOps.getUser(clientFor(args), (args as { id: string }).id);
      },
    },
    {
      name: "tenant_members_list",
      description:
        "List all members (role + status per principal) of a tenant.",
      inputSchema: {
        type: "object",
        properties: {
          tenantId: { type: "string", description: "Tenant UUID." },
        },
        required: ["tenantId"],
        additionalProperties: false,
      },
      async handler(args) {
        return userOps.listTenantMembers(
          clientFor(args),
          (args as { tenantId: string }).tenantId,
        );
      },
    },
    {
      name: "tenant_members_resend_invite",
      description:
        "Resend a pending Cognito invite email for a tenant member. Returns RESENT, NOT_PENDING, or DELIVERY_FAILED.",
      inputSchema: {
        type: "object",
        properties: {
          tenantId: {
            type: "string",
            description:
              "Tenant UUID (optional when the admin key already pins the tenant).",
          },
          memberId: { type: "string", description: "Tenant member UUID." },
          principalId: {
            type: "string",
            description:
              "Invoking user's UUID (optional; used for audit attribution).",
          },
        },
        required: ["memberId"],
        additionalProperties: false,
      },
      async handler(args) {
        const tenantId =
          auth.tenantId ??
          (typeof args.tenantId === "string" ? args.tenantId : undefined);
        if (!tenantId) {
          throw new Error(
            "tenantId is required when the admin key is not tenant-scoped",
          );
        }
        return userOps.resendMemberInvite(
          clientFor(args),
          tenantId,
          (args as { memberId: string }).memberId,
        );
      },
    },

    // -------------------------------------------------------------------
    // Artifact reads
    // -------------------------------------------------------------------
    {
      name: "artifacts_list",
      description:
        "List artifacts in a tenant, filterable by thread/agent/type/status.",
      inputSchema: {
        type: "object",
        properties: {
          tenantId: { type: "string" },
          threadId: { type: "string" },
          agentId: { type: "string" },
          type: { type: "string", description: "ArtifactType enum filter." },
          status: {
            type: "string",
            description: "ArtifactStatus enum filter.",
          },
          limit: { type: "integer" },
        },
        required: ["tenantId"],
        additionalProperties: false,
      },
      async handler(args) {
        return artifactOps.listArtifacts(
          clientFor(args),
          args as unknown as artifactOps.ListArtifactsInput,
        );
      },
    },
    {
      name: "artifacts_get",
      description: "Fetch an artifact by id.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      async handler(args) {
        return artifactOps.getArtifact(
          clientFor(args),
          (args as { id: string }).id,
        );
      },
    },

    // -------------------------------------------------------------------
    // Workflows (THNK-59 U9)
    // -------------------------------------------------------------------
    {
      name: "workflows_list",
      description:
        "List first-class ThinkWork workflows visible to the caller's agent, including readiness and capability flags. Does not expose backend Routine ids, Step Functions ARNs, n8n URLs, or CRM identifiers. Disabled until WORKFLOWS_AGENT_TOOLS_ENABLED or ROUTINES_AGENT_TOOLS_ENABLED is set on the runtime.",
      inputSchema: {
        type: "object",
        properties: {
          tenantId: {
            type: "string",
            description:
              "Tenant UUID (omit when the admin key already pins the tenant).",
          },
          agentId: {
            type: "string",
            description:
              "Caller's agent UUID. Used to include workflows private to this agent.",
          },
          principalId: {
            type: "string",
            description: "Invoking user's UUID (optional).",
          },
        },
        required: ["agentId"],
        additionalProperties: false,
      },
      async handler(args) {
        if (!workflowsAgentToolsEnabled()) {
          return notYetEnabled("workflows_list");
        }
        const a = args as { agentId: string };
        const client = clientFor(args);
        const tenantId = client.tenantId;
        if (!tenantId) {
          throw new Error(
            "tenantId required: pass via args or use a tenant-pinned admin key.",
          );
        }
        const workflows = await workflowOps.listWorkflows(client, { tenantId });
        return workflows.filter(
          (workflow) =>
            workflowOps.checkWorkflowVisibility(workflow, {
              tenantId,
              agentId: a.agentId,
            }).ok,
        );
      },
    },
    {
      name: "workflow_invoke",
      description:
        "Trigger a first-class ThinkWork workflow by workflowId. The workflow must be tenant-shared or private to the caller's agent. Returns the canonical workflow run; backend execution identifiers appear only as run evidence fields after creation. Disabled until WORKFLOWS_AGENT_TOOLS_ENABLED or ROUTINES_AGENT_TOOLS_ENABLED is set on the runtime.",
      inputSchema: {
        type: "object",
        properties: {
          tenantId: {
            type: "string",
            description:
              "Tenant UUID (omit when the admin key already pins the tenant).",
          },
          agentId: {
            type: "string",
            description:
              "Caller's agent UUID. Used for visibility check against agent-private workflows.",
          },
          workflowId: {
            type: "string",
            description: "ThinkWork workflow UUID to invoke.",
          },
          args: {
            type: "object",
            description: "Arbitrary JSON object passed to the workflow.",
            additionalProperties: true,
          },
          idempotencyKey: {
            type: "string",
            description:
              "Optional stable key for API/agent retry deduplication.",
          },
          principalId: {
            type: "string",
            description: "Invoking user's UUID (optional).",
          },
        },
        required: ["agentId", "workflowId"],
        additionalProperties: false,
      },
      async handler(args) {
        if (!workflowsAgentToolsEnabled()) {
          return notYetEnabled("workflow_invoke");
        }
        const a = args as {
          agentId: string;
          workflowId: string;
          args?: Record<string, unknown>;
          idempotencyKey?: string;
        };
        const client = clientFor(args);
        const tenantId = client.tenantId;
        if (!tenantId) {
          throw new Error(
            "tenantId required: pass via args or use a tenant-pinned admin key.",
          );
        }
        const workflow = await workflowOps.getWorkflow(client, a.workflowId);
        const visibility = workflowOps.checkWorkflowVisibility(workflow, {
          tenantId,
          agentId: a.agentId,
        });
        if (!visibility.ok) {
          throw new Error(
            `workflow_invoke denied: ${visibility.reason} (workflowId=${a.workflowId}, agentId=${a.agentId})`,
          );
        }
        return workflowOps.triggerWorkflowRun(client, {
          workflowId: a.workflowId,
          args: a.args,
          agentId: a.agentId,
          idempotencyKey: a.idempotencyKey,
        });
      },
    },

    // -------------------------------------------------------------------
    // Routines (Plan 2026-05-01-006 §U11)
    // -------------------------------------------------------------------
    // Both tools are inert by default. ROUTINES_AGENT_TOOLS_ENABLED=true
    // flips them live. The pattern lets the code merge before the agent
    // runtime warm-flush — agents see the tools in tools/list but every
    // tools/call returns `not_yet_enabled` until the env flag flips,
    // avoiding a half-rolled-out window where agents try to invoke
    // tools that aren't ready.
    //
    // Visibility: agent_private routines are gated on owningAgentId;
    // tenant_shared routines are callable by any agent in the tenant.
    // routine_invoke runs checkRoutineVisibility before delegating to
    // triggerRoutineRun.
    {
      name: "create_routine",
      description:
        "DEPRECATED alias for the git birth flow (deterministic routines v1). Author a Python module (def run(input: dict) -> dict) plus at least one fixture, dry-run them with routine_run_fixtures, then commit + register with routine_repo_commit. This tool only returns those instructions. Disabled until ROUTINES_AGENT_TOOLS_ENABLED is set on the runtime.",
      inputSchema: {
        type: "object",
        properties: {
          tenantId: {
            type: "string",
            description:
              "Tenant UUID (omit when the admin key already pins the tenant).",
          },
          agentId: {
            type: "string",
            description:
              "Caller's agent UUID. The routine is stamped private to this agent.",
          },
          name: {
            type: "string",
            description: "Operator-facing routine name.",
          },
          description: {
            type: "string",
            description: "Optional one-line description.",
          },
          intent: {
            type: "string",
            description:
              "Natural-language description of the work. Becomes the markdown summary's intent line.",
          },
          suggestedSteps: {
            type: "array",
            items: { type: "string" },
            description: "Optional ordered list of step descriptions.",
          },
          principalId: {
            type: "string",
            description: "Invoking user's UUID (optional).",
          },
        },
        required: ["agentId", "name", "intent"],
        additionalProperties: false,
      },
      async handler(args) {
        if (!routinesAgentToolsEnabled()) {
          return notYetEnabled("create_routine");
        }
        void args;
        return {
          status: "use_git_birth_flow",
          message:
            "Routines are git-backed now. Author routines/<slug>/main.py exposing " +
            "def run(input: dict) -> dict plus at least one fixture " +
            "(routines/<slug>/fixtures/*.json with {input, expected, mode: exact|shape}), " +
            "dry-run via routine_run_fixtures {files}, then commit + register via " +
            "routine_repo_commit {register, files, parentSha, message}.",
        };
      },
    },
    {
      name: "routine_invoke",
      description:
        "Trigger a routine execution. The routine must be owned by the caller's agent (agent_private by owningAgentId) or tenant-shared. Returns a routine execution lite (id, status, triggerSource, startedAt). Disabled until ROUTINES_AGENT_TOOLS_ENABLED is set on the runtime.",
      inputSchema: {
        type: "object",
        properties: {
          tenantId: {
            type: "string",
            description:
              "Tenant UUID (omit when the admin key already pins the tenant).",
          },
          agentId: {
            type: "string",
            description:
              "Caller's agent UUID. Used for visibility check against the routine's owning agentId.",
          },
          routineId: {
            type: "string",
            description: "Routine UUID to invoke.",
          },
          args: {
            type: "object",
            description:
              "Arbitrary input passed to the SFN execution as $$.Execution.Input.",
            additionalProperties: true,
          },
          principalId: {
            type: "string",
            description: "Invoking user's UUID (optional).",
          },
        },
        required: ["agentId", "routineId"],
        additionalProperties: false,
      },
      async handler(args) {
        if (!routinesAgentToolsEnabled()) {
          return notYetEnabled("routine_invoke");
        }
        const a = args as {
          tenantId?: string;
          agentId: string;
          routineId: string;
          args?: Record<string, unknown>;
        };
        const client = clientFor(args);
        const tenantId = client.tenantId;
        if (!tenantId) {
          throw new Error(
            "tenantId required: pass via args or use a tenant-pinned admin key.",
          );
        }
        const routine = await routineOps.getRoutine(client, a.routineId);
        const visibility = routineOps.checkRoutineVisibility(routine, {
          tenantId,
          agentId: a.agentId,
        });
        if (!visibility.ok) {
          throw new Error(
            `routine_invoke denied: ${visibility.reason} (routineId=${a.routineId}, agentId=${a.agentId})`,
          );
        }
        return routineOps.triggerRoutineRun(client, {
          routineId: a.routineId,
          args: a.args,
        });
      },
    },

    // -------------------------------------------------------------------
    // Deterministic routines — git-backed lifecycle suite
    // (plan 2026-07-03-004 U6, KTD-5). Invariants R9/R15/R16/R18/R20 are
    // enforced server-side in routine-repo-tools.ts at the commit seam.
    // -------------------------------------------------------------------
    {
      name: "routine_repo_list",
      description:
        "List the tenant's git-backed deterministic routines: id, name, module path, fixture paths, credential refs, validated SHA, enabled state, and disable reason. Disabled until ROUTINES_AGENT_TOOLS_ENABLED is set on the runtime.",
      inputSchema: {
        type: "object",
        properties: {
          tenantId: {
            type: "string",
            description:
              "Tenant UUID (omit when the admin key already pins the tenant).",
          },
          principalId: {
            type: "string",
            description: "Invoking user's UUID (optional).",
          },
        },
        additionalProperties: false,
      },
      async handler(args) {
        if (!routinesAgentToolsEnabled()) {
          return notYetEnabled("routine_repo_list");
        }
        const tenantId = requireTenantId(clientFor(args));
        return listGitRoutines(tenantId);
      },
    },
    {
      name: "routine_repo_read",
      description:
        "Read a git-backed routine's code and fixtures from the tenant repo (at branch HEAD, or a specific ref). Returns the ref that was read plus each file's content — commit against that ref as parentSha. Disabled until ROUTINES_AGENT_TOOLS_ENABLED is set on the runtime.",
      inputSchema: {
        type: "object",
        properties: {
          tenantId: {
            type: "string",
            description: "Tenant UUID (optional with a pinned key).",
          },
          routineId: { type: "string", description: "Routine UUID." },
          ref: {
            type: "string",
            description: "Commit SHA or ref to read; defaults to branch HEAD.",
          },
          principalId: {
            type: "string",
            description: "Invoking user's UUID (optional).",
          },
        },
        required: ["routineId"],
        additionalProperties: false,
      },
      async handler(args) {
        if (!routinesAgentToolsEnabled()) {
          return notYetEnabled("routine_repo_read");
        }
        const a = args as { routineId: string; ref?: string };
        const tenantId = requireTenantId(clientFor(args));
        return readRoutineRepo({
          tenantId,
          routineId: a.routineId,
          ref: a.ref,
        });
      },
    },
    {
      name: "routine_run_fixtures",
      description:
        "Run a routine's fixtures. With `files` (path → content, module + fixtures), dry-runs your WORKING content before committing — this is the same code path as the production fixture gate, so green here means green at the gate. Without `files`, gates the repo branch HEAD. Disabled until ROUTINES_AGENT_TOOLS_ENABLED is set on the runtime.",
      inputSchema: {
        type: "object",
        properties: {
          tenantId: {
            type: "string",
            description: "Tenant UUID (optional with a pinned key).",
          },
          routineId: { type: "string", description: "Routine UUID." },
          files: {
            type: "object",
            description:
              "Working files keyed by repo path (module + fixture JSON files). Omit to gate the repo HEAD.",
            additionalProperties: { type: "string" },
          },
          modulePath: {
            type: "string",
            description:
              "Module path within files (defaults to the routine's registered module path).",
          },
          principalId: {
            type: "string",
            description: "Invoking user's UUID (optional).",
          },
        },
        required: ["routineId"],
        additionalProperties: false,
      },
      async handler(args) {
        if (!routinesAgentToolsEnabled()) {
          return notYetEnabled("routine_run_fixtures");
        }
        const a = args as {
          routineId: string;
          files?: Record<string, string>;
          modulePath?: string;
        };
        const tenantId = requireTenantId(clientFor(args));
        return runRoutineFixtures({
          tenantId,
          routineId: a.routineId,
          files: a.files,
          modulePath: a.modulePath,
        });
      },
    },
    {
      name: "routine_repo_commit",
      description:
        "Commit routine files to the tenant repo and (for new routines) register the routine. Composite + atomic: commits against a stated parentSha (conflict if the branch moved — never force), requires at least one fixture for NEW routines, requires the initiating operator's principalId for birth-path commits, and in repair mode accepts code-only changes referencing a failed execution — repairs outside the auto-publish envelope (new imports, new network primitives, large diffs) land on a pending branch with an operator-approval inbox item instead of the live branch. In-envelope repair commits run the fixture gate synchronously and return its verdict. Disabled until ROUTINES_AGENT_TOOLS_ENABLED is set on the runtime.",
      inputSchema: {
        type: "object",
        properties: {
          tenantId: {
            type: "string",
            description: "Tenant UUID (optional with a pinned key).",
          },
          principalId: {
            type: "string",
            description:
              "Initiating operator's user UUID — REQUIRED for birth-path (non-repair) commits (R20).",
          },
          routineId: {
            type: "string",
            description:
              "Existing routine UUID (omit with `register` for a new routine).",
          },
          register: {
            type: "object",
            description: "Birth registration metadata for a NEW routine.",
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              modulePath: {
                type: "string",
                description: "e.g. routines/<slug>/main.py",
              },
              fixturePaths: {
                type: "array",
                items: { type: "string" },
                description:
                  "Repo paths of the fixture files (at least one, included in files).",
              },
              credentialRefs: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    alias: { type: "string" },
                    credentialId: { type: "string" },
                  },
                  required: ["alias", "credentialId"],
                  additionalProperties: false,
                },
                description:
                  "Named tenant credentials the routine declares; only these are injected into its sandbox (R19).",
              },
            },
            required: ["name", "modulePath", "fixturePaths"],
            additionalProperties: false,
          },
          files: {
            type: "object",
            description: "Files to write, repo path → content.",
            additionalProperties: { type: "string" },
          },
          message: { type: "string", description: "Commit summary line." },
          parentSha: {
            type: "string",
            description:
              "Branch HEAD you read (routine_repo_read returns it). The commit applies only if the branch is still there.",
          },
          repair: {
            type: "object",
            description:
              "Repair mode: code-only fix for a failed execution. Accepted only when executionId references a failed run of this routine.",
            properties: {
              executionId: { type: "string" },
              threadRef: { type: "string" },
            },
            required: ["executionId"],
            additionalProperties: false,
          },
        },
        required: ["files", "message", "parentSha"],
        additionalProperties: false,
      },
      async handler(args) {
        if (!routinesAgentToolsEnabled()) {
          return notYetEnabled("routine_repo_commit");
        }
        const tenantId = requireTenantId(clientFor(args));
        const a = args as unknown as Omit<CommitRoutineInput, "tenantId"> & {
          principalId?: string;
        };
        return commitRoutine({
          ...a,
          tenantId,
          principalId: a.principalId ?? auth.createdByUserId ?? null,
        });
      },
    },
    {
      name: "routine_runs",
      description:
        "List a git-backed routine's recent executions with status, commit SHA, cache-served flag, and error detail — the context a repair needs. Disabled until ROUTINES_AGENT_TOOLS_ENABLED is set on the runtime.",
      inputSchema: {
        type: "object",
        properties: {
          tenantId: {
            type: "string",
            description: "Tenant UUID (optional with a pinned key).",
          },
          routineId: { type: "string", description: "Routine UUID." },
          limit: {
            type: "number",
            description: "Max rows (default 10, cap 50).",
          },
          principalId: {
            type: "string",
            description: "Invoking user's UUID (optional).",
          },
        },
        required: ["routineId"],
        additionalProperties: false,
      },
      async handler(args) {
        if (!routinesAgentToolsEnabled()) {
          return notYetEnabled("routine_runs");
        }
        const a = args as { routineId: string; limit?: number };
        const tenantId = requireTenantId(clientFor(args));
        return listRoutineRuns({
          tenantId,
          routineId: a.routineId,
          limit: a.limit,
        });
      },
    },

    // -------------------------------------------------------------------
    // Automations — read-only agent view (THINK-137 U9, R15). Both tools
    // are inert until AUTOMATIONS_AGENT_TOOLS_ENABLED=true on the runtime
    // (same ship-inert pattern as the routine tools). Tenant-scoped on
    // every query; no create/update/trigger tools (deferred).
    // -------------------------------------------------------------------
    {
      name: "automations_list",
      description:
        "READ-ONLY. List the tenant's Automations (agent loops): id, name, enabled, trigger family+source, target kind+label, run-as user, space, and last run {id,status,at}. Tenant-scoped. Disabled until AUTOMATIONS_AGENT_TOOLS_ENABLED is set on the runtime.",
      inputSchema: {
        type: "object",
        properties: {
          tenantId: {
            type: "string",
            description:
              "Tenant UUID (omit when the admin key already pins the tenant).",
          },
          principalId: {
            type: "string",
            description: "Invoking user's UUID (optional).",
          },
        },
        additionalProperties: false,
      },
      async handler(args) {
        if (!automationsAgentToolsEnabled()) {
          return notYetEnabled("automations_list");
        }
        const tenantId = requireTenantId(clientFor(args));
        return listAutomations({ tenantId });
      },
    },
    {
      name: "automation_get",
      description:
        "READ-ONLY. Fetch one Automation (agent loop) by id: the list shape plus description, current-version target detail, and recentRuns (last ~10: id, status, triggerFamily, triggerSource, createdAt, finishedAt, errorCode, errorMessage). Tenant-scoped. Disabled until AUTOMATIONS_AGENT_TOOLS_ENABLED is set on the runtime.",
      inputSchema: {
        type: "object",
        properties: {
          tenantId: {
            type: "string",
            description: "Tenant UUID (optional with a pinned key).",
          },
          automationId: {
            type: "string",
            description: "Automation (agent loop) UUID.",
          },
          principalId: {
            type: "string",
            description: "Invoking user's UUID (optional).",
          },
        },
        required: ["automationId"],
        additionalProperties: false,
      },
      async handler(args) {
        if (!automationsAgentToolsEnabled()) {
          return notYetEnabled("automation_get");
        }
        const a = args as { automationId: string };
        const tenantId = requireTenantId(clientFor(args));
        return getAutomation({ tenantId, automationId: a.automationId });
      },
    },
  ];
}

function requireTenantId(client: { tenantId?: string }): string {
  if (!client.tenantId) {
    throw new Error(
      "tenantId required: pass via args or use a tenant-pinned admin key.",
    );
  }
  return client.tenantId;
}

// ---------------------------------------------------------------------------
// Phase C U11: agent-tool gate
// ---------------------------------------------------------------------------

function routinesAgentToolsEnabled(): boolean {
  return getConfig("ROUTINES_AGENT_TOOLS_ENABLED") === "true";
}

function workflowsAgentToolsEnabled(): boolean {
  return (
    getConfig("WORKFLOWS_AGENT_TOOLS_ENABLED") === "true" ||
    routinesAgentToolsEnabled()
  );
}

// THINK-137 U9 (R15): read-only Automation tools gate. Mirrors the routine
// gate exactly (getConfig() === "true"), landed in the same runtime
// config_env map (handlers.tf).
function automationsAgentToolsEnabled(): boolean {
  return getConfig("AUTOMATIONS_AGENT_TOOLS_ENABLED") === "true";
}

function notYetEnabled(toolName: string): {
  error: "not_yet_enabled";
  tool: string;
  message: string;
} {
  return {
    error: "not_yet_enabled",
    tool: toolName,
    message: `${toolName} is defined but disabled — flip its agent-tools env flag (e.g. WORKFLOWS_AGENT_TOOLS_ENABLED, ROUTINES_AGENT_TOOLS_ENABLED, or AUTOMATIONS_AGENT_TOOLS_ENABLED) to "true" on the runtime to activate.`,
  };
}

// ---------------------------------------------------------------------------
// JSON-RPC method dispatch
// ---------------------------------------------------------------------------

async function dispatch(
  req: JsonRpcRequest,
  tools: ToolDefinition[],
): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;

  // Notifications carry no id and expect no reply.
  const isNotification = req.id === undefined;

  try {
    switch (req.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          },
        };

      case "notifications/initialized":
        return null;

      case "ping":
        return { jsonrpc: "2.0", id, result: {} };

      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          },
        };

      case "tools/call": {
        const params = req.params as
          | { name?: string; arguments?: Record<string, unknown> }
          | undefined;
        const toolName = params?.name;
        const toolArgs = params?.arguments ?? {};
        if (!toolName) {
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: JsonRpcErrorCode.InvalidParams,
              message: "tools/call requires params.name",
            },
          };
        }
        const tool = tools.find((t) => t.name === toolName);
        if (!tool) {
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: JsonRpcErrorCode.MethodNotFound,
              message: `Unknown tool: ${toolName}`,
            },
          };
        }
        try {
          const result = await tool.handler(toolArgs);
          // MCP content block — tool result as JSON text so the model can parse.
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify(result) }],
              isError: false,
            },
          };
        } catch (err) {
          // Tool-level errors come back as isError=true content per MCP spec —
          // the client/LLM sees the failure but the RPC itself succeeds.
          const message =
            err instanceof AdminOpsError
              ? `${err.message} (HTTP ${err.status})`
              : err instanceof Error
                ? err.message
                : String(err);
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: message }],
              isError: true,
            },
          };
        }
      }

      default:
        if (isNotification) return null;
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: JsonRpcErrorCode.MethodNotFound,
            message: `Method not found: ${req.method}`,
          },
        };
    }
  } catch (err: unknown) {
    if (isNotification) return null;
    const message = err instanceof Error ? err.message : String(err);
    return {
      jsonrpc: "2.0",
      id,
      error: { code: JsonRpcErrorCode.InternalError, message },
    };
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function extractBearer(event: APIGatewayProxyEventV2): string | null {
  const h = event.headers ?? {};
  const raw = h["authorization"] ?? h["Authorization"];
  if (!raw) return null;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1]! : null;
}

export interface AuthResult {
  ok: true;
  /** Present for tenant-scoped keys; absent for break-glass admin-secret callers. */
  tenantId?: string;
  /** Key row id, when authenticated via tenant_mcp_admin_keys. */
  keyId?: string;
  /**
   * User the key was minted against — typically the tenant owner that ran
   * `thinkwork mcp provision`. Forwarded to downstream REST/GraphQL calls
   * as `x-principal-id` when the MCP tool caller doesn't supply their
   * own. Without it, resolvers gated on tenant-admin (tenant_members
   * lookup against ctx.auth.principalId) would refuse every call.
   */
  createdByUserId?: string;
  /** True when the caller used the shared API_AUTH_SECRET (cross-tenant access). */
  superuser: boolean;
}

/**
 * Authenticate the caller.
 *
 * Order:
 *   1. Bearer matches a live (non-revoked) row in tenant_mcp_admin_keys
 *      → tenant-scoped auth. `tenantId` is populated.
 *   2. Bearer matches getApiAuthSecret()→ break-glass superuser.
 *      No tenant pinning; reserved for bootstrap + ops debugging.
 *   3. Anything else → null (401).
 */
async function authenticate(
  event: APIGatewayProxyEventV2,
): Promise<AuthResult | null> {
  const token = extractBearer(event);
  if (!token) return null;

  const hash = createHash("sha256").update(token).digest("hex");
  try {
    const db = getDb();
    const [row] = await db
      .select({
        id: tenantMcpAdminKeys.id,
        tenant_id: tenantMcpAdminKeys.tenant_id,
        created_by_user_id: tenantMcpAdminKeys.created_by_user_id,
      })
      .from(tenantMcpAdminKeys)
      .where(
        and(
          eq(tenantMcpAdminKeys.key_hash, hash),
          isNull(tenantMcpAdminKeys.revoked_at),
        ),
      )
      .limit(1);
    if (row) {
      // Best-effort last_used_at bump — failure to update MUST NOT block auth.
      db.update(tenantMcpAdminKeys)
        .set({ last_used_at: new Date() })
        .where(eq(tenantMcpAdminKeys.id, row.id))
        .catch((err: unknown) => {
          console.warn("admin-ops-mcp: last_used_at bump failed", err);
        });
      return {
        ok: true,
        tenantId: row.tenant_id,
        keyId: row.id,
        createdByUserId: row.created_by_user_id ?? undefined,
        superuser: false,
      };
    }
  } catch (err: unknown) {
    // DB unavailable — fall through to superuser check so break-glass still
    // works during partial outages. Log so operators know the index path
    // is degraded.
    console.error(
      "admin-ops-mcp: key lookup failed (falling back to superuser check)",
      err,
    );
  }

  const superSecret = getApiAuthSecret();
  if (superSecret && token === superSecret) {
    return { ok: true, superuser: true };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------

function httpJson(
  status: number,
  body: unknown,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, x-tenant-id, x-api-key",
    },
    body: JSON.stringify(body),
  };
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;

  if (method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, x-tenant-id, x-api-key",
      },
      body: "",
    };
  }

  if (method !== "POST") {
    return httpJson(405, { error: "Method not allowed — POST only" });
  }

  const auth = await authenticate(event);
  if (!auth) {
    return httpJson(401, { error: "Unauthorized" });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.body ?? "");
  } catch {
    return httpJson(200, {
      jsonrpc: "2.0",
      id: null,
      error: { code: JsonRpcErrorCode.ParseError, message: "Invalid JSON" },
    });
  }

  const tools = buildTools(auth);

  // Single request or batch
  if (Array.isArray(parsed)) {
    const responses = (
      await Promise.all(
        (parsed as JsonRpcRequest[]).map((r) => dispatch(r, tools)),
      )
    ).filter((r): r is JsonRpcResponse => r !== null);
    return httpJson(200, responses);
  }

  const response = await dispatch(parsed as JsonRpcRequest, tools);
  if (response === null) {
    // Notification — HTTP 202 per JSON-RPC over HTTP convention, empty body.
    return {
      statusCode: 202,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: "",
    };
  }
  return httpJson(200, response);
}

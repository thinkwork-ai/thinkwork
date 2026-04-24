/**
 * sandbox-preflight — shared helper every Strands-runtime caller (chat-
 * agent-invoke, wakeup-processor, composition dispatch, self-serve tools)
 * uses to decide whether the sandbox tool should be registered for this
 * invocation (plan Unit 9).
 *
 * Returns a discriminated union with four outcomes:
 *
 *   - "not-requested" — template.sandbox is null (no opt-in)
 *   - "disabled"      — tenant.sandbox_enabled is false
 *   - "provisioning"  — sandbox_enabled=true but the interpreter id for
 *                       the requested environment is null
 *   - "ready"         — register execute_code; result carries the
 *                       interpreter_id + environment the Strands
 *                       container uses to start the session
 *
 * Historical note: v1 also had a "missing-connection" outcome for the
 * now-retired OAuth preamble path. The sandbox no longer injects tokens
 * into os.environ — agents that need OAuth-ed work call composable-
 * skill connector scripts. See docs/plans/2026-04-23-006-refactor-
 * sandbox-drop-required-connections-plan.md.
 */

import { eq } from "drizzle-orm";
import { getDb, schema } from "@thinkwork/database-pg";

const { tenants } = schema;

export type SandboxEnvironmentId = "default-public" | "internal-only";

export interface TemplateSandboxConfig {
  environment: SandboxEnvironmentId;
}

/**
 * Which caller is asking for a preflight. `execute_code` is the historical
 * path — the agent's direct code-execution tool. `skill_dispatch` is the
 * new unified dispatcher (plan #007 §U4) that runs every skill-with-scripts
 * in the same sandbox. Semantics today are identical; surfacing the caller
 * gives logs + metrics enough context to separate sandbox-tool usage from
 * skill-dispatch usage once U5+ wires dispatch into the runtime.
 */
export type SandboxPreflightCaller = "execute_code" | "skill_dispatch";

export interface SandboxPreflightInput {
  stage: string;
  tenantId: string;
  agentId: string;
  /** The user on whose behalf the agent is running. */
  userId: string;
  /** template.sandbox as validated by Unit 3; null = template did not opt in. */
  templateSandbox: TemplateSandboxConfig | null;
  /**
   * Which caller asked for the preflight. Defaults to `execute_code` for
   * backwards compatibility with every pre-V1 call site. Dispatcher paths
   * set this to `skill_dispatch`.
   */
  caller?: SandboxPreflightCaller;
}

export type SandboxPreflightResult =
  | {
      status: "not-requested";
      reason: "template_did_not_opt_in";
      caller: SandboxPreflightCaller;
    }
  | {
      status: "disabled";
      reason: "tenant_sandbox_disabled";
      caller: SandboxPreflightCaller;
    }
  | {
      status: "provisioning";
      reason: "interpreter_not_ready";
      environment: SandboxEnvironmentId;
      caller: SandboxPreflightCaller;
    }
  | {
      status: "ready";
      environment: SandboxEnvironmentId;
      interpreterId: string;
      caller: SandboxPreflightCaller;
    };

/**
 * Run the pre-flight check. The caller threads the result fields into
 * the Strands invocation payload (sandbox_interpreter_id +
 * sandbox_environment). server.py + invocation_env.py consume them and
 * start the per-turn session inside the container.
 */
export async function checkSandboxPreflight(
  input: SandboxPreflightInput,
): Promise<SandboxPreflightResult> {
  const caller: SandboxPreflightCaller = input.caller ?? "execute_code";

  if (!input.templateSandbox) {
    return {
      status: "not-requested",
      reason: "template_did_not_opt_in",
      caller,
    };
  }
  const { environment } = input.templateSandbox;

  // 1. Tenant policy gate.
  const [tenant] = await getDb()
    .select({
      sandbox_enabled: tenants.sandbox_enabled,
      sandbox_interpreter_public_id: tenants.sandbox_interpreter_public_id,
      sandbox_interpreter_internal_id: tenants.sandbox_interpreter_internal_id,
    })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId))
    .limit(1);
  if (!tenant || !tenant.sandbox_enabled) {
    return { status: "disabled", reason: "tenant_sandbox_disabled", caller };
  }

  // 2. Interpreter-ready gate, independent of sandbox_enabled (plan R-Q10).
  const interpreterId =
    environment === "default-public"
      ? tenant.sandbox_interpreter_public_id
      : tenant.sandbox_interpreter_internal_id;
  if (!interpreterId) {
    return {
      status: "provisioning",
      reason: "interpreter_not_ready",
      environment,
      caller,
    };
  }

  return { status: "ready", environment, interpreterId, caller };
}

/**
 * Thread a ready pre-flight result into the Strands invocation payload.
 * The container's invocation_env sets SANDBOX_INTERPRETER_ID +
 * SANDBOX_ENVIRONMENT on os.environ; server.py reads them and starts
 * the per-turn session.
 */
export function applySandboxPayloadFields(
  payload: Record<string, unknown>,
  result: SandboxPreflightResult,
): void {
  if (result.status !== "ready") return;
  payload.sandbox_interpreter_id = result.interpreterId;
  payload.sandbox_environment = result.environment;
}

// ---------------------------------------------------------------------------
// Pure classifier — exported so tests exercise the decision tree without
// needing a live DB. Used by integration tests that want to assert a
// shape without hitting AWS.
// ---------------------------------------------------------------------------

export interface ClassifierInput {
  templateSandbox: TemplateSandboxConfig | null;
  tenant: {
    sandboxEnabled: boolean;
    interpreterPublicId: string | null;
    interpreterInternalId: string | null;
  } | null;
}

export type ClassifierResult =
  | { status: "not-requested" }
  | { status: "disabled" }
  | {
      status: "provisioning";
      environment: SandboxEnvironmentId;
    }
  | {
      status: "ready";
      environment: SandboxEnvironmentId;
      interpreterId: string;
    };

export function classifyPreflight(input: ClassifierInput): ClassifierResult {
  if (!input.templateSandbox) return { status: "not-requested" };
  const { environment } = input.templateSandbox;

  if (!input.tenant || !input.tenant.sandboxEnabled) {
    return { status: "disabled" };
  }
  const interpreterId =
    environment === "default-public"
      ? input.tenant.interpreterPublicId
      : input.tenant.interpreterInternalId;
  if (!interpreterId) {
    return { status: "provisioning", environment };
  }
  return { status: "ready", environment, interpreterId };
}

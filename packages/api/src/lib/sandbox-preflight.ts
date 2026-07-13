/**
 * sandbox-preflight — shared helper every runtime caller (chat-
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
 *                       interpreter_id + environment the runtime
 *                       uses to start the session
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
  /**
   * THINK-280 U4 — the selection axis for the capability-private VPC-mode
   * interpreter. Derived by the caller from the SIGNED capabilities manifest:
   * true only when an executable capability projection is requested for this
   * invocation. When true, the capability-private interpreter is selected
   * instead of the template environment and the result FAILS CLOSED (never
   * falls back to `default-public`) if the interpreter is not provisioned or
   * the tenant sandbox is disabled. Absent/false ⇒ existing template-env
   * behavior, untouched.
   */
  requestedCapabilityPrivate?: boolean;
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
    }
  | {
      // THINK-280 U4 — capability-private selected and provisioned. The caller
      // opens a broker session (U7) and threads the interpreter + bootstrap as
      // the `capability_private_session` dispatch field.
      status: "capability-private-ready";
      interpreterId: string;
      caller: SandboxPreflightCaller;
    }
  | {
      // THINK-280 U4 — capability-private requested but unavailable. FAIL
      // CLOSED: the caller must surface an error, never fall back to
      // `default-public`. `reason` distinguishes a disabled tenant from an
      // un-provisioned capability-private interpreter.
      status: "capability-private-unavailable";
      reason: "tenant_sandbox_disabled" | "interpreter_not_provisioned";
      caller: SandboxPreflightCaller;
    };

/**
 * Run the pre-flight check. The caller threads the result fields into
 * the runtime invocation payload (sandbox_interpreter_id +
 * sandbox_environment). The runtime consumes them and starts the per-turn
 * session inside the container.
 */
export async function checkSandboxPreflight(
  input: SandboxPreflightInput,
): Promise<SandboxPreflightResult> {
  const caller: SandboxPreflightCaller = input.caller ?? "execute_code";

  // THINK-280 U4 — capability-private is a per-invocation selection derived
  // from the signed manifest, independent of the template environment. It
  // takes precedence and FAILS CLOSED — never falling back to default-public.
  if (input.requestedCapabilityPrivate) {
    const [tenant] = await getDb()
      .select({
        sandbox_enabled: tenants.sandbox_enabled,
        sandbox_interpreter_capability_private_id:
          tenants.sandbox_interpreter_capability_private_id,
      })
      .from(tenants)
      .where(eq(tenants.id, input.tenantId))
      .limit(1);
    if (!tenant || !tenant.sandbox_enabled) {
      return {
        status: "capability-private-unavailable",
        reason: "tenant_sandbox_disabled",
        caller,
      };
    }
    const interpreterId = tenant.sandbox_interpreter_capability_private_id;
    if (!interpreterId) {
      return {
        status: "capability-private-unavailable",
        reason: "interpreter_not_provisioned",
        caller,
      };
    }
    return { status: "capability-private-ready", interpreterId, caller };
  }

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
 * Thread a ready pre-flight result into the runtime invocation payload.
 * The runtime uses SANDBOX_INTERPRETER_ID + SANDBOX_ENVIRONMENT to start
 * the per-turn session.
 *
 * THINK-280 U4: capability-private results (`capability-private-ready` /
 * `capability-private-unavailable`) are intentionally a NO-OP here — the
 * capability-private interpreter reaches the runtime through the
 * `capability_private_session` dispatch field, which is assembled only after
 * a broker session is opened (U7). Applying the template `sandbox_environment`
 * fields for a capability-private selection would be wrong, so this helper
 * only ever touches the `ready` (template-env) outcome.
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
    /**
     * THINK-280 U4 — the capability-private VPC-mode interpreter id. Optional
     * so existing callers that never touch capability-private keep compiling.
     */
    interpreterCapabilityPrivateId?: string | null;
  } | null;
  /** THINK-280 U4 — see SandboxPreflightInput.requestedCapabilityPrivate. */
  requestedCapabilityPrivate?: boolean;
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
    }
  | { status: "capability-private-ready"; interpreterId: string }
  | {
      status: "capability-private-unavailable";
      reason: "tenant_sandbox_disabled" | "interpreter_not_provisioned";
    };

export function classifyPreflight(input: ClassifierInput): ClassifierResult {
  // THINK-280 U4 — capability-private selection takes precedence and fails
  // closed (no fallback to default-public), independent of templateSandbox.
  if (input.requestedCapabilityPrivate) {
    if (!input.tenant || !input.tenant.sandboxEnabled) {
      return {
        status: "capability-private-unavailable",
        reason: "tenant_sandbox_disabled",
      };
    }
    const interpreterId = input.tenant.interpreterCapabilityPrivateId ?? null;
    if (!interpreterId) {
      return {
        status: "capability-private-unavailable",
        reason: "interpreter_not_provisioned",
      };
    }
    return { status: "capability-private-ready", interpreterId };
  }

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

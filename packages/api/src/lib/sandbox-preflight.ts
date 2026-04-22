/**
 * sandbox-preflight — shared helper every Strands-runtime caller (chat-
 * agent-invoke, wakeup-processor, composition dispatch, self-serve tools)
 * uses to decide whether the sandbox tool should be registered for this
 * invocation (plan Unit 9).
 *
 * Returns a discriminated union that spells out the full decision tree:
 *
 *   - "not-requested"    — template.sandbox is null (no opt-in)
 *   - "disabled"         — tenant.sandbox_enabled is false
 *   - "provisioning"     — sandbox_enabled=true but interpreter IDs null
 *   - "missing-connection" — required_connections include one the invoking
 *                            user hasn't connected (or it's expired/revoked)
 *   - "ready"            — register execute_code; result carries the
 *                          interpreter_id + secret_paths the Strands
 *                          container uses to build the preamble at
 *                          executeCode call #1 via sandbox_preamble.build_preamble.
 *
 * The preamble *source* is intentionally built Python-side — sandbox_preamble
 * already has the single-source-of-truth generator, and duplicating it here
 * would invite lockstep drift. The TS side only ships the data the generator
 * needs.
 */

import { eq } from "drizzle-orm";
import { getDb, schema } from "@thinkwork/database-pg";
import {
  writeSandboxSecrets,
  ConnectionRevokedError,
  SANDBOX_ALLOWED_CONNECTION_TYPES,
  type SandboxConnectionType,
} from "./sandbox-secrets.js";

const { tenants, connections, connectProviders } = schema;

export type SandboxEnvironmentId = "default-public" | "internal-only";

export interface TemplateSandboxConfig {
  environment: SandboxEnvironmentId;
  required_connections: SandboxConnectionType[];
}

export interface SandboxPreflightInput {
  stage: string;
  tenantId: string;
  agentId: string;
  /** The user on whose behalf the agent is running. */
  userId: string;
  /** template.sandbox as validated by Unit 3; null = template did not opt in. */
  templateSandbox: TemplateSandboxConfig | null;
}

export type SandboxPreflightResult =
  | {
      status: "not-requested";
      reason: "template_did_not_opt_in";
    }
  | {
      status: "disabled";
      reason: "tenant_sandbox_disabled";
    }
  | {
      status: "provisioning";
      reason: "interpreter_not_ready";
      environment: SandboxEnvironmentId;
    }
  | {
      status: "missing-connection";
      reason: "user_connection_missing" | "user_connection_expired";
      missingConnections: SandboxConnectionType[];
    }
  | {
      status: "ready";
      environment: SandboxEnvironmentId;
      interpreterId: string;
      /** connection_type → Secrets Manager ARN path. Passes to the container
       * via sandbox_secret_paths in the invocation payload. */
      secretPaths: Record<string, string>;
    };

/**
 * Run the pre-flight check. Writes per-invocation sandbox secrets when
 * status=ready; the caller is responsible for threading the result fields
 * into the Strands invocation payload (sandbox_interpreter_id +
 * sandbox_environment + sandbox_secret_paths + sandbox_tenant_id +
 * sandbox_user_id + sandbox_stage). server.py + invocation_env.py consume
 * them and build the preamble inside the container.
 */
export async function checkSandboxPreflight(
  input: SandboxPreflightInput,
): Promise<SandboxPreflightResult> {
  if (!input.templateSandbox) {
    return { status: "not-requested", reason: "template_did_not_opt_in" };
  }
  const { environment, required_connections } = input.templateSandbox;

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
    return { status: "disabled", reason: "tenant_sandbox_disabled" };
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
    };
  }

  // 3. Required-connections gate.
  const missing = await findMissingConnections(
    input.userId,
    required_connections,
  );
  if (missing.length > 0) {
    return {
      status: "missing-connection",
      reason: "user_connection_missing",
      missingConnections: missing,
    };
  }

  // 4. Write fresh per-invocation secrets.
  try {
    const { secretPaths } = await writeSandboxSecrets({
      stage: input.stage,
      tenantId: input.tenantId,
      userId: input.userId,
      requiredConnections: required_connections,
    });
    return {
      status: "ready",
      environment,
      interpreterId,
      secretPaths,
    };
  } catch (err) {
    // Close-to-use recheck can surface a revoked connection the pre-flight
    // filter missed. Translate to missing-connection so the caller's UX
    // stays consistent with the other denial paths.
    if (err instanceof ConnectionRevokedError) {
      return {
        status: "missing-connection",
        reason: "user_connection_expired",
        missingConnections: [err.connectionType as SandboxConnectionType],
      };
    }
    throw err;
  }
}

/**
 * Thread a ready pre-flight result into the Strands invocation payload.
 * The container's invocation_env will set SANDBOX_INTERPRETER_ID +
 * SANDBOX_ENVIRONMENT + SANDBOX_SECRET_PATHS on os.environ; server.py
 * reads them + builds the preamble + passes it into the sandbox_tool
 * factory.
 */
export function applySandboxPayloadFields(
  payload: Record<string, unknown>,
  result: SandboxPreflightResult,
  input: { tenantId: string; userId: string; stage: string },
): void {
  if (result.status !== "ready") return;
  payload.sandbox_interpreter_id = result.interpreterId;
  payload.sandbox_environment = result.environment;
  payload.sandbox_secret_paths = JSON.stringify(result.secretPaths);
  payload.sandbox_tenant_id = input.tenantId;
  payload.sandbox_user_id = input.userId;
  payload.sandbox_stage = input.stage;
}

// ---------------------------------------------------------------------------
// Required-connections scan — exported for unit tests
// ---------------------------------------------------------------------------

async function findMissingConnections(
  userId: string,
  required: SandboxConnectionType[],
): Promise<SandboxConnectionType[]> {
  if (required.length === 0) return [];
  const allowed = new Set<string>(SANDBOX_ALLOWED_CONNECTION_TYPES);
  const unknown = required.filter((t) => !allowed.has(t));
  if (unknown.length > 0) return unknown;

  const rows = await getDb()
    .select({
      providerName: connectProviders.name,
      status: connections.status,
    })
    .from(connections)
    .innerJoin(
      connectProviders,
      eq(connections.provider_id, connectProviders.id),
    )
    .where(eq(connections.user_id, userId));

  const active = new Set<string>();
  for (const row of rows) {
    if (row.status === "active") active.add(row.providerName);
  }
  return required.filter((t) => !active.has(t));
}

// ---------------------------------------------------------------------------
// Pure classifier — exported so tests exercise the decision tree without
// needing a live DB. Used internally by checkSandboxPreflight and by
// integration tests that want to assert a shape without hitting Secrets
// Manager.
// ---------------------------------------------------------------------------

export interface ClassifierInput {
  templateSandbox: TemplateSandboxConfig | null;
  tenant: {
    sandboxEnabled: boolean;
    interpreterPublicId: string | null;
    interpreterInternalId: string | null;
  } | null;
  activeConnections: Set<string>;
}

export type ClassifierResult =
  | { status: "not-requested" }
  | { status: "disabled" }
  | {
      status: "provisioning";
      environment: SandboxEnvironmentId;
    }
  | {
      status: "missing-connection";
      missing: SandboxConnectionType[];
    }
  | {
      status: "ready-pending-secrets";
      environment: SandboxEnvironmentId;
      interpreterId: string;
    };

export function classifyPreflight(input: ClassifierInput): ClassifierResult {
  if (!input.templateSandbox) return { status: "not-requested" };
  const { environment, required_connections } = input.templateSandbox;

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

  const allowed = new Set<string>(SANDBOX_ALLOWED_CONNECTION_TYPES);
  const unknown = required_connections.filter((t) => !allowed.has(t));
  if (unknown.length > 0) {
    return { status: "missing-connection", missing: unknown };
  }
  const missing = required_connections.filter(
    (t) => !input.activeConnections.has(t),
  );
  if (missing.length > 0) {
    return { status: "missing-connection", missing };
  }

  return {
    status: "ready-pending-secrets",
    environment,
    interpreterId,
  };
}

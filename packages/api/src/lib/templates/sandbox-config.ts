/**
 * Validator for AgentTemplate.sandbox — the opt-in metadata that tells the
 * dispatcher to register the `execute_code` Strands tool for agents linked
 * to this template (AgentCore Code Sandbox plan, Unit 3).
 *
 * Shape:
 *   {
 *     environment: "default-public" | "internal-only",
 *   }
 *
 * Lives at the resolver boundary because the schema column is plain jsonb.
 *
 * Historical note: v1 also accepted a `required_connections` array that
 * injected OAuth tokens into the sandbox's os.environ via the preamble.
 * That path was retired (see docs/plans/2026-04-23-006-refactor-sandbox-
 * drop-required-connections-plan.md) — OAuth'd work belongs in
 * composable-skill connector scripts, not a credential-laden Python
 * runtime. The validator now rejects the field on write and silently
 * strips it on hydration so legacy rows keep round-tripping without
 * surprising anyone.
 */

import {
  SANDBOX_ENVIRONMENTS,
  type SandboxEnvironment,
} from "@thinkwork/database-pg/schema";

export interface TemplateSandbox {
  environment: SandboxEnvironment;
}

export type SandboxValidationResult =
  | { ok: true; value: TemplateSandbox | null }
  | { ok: false; error: string };

/**
 * Validate + normalize the incoming `sandbox` field from a template
 * create/update mutation. Returns `{ ok: true, value: null }` for
 * `null | undefined` (the template does not opt into the sandbox).
 *
 * Rejects unknown environments, malformed shapes, and the retired
 * `required_connections` field with a specific error the resolver
 * surfaces verbatim.
 */
export function validateTemplateSandbox(raw: unknown): SandboxValidationResult {
  if (raw === null || raw === undefined) {
    return { ok: true, value: null };
  }

  // Tolerate JSON-string payloads the way other template fields do.
  const value = typeof raw === "string" ? safeParse(raw) : raw;
  if (value === SAFE_PARSE_FAIL) {
    return { ok: false, error: "sandbox: invalid JSON payload" };
  }

  if (typeof value !== "object" || Array.isArray(value) || value === null) {
    return {
      ok: false,
      error: "sandbox: must be an object with `environment`",
    };
  }

  const v = value as Record<string, unknown>;

  if (typeof v.environment !== "string") {
    return { ok: false, error: "sandbox.environment: required string" };
  }
  if (!SANDBOX_ENVIRONMENTS.includes(v.environment as SandboxEnvironment)) {
    return {
      ok: false,
      error: `sandbox.environment: must be one of ${SANDBOX_ENVIRONMENTS.join(", ")}; got "${v.environment}"`,
    };
  }
  const environment = v.environment as SandboxEnvironment;

  // required_connections is retired. Reject on write so operators can't
  // reintroduce OAuth-into-sandbox via raw GraphQL. Hydration of legacy
  // rows silently strips the key (see resolvers / admin editor — both
  // read only `environment` now).
  if ("required_connections" in v) {
    return {
      ok: false,
      error:
        "sandbox.required_connections is no longer accepted — use composable-skill connectors for OAuth-ed work",
    };
  }

  return {
    ok: true,
    value: { environment },
  };
}

const SAFE_PARSE_FAIL = Symbol("safeParseFail");

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return SAFE_PARSE_FAIL;
  }
}

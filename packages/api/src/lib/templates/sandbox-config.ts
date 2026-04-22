/**
 * Validator for AgentTemplate.sandbox — the opt-in metadata that tells the
 * dispatcher to register the `execute_code` Strands tool for agents linked
 * to this template (AgentCore Code Sandbox plan, Unit 3).
 *
 * Shape:
 *   {
 *     environment: "default-public" | "internal-only",
 *     required_connections: ("google" | "github" | "slack")[],
 *   }
 *
 * Lives at the resolver boundary because the schema column is plain jsonb.
 */

import {
  SANDBOX_ENVIRONMENTS,
  type SandboxEnvironment,
} from "@thinkwork/database-pg/schema";

// v1 allowed connection_type identifiers per brainstorm R11 + plan Unit 2
// (github + slack shipped in #419). If the set grows, extend this list.
export const SANDBOX_ALLOWED_CONNECTION_TYPES = [
  "google",
  "github",
  "slack",
] as const;

export type SandboxConnectionType =
  (typeof SANDBOX_ALLOWED_CONNECTION_TYPES)[number];

export interface TemplateSandbox {
  environment: SandboxEnvironment;
  required_connections: SandboxConnectionType[];
}

export type SandboxValidationResult =
  | { ok: true; value: TemplateSandbox | null }
  | { ok: false; error: string };

/**
 * Validate + normalize the incoming `sandbox` field from a template
 * create/update mutation. Returns `{ ok: true, value: null }` for
 * `null | undefined` (the template does not opt into the sandbox).
 *
 * Rejects unknown environments, unknown connection types, duplicates, and
 * malformed shapes with a specific error the resolver surfaces verbatim.
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
      error:
        "sandbox: must be an object with `environment` and `required_connections`",
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

  // required_connections is optional — default to empty list if omitted. The
  // template may need a sandbox without OAuth credentials (internal-data
  // scripting), so required_connections = [] is a legitimate v1 shape.
  let required_connections: SandboxConnectionType[] = [];
  if (v.required_connections !== undefined && v.required_connections !== null) {
    if (!Array.isArray(v.required_connections)) {
      return {
        ok: false,
        error:
          "sandbox.required_connections: must be an array of connection type strings",
      };
    }
    const seen = new Set<string>();
    for (const item of v.required_connections) {
      if (typeof item !== "string") {
        return {
          ok: false,
          error: "sandbox.required_connections: entries must be strings",
        };
      }
      if (
        !SANDBOX_ALLOWED_CONNECTION_TYPES.includes(
          item as SandboxConnectionType,
        )
      ) {
        return {
          ok: false,
          error: `sandbox.required_connections: "${item}" is not an allowed connection type; allowed: ${SANDBOX_ALLOWED_CONNECTION_TYPES.join(", ")}`,
        };
      }
      if (seen.has(item)) {
        return {
          ok: false,
          error: `sandbox.required_connections: duplicate entry "${item}"`,
        };
      }
      seen.add(item);
      required_connections.push(item as SandboxConnectionType);
    }
  }

  return {
    ok: true,
    value: { environment, required_connections },
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

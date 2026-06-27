/**
 * ThinkWork memory contract — deployment configuration.
 *
 * Resolves the active long-term memory engine and its feature flags from
 * process env. Exactly one engine is selected per deployment via
 * `MEMORY_ENGINE`; the selected engine's required env vars
 * (`HINDSIGHT_ENDPOINT`, `AGENTCORE_MEMORY_ID`, `COGNEE_ENDPOINT`, or the
 * compact `COGNEE` status document for Cognee) must be present or
 * {@link loadMemoryConfig} throws.
 *
 * `sessionSource` is fixed to `"thread_db"` in v1: Aurora thread messages
 * remain the short-term/session context source. Long-term engines must not
 * masquerade as the session-history source.
 *
 * Defined per `.prds/memory-implementation-plan.md` §7.
 */

import { getConfig } from "@thinkwork/runtime-config";

import type { MemoryEngineType } from "./types.js";

export type MemoryConfig = {
  enabled: boolean;
  engine: MemoryEngineType;
  sessionSource: "thread_db";
  apiEnabled: boolean;
  mcpEnabled: boolean;
  recall: {
    defaultLimit: number;
    tokenBudget: number;
  };
  retain: {
    autoRetainTurns: boolean;
    explicitRememberEnabled: boolean;
  };
  inspect: {
    graphEnabled: boolean;
    exportEnabled: boolean;
  };
  backends: {
    hindsightEndpoint: string | null;
    agentcoreMemoryId: string | null;
    cogneeEndpoint: string | null;
    awsRegion: string;
  };
};

const DEFAULT_RECALL_LIMIT = 10;
const DEFAULT_TOKEN_BUDGET = 2000;

export class MemoryConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryConfigError";
  }
}

function parseEngine(raw: string | undefined): MemoryEngineType {
  const value = (raw || "hindsight").toLowerCase();
  if (value === "hindsight" || value === "agentcore" || value === "cognee") {
    return value;
  }
  throw new MemoryConfigError(
    `MEMORY_ENGINE must be "hindsight", "agentcore", or "cognee", got "${raw}"`,
  );
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  const v = raw.toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return fallback;
}

function parseInt10(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function resolveCogneeEndpoint(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const explicit =
    (env.COGNEE_ENDPOINT ?? getConfig("COGNEE_ENDPOINT"))?.trim() || null;
  if (explicit) return explicit;

  const raw = env.COGNEE ?? getConfig("COGNEE") ?? env.COGNEE_STATUS;
  if (!raw) return null;

  const separatorIndex = raw.indexOf("|");
  if (separatorIndex >= 0) {
    return raw.slice(separatorIndex + 1).trim() || null;
  }

  try {
    const parsed = JSON.parse(raw) as { endpoint?: unknown };
    return typeof parsed.endpoint === "string" && parsed.endpoint.trim()
      ? parsed.endpoint.trim()
      : null;
  } catch {
    return null;
  }
}

export function loadMemoryConfig(
  env: NodeJS.ProcessEnv = process.env,
): MemoryConfig {
  const enabled = parseBool(env.MEMORY_ENABLED, true);
  const engine = parseEngine(env.MEMORY_ENGINE ?? getConfig("MEMORY_ENGINE"));
  const apiEnabled = parseBool(env.MEMORY_API_ENABLED, true);
  const mcpEnabled = parseBool(env.MEMORY_MCP_ENABLED, true);

  const hindsightEndpoint =
    (env.HINDSIGHT_ENDPOINT ?? getConfig("HINDSIGHT_ENDPOINT"))?.trim() || null;
  const agentcoreMemoryId =
    (env.AGENTCORE_MEMORY_ID ?? getConfig("AGENTCORE_MEMORY_ID"))?.trim() ||
    null;
  const cogneeEndpoint = resolveCogneeEndpoint(env);
  const awsRegion = env.AWS_REGION || "us-east-1";

  if (enabled) {
    if (engine === "hindsight" && !hindsightEndpoint) {
      throw new MemoryConfigError(
        'MEMORY_ENGINE="hindsight" requires HINDSIGHT_ENDPOINT to be set',
      );
    }
    if (engine === "agentcore" && !agentcoreMemoryId) {
      throw new MemoryConfigError(
        'MEMORY_ENGINE="agentcore" requires AGENTCORE_MEMORY_ID to be set',
      );
    }
    if (engine === "cognee" && !cogneeEndpoint) {
      throw new MemoryConfigError(
        'MEMORY_ENGINE="cognee" requires COGNEE_ENDPOINT to be set',
      );
    }
  }

  return {
    enabled,
    engine,
    sessionSource: "thread_db",
    apiEnabled,
    mcpEnabled,
    recall: {
      defaultLimit: parseInt10(env.MEMORY_RECALL_LIMIT, DEFAULT_RECALL_LIMIT),
      tokenBudget: parseInt10(env.MEMORY_TOKEN_BUDGET, DEFAULT_TOKEN_BUDGET),
    },
    retain: {
      autoRetainTurns: parseBool(
        env.MEMORY_AUTO_RETAIN_TURNS,
        engine === "agentcore" || engine === "cognee",
      ),
      explicitRememberEnabled: parseBool(env.MEMORY_EXPLICIT_REMEMBER, true),
    },
    inspect: {
      graphEnabled: engine === "hindsight" || engine === "cognee",
      exportEnabled: parseBool(env.MEMORY_EXPORT_ENABLED, true),
    },
    backends: {
      hindsightEndpoint,
      agentcoreMemoryId,
      cogneeEndpoint,
      awsRegion,
    },
  };
}

let _cached: MemoryConfig | null = null;

export function getMemoryConfig(): MemoryConfig {
  if (_cached) return _cached;
  _cached = loadMemoryConfig();
  return _cached;
}

export function resetMemoryConfigCache(): void {
  _cached = null;
}

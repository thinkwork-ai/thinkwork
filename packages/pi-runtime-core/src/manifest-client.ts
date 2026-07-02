/**
 * Per-turn capability manifest sink (capability-mapping plan U12).
 *
 * At turn end the container POSTs what it actually loaded — skills, tools,
 * MCP servers, extensions, and what was gated out with reasons — to
 * `POST /api/runtime/manifests` (the U11 spine). Best-effort by contract:
 * a failed POST logs and never blocks or alters the turn.
 *
 * Gating (KTD-6): emission requires `thinkwork_api_url` +
 * `thinkwork_api_secret` + `tenant_id`, which every dispatch path carries —
 * deliberately NOT the finalize-callback config, which is chat-only. Wakeup
 * and automation turns are exactly the no-invoker class the fail-closed
 * baseline exists to verify, so they must emit too (R14: each turn).
 */

export interface CapabilityManifestSinkConfig {
  apiUrl: string;
  secret: string;
  tenantId: string;
  sessionId: string;
  agentId?: string;
  userId?: string;
  threadId?: string;
  threadTurnId?: string;
  spaceId?: string;
  configFingerprint?: string;
}

const POST_TIMEOUT_MS = 5_000;

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Read the manifest sink wiring off the invocation payload. Null (no-op)
 * when the API wiring or tenant identity is absent — never a throw.
 */
export function readCapabilityManifestSinkConfig(
  payload: Record<string, unknown>,
): CapabilityManifestSinkConfig | null {
  const apiUrl = asString(payload.thinkwork_api_url);
  const secret = asString(payload.thinkwork_api_secret);
  const tenantId = asString(payload.tenant_id);
  if (!apiUrl || !secret || !tenantId) return null;

  const threadTurnId = asString(payload.thread_turn_id);
  const turnContext =
    payload.turn_context &&
    typeof payload.turn_context === "object" &&
    !Array.isArray(payload.turn_context)
      ? (payload.turn_context as Record<string, unknown>)
      : undefined;

  // The manifest row needs a non-empty session id; prefer the explicit
  // session key (wakeup paths), then the turn id, then the trace id.
  const sessionId =
    asString(payload.session_key) ??
    threadTurnId ??
    asString(payload.trace_id) ??
    "unknown-session";

  return {
    apiUrl: apiUrl.replace(/\/$/, ""),
    secret,
    tenantId,
    sessionId,
    agentId: asString(payload.assistant_id),
    userId: asString(payload.user_id),
    threadId: asString(payload.thread_id),
    threadTurnId,
    spaceId: turnContext ? asString(turnContext.spaceId) : undefined,
    configFingerprint: asString(payload.config_fingerprint),
  };
}

export interface PostCapabilityManifestArgs {
  config: CapabilityManifestSinkConfig;
  /** schema_version-2 manifest body (resolved/loaded/gated sections). */
  manifestJson: Record<string, unknown>;
  /** Active delegated profile for profile-scoped rows; omit for the default agent. */
  agentProfileId?: string;
  fetchImpl: typeof fetch;
  logger?: (entry: {
    level: "info" | "warn";
    event: string;
    [key: string]: unknown;
  }) => void;
  attemptTimeoutMs?: number;
}

/**
 * POST the manifest. Never throws; returns true when the row landed.
 */
export async function postCapabilityManifest(
  args: PostCapabilityManifestArgs,
): Promise<boolean> {
  const { config } = args;
  const log = args.logger ?? (() => {});
  try {
    const response = await args.fetchImpl(
      `${config.apiUrl}/api/runtime/manifests`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          session_id: config.sessionId,
          tenant_id: config.tenantId,
          agent_id: config.agentId,
          user_id: config.userId,
          thread_id: config.threadId,
          thread_turn_id: config.threadTurnId,
          space_id: config.spaceId,
          agent_profile_id: args.agentProfileId,
          config_fingerprint: config.configFingerprint,
          manifest_json: args.manifestJson,
        }),
        signal: AbortSignal.timeout(args.attemptTimeoutMs ?? POST_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      log({
        level: "warn",
        event: "capability_manifest_non_2xx",
        status: response.status,
        tenantId: config.tenantId,
        threadTurnId: config.threadTurnId,
      });
      return false;
    }
    log({
      level: "info",
      event: "capability_manifest_posted",
      tenantId: config.tenantId,
      threadTurnId: config.threadTurnId,
    });
    return true;
  } catch (error) {
    log({
      level: "warn",
      event: "capability_manifest_failed",
      tenantId: config.tenantId,
      threadTurnId: config.threadTurnId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

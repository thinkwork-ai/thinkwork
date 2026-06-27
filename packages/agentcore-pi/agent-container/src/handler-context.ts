/**
 * Plan §005 U9 — Per-invocation handler context for the Pi trusted handler.
 *
 * Owns the seams that have to live OUTSIDE of `init({ tools })` because they
 * are stateful per invocation:
 *   - Identity scope (tenantId, userId, agentId, threadId).
 *   - Snapshot of the secrets the completion callback uses to authenticate
 *     against `/api/skills/complete` (per `feedback_completion_callback_snapshot_pattern`).
 *   - Boundary validators that run BEFORE constructing tools — most importantly
 *     the MCP URL guard (HTTPS-only + private/loopback CIDR denylist).
 *   - A structured logger that redacts known-sensitive values when CloudWatch
 *     reads stdout.
 *
 * Everything here is shaped to be testable in isolation — the helpers take
 * inputs, return outputs, and never reach into module-load globals. Per
 * `feedback_vitest_env_capture_timing`, env reads ARE wrapped in functions so
 * Lambda warm-container env injection happens before the read.
 */

import { isIP } from "node:net";

// ---------------------------------------------------------------------------
// Identity scope — bound at /invocations entry, never re-read.
// ---------------------------------------------------------------------------

export interface InvocationIdentity {
  tenantId: string;
  userId: string;
  agentId: string;
  threadId: string;
  spaceId?: string;
}

export interface IdentitySnapshot extends InvocationIdentity {
  /** Optional tenant slug (from payload.tenant_slug). Used for workspace S3 sync. */
  tenantSlug: string;
  /** Optional agent slug (from payload.instance_id). Used for workspace S3 sync. */
  agentSlug: string;
  /** Trace id propagated to logs. */
  traceId: string;
}

export class InvocationValidationError extends Error {
  constructor(
    message: string,
    /** HTTP status to surface to the caller. */
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "InvocationValidationError";
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function spaceIdFromTurnContext(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return asString((value as Record<string, unknown>).spaceId);
}

/**
 * Pull identity scope out of the invocation payload, fail-closed. Missing
 * tenantId / agentId / threadId throw with `statusCode = 400` so the caller
 * can surface it without leaking internal state.
 *
 * `user_id` is required for normal invocations and optional for eval-mode
 * (`payload.eval_mode === true`) plus system-originated thread channels such
 * as webhooks and inbound email. Those invocations are user-less by
 * construction, so user-scoped tools (memory, hindsight) are skipped when
 * `IdentitySnapshot.userId` is empty.
 */
export function snapshotIdentity(
  payload: Record<string, unknown>,
): IdentitySnapshot {
  const tenantId = asString(payload.tenant_id);
  const userId = asString(payload.user_id);
  const agentId = asString(payload.assistant_id);
  const threadId = asString(payload.thread_id);
  const spaceId = spaceIdFromTurnContext(payload.turn_context);
  const evalMode = payload.eval_mode === true;
  const triggerChannel = asString(payload.trigger_channel);
  const userlessSystemChannel =
    triggerChannel === "webhook" || triggerChannel === "email_received";

  const missing: string[] = [];
  if (!tenantId) missing.push("tenant_id");
  if (!userId && !evalMode && !userlessSystemChannel) missing.push("user_id");
  if (!agentId) missing.push("assistant_id");
  if (!threadId) missing.push("thread_id");
  if (missing.length > 0) {
    throw new InvocationValidationError(
      `Pi invocation missing required identity field(s): ${missing.join(", ")}.`,
      400,
    );
  }

  return {
    tenantId,
    userId,
    agentId,
    threadId,
    spaceId: spaceId || undefined,
    tenantSlug: asString(payload.tenant_slug),
    agentSlug: asString(payload.instance_id),
    traceId: asString(payload.trace_id),
  };
}

// ---------------------------------------------------------------------------
// Secrets snapshot — taken at /invocations entry, never re-read.
// ---------------------------------------------------------------------------

export interface SecretsSnapshot {
  /**
   * Bearer for the completion callback (`POST /api/skills/complete`). Sourced
   * from `payload.thinkwork_api_secret`, which chat-agent-invoke fills from
   * `THINKWORK_API_SECRET` in its own env. Empty value disables the callback
   * (handler logs and continues — completion observability is best-effort).
   */
  apiAuthSecret: string;
  /**
   * Base URL for the ThinkWork API. Sourced from
   * `payload.thinkwork_api_url`; empty disables the callback.
   */
  apiUrl: string;
}

/** Snapshot the secrets the completion callback uses. Values may be empty. */
export function snapshotSecrets(
  payload: Record<string, unknown>,
): SecretsSnapshot {
  return {
    apiAuthSecret: asString(payload.thinkwork_api_secret),
    apiUrl: asString(payload.thinkwork_api_url),
  };
}

// ---------------------------------------------------------------------------
// Runtime env — wrapped reads so module-load capture doesn't lock in `""`.
// ---------------------------------------------------------------------------

export interface RuntimeEnvSnapshot {
  awsRegion: string;
  agentCoreMemoryId: string;
  hindsightEndpoint: string;
  memoryEngine: "managed" | "hindsight" | "cognee";
  /**
   * Name of the API's `memory-retain` Lambda
   * (`thinkwork-${stage}-api-memory-retain`). Empty string disables
   * end-of-turn auto-retain — the runtime logs and continues.
   */
  memoryRetainFnName: string;
  dbClusterArn: string;
  dbSecretArn: string;
  dbName: string;
  workspaceBucket: string;
  workspaceDir: string;
  piAgentDir: string;
  gitSha: string;
  okfWikiNavigatorEnabled?: boolean;
  okfWikiRoot?: string;
}

/**
 * Snapshot ALL env-derived runtime state in a single function call. Per
 * `feedback_vitest_env_capture_timing`, NO reads happen at module load — the
 * caller invokes this on every /invocations request so warm-container env
 * injection (which can race with module init) doesn't lock in `undefined`.
 */
export function snapshotRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeEnvSnapshot {
  const memoryEngineRaw = (env.MEMORY_ENGINE || "hindsight")
    .toLowerCase()
    .trim();
  const memoryEngine: RuntimeEnvSnapshot["memoryEngine"] =
    memoryEngineRaw === "hindsight"
      ? "hindsight"
      : memoryEngineRaw === "cognee"
        ? "cognee"
        : memoryEngineRaw === "managed" || memoryEngineRaw === "agentcore"
          ? "managed"
          : "hindsight";

  return {
    awsRegion: env.AWS_REGION || "us-east-1",
    agentCoreMemoryId: env.AGENTCORE_MEMORY_ID || "",
    hindsightEndpoint: env.HINDSIGHT_ENDPOINT || "",
    memoryEngine,
    memoryRetainFnName: env.MEMORY_RETAIN_FN_NAME || "",
    dbClusterArn: env.DB_CLUSTER_ARN || "",
    dbSecretArn: env.DB_SECRET_ARN || "",
    dbName: env.DB_NAME || "thinkwork",
    workspaceBucket: env.WORKSPACE_BUCKET || env.AGENTCORE_FILES_BUCKET || "",
    workspaceDir: env.WORKSPACE_DIR || "/workspace",
    piAgentDir: env.THINKWORK_PI_AGENT_DIR || "/tmp/thinkwork-pi-agent",
    gitSha: env.THINKWORK_GIT_SHA || "unknown",
    okfWikiNavigatorEnabled:
      (env.OKF_WIKI_NAVIGATOR_ENABLED || "").toLowerCase() === "true",
    okfWikiRoot: env.OKF_WIKI_ROOT || "",
  };
}

// ---------------------------------------------------------------------------
// MCP URL boundary validator.
// ---------------------------------------------------------------------------

/**
 * Reasons `validateMcpUrl` rejects a URL. Surfaced to the structured logger so
 * an operator can audit which configs were dropped.
 */
export type McpUrlRejection =
  | "invalid-url"
  | "unsupported-scheme"
  | "private-host"
  | "loopback-host"
  | "link-local-host";

export interface McpUrlValidation {
  ok: boolean;
  reason?: McpUrlRejection;
  /** Hostname extracted (lowercased) when `ok === true`. */
  host?: string;
}

export interface McpUrlValidationOptions {
  /**
   * Server-side trust marker for plugin-owned tenant-internal MCP endpoints.
   * Never set this for user-supplied URLs.
   */
  trustedInternal?: boolean;
}

/**
 * Single-octet IPv4 private-range matchers. Encoded as predicates rather than
 * a regex so the test surface mirrors the CIDR ranges the audit applies.
 */
const PRIVATE_IPV4_PREDICATES: ReadonlyArray<{
  reason: McpUrlRejection;
  match: (octets: readonly [number, number, number, number]) => boolean;
}> = [
  // 127.0.0.0/8 — loopback
  {
    reason: "loopback-host",
    match: ([a]) => a === 127,
  },
  // 169.254.0.0/16 — IMDS / link-local
  {
    reason: "link-local-host",
    match: ([a, b]) => a === 169 && b === 254,
  },
  // 10.0.0.0/8 — private
  {
    reason: "private-host",
    match: ([a]) => a === 10,
  },
  // 172.16.0.0/12 — private
  {
    reason: "private-host",
    match: ([a, b]) => a === 172 && b >= 16 && b <= 31,
  },
  // 192.168.0.0/16 — private
  {
    reason: "private-host",
    match: ([a, b]) => a === 192 && b === 168,
  },
  // 100.64.0.0/10 — Carrier-Grade NAT (RFC 6598). Used by AWS PrivateLink,
  // EKS pod CIDRs, and many corp VPNs; routes to non-public infrastructure.
  {
    reason: "private-host",
    match: ([a, b]) => a === 100 && b >= 64 && b <= 127,
  },
  // 198.18.0.0/15 — benchmarking (RFC 2544). Should never appear on the
  // public internet; if a payload supplies one we treat it as suspicious.
  {
    reason: "private-host",
    match: ([a, b]) => a === 198 && (b === 18 || b === 19),
  },
  // 0.0.0.0/8 — "this network"; treated as private because it routes to
  // localhost on most stacks.
  {
    reason: "private-host",
    match: ([a]) => a === 0,
  },
];

function classifyIpv4(host: string): McpUrlRejection | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    octets.push(n);
  }
  if (octets.length !== 4) return null;
  const tuple: readonly [number, number, number, number] = [
    octets[0]!,
    octets[1]!,
    octets[2]!,
    octets[3]!,
  ];
  for (const predicate of PRIVATE_IPV4_PREDICATES) {
    if (predicate.match(tuple)) return predicate.reason;
  }
  return null;
}

function classifyIpv6(host: string): McpUrlRejection | null {
  // Node's URL keeps brackets in `hostname` for IPv6; strip them before
  // matching so the predicates don't have to know about the wire form.
  const stripped =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const lowered = stripped.toLowerCase();
  if (lowered === "::1" || lowered === "0:0:0:0:0:0:0:1")
    return "loopback-host";
  // Unspecified address — never legally routable.
  if (lowered === "::" || lowered === "0:0:0:0:0:0:0:0") return "loopback-host";
  // Link-local — fe80::/10. Per RFC 4291 the prefix is fe8x..febx (the
  // /10 covers all variants where the high two bits of the third nibble
  // are `10`). The earlier `fe80:` startsWith only covered fe80::/16.
  if (/^fe[89ab][0-9a-f]?:/i.test(lowered)) return "link-local-host";
  // ULAs — fc00::/7 (fc... or fd...). Match any leading hex pair so
  // `fc00::1`, `fd12:abcd::1`, etc. all resolve.
  if (/^fc[0-9a-f]{0,2}:|^fd[0-9a-f]{0,2}:/i.test(lowered))
    return "private-host";
  // IPv4-mapped IPv6 — `::ffff:a.b.c.d` (literal) OR `::ffff:N1:N2`
  // (the canonical form Node's URL parser emits). Re-derive the IPv4
  // octets and run classifyIpv4.
  const dottedMatch = lowered.match(
    /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/,
  );
  if (dottedMatch?.[1]) {
    const inner = classifyIpv4(dottedMatch[1]);
    if (inner) return inner;
  }
  const hexMatch = lowered.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMatch) {
    const high = parseInt(hexMatch[1]!, 16);
    const low = parseInt(hexMatch[2]!, 16);
    if (high <= 0xffff && low <= 0xffff) {
      const a = (high >> 8) & 0xff;
      const b = high & 0xff;
      const c = (low >> 8) & 0xff;
      const d = low & 0xff;
      const inner = classifyIpv4(`${a}.${b}.${c}.${d}`);
      if (inner) return inner;
    }
  }
  return null;
}

function classifyHostname(host: string): McpUrlRejection | null {
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost"))
    return "loopback-host";
  // `metadata.google.internal` and similar cloud-metadata hostnames are not
  // covered here — the IPv4 169.254.x.x predicate catches the IMDS endpoint
  // they typically resolve to. Adding hostname denylists is FR-future work.
  return null;
}

/**
 * Reject MCP server URLs that would expose the trusted handler to local
 * resources (file://), unencrypted transports (http://, ws://), legacy
 * exfil-prone schemes (gopher://), or private network endpoints (IMDS at
 * 169.254.169.254, RFC1918 ranges, loopback, link-local IPv6).
 *
 * Accepts: `https://...` with a publicly-resolvable host. The hostname is
 * NOT DNS-resolved here — DNS rebinding is partially mitigated by the
 * worker-thread's response scrubbing in U16 + the connect timeout in U7's
 * `connectMcpServer` factory. This validator is the cheap pre-flight gate.
 */
export function validateMcpUrl(
  url: string,
  options: McpUrlValidationOptions = {},
): McpUrlValidation {
  if (typeof url !== "string" || !url.trim()) {
    return { ok: false, reason: "invalid-url" };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  // Only HTTPS is permitted for user-supplied MCP. Trusted plugin-owned
  // internal endpoints may use HTTP because the private substrate ALB is
  // intentionally not internet-facing.
  if (
    parsed.protocol !== "https:" &&
    !(options.trustedInternal === true && parsed.protocol === "http:")
  ) {
    return { ok: false, reason: "unsupported-scheme" };
  }
  const host = parsed.hostname;
  if (!host) {
    return { ok: false, reason: "invalid-url" };
  }
  // Node's URL parser keeps brackets on IPv6 hostnames; strip them so
  // `isIP` can recognise the address family. Also strip trailing dots
  // ("FQDN absolute" form): most resolvers map `localhost.` to 127.0.0.1
  // identically to `localhost`, so the dot must not bypass the loopback
  // classification. Strip after the IPv6-bracket check so we don't strip
  // legitimate IPv6 hostnames.
  const unbracketed =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const normalised = unbracketed.replace(/\.+$/, "");
  if (!normalised) {
    return { ok: false, reason: "invalid-url" };
  }
  const ipFamily = isIP(normalised);
  if (ipFamily === 4) {
    const reason = classifyIpv4(normalised);
    if (reason && !options.trustedInternal) return { ok: false, reason };
  } else if (ipFamily === 6) {
    const reason = classifyIpv6(normalised);
    if (reason && !options.trustedInternal) return { ok: false, reason };
  } else {
    const reason = classifyHostname(normalised);
    if (reason && !options.trustedInternal) return { ok: false, reason };
  }
  return { ok: true, host: normalised.toLowerCase() };
}

// ---------------------------------------------------------------------------
// Structured logger — JSON lines on stdout, redacted at the source.
// ---------------------------------------------------------------------------

export interface LogFields {
  level: "info" | "warn" | "error";
  event: string;
  tenantId?: string;
  userId?: string;
  agentId?: string;
  threadId?: string;
  traceId?: string;
  [key: string]: unknown;
}

const REDACTED = "[redacted]";

/**
 * Match common shapes of leaked secrets:
 *  - `Authorization: Bearer xxx` / `Authorization=Bearer xxx`
 *  - `Authorization: xxx` (with no scheme)
 *  - `Bearer xxx` / `Token xxx` / `Basic xxx` / `ApiKey xxx` (standalone)
 *  - `api-key: xxx`, `access-token=xxx`, `cookie: foo=bar`
 *  - URL-style: `?api_key=xxx` / `&token=xxx`
 *
 * Each match is replaced with `<keyword>=[redacted]` so reading the log line
 * makes the redaction obvious without leaking the prefix or the token.
 *
 * The patterns target the formats that real upstream errors echo back —
 * the goal is "make it hard to leak", not formal completeness.
 */
const SENSITIVE_KEY_VALUE_PATTERN =
  /(authorization|proxy-authorization|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|cookie|set-cookie)\s*[:=]\s*(?:bearer\s+|token\s+|basic\s+|apikey\s+)?[^\s",;]+/gi;
const SENSITIVE_AUTH_SCHEME_PATTERN =
  /\b(bearer|token|basic|apikey)\s+[A-Za-z0-9._\-+/=]+/gi;
const SENSITIVE_QUERY_TOKEN_PATTERN =
  /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret))=[^&\s",]+/gi;

/** Strip Authorization / api-key / token-query fragments from any free-text value. */
export function redactSensitive(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value
    .replace(SENSITIVE_KEY_VALUE_PATTERN, (match) => {
      const keyword = match.match(
        /(authorization|proxy-authorization|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|cookie|set-cookie)/i,
      );
      return `${keyword?.[1] ?? "secret"}=[redacted]`;
    })
    .replace(SENSITIVE_AUTH_SCHEME_PATTERN, (_match, scheme: string) => {
      // Preserve original casing of the scheme keyword so the reader can
      // tell which header value was redacted (Bearer vs Basic, etc.).
      return `${scheme} [redacted]`;
    })
    .replace(SENSITIVE_QUERY_TOKEN_PATTERN, (_match, prefixKey: string) => {
      return `${prefixKey}=[redacted]`;
    });
}

const SENSITIVE_HEADER_KEYS = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "cookie",
  "set-cookie",
  "x-skill-run-signature",
]);

/** Recursively redact a value: header-key strip, inline-pattern strip, and nested traversal. */
function redactDeep(value: unknown, depth = 0): unknown {
  // Cap recursion so a circular or very deep structure can't lock the logger.
  if (depth > 5) return "[depth-limit]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactSensitive(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_HEADER_KEYS.has(k.toLowerCase())) {
        out[k] = REDACTED;
      } else {
        out[k] = redactDeep(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

/**
 * Emit a JSON-line log entry. CloudWatch picks up stdout. Sensitive fields
 * (Authorization-shaped) are scrubbed in-place. The `level` and `event` fields
 * are required — `event` should be a stable name an alarm can match on.
 *
 * Redaction is recursive through nested objects + arrays so a payload like
 * `{ ctx: { Authorization: "..." } }` or `[{ Authorization: "..." }]` does
 * not leak. Depth is capped at 6 to bound work on pathological inputs.
 */
export function logStructured(
  fields: LogFields,
  out: NodeJS.WritableStream = process.stdout,
): void {
  const sanitised: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key === "level" || key === "event") {
      sanitised[key] = value;
      continue;
    }
    sanitised[key] = redactDeep(value);
  }
  // Add a wall-clock timestamp last so alarms can sort.
  sanitised.ts = new Date().toISOString();
  out.write(`${JSON.stringify(sanitised)}\n`);
}

export type AgentCorePhaseStatus =
  | "started"
  | "completed"
  | "failed"
  | "skipped";

export interface AgentCorePhaseLogFields {
  phase: string;
  status: AgentCorePhaseStatus;
  tenantId?: string;
  userId?: string;
  agentId?: string;
  agentSlug?: string;
  threadId?: string;
  threadTurnId?: string;
  traceId?: string;
  runtimeType?: string;
  durationMs?: number;
  count?: number;
  detail?: string;
  errorType?: string;
}

export function logAgentCorePhase(
  fields: AgentCorePhaseLogFields,
  out: NodeJS.WritableStream = process.stdout,
): void {
  const sessionId = fields.threadTurnId || fields.threadId || "unknown";
  logStructured(
    {
      level: fields.status === "failed" ? "error" : "info",
      event: "agentcore_phase",
      name: "thinkwork.agentcore.phase",
      scope: { name: "thinkwork.pi.runtime" },
      spanId: phaseSpanId(fields.phase, sessionId),
      sessionId,
      source: "agentcore-pi",
      runtimeType: fields.runtimeType ?? "pi",
      ...fields,
    },
    out,
  );
}

function phaseSpanId(phase: string, sessionId: string): string {
  const safe = `agentcore-pi-${phase}-${sessionId}`
    .replace(/[^A-Za-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return `tw-${safe || "agentcore-phase"}`;
}

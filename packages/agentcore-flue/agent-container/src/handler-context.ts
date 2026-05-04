/**
 * Plan §005 U9 — Per-invocation handler context for the Flue trusted handler.
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

/**
 * Pull identity scope out of the invocation payload, fail-closed. Missing
 * tenantId / userId / agentId / threadId throw with `statusCode = 400` so the
 * caller can surface it without leaking internal state.
 */
export function snapshotIdentity(
  payload: Record<string, unknown>,
): IdentitySnapshot {
  const tenantId = asString(payload.tenant_id);
  const userId = asString(payload.user_id);
  const agentId = asString(payload.assistant_id);
  const threadId = asString(payload.thread_id);

  const missing: string[] = [];
  if (!tenantId) missing.push("tenant_id");
  if (!userId) missing.push("user_id");
  if (!agentId) missing.push("assistant_id");
  if (!threadId) missing.push("thread_id");
  if (missing.length > 0) {
    throw new InvocationValidationError(
      `Flue invocation missing required identity field(s): ${missing.join(", ")}.`,
      400,
    );
  }

  return {
    tenantId,
    userId,
    agentId,
    threadId,
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
  memoryEngine: "managed" | "hindsight";
  dbClusterArn: string;
  dbSecretArn: string;
  dbName: string;
  workspaceBucket: string;
  workspaceDir: string;
  gitSha: string;
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
  const memoryEngineRaw = (env.MEMORY_ENGINE || "managed")
    .toLowerCase()
    .trim();
  const memoryEngine: RuntimeEnvSnapshot["memoryEngine"] =
    memoryEngineRaw === "hindsight" ? "hindsight" : "managed";

  return {
    awsRegion: env.AWS_REGION || "us-east-1",
    agentCoreMemoryId: env.AGENTCORE_MEMORY_ID || "",
    hindsightEndpoint: env.HINDSIGHT_ENDPOINT || "",
    memoryEngine,
    dbClusterArn: env.DB_CLUSTER_ARN || "",
    dbSecretArn: env.DB_SECRET_ARN || "",
    dbName: env.DB_NAME || "thinkwork",
    workspaceBucket: env.WORKSPACE_BUCKET || env.AGENTCORE_FILES_BUCKET || "",
    workspaceDir: env.WORKSPACE_DIR || "/tmp/workspace",
    gitSha: env.THINKWORK_GIT_SHA || "unknown",
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
  const stripped = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;
  const lowered = stripped.toLowerCase();
  if (lowered === "::1" || lowered === "0:0:0:0:0:0:0:1") return "loopback-host";
  if (lowered.startsWith("fe80:") || lowered.startsWith("fe80::"))
    return "link-local-host";
  // ULAs — fc00::/7 (fc... or fd...). Match any leading hex pair so
  // `fc00::1`, `fd12:abcd::1`, etc. all resolve.
  if (/^fc[0-9a-f]{0,2}:|^fd[0-9a-f]{0,2}:/i.test(lowered)) return "private-host";
  // IPv4-mapped IPv6 — `::ffff:a.b.c.d` (literal) OR `::ffff:N1:N2`
  // (the canonical form Node's URL parser emits). Re-derive the IPv4
  // octets and run classifyIpv4.
  const dottedMatch = lowered.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
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
  if (lower === "localhost" || lower.endsWith(".localhost")) return "loopback-host";
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
export function validateMcpUrl(url: string): McpUrlValidation {
  if (typeof url !== "string" || !url.trim()) {
    return { ok: false, reason: "invalid-url" };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  // Only HTTPS is permitted. Plaintext HTTP, websockets (ws/wss), file://,
  // gopher://, etc. are all rejected.
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "unsupported-scheme" };
  }
  const host = parsed.hostname;
  if (!host) {
    return { ok: false, reason: "invalid-url" };
  }
  // Node's URL parser keeps brackets on IPv6 hostnames; strip them so
  // `isIP` can recognise the address family.
  const unbracketed =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const ipFamily = isIP(unbracketed);
  if (ipFamily === 4) {
    const reason = classifyIpv4(unbracketed);
    if (reason) return { ok: false, reason };
  } else if (ipFamily === 6) {
    const reason = classifyIpv6(unbracketed);
    if (reason) return { ok: false, reason };
  } else {
    const reason = classifyHostname(unbracketed);
    if (reason) return { ok: false, reason };
  }
  return { ok: true, host: unbracketed.toLowerCase() };
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
 *  - `Bearer xxx` (standalone, e.g. inside a stringified header value)
 *  - `api-key: xxx`, `access-token=xxx`, etc.
 *
 * Each match is replaced with `<keyword>=[redacted]` so reading the log line
 * makes the redaction obvious without leaking the prefix or the token.
 */
const SENSITIVE_KEY_VALUE_PATTERN =
  /(authorization|proxy-authorization|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*(?:bearer\s+)?[^\s",]+/gi;
const SENSITIVE_BEARER_PATTERN = /\bbearer\s+[^\s",]+/gi;

/** Strip Authorization / api-key fragments embedded in any free-text value. */
export function redactSensitive(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value
    .replace(SENSITIVE_KEY_VALUE_PATTERN, (match) => {
      const keyword = match.match(
        /(authorization|proxy-authorization|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token)/i,
      );
      return `${keyword?.[1] ?? "secret"}=[redacted]`;
    })
    .replace(SENSITIVE_BEARER_PATTERN, "Bearer [redacted]");
}

/**
 * Emit a JSON-line log entry. CloudWatch picks up stdout. Sensitive fields
 * (Authorization-shaped) are scrubbed in-place. The `level` and `event` fields
 * are required — `event` should be a stable name an alarm can match on.
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
    // Header object fields get per-key redaction so an Authorization header
    // never reaches stdout in the clear.
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      const headerLike: Record<string, unknown> = {};
      for (const [hk, hv] of Object.entries(value as Record<string, unknown>)) {
        const hkLower = hk.toLowerCase();
        if (
          hkLower === "authorization" ||
          hkLower === "proxy-authorization" ||
          hkLower === "x-api-key"
        ) {
          headerLike[hk] = REDACTED;
        } else {
          headerLike[hk] = redactSensitive(hv);
        }
      }
      sanitised[key] = headerLike;
      continue;
    }
    sanitised[key] = redactSensitive(value);
  }
  // Add a wall-clock timestamp last so alarms can sort.
  sanitised.ts = new Date().toISOString();
  out.write(`${JSON.stringify(sanitised)}\n`);
}

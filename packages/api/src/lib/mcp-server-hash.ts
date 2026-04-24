/**
 * MCP server hash-pin helper (plan §U11 / SI-5).
 *
 * An approved MCP server gets a `url_hash` written at approval time. Any
 * subsequent mutation to `url` or `auth_config` must recompute this hash
 * — if it changes, the admin approval no longer applies to the new
 * (url, auth_config) tuple and the server reverts to `pending`.
 *
 * The canonical form is `JSON.stringify({ url, auth_config })` with
 * recursively sorted object keys. Arrays preserve order. `undefined`
 * auth_config hashes identically to explicit `null` — both represent
 * "no auth config" on the `tenant_mcp_servers.auth_config` column.
 *
 * Defensive invariants the callers rely on:
 *   - Two equal (url, auth_config) tuples produce identical hashes
 *     regardless of key ordering in the input JSONB.
 *   - A malicious actor cannot bypass the hash by reordering keys
 *     inside `auth_config` — canonicalize before hashing.
 *   - The hash is stable across Node versions (sha256 over a
 *     deterministic UTF-8 JSON string).
 */

import { createHash } from "node:crypto";

export type McpAuthConfig = Record<string, unknown> | null | undefined;

/** Recursively sort object keys so `{b:1, a:2}` and `{a:2, b:1}` serialize identically. */
function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = canonicalize(v);
    return out;
  }
  return value;
}

/**
 * Compute the canonical sha256 hex digest of (url, auth_config).
 *
 * Returned as lowercase hex. `auth_config === undefined` and
 * `auth_config === null` canonicalize to the same hash.
 */
export function computeMcpUrlHash(
  url: string,
  authConfig: McpAuthConfig,
): string {
  const canonical = canonicalize({ url, auth_config: authConfig ?? null });
  const payload = JSON.stringify(canonical);
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/** Returns true iff the row's stored `url_hash` matches `(url, auth_config)`. */
export function mcpHashMatches(
  storedHash: string | null | undefined,
  url: string,
  authConfig: McpAuthConfig,
): boolean {
  if (!storedHash) return false;
  return storedHash === computeMcpUrlHash(url, authConfig);
}

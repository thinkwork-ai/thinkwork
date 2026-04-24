/**
 * capability-catalog-list — runtime → API read of `capability_catalog`
 * (plan §U15 pt 3/3, SI-7).
 *
 *   GET /api/runtime/capability-catalog?type=tool&source=builtin
 *     Authorization: Bearer <API_AUTH_SECRET>
 *     → 200 { slugs: string[], count: number, version: string }
 *
 * The Strands container calls this once per session-start. It trusts the
 * slug list over its own hard-coded tool registration — a catalog-missing
 * tool cannot register (SI-7). Shipped behind a container-side
 * `RCM_ENFORCE=true` env feature flag, so the API contract is stable but
 * the behavioral change can be flipped per-stage.
 *
 * Auth rationale matches `manifest-log`: runtime→API, no tenant OAuth.
 * Shared service secret. The endpoint is read-only; no mutation risk.
 *
 * ``version`` is the current timestamp of the most-recently-updated
 * catalog row so the runtime can cache per-session + invalidate on
 * redeploy / edits — a future optimization hook, not load-bearing for
 * this PR.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { and, eq, max } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { capabilityCatalog } from "@thinkwork/database-pg/schema";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { error, json, notFound, unauthorized } from "../lib/response.js";

const ALLOWED_TYPES = new Set(["skill", "tool", "mcp-server"]);
const ALLOWED_SOURCES = new Set(["builtin", "tenant-library", "community"]);

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
      body: "",
    };
  }

  if (event.requestContext.http.method !== "GET") {
    return error("Method not allowed", 405);
  }
  if (event.rawPath !== "/api/runtime/capability-catalog") {
    return notFound("Route not found");
  }

  const token = extractBearerToken(event);
  if (!token || !validateApiSecret(token)) return unauthorized();

  const qs = event.queryStringParameters ?? {};
  const type = (qs.type ?? "").trim();
  const source = (qs.source ?? "").trim();

  if (!type || !ALLOWED_TYPES.has(type)) {
    return error(
      `type: required; one of ${[...ALLOWED_TYPES].join(", ")}`,
      400,
    );
  }
  if (!source || !ALLOWED_SOURCES.has(source)) {
    return error(
      `source: required; one of ${[...ALLOWED_SOURCES].join(", ")}`,
      400,
    );
  }

  try {
    const db = getDb();

    const rows = await db
      .select({ slug: capabilityCatalog.slug })
      .from(capabilityCatalog)
      .where(
        and(
          eq(capabilityCatalog.type, type),
          eq(capabilityCatalog.source, source),
        ),
      );
    const slugs = rows.map((r) => r.slug).sort();

    // `version` doubles as a cache key for the runtime — the latest
    // updated_at across the filtered set. Runtime can compare against
    // a cached value and skip the full list when unchanged. For this
    // PR we just echo it; caching is a later optimization.
    const [versionRow] = await db
      .select({
        version: max(capabilityCatalog.updated_at),
      })
      .from(capabilityCatalog)
      .where(
        and(
          eq(capabilityCatalog.type, type),
          eq(capabilityCatalog.source, source),
        ),
      );
    const version =
      versionRow?.version instanceof Date
        ? versionRow.version.toISOString()
        : "";

    return json({
      slugs,
      count: slugs.length,
      version,
      type,
      source,
    });
  } catch (err) {
    console.error("[capability-catalog-list] handler crashed:", err);
    return error("internal server error", 500);
  }
}

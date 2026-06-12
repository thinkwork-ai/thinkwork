/**
 * Tenant slug validation — shape, reserved list, and (plan 2026-06-12-002
 * U5) the customer-domain namespace check: a slug is rejected when ANY DNS
 * record exists at `<slug>.thinkwork.ai` in the Cloudflare apex zone, so
 * tenant signup cannot take a name delegated to a customer deployment (R1).
 *
 * Posture (R5): the Cloudflare leg fails CLOSED — an API error surfaces as
 * SLUG_VALIDATION_UNAVAILABLE and no tenant row is created — and taken
 * names map to the same SLUG_UNAVAILABLE code as a DB unique violation,
 * never echoing record comments or owner identity to the caller.
 *
 * Ship-inert carve-out: when no token is CONFIGURED (the SSM parameter is
 * absent or still holds the terraform placeholder — distinct from a lookup
 * or Cloudflare API FAILURE), the Cloudflare leg logs loudly and is
 * skipped, so existing dev stages keep creating tenants the day this
 * merges. The customer-domain runbook makes the token mandatory for any
 * stage whose deployments share the thinkwork.ai namespace.
 */

import { GraphQLError } from "graphql";
import {
  isReservedTenantSlug,
  TENANT_SLUG_PATTERN,
} from "@thinkwork/database-pg/utils/reserved-slugs";
import {
  CloudflareNamespaceClient,
  namespaceFqdn,
  type NamespaceDnsApi,
} from "@thinkwork/namespace-registry";
import {
  CloudflareNamespaceTokenError,
  resolveCloudflareNamespaceToken,
} from "../../../lib/cloudflare-namespace-token.js";

type PgErrorLike = {
  code?: unknown;
  cause?: unknown;
};

export function tenantSlugError(message: string, code: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code } });
}

/** The read-only slice of the namespace DNS API the signup check needs. */
type NamespaceDnsReader = Pick<NamespaceDnsApi, "listRecords">;

export interface NamespaceCheckDeps {
  resolveToken: () => Promise<string | null>;
  createDns: (token: string) => NamespaceDnsReader;
}

let testDepsOverride: NamespaceCheckDeps | null = null;

// Container-lifetime client cache — CloudflareNamespaceClient memoizes the
// zone id, so reusing one instance saves a zone lookup per validation.
let cachedClient: { token: string; dns: NamespaceDnsReader } | null = null;

function defaultDeps(): NamespaceCheckDeps {
  return {
    resolveToken: () => resolveCloudflareNamespaceToken(),
    createDns: (token) => {
      if (!cachedClient || cachedClient.token !== token) {
        cachedClient = { token, dns: new CloudflareNamespaceClient({ token }) };
      }
      return cachedClient.dns;
    },
  };
}

/** Test hook — inject fake token/DNS legs; pass null to restore defaults. */
export function __setNamespaceCheckDepsForTests(
  deps: NamespaceCheckDeps | null,
): void {
  testDepsOverride = deps;
  cachedClient = null;
}

export async function validateTenantSlug(slug: string): Promise<void> {
  if (!TENANT_SLUG_PATTERN.test(slug)) {
    throw tenantSlugError(
      "Tenant slug must be 3-30 lowercase letters, numbers, or hyphens, and cannot start or end with a hyphen",
      "INVALID_SLUG",
    );
  }
  if (isReservedTenantSlug(slug)) {
    throw tenantSlugError("Tenant slug is reserved", "RESERVED_SLUG");
  }
  // Reserved/invalid rejections must not consume a Cloudflare request —
  // the namespace leg runs strictly after the local checks pass.
  await assertSlugFreeInNamespace(slug);
}

function namespaceCheckUnavailableError(): GraphQLError {
  return tenantSlugError(
    "Tenant slug availability could not be verified — try again shortly",
    "SLUG_VALIDATION_UNAVAILABLE",
  );
}

async function assertSlugFreeInNamespace(slug: string): Promise<void> {
  const deps = testDepsOverride ?? defaultDeps();

  let token: string | null;
  try {
    token = await deps.resolveToken();
  } catch (err) {
    // The token may exist but we could not read it — fail CLOSED (R5).
    // CloudflareNamespaceTokenError is the lookup-failure signal; anything
    // else is equally a failure to establish the check's preconditions.
    const detail =
      err instanceof CloudflareNamespaceTokenError
        ? err.message
        : ((err as Error)?.message ?? String(err));
    console.error(
      `[tenant-slug] Cloudflare namespace token lookup failed while validating "${slug}": ${detail}`,
    );
    throw namespaceCheckUnavailableError();
  }

  if (!token) {
    // Ship-inert carve-out (see module doc): missing-token CONFIG skips the
    // Cloudflare leg so pre-token dev stages keep working. Loud by design —
    // a namespace-sharing stage seeing this log is misconfigured.
    console.warn(
      `[tenant-slug] Cloudflare namespace check SKIPPED for "${slug}": no token configured ` +
        "(set /thinkwork/<stage>/cloudflare-namespace-token — mandatory for stages sharing " +
        "the thinkwork.ai namespace; see the customer-domain runbook)",
    );
    return;
  }

  let recordCount: number;
  try {
    const records = await deps
      .createDns(token)
      .listRecords(namespaceFqdn(slug));
    recordCount = records.length;
  } catch (err) {
    // Fail CLOSED (R5): a Cloudflare API error must not let a possibly
    // deployment-claimed name through. Full detail goes to the log only.
    console.error(
      `[tenant-slug] Cloudflare namespace check failed for "${slug}":`,
      err,
    );
    throw namespaceCheckUnavailableError();
  }

  if (recordCount > 0) {
    // ANY record at <slug>.thinkwork.ai means taken (R1) — same code as a
    // DB unique violation. Never include record comments or owner identity
    // in the error (R5).
    throw tenantSlugError("Tenant slug is unavailable", "SLUG_UNAVAILABLE");
  }
}

export function hasPgErrorCode(err: unknown, code: string): boolean {
  let current: unknown = err;
  while (current && typeof current === "object") {
    const maybe = current as PgErrorLike;
    if (maybe.code === code) return true;
    current = maybe.cause;
  }
  return false;
}

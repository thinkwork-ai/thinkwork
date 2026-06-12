/**
 * Cloudflare namespace-token resolution (plan 2026-06-12-002 U5, KTD7).
 *
 * The graphql-http Lambda holds its OWN zone-scoped DNS:Edit token for the
 * thinkwork.ai namespace zone, on a distinct SSM path from the CI
 * CLOUDFLARE_API_TOKEN (independent rotation — a signup-path compromise
 * doesn't burn the CI token). The token is NOT a Lambda env var
 * (graphql-http env sits at the 4KB ceiling, #2375) and never enters the
 * runtime-config document (secrets stay out of the plain String parameter
 * — R4 of the SSM migration). It lives in its own SecureString parameter:
 *
 *   /thinkwork/<stage>/cloudflare-namespace-token
 *
 * Resolution order: CLOUDFLARE_NAMESPACE_API_TOKEN env (local dev, vitest;
 * getConfig's env leg) → the SecureString parameter, cached for the
 * container lifetime (same shape as wiki/google-places-client.ts).
 *
 * A missing parameter, an empty value, or the terraform-seeded
 * PLACEHOLDER_SET_VIA_CLI sentinel all resolve to null — the caller
 * (tenantSlugValidation) treats null as "namespace check unconfigured" and
 * SKIPS the Cloudflare leg. Any other SSM failure throws
 * CloudflareNamespaceTokenError so the caller can fail CLOSED (the token
 * may exist; we just couldn't read it).
 */

import { getConfig } from "@thinkwork/runtime-config";

/** Terraform seeds the parameter with this sentinel; it means "unconfigured". */
export const CLOUDFLARE_NAMESPACE_TOKEN_PLACEHOLDER = "PLACEHOLDER_SET_VIA_CLI";

/** Thrown when the parameter LOOKUP fails (≠ the parameter being absent). */
export class CloudflareNamespaceTokenError extends Error {
  constructor(paramName: string, cause: unknown) {
    super(
      `failed to read Cloudflare namespace token from SSM parameter ${paramName}: ` +
        ((cause as Error)?.message ?? String(cause)),
    );
    this.name = "CloudflareNamespaceTokenError";
    this.cause = cause;
  }
}

// Container-lifetime cache: undefined = not yet resolved; null = resolved
// to "unconfigured". Lookup FAILURES are never cached, so a transient SSM
// outage retries on the next validation instead of pinning the skip path.
let cachedToken: string | null | undefined;

export interface ResolveCloudflareNamespaceTokenOptions {
  /** Test injection — returns the raw parameter value or null when absent. */
  ssmSend?: (paramName: string) => Promise<string | null>;
}

export async function resolveCloudflareNamespaceToken(
  opts: ResolveCloudflareNamespaceTokenOptions = {},
): Promise<string | null> {
  // Env wins (local dev / vitest), matching the runtime-config posture.
  const fromEnv = getConfig("CLOUDFLARE_NAMESPACE_API_TOKEN");
  if (fromEnv) return fromEnv;

  if (cachedToken !== undefined) return cachedToken;

  const stage = getConfig("STAGE");
  if (!stage) {
    // No stage identity (vitest, local tools) — nothing to look up.
    cachedToken = null;
    return null;
  }

  const paramName = `/thinkwork/${stage}/cloudflare-namespace-token`;
  let raw: string | null;
  try {
    raw = await (opts.ssmSend ?? defaultSsmSend)(paramName);
  } catch (err) {
    if (isParameterNotFound(err)) {
      cachedToken = null;
      return null;
    }
    throw new CloudflareNamespaceTokenError(paramName, err);
  }

  const trimmed = raw?.trim() ?? "";
  cachedToken =
    trimmed.length > 0 && trimmed !== CLOUDFLARE_NAMESPACE_TOKEN_PLACEHOLDER
      ? trimmed
      : null;
  return cachedToken;
}

function isParameterNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? "";
  const message = error instanceof Error ? error.message : String(error);
  return name === "ParameterNotFound" || message.includes("ParameterNotFound");
}

async function defaultSsmSend(paramName: string): Promise<string | null> {
  const { SSMClient, GetParameterCommand } =
    await import("@aws-sdk/client-ssm");
  const ssm = new SSMClient({});
  const res = await ssm.send(
    new GetParameterCommand({ Name: paramName, WithDecryption: true }),
  );
  return res.Parameter?.Value ?? null;
}

/** Test hook — drop the container-lifetime cache. */
export function __resetCloudflareNamespaceTokenCacheForTests(): void {
  cachedToken = undefined;
}

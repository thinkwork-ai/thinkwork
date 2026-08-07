/**
 * Cognito client-credentials minting for the Brain MCP machine lane
 * (THINK-628, `platform-agent`).
 *
 * The Brain's `tkt_` keys are long-lived bearer strings. The machine lane
 * replaces the platform's copy with a short-lived, issuer-signed token minted
 * from a Cognito app client. Terraform (company-brain repo) writes the lane's
 * credentials into Secrets Manager as one JSON blob:
 *
 *   { "client_id": "…", "client_secret": "…",
 *     "token_url": "https://…/oauth2/token", "scope": "brain-m2m/lane:…" }
 *
 * This module turns that blob into a cached bearer. It deliberately mirrors
 * the rules the Brain-side callers already follow (ops-api console proxy,
 * evals worker — see company-brain docs/runbooks/brain-mcp-m2m-migration.md):
 *
 *  - cache per secretRef for the token's lifetime, re-mint 5 minutes before
 *    expiry — never mint per request;
 *  - a token is an IDENTITY, never an authorization: the Brain refuses a
 *    perfectly valid token whose client_id no manifest entry names
 *    (`unknown_client`), so nothing here grants anything;
 *  - send the scope even though Cognito would default it — it keeps the
 *    token self-describing in logs.
 *
 * The cache is module-scoped (per Lambda container). Config build re-reads
 * the SECRET on every build; only the minted token is cached here.
 */

/** The wire shape terraform writes for an m2m lane secret. */
export interface M2mClientCredentials {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  scope?: string;
}

/**
 * Read m2m credentials out of a parsed secret value, or null when the secret
 * is not lane-shaped. All three core fields must be present non-empty
 * strings — a partial blob is "not a lane secret", never a guess.
 */
export function m2mCredentialsFromSecret(
  secretValue: Record<string, unknown> | string,
): M2mClientCredentials | null {
  if (typeof secretValue === "string") return null;
  const read = (key: string): string | null => {
    const value = secretValue[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };
  const clientId = read("client_id");
  const clientSecret = read("client_secret");
  const tokenUrl = read("token_url");
  if (!clientId || !clientSecret || !tokenUrl) return null;
  const scope = read("scope");
  return {
    clientId,
    clientSecret,
    tokenUrl,
    ...(scope ? { scope } : {}),
  };
}

/** Re-mint this long before `exp` so a token is never presented near-dead. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

interface CachedToken {
  token: string;
  /** Epoch ms after which the cached token must not be reused. */
  staleAt: number;
  /**
   * The client the token was minted FOR. The secret is re-read on every
   * config build, so a rotated lane (new app client, new client_id) shows up
   * here immediately — and a cached token minted for the OLD client must
   * read as stale on the spot, not after its timer. Without this check a
   * rotation serves a dead token for up to 55 minutes with no eviction path.
   */
  clientId: string;
}

const tokenCache = new Map<string, CachedToken>();

/** Test hook: drop every cached token. */
export function clearM2mTokenCache(): void {
  tokenCache.clear();
}

export interface M2mTokenDeps {
  fetch?: typeof fetch;
  now?: () => number;
}

/**
 * Bearer for a lane, minting only when the cache is empty or stale.
 *
 * `cacheKey` should be the secretRef the credentials came from: one lane =
 * one secret = one cache slot, and a rotated secret naturally lands in the
 * same slot with the new client secret.
 */
export async function cachedM2mToken(
  cacheKey: string,
  creds: M2mClientCredentials,
  deps: M2mTokenDeps = {},
): Promise<string> {
  const now = deps.now ?? Date.now;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.staleAt > now() && cached.clientId === creds.clientId) {
    return cached.token;
  }

  const minted = await mintM2mToken(creds, deps);
  tokenCache.set(cacheKey, minted);
  return minted.token;
}

/**
 * One client-credentials exchange. Throws on any failure — the caller
 * (config build) already treats a failed credential resolve as "skip this
 * server with a warning", and a thrown error is what routes there.
 */
export async function mintM2mToken(
  creds: M2mClientCredentials,
  deps: M2mTokenDeps = {},
): Promise<CachedToken> {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  if (creds.scope) body.set("scope", creds.scope);

  const response = await doFetch(creds.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization:
        "Basic " +
        Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString(
          "base64",
        ),
    },
    body: body.toString(),
  });
  if (!response.ok) {
    // Never echo the response body: a misconfigured endpoint could reflect
    // the request, and this string lands in CloudWatch.
    throw new Error(
      `m2m token mint failed: ${response.status} from token endpoint`,
    );
  }
  const parsed = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  const token =
    typeof parsed.access_token === "string" && parsed.access_token
      ? parsed.access_token
      : null;
  if (!token) throw new Error("m2m token mint returned no access_token");
  const expiresInSec =
    typeof parsed.expires_in === "number" && parsed.expires_in > 0
      ? parsed.expires_in
      : 3600;
  return {
    token,
    staleAt: now() + expiresInSec * 1000 - REFRESH_MARGIN_MS,
    clientId: creds.clientId,
  };
}

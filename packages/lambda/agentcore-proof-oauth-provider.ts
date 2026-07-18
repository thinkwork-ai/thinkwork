import {
  createHmac,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify,
} from "node:crypto";
import { KMSClient, SignCommand } from "@aws-sdk/client-kms";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

const ACCESS_TOKEN_TTL_SECONDS = 5 * 60;
const AUTH_CODE_TTL_SECONDS = 2 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60;
const PROOF_SCOPE = "owner.read";
const GATEWAY_SCOPE = "gateway:invoke";
const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
const DEFAULT_PROOF_OWNERS = new Set(["alice", "bob"]);

interface SignedProofPayload {
  kind: "authorization_code" | "refresh_token";
  owner: string;
  clientId: string;
  scope: string;
  redirectUri?: string;
  iat: number;
  exp: number;
  nonce: string;
}

interface AccessTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  scope: string;
  iat: number;
  exp: number;
  jti: string;
  token_class: "agentcore_proof_provider";
}

export interface ProofOauthProviderDeps {
  issuer: string;
  clientId: string;
  clientSecret: string;
  nowSeconds(): number;
  randomToken(): string;
  allowedOwners?: ReadonlySet<string>;
  exchangeSubjectToken?(subjectToken: string, scope: string): Promise<string>;
}

export function createProofOauthProviderHandler(deps: ProofOauthProviderDeps) {
  const issuer = normalizeIssuer(deps.issuer);
  const allowedOwners = deps.allowedOwners ?? DEFAULT_PROOF_OWNERS;
  return async function proofOauthProvider(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const method = event.requestContext.http.method;
    const path = event.rawPath.replace(/\/+$/, "") || "/";

    if (
      method === "GET" &&
      path === "/agentcore-proof/oauth/.well-known/openid-configuration"
    ) {
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        response_types_supported: ["code"],
        grant_types_supported: [
          "authorization_code",
          "refresh_token",
          TOKEN_EXCHANGE_GRANT,
        ],
        token_endpoint_auth_methods_supported: [
          "client_secret_basic",
          "client_secret_post",
        ],
        scopes_supported: [PROOF_SCOPE, GATEWAY_SCOPE],
      });
    }
    if (method === "GET" && path === "/agentcore-proof/oauth/authorize") {
      return authorize(event, deps, issuer, allowedOwners);
    }
    if (method === "POST" && path === "/agentcore-proof/oauth/token") {
      return await token(event, deps, issuer, allowedOwners);
    }
    return json(404, { error: "not_found" });
  };
}

function authorize(
  event: APIGatewayProxyEventV2,
  deps: ProofOauthProviderDeps,
  issuer: string,
  allowedOwners: ReadonlySet<string>,
): APIGatewayProxyStructuredResultV2 {
  const query = event.queryStringParameters ?? {};
  const clientId = query.client_id ?? "";
  const redirectUri = query.redirect_uri ?? "";
  const state = query.state ?? "";
  const scope = normalizeScope(query.scope ?? "");
  const owner = (query.proof_owner ?? "").toLowerCase();
  if (
    query.response_type !== "code" ||
    clientId !== deps.clientId ||
    !isHttpsUrl(redirectUri) ||
    !state ||
    !scope.split(" ").includes(PROOF_SCOPE) ||
    !allowedOwners.has(owner)
  ) {
    return json(400, { error: "invalid_request" });
  }
  const now = deps.nowSeconds();
  const code = signOpaque(
    {
      kind: "authorization_code",
      owner,
      clientId,
      scope,
      redirectUri,
      iat: now,
      exp: now + AUTH_CODE_TTL_SECONDS,
      nonce: deps.randomToken(),
    },
    deps.clientSecret,
  );
  const destination = new URL(redirectUri);
  destination.searchParams.set("code", code);
  destination.searchParams.set("state", state);
  return {
    statusCode: 302,
    headers: {
      "cache-control": "no-store",
      location: destination.toString(),
      pragma: "no-cache",
      "x-proof-oauth-issuer": issuer,
    },
  };
}

async function token(
  event: APIGatewayProxyEventV2,
  deps: ProofOauthProviderDeps,
  issuer: string,
  allowedOwners: ReadonlySet<string>,
): Promise<APIGatewayProxyStructuredResultV2> {
  const body = new URLSearchParams(decodeBody(event));
  const credentials = clientCredentials(event, body);
  if (
    credentials.clientId !== deps.clientId ||
    !constantTimeEqual(credentials.clientSecret, deps.clientSecret)
  ) {
    return oauthError(401, "invalid_client");
  }

  const now = deps.nowSeconds();
  const grantType = body.get("grant_type");
  if (grantType === TOKEN_EXCHANGE_GRANT) {
    const scope = normalizeScope(body.get("scope") ?? "");
    const subjectToken = body.get("subject_token") ?? "";
    if (!deps.exchangeSubjectToken || !subjectToken || !scope) {
      return oauthError(400, "invalid_grant");
    }
    try {
      const accessToken = await deps.exchangeSubjectToken(subjectToken, scope);
      return json(
        200,
        {
          access_token: accessToken,
          expires_in: ACCESS_TOKEN_TTL_SECONDS,
          issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
          scope,
          token_type: "Bearer",
        },
        { "cache-control": "no-store", pragma: "no-cache" },
      );
    } catch {
      return oauthError(400, "invalid_grant");
    }
  }
  let owner: string;
  let scope: string;
  let refreshToken: string;

  try {
    if (grantType === "authorization_code") {
      const code = verifyOpaque(
        body.get("code") ?? "",
        deps.clientSecret,
        now,
        "authorization_code",
        allowedOwners,
      );
      if (
        code.clientId !== deps.clientId ||
        code.redirectUri !== body.get("redirect_uri")
      ) {
        return oauthError(400, "invalid_grant");
      }
      owner = code.owner;
      scope = code.scope;
      refreshToken = signOpaque(
        {
          kind: "refresh_token",
          owner,
          clientId: deps.clientId,
          scope,
          iat: now,
          exp: now + REFRESH_TOKEN_TTL_SECONDS,
          nonce: deps.randomToken(),
        },
        deps.clientSecret,
      );
    } else if (grantType === "refresh_token") {
      const refresh = verifyOpaque(
        body.get("refresh_token") ?? "",
        deps.clientSecret,
        now,
        "refresh_token",
        allowedOwners,
      );
      if (refresh.clientId !== deps.clientId) {
        return oauthError(400, "invalid_grant");
      }
      owner = refresh.owner;
      scope = refresh.scope;
      refreshToken = body.get("refresh_token") ?? "";
    } else {
      return oauthError(400, "unsupported_grant_type");
    }
  } catch {
    return oauthError(400, "invalid_grant");
  }

  return json(
    200,
    {
      access_token: signAccessToken(
        {
          iss: issuer,
          aud: `${issuer}/target`,
          sub: owner,
          scope,
          iat: now,
          exp: now + ACCESS_TOKEN_TTL_SECONDS,
          jti: deps.randomToken(),
          token_class: "agentcore_proof_provider",
        },
        deps.clientSecret,
      ),
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope,
      token_type: "Bearer",
    },
    { "cache-control": "no-store", pragma: "no-cache" },
  );
}

export function verifyProofProviderAccessToken(
  token: string,
  args: {
    issuer: string;
    audience: string;
    secret: string;
    nowSeconds: number;
    allowedOwners?: ReadonlySet<string>;
  },
): AccessTokenClaims {
  const [headerPart, payloadPart, signaturePart, extra] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart || extra) {
    throw new Error("provider token is malformed");
  }
  const signingInput = `${headerPart}.${payloadPart}`;
  const expected = hmac(signingInput, args.secret);
  if (!constantTimeEqual(signaturePart, expected)) {
    throw new Error("provider token signature is invalid");
  }
  const header = JSON.parse(decodeBase64Url(headerPart)) as Record<
    string,
    unknown
  >;
  const claims = JSON.parse(decodeBase64Url(payloadPart)) as AccessTokenClaims;
  if (
    header.alg !== "HS256" ||
    header.typ !== "JWT" ||
    claims.iss !== normalizeIssuer(args.issuer) ||
    claims.aud !== args.audience ||
    claims.token_class !== "agentcore_proof_provider" ||
    !(args.allowedOwners ?? DEFAULT_PROOF_OWNERS).has(claims.sub) ||
    !claims.scope.split(" ").includes(PROOF_SCOPE) ||
    !Number.isInteger(claims.iat) ||
    !Number.isInteger(claims.exp) ||
    claims.iat > args.nowSeconds + 30 ||
    claims.exp <= args.nowSeconds
  ) {
    throw new Error("provider token claims are invalid");
  }
  return claims;
}

function signAccessToken(claims: AccessTokenClaims, secret: string): string {
  const header = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = encodeBase64Url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${hmac(signingInput, secret)}`;
}

function signOpaque(payload: SignedProofPayload, secret: string): string {
  const encoded = encodeBase64Url(JSON.stringify(payload));
  return `${encoded}.${hmac(encoded, secret)}`;
}

function verifyOpaque(
  token: string,
  secret: string,
  now: number,
  kind: SignedProofPayload["kind"],
  allowedOwners: ReadonlySet<string>,
): SignedProofPayload {
  const [encoded, signature, extra] = token.split(".");
  if (
    !encoded ||
    !signature ||
    extra ||
    !constantTimeEqual(signature, hmac(encoded, secret))
  ) {
    throw new Error("signed OAuth value is invalid");
  }
  const payload = JSON.parse(decodeBase64Url(encoded)) as SignedProofPayload;
  if (
    payload.kind !== kind ||
    !allowedOwners.has(payload.owner) ||
    !Number.isInteger(payload.iat) ||
    !Number.isInteger(payload.exp) ||
    payload.iat > now + 30 ||
    payload.exp <= now
  ) {
    throw new Error("signed OAuth value is expired or invalid");
  }
  return payload;
}

function clientCredentials(
  event: APIGatewayProxyEventV2,
  body: URLSearchParams,
): { clientId: string; clientSecret: string } {
  const authorization =
    event.headers.authorization ?? event.headers.Authorization;
  if (authorization?.startsWith("Basic ")) {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString(
      "utf8",
    );
    const split = decoded.indexOf(":");
    return split < 0
      ? { clientId: "", clientSecret: "" }
      : {
          clientId: decodeURIComponent(decoded.slice(0, split)),
          clientSecret: decodeURIComponent(decoded.slice(split + 1)),
        };
  }
  return {
    clientId: body.get("client_id") ?? "",
    clientSecret: body.get("client_secret") ?? "",
  };
}

function decodeBody(event: APIGatewayProxyEventV2): string {
  if (!event.body) return "";
  return event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
}

function normalizeIssuer(value: string): string {
  const issuer = value.replace(/\/+$/, "");
  if (!isHttpsUrl(issuer)) throw new Error("proof OAuth issuer must use HTTPS");
  return issuer;
}

function normalizeScope(value: string): string {
  return [...new Set(value.split(/\s+/).filter(Boolean))].sort().join(" ");
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function encodeBase64Url(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function hmac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

function oauthError(
  statusCode: number,
  error: string,
): APIGatewayProxyStructuredResultV2 {
  return json(statusCode, { error }, { "cache-control": "no-store" });
}

interface ProofSubjectClaims {
  iss: string;
  aud: string | string[];
  sub: string;
  iat: number;
  exp: number;
  tenant_id: string;
  space_id?: string;
  agent_id: string;
  thread_id: string;
  turn_id: string;
  participant_id: string;
  session_generation: number;
  purpose: string;
  scope: string;
  token_class?: string;
}

async function exchangeProofSubjectToken(args: {
  subjectToken: string;
  requestedScope: string;
  assertionIssuer: string;
  harnessAudience: string;
  gatewayAudience: string;
  proofIssuer: string;
  proofClientSecret: string;
  keyId: string;
  kid: string;
  nowSeconds: number;
  allowedOwners: ReadonlySet<string>;
}): Promise<string> {
  const scopes = args.requestedScope.split(" ");
  if (scopes.includes(PROOF_SCOPE)) {
    const claims = await verifyProofSubjectToken(args.subjectToken, {
      issuer: args.assertionIssuer,
      audience: args.gatewayAudience,
      purpose: "gateway_operation",
      requiredScope: GATEWAY_SCOPE,
      expectedTokenClass: "agentcore_proof_obo",
      nowSeconds: args.nowSeconds,
      allowedOwners: args.allowedOwners,
    });
    return signAccessToken(
      {
        iss: args.proofIssuer,
        aud: `${args.proofIssuer}/target`,
        sub: claims.sub,
        scope: PROOF_SCOPE,
        iat: args.nowSeconds,
        exp: args.nowSeconds + ACCESS_TOKEN_TTL_SECONDS,
        jti: randomUUID(),
        token_class: "agentcore_proof_provider",
      },
      args.proofClientSecret,
    );
  }
  if (!scopes.includes(GATEWAY_SCOPE)) {
    throw new Error("unsupported token-exchange scope");
  }
  const claims = await verifyProofSubjectToken(args.subjectToken, {
    issuer: args.assertionIssuer,
    audience: args.harnessAudience,
    purpose: "harness_invoke",
    requiredScope: "harness:invoke",
    nowSeconds: args.nowSeconds,
    allowedOwners: args.allowedOwners,
  });
  const gatewayClaims = {
    iss: args.assertionIssuer,
    aud: args.gatewayAudience,
    sub: claims.sub,
    jti: randomUUID(),
    iat: args.nowSeconds,
    exp: args.nowSeconds + ACCESS_TOKEN_TTL_SECONDS,
    tenant_id: claims.tenant_id,
    ...(claims.space_id ? { space_id: claims.space_id } : {}),
    agent_id: claims.agent_id,
    thread_id: claims.thread_id,
    turn_id: claims.turn_id,
    participant_id: claims.participant_id,
    session_generation: claims.session_generation,
    purpose: "gateway_operation",
    scope: GATEWAY_SCOPE,
    token_class: "agentcore_proof_obo",
  };
  const header = encodeBase64Url(
    JSON.stringify({ alg: "RS256", kid: args.kid, typ: "JWT" }),
  );
  const payload = encodeBase64Url(JSON.stringify(gatewayClaims));
  const signingInput = `${header}.${payload}`;
  const result = await new KMSClient({
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
  }).send(
    new SignCommand({
      KeyId: args.keyId,
      Message: Buffer.from(signingInput),
      MessageType: "RAW",
      SigningAlgorithm: "RSASSA_PKCS1_V1_5_SHA_256",
    }),
  );
  if (!result.Signature?.byteLength) {
    throw new Error("KMS Sign returned no token-exchange signature");
  }
  return `${signingInput}.${encodeBase64Url(result.Signature)}`;
}

async function verifyProofSubjectToken(
  token: string,
  args: {
    issuer: string;
    audience: string;
    purpose: string;
    requiredScope: string;
    expectedTokenClass?: string;
    nowSeconds: number;
    allowedOwners: ReadonlySet<string>;
  },
): Promise<ProofSubjectClaims> {
  const [encodedHeader, encodedClaims, encodedSignature, extra] =
    token.split(".");
  if (!encodedHeader || !encodedClaims || !encodedSignature || extra) {
    throw new Error("subject token is malformed");
  }
  const header = JSON.parse(decodeBase64Url(encodedHeader)) as {
    alg?: string;
    kid?: string;
  };
  const claims = JSON.parse(
    decodeBase64Url(encodedClaims),
  ) as ProofSubjectClaims;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    header.alg !== "RS256" ||
    !header.kid ||
    claims.iss !== args.issuer ||
    !audiences.includes(args.audience) ||
    claims.purpose !== args.purpose ||
    !claims.scope.split(" ").includes(args.requiredScope) ||
    (args.expectedTokenClass !== undefined &&
      claims.token_class !== args.expectedTokenClass) ||
    !args.allowedOwners.has(claims.sub) ||
    claims.participant_id !== claims.sub ||
    !Number.isInteger(claims.iat) ||
    !Number.isInteger(claims.exp) ||
    claims.iat > args.nowSeconds + 30 ||
    claims.exp <= args.nowSeconds
  ) {
    throw new Error("subject token claims are invalid");
  }
  const discovery = await fetch(
    `${args.issuer}/.well-known/openid-configuration`,
  );
  if (!discovery.ok) throw new Error("subject issuer discovery failed");
  const metadata = (await discovery.json()) as { jwks_uri?: string };
  if (!metadata.jwks_uri?.startsWith("https://")) {
    throw new Error("subject issuer has no HTTPS JWKS URI");
  }
  const jwksResponse = await fetch(metadata.jwks_uri);
  if (!jwksResponse.ok) throw new Error("subject issuer JWKS failed");
  const jwks = (await jwksResponse.json()) as {
    keys?: Array<Record<string, string>>;
  };
  const jwk = jwks.keys?.find((candidate) => candidate.kid === header.kid);
  if (!jwk) throw new Error("subject signing key was not found");
  const valid = verify(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedClaims}`),
    createPublicKey({ key: jwk, format: "jwk" }),
    Buffer.from(encodedSignature, "base64url"),
  );
  if (!valid) throw new Error("subject token signature is invalid");
  return claims;
}

export async function handler(event: APIGatewayProxyEventV2) {
  // Resolve configuration lazily so dependency-injected unit tests can import
  // this module without a deployed Lambda environment. A real invocation with
  // missing configuration still fails closed before any OAuth response.
  const allowedOwners = proofOwnerAllowlistFromEnv();
  const proofIssuer = requiredEnv("AGENTCORE_PROOF_OAUTH_ISSUER");
  const proofClientSecret = requiredEnv("AGENTCORE_PROOF_OAUTH_CLIENT_SECRET");
  return createProofOauthProviderHandler({
    issuer: proofIssuer,
    clientId: requiredEnv("AGENTCORE_PROOF_OAUTH_CLIENT_ID"),
    clientSecret: proofClientSecret,
    nowSeconds: () => Math.floor(Date.now() / 1000),
    randomToken: () => randomBytes(24).toString("base64url"),
    allowedOwners,
    exchangeSubjectToken: (subjectToken, scope) =>
      exchangeProofSubjectToken({
        subjectToken,
        requestedScope: scope,
        assertionIssuer: requiredEnv("AGENTCORE_ASSERTION_ISSUER"),
        harnessAudience: requiredEnv("AGENTCORE_HARNESS_AUDIENCE"),
        gatewayAudience: requiredEnv("AGENTCORE_GATEWAY_AUDIENCE"),
        proofIssuer,
        proofClientSecret,
        keyId: requiredEnv("AGENTCORE_TURN_ASSERTION_KMS_KEY_ID"),
        kid: requiredEnv("AGENTCORE_TURN_ASSERTION_KID"),
        nowSeconds: Math.floor(Date.now() / 1000),
        allowedOwners,
      }),
  })(event);
}

export function proofOwnerAllowlistFromEnv(
  value = process.env.AGENTCORE_PROOF_OWNER_ALLOWLIST,
): ReadonlySet<string> {
  if (!value?.trim()) {
    throw new Error("AGENTCORE_PROOF_OWNER_ALLOWLIST is required");
  }
  const owners = new Set(
    value
      .split(",")
      .map((owner) => owner.trim().toLowerCase())
      .filter(Boolean),
  );
  if (owners.size < 2) {
    throw new Error("AgentCore proof requires at least two allowed owners");
  }
  return owners;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

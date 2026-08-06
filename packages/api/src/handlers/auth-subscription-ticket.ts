import { authSubscriptionTickets } from "@thinkwork/database-pg/schema";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { and, eq, gte, sql } from "drizzle-orm";
import { getConfig } from "@thinkwork/runtime-config";

import { admitCognitoTenant } from "../lib/auth-admission.js";
import {
  authStateStoreMode,
  bumpCounter,
  putTicket,
} from "../lib/auth-state-store.js";
import { authenticate, type AuthResult } from "../lib/cognito-auth.js";
import { db } from "../lib/db.js";
import {
  error,
  forbidden,
  handleCors,
  json,
  unauthorized,
} from "../lib/response.js";
import { admitSubscriptionOperation } from "../lib/subscription-admission.js";
import {
  resolveSubscriptionTicketSigner,
  subscriptionTicketNonce,
  subscriptionTicketNonceDigest,
  type SubscriptionTicketClaims,
  type SubscriptionTicketSigner,
} from "../lib/subscription-ticket-signing.js";

const MAX_TICKET_TTL_SECONDS = 60;

/**
 * Backstop against a looping client. A healthy client reconnects roughly once a
 * minute at worst (connect tickets are reusable for 45s of their 60s TTL), so
 * 10 per minute is ~10x headroom while still capping a runaway tab.
 */
const CONNECT_TICKET_RATE_WINDOW_SECONDS = 60;
const MAX_CONNECT_TICKETS_PER_WINDOW = 10;

interface TicketRequest {
  kind: "connect" | "registration";
  tenantId?: string;
  operationName?: string;
  query?: string;
  variables?: Record<string, unknown>;
}

export interface AuthSubscriptionTicketDependencies {
  authenticate(
    headers: Record<string, string | undefined>,
  ): Promise<AuthResult | null>;
  signer(): Promise<SubscriptionTicketSigner | null>;
  admit(
    auth: AuthResult,
    tenantId?: string,
  ): Promise<{
    userId: string;
    tenantId: string;
    route: NonNullable<AuthResult["route"]>;
  }>;
  admitOperation(input: {
    operationName: string;
    query: string;
    variables: Record<string, unknown>;
    userId: string;
    tenantId: string;
  }): Promise<{
    operationName: string;
    operationHash: string;
    resourceKind: "tenant" | "user" | "thread";
    resourceId: string;
  }>;
  persist(input: {
    nonceDigest: string;
    claims: SubscriptionTicketClaims;
  }): Promise<void>;
  countRecentConnectTickets(input: {
    cognitoIssuer: string;
    cognitoSub: string;
    since: Date;
  }): Promise<number>;
  now(): number;
  stage(): string;
  audience(): string;
}

/** Exported for THINK-643 store-routing tests; the handler default. */
export const defaultDependencies: AuthSubscriptionTicketDependencies = {
  authenticate,
  signer: resolveSubscriptionTicketSigner,
  admit: admitCognitoTenant,
  admitOperation: admitSubscriptionOperation,
  async persist(input) {
    if (authStateStoreMode() === "dynamo") {
      await persistTicketDynamo(input);
      return;
    }
    await persistTicketPostgres(input);
  },
  async countRecentConnectTickets(input) {
    return authStateStoreMode() === "dynamo"
      ? countRecentConnectTicketsDynamo(input)
      : countRecentConnectTicketsPostgres(input);
  },
  now: () => Math.floor(Date.now() / 1000),
  stage: () => getConfig("STAGE", ""),
  audience: () => getConfig("APPSYNC_API_ID", ""),
};

/** THINK-643: unchanged Aurora path. Active while AUTH_STATE_STORE=postgres. */
export async function persistTicketPostgres({
  nonceDigest,
  claims,
}: {
  nonceDigest: string;
  claims: SubscriptionTicketClaims;
}): Promise<void> {
  await db.insert(authSubscriptionTickets).values({
    nonce_digest: nonceDigest,
    kind: claims.kind,
    status: "issued",
    stage: claims.stage,
    appsync_api_id: claims.audience,
    key_id: claims.keyId,
    cognito_issuer: claims.cognitoIssuer,
    cognito_sub: claims.cognitoSub,
    user_id: claims.userId,
    tenant_id: claims.tenantId,
    auth_route_client_id: claims.routeClientId,
    operation_name: claims.operationName ?? null,
    operation_hash: claims.operationHash ?? null,
    resource_kind: claims.resourceKind ?? null,
    resource_id: claims.resourceId ?? null,
    expires_at: new Date(claims.expiresAt * 1000),
  });
}

/** THINK-643: DynamoDB path. Same claim set, TTL'd item instead of a row. */
export async function persistTicketDynamo({
  nonceDigest,
  claims,
}: {
  nonceDigest: string;
  claims: SubscriptionTicketClaims;
}): Promise<void> {
  await putTicket({
    nonceDigest,
    kind: claims.kind,
    stage: claims.stage,
    audience: claims.audience,
    keyId: claims.keyId,
    cognitoIssuer: claims.cognitoIssuer,
    cognitoSub: claims.cognitoSub,
    userId: claims.userId,
    tenantId: claims.tenantId,
    routeClientId: claims.routeClientId,
    operationName: claims.operationName,
    operationHash: claims.operationHash,
    resourceKind: claims.resourceKind,
    resourceId: claims.resourceId,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
  });
}

/**
 * Unchanged Aurora path — counts against the leading columns of
 * idx_auth_subscription_tickets_principal.
 */
export async function countRecentConnectTicketsPostgres({
  cognitoIssuer,
  cognitoSub,
  since,
}: {
  cognitoIssuer: string;
  cognitoSub: string;
  since: Date;
}): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(authSubscriptionTickets)
    .where(
      and(
        eq(authSubscriptionTickets.cognito_issuer, cognitoIssuer),
        eq(authSubscriptionTickets.cognito_sub, cognitoSub),
        eq(authSubscriptionTickets.kind, "connect"),
        gte(authSubscriptionTickets.created_at, since),
      ),
    );
  return row?.count ?? 0;
}

/**
 * THINK-643: the same backstop as an atomic TTL-windowed DynamoDB counter.
 *
 * Two deliberate semantic differences from the Postgres COUNT, both of which
 * make the backstop slightly *stricter* — acceptable for a runaway-tab guard
 * with 10x headroom, and neither is an authorization control:
 *
 *  - Fixed windows, not sliding. A principal gets MAX per aligned 60s bucket
 *    rather than per trailing 60s, so a burst straddling a boundary can briefly
 *    see up to 2x MAX. The Postgres query had the opposite skew.
 *  - It counts *attempts*, not successful mints — the counter is bumped before
 *    admission, so tickets that are later denied still consume budget.
 *
 * Returns the count of PRIOR attempts in the window (bump returns the
 * post-increment value) so the caller's `>= MAX` comparison is unchanged.
 */
export async function countRecentConnectTicketsDynamo({
  cognitoIssuer,
  cognitoSub,
}: {
  cognitoIssuer: string;
  cognitoSub: string;
}): Promise<number> {
  const count = await bumpCounter(
    `connect#${cognitoIssuer}#${cognitoSub}`,
    CONNECT_TICKET_RATE_WINDOW_SECONDS,
  );
  return Math.max(0, count - 1);
}

export function createAuthSubscriptionTicketHandler(
  dependencies: AuthSubscriptionTicketDependencies = defaultDependencies,
) {
  return async function authSubscriptionTicketHandler(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const preflight = handleCors(event);
    if (preflight) return preflight;
    if (event.requestContext.http.method !== "POST")
      return error("Method not allowed", 405);
    const auth = await dependencies.authenticate(
      event.headers as Record<string, string | undefined>,
    );
    if (
      !auth ||
      auth.authType !== "cognito" ||
      !auth.principalId ||
      !auth.cognitoIssuer ||
      !auth.route
    ) {
      return unauthorized("Authentication required");
    }
    const request = parseRequest(event);
    if (!request) return error("Invalid subscription ticket request", 400);
    const stage = dependencies.stage();
    const audience = dependencies.audience();
    const signer = await dependencies.signer();
    if (!stage || !audience || !signer) {
      console.error(
        "[auth-subscription-ticket] signing configuration unavailable",
      );
      return error("Realtime authorization unavailable", 503);
    }
    if (request.kind === "connect") {
      const recent = await countRecentConnectTickets(dependencies, {
        cognitoIssuer: auth.cognitoIssuer,
        cognitoSub: auth.principalId,
      });
      if (recent !== null && recent >= MAX_CONNECT_TICKETS_PER_WINDOW) {
        console.warn("[auth-subscription-ticket] connect ticket rate limited", {
          cognitoSub: auth.principalId,
          recent,
        });
        return error("Too many realtime connection attempts", 429);
      }
    }
    try {
      const admitted = await dependencies.admit(auth, request.tenantId);
      let operation:
        | Awaited<
            ReturnType<AuthSubscriptionTicketDependencies["admitOperation"]>
          >
        | undefined;
      if (request.kind === "registration") {
        operation = await dependencies.admitOperation({
          operationName: request.operationName!,
          query: request.query!,
          variables: request.variables!,
          userId: admitted.userId,
          tenantId: admitted.tenantId,
        });
      }
      const issuedAt = dependencies.now();
      const nonce = subscriptionTicketNonce();
      const unsignedClaims: Omit<SubscriptionTicketClaims, "keyId"> = {
        version: 1,
        domain: "thinkwork.appsync.subscription.v1",
        algorithm: "Ed25519",
        issuer: "thinkwork-auth",
        stage,
        audience,
        kind: request.kind,
        nonce,
        issuedAt,
        expiresAt: issuedAt + MAX_TICKET_TTL_SECONDS,
        cognitoIssuer: auth.cognitoIssuer,
        cognitoSub: auth.principalId,
        userId: admitted.userId,
        tenantId: admitted.tenantId,
        routeClientId: admitted.route.routeClientId,
        appClientId: admitted.route.appClientId,
        ...(operation
          ? {
              operationName: operation.operationName,
              operationHash: operation.operationHash,
              resourceKind: operation.resourceKind,
              resourceId: operation.resourceId,
            }
          : {}),
      };
      const token = signer.sign(unsignedClaims);
      const claims: SubscriptionTicketClaims = {
        ...unsignedClaims,
        keyId: signer.keyId,
      };
      await dependencies.persist({
        nonceDigest: subscriptionTicketNonceDigest(nonce),
        claims,
      });
      return json({ token, kind: claims.kind, expiresAt: claims.expiresAt });
    } catch (cause) {
      const code =
        typeof cause === "object" && cause !== null && "code" in cause
          ? String(cause.code)
          : "admission_failed";
      console.warn("[auth-subscription-ticket] ticket denied", { code });
      return forbidden("Subscription is not authorized");
    }
  };
}

/**
 * Fail open (null) if the counting query itself fails — the rate limit is a
 * backstop, not an authorization control, and must not take realtime down.
 */
async function countRecentConnectTickets(
  dependencies: AuthSubscriptionTicketDependencies,
  principal: { cognitoIssuer: string; cognitoSub: string },
): Promise<number | null> {
  const since = new Date(
    (dependencies.now() - CONNECT_TICKET_RATE_WINDOW_SECONDS) * 1000,
  );
  try {
    return await dependencies.countRecentConnectTickets({
      ...principal,
      since,
    });
  } catch (cause) {
    console.warn("[auth-subscription-ticket] rate-limit count failed", {
      cause,
    });
    return null;
  }
}

function parseRequest(event: APIGatewayProxyEventV2): TicketRequest | null {
  if (!event.body) return null;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    const body = JSON.parse(raw) as Partial<TicketRequest>;
    if (
      (body.kind !== "connect" && body.kind !== "registration") ||
      (body.tenantId !== undefined &&
        (typeof body.tenantId !== "string" || body.tenantId.length === 0))
    ) {
      return null;
    }
    if (body.kind === "connect")
      return {
        kind: body.kind,
        ...(body.tenantId ? { tenantId: body.tenantId } : {}),
      };
    if (
      typeof body.operationName !== "string" ||
      typeof body.query !== "string" ||
      !body.variables ||
      typeof body.variables !== "object" ||
      Array.isArray(body.variables)
    ) {
      return null;
    }
    return {
      kind: body.kind,
      ...(body.tenantId ? { tenantId: body.tenantId } : {}),
      operationName: body.operationName,
      query: body.query,
      variables: body.variables,
    };
  } catch {
    return null;
  }
}

export const handler = createAuthSubscriptionTicketHandler();

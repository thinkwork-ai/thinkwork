import { authSubscriptionTickets } from "@thinkwork/database-pg/schema";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { getConfig } from "@thinkwork/runtime-config";

import { admitCognitoTenant } from "../lib/auth-admission.js";
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
  now(): number;
  stage(): string;
  audience(): string;
}

const defaultDependencies: AuthSubscriptionTicketDependencies = {
  authenticate,
  signer: resolveSubscriptionTicketSigner,
  admit: admitCognitoTenant,
  admitOperation: admitSubscriptionOperation,
  async persist({ nonceDigest, claims }) {
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
  },
  now: () => Math.floor(Date.now() / 1000),
  stage: () => getConfig("STAGE", ""),
  audience: () => getConfig("APPSYNC_API_ID", ""),
};

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

import { and, eq, gt } from "drizzle-orm";
import { authSubscriptionTickets } from "@thinkwork/database-pg/schema";
import { getConfig } from "@thinkwork/runtime-config";

import {
  admitCognitoTenant,
  resolveCognitoRouteProvenance,
} from "../lib/auth-admission.js";
import type { AuthResult } from "../lib/cognito-auth.js";
import { db } from "../lib/db.js";
import { admitSubscriptionOperation } from "../lib/subscription-admission.js";
import {
  configuredSubscriptionTicketVerificationKeys,
  subscriptionTicketNonceDigest,
  verifySubscriptionTicket,
  type SubscriptionTicketClaims,
} from "../lib/subscription-ticket-signing.js";

interface AppSyncAuthorizerEvent {
  authorizationToken?: string;
  requestContext?: {
    apiId?: string;
    queryString?: string;
    operationName?: string;
    variables?: Record<string, unknown>;
  };
}

interface AuthorizerResponse {
  isAuthorized: boolean;
  resolverContext?: Record<string, string>;
  ttlOverride: number;
}

export interface AppSyncSubscriptionAuthorizerDependencies {
  verify(token: string, apiId: string): SubscriptionTicketClaims;
  consume(claims: SubscriptionTicketClaims): Promise<boolean>;
  revalidate(
    claims: SubscriptionTicketClaims,
    context: NonNullable<AppSyncAuthorizerEvent["requestContext"]>,
  ): Promise<boolean>;
}

const defaultDependencies: AppSyncSubscriptionAuthorizerDependencies = {
  verify(token, apiId) {
    return verifySubscriptionTicket(token, {
      stage: getConfig("STAGE", ""),
      audience: apiId,
      keys: configuredSubscriptionTicketVerificationKeys(),
    });
  },
  async consume(claims) {
    const rows = await db
      .update(authSubscriptionTickets)
      .set({ status: "consumed", consumed_at: new Date() })
      .where(
        and(
          eq(
            authSubscriptionTickets.nonce_digest,
            subscriptionTicketNonceDigest(claims.nonce),
          ),
          eq(authSubscriptionTickets.kind, claims.kind),
          eq(authSubscriptionTickets.status, "issued"),
          eq(authSubscriptionTickets.stage, claims.stage),
          eq(authSubscriptionTickets.appsync_api_id, claims.audience),
          eq(authSubscriptionTickets.key_id, claims.keyId),
          eq(authSubscriptionTickets.cognito_issuer, claims.cognitoIssuer),
          eq(authSubscriptionTickets.cognito_sub, claims.cognitoSub),
          eq(authSubscriptionTickets.user_id, claims.userId),
          eq(authSubscriptionTickets.tenant_id, claims.tenantId),
          eq(
            authSubscriptionTickets.auth_route_client_id,
            claims.routeClientId,
          ),
          gt(authSubscriptionTickets.expires_at, new Date()),
        ),
      )
      .returning({ id: authSubscriptionTickets.id });
    return rows.length === 1;
  },
  async revalidate(claims, context) {
    const poolId = claims.cognitoIssuer.split("/").pop();
    if (!poolId) return false;
    const route = await resolveCognitoRouteProvenance({
      userPoolId: poolId,
      appClientId: claims.appClientId,
      cognitoSub: claims.cognitoSub,
    });
    const auth: AuthResult = {
      principalId: claims.cognitoSub,
      tenantId: null,
      email: null,
      emailVerified: false,
      authType: "cognito",
      agentId: null,
      cognitoIssuer: claims.cognitoIssuer,
      route,
    };
    const admitted = await admitCognitoTenant(auth, claims.tenantId);
    if (
      admitted.userId !== claims.userId ||
      admitted.tenantId !== claims.tenantId ||
      admitted.route.routeClientId !== claims.routeClientId ||
      admitted.route.appClientId !== claims.appClientId
    ) {
      return false;
    }
    if (claims.kind === "connect") {
      return context.operationName === "DeepDish:Connect";
    }
    if (
      !context.queryString ||
      !context.operationName ||
      context.operationName !== claims.operationName
    ) {
      return false;
    }
    const operation = await admitSubscriptionOperation({
      operationName: context.operationName,
      query: context.queryString,
      variables: context.variables ?? {},
      userId: admitted.userId,
      tenantId: admitted.tenantId,
    });
    return (
      operation.operationHash === claims.operationHash &&
      operation.resourceKind === claims.resourceKind &&
      operation.resourceId === claims.resourceId
    );
  },
};

const denied = (): AuthorizerResponse => ({
  isAuthorized: false,
  ttlOverride: 0,
});

export function createAppSyncSubscriptionAuthorizer(
  dependencies: AppSyncSubscriptionAuthorizerDependencies = defaultDependencies,
) {
  return async function appsyncSubscriptionAuthorizer(
    event: AppSyncAuthorizerEvent,
  ): Promise<AuthorizerResponse> {
    const token = event.authorizationToken;
    const context = event.requestContext;
    const apiId = context?.apiId;
    if (!token || !apiId || !context) return denied();
    try {
      const claims = dependencies.verify(token, apiId);
      const expectedKind =
        context.operationName === "DeepDish:Connect"
          ? "connect"
          : "registration";
      if (claims.kind !== expectedKind) return denied();
      // Compare all request-bound state before atomically burning the nonce.
      if (claims.kind === "registration") {
        if (
          context.operationName !== claims.operationName ||
          !context.queryString ||
          !context.variables
        ) {
          return denied();
        }
      }
      if (!(await dependencies.consume(claims))) return denied();
      if (!(await dependencies.revalidate(claims, context))) return denied();
      return {
        isAuthorized: true,
        ttlOverride: 0,
        resolverContext: {
          stableUserId: claims.userId,
          tenantId: claims.tenantId,
          routeClientId: claims.routeClientId,
          ticketKind: claims.kind,
          ...(claims.resourceKind ? { resourceKind: claims.resourceKind } : {}),
          ...(claims.resourceId ? { resourceId: claims.resourceId } : {}),
        },
      };
    } catch (cause) {
      const code =
        typeof cause === "object" && cause !== null && "code" in cause
          ? String(cause.code)
          : "authorization_failed";
      console.warn("[appsync-subscription-authorizer] ticket rejected", {
        code,
      });
      return denied();
    }
  };
}

export const handler = createAppSyncSubscriptionAuthorizer();

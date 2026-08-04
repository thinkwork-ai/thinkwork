import type { GraphQLContext } from "../../context.js";
import type { AuthResult } from "../../../lib/cognito-auth.js";

export interface ResolvedCaller {
  userId: string | null;
  tenantId: string | null;
}

/**
 * Resolve a caller only after the full native-auth admission chain succeeds.
 *
 * Cognito signature validation happens earlier. This boundary additionally
 * requires an admitted route client, an exact active user_auth_identities row,
 * an active tenant policy that permits that connection, and active membership.
 * Email is deliberately absent from the resolution path.
 */
export async function resolveCallerFromAuth(
  auth: AuthResult,
  requestedTenantId?: string,
): Promise<ResolvedCaller> {
  if (auth.authType === "apikey" || auth.authType === "service") {
    return { userId: auth.principalId, tenantId: auth.tenantId };
  }
  if (auth.authType !== "cognito") {
    return { userId: null, tenantId: null };
  }
  const { admitCognitoTenant, AuthAdmissionError } =
    await import("../../../lib/auth-admission.js");
  try {
    const admitted = await admitCognitoTenant(auth, requestedTenantId);
    return { userId: admitted.userId, tenantId: admitted.tenantId };
  } catch (error) {
    if (error instanceof AuthAdmissionError) {
      console.warn("[resolve-auth-user] Cognito tenant admission denied", {
        code: error.code,
        appClientId: auth.route?.appClientId ?? null,
        requestedTenantId: requestedTenantId ?? null,
      });
      return { userId: null, tenantId: null };
    }
    throw error;
  }
}

export async function resolveCaller(
  ctx: GraphQLContext,
  requestedTenantId?: string,
): Promise<ResolvedCaller> {
  return resolveCallerFromAuth(ctx.auth, requestedTenantId);
}

/** Resolve against an independently selected resource tenant. */
export async function resolveCallerForTenant(
  ctx: GraphQLContext,
  tenantId: string,
): Promise<ResolvedCaller> {
  return resolveCallerFromAuth(ctx.auth, tenantId);
}

export async function resolveCallerUserId(
  ctx: GraphQLContext,
  requestedTenantId?: string,
): Promise<string | null> {
  const { userId } = await resolveCaller(ctx, requestedTenantId);
  return userId;
}

export async function resolveCallerTenantId(
  ctx: GraphQLContext,
  requestedTenantId?: string,
): Promise<string | null> {
  const { tenantId } = await resolveCaller(ctx, requestedTenantId);
  return tenantId;
}

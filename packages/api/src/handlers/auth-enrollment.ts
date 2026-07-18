import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { and, eq, sql } from "drizzle-orm";
import {
  authIdentityEnrollments,
  authSubscriptionInvalidations,
  tenantMembers,
  tenants,
  userAuthIdentities,
} from "@thinkwork/database-pg/schema";

import { authenticate, type AuthResult } from "../lib/cognito-auth.js";
import { db } from "../lib/db.js";
import { error, handleCors, json, unauthorized } from "../lib/response.js";

export type EnrollmentOutcome =
  | "consumed"
  | "invalid_grant"
  | "invalid_challenge"
  | "expired"
  | "already_consumed"
  | "wrong_route"
  | "wrong_redirect"
  | "identity_conflict";

export interface EnrollmentConsumeInput {
  startToken: string;
  recipientChallenge: string;
  redirectUri: string;
}

export interface IssuedEnrollmentGrant {
  startToken: string;
  recipientChallenge: string;
  expiresAt: Date;
  routeKeys: string[];
}

type AuthEnrollmentTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

/**
 * Issue one opaque bearer/challenge pair across every requested client-family
 * route for the tenant. Digests are route-domain-separated, so selecting a
 * provider does not let the grant cross to another app client or connection.
 */
export async function issueEnrollmentGrants(input: {
  tenantId: string;
  intendedUserId: string;
  membershipId: string;
  redirectUri: string;
  additionalRoutes?: Array<{
    clientFamily: "mobile" | "desktop" | "cli";
    redirectUri: string;
  }>;
  ttlMs?: number;
  now?: Date;
  grantKind?: "membership" | "pending_owner";
  transaction?: AuthEnrollmentTransaction;
}): Promise<IssuedEnrollmentGrant> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? 30 * 60_000));
  const startToken = randomBytes(32).toString("base64url");
  const recipientChallenge = String(randomInt(0, 100_000_000)).padStart(8, "0");
  type EnrollmentRoute = {
    route_client_id: string;
    route_key: string;
    connection_id: string;
    redirect_uri: string;
  };
  const targets = [
    { clientFamily: "web", redirectUri: input.redirectUri },
    ...(input.additionalRoutes ?? []),
  ];
  const routes: EnrollmentRoute[] = [];
  const database = input.transaction ?? db;
  for (const target of targets) {
    const result = await database.execute<
      Omit<EnrollmentRoute, "redirect_uri">
    >(sql`
      SELECT DISTINCT
        rc.id AS route_client_id,
        rc.route_key,
        apr.id AS connection_id
      FROM auth_route_clients rc
      JOIN auth_provider_resources apr
        ON apr.cognito_app_client_ids ? rc.cognito_app_client_id
      LEFT JOIN tenant_auth_provider_references tapr
        ON tapr.auth_provider_resource_id = apr.id
       AND tapr.tenant_id = ${input.tenantId}
       AND tapr.status = 'enabled'
      JOIN tenant_auth_policies tap
        ON tap.tenant_id = ${input.tenantId}
       AND tap.status = 'active'
      WHERE rc.client_family = ${target.clientFamily}
        AND rc.lifecycle_state = 'native'
        AND rc.validation_status = 'valid'
        AND apr.lifecycle_state = 'native'
        AND apr.validation_status = 'valid'
        AND rc.redirect_uris @> jsonb_build_array(${target.redirectUri}::text)
        AND (
          apr.provider_kind IN ('local', 'google', 'microsoft_organizations')
          OR tapr.id IS NOT NULL
        )
    `);
    routes.push(
      ...result.rows.map((route) => ({
        ...route,
        redirect_uri: target.redirectUri,
      })),
    );
  }
  if (routes.length === 0) {
    throw new Error("No admitted enrollment route is available");
  }

  const persist = async (tx: AuthEnrollmentTransaction) => {
    await tx
      .update(authIdentityEnrollments)
      .set({ status: "revoked", updated_at: now })
      .where(
        and(
          eq(authIdentityEnrollments.recipient_grant_id, input.membershipId),
          eq(authIdentityEnrollments.status, "pending"),
        ),
      );
    await tx.insert(authIdentityEnrollments).values(
      routes.map((route) => ({
        tenant_id: input.tenantId,
        intended_user_id: input.intendedUserId,
        recipient_grant_kind: input.grantKind ?? "membership",
        recipient_grant_id: input.membershipId,
        auth_provider_resource_id: route.connection_id,
        auth_route_client_id: route.route_client_id,
        redirect_uri: route.redirect_uri,
        nonce_digest: enrollmentDigest(startToken, route.route_client_id),
        recipient_challenge_digest: enrollmentDigest(
          recipientChallenge,
          route.route_client_id,
        ),
        status: "pending",
        expires_at: expiresAt,
        proof: { routeKey: route.route_key },
      })),
    );
  };
  if (input.transaction) {
    await persist(input.transaction);
  } else {
    await db.transaction(persist);
  }
  return {
    startToken,
    recipientChallenge,
    expiresAt,
    routeKeys: routes.map((route) => route.route_key),
  };
}

export function enrollmentDigest(
  secret: string,
  routeClientId: string,
): string {
  return createHash("sha256")
    .update("thinkwork-auth-enrollment-v1\0")
    .update(routeClientId)
    .update("\0")
    .update(secret)
    .digest("hex");
}

export async function consumeEnrollment(
  input: EnrollmentConsumeInput,
  auth: AuthResult,
  now = new Date(),
): Promise<EnrollmentOutcome> {
  if (
    auth.authType !== "cognito" ||
    !auth.principalId ||
    !auth.cognitoIssuer ||
    !auth.route
  ) {
    return "invalid_grant";
  }
  const route = auth.route;
  const cognitoIssuer = auth.cognitoIssuer;
  const cognitoSub = auth.principalId;
  const nonceDigest = enrollmentDigest(input.startToken, route.routeClientId);
  const challengeDigest = enrollmentDigest(
    input.recipientChallenge,
    route.routeClientId,
  );

  return db.transaction(async (tx) => {
    const [enrollment] = await tx
      .select()
      .from(authIdentityEnrollments)
      .where(eq(authIdentityEnrollments.nonce_digest, nonceDigest))
      .for("update");
    if (!enrollment) return "invalid_grant";
    if (!enrollment.intended_user_id) return "invalid_grant";
    if (enrollment.status === "consumed") return "already_consumed";
    if (enrollment.status !== "pending" || enrollment.expires_at <= now) {
      if (enrollment.status === "pending") {
        await tx
          .update(authIdentityEnrollments)
          .set({ status: "expired", updated_at: now })
          .where(eq(authIdentityEnrollments.id, enrollment.id));
      }
      return "expired";
    }
    if (enrollment.auth_route_client_id !== route.routeClientId) {
      return "wrong_route";
    }
    if (enrollment.auth_provider_resource_id !== route.connectionId) {
      return "wrong_route";
    }
    if (enrollment.redirect_uri !== input.redirectUri) return "wrong_redirect";
    if (
      !safeDigestEqual(enrollment.recipient_challenge_digest, challengeDigest)
    ) {
      return "invalid_challenge";
    }

    const [conflict] = await tx
      .select({ userId: userAuthIdentities.user_id })
      .from(userAuthIdentities)
      .where(
        and(
          eq(userAuthIdentities.cognito_issuer, cognitoIssuer),
          eq(userAuthIdentities.cognito_sub, cognitoSub),
        ),
      )
      .limit(1);
    if (conflict && conflict.userId !== enrollment.intended_user_id) {
      return "identity_conflict";
    }

    if (!conflict) {
      await tx.insert(userAuthIdentities).values({
        tenant_id: enrollment.tenant_id,
        user_id: enrollment.intended_user_id,
        auth_provider_resource_id: route.connectionId,
        cognito_issuer: cognitoIssuer,
        cognito_sub: cognitoSub,
        provider_issuer: route.providerIssuer ?? cognitoIssuer,
        // The route-specific Cognito profile is the immutable subject at the
        // application trust boundary. Email and domain claims are never used.
        provider_subject: cognitoSub,
        status: "active",
        proof_kind: "recipient_challenge",
        evidence: {
          appClientId: route.appClientId,
          connectionKey: route.connectionKey,
          routeKey: route.routeKey,
        },
        activated_at: now,
      });
    }

    await tx
      .update(tenantMembers)
      .set({ status: "active", updated_at: now })
      .where(
        and(
          eq(tenantMembers.id, enrollment.recipient_grant_id),
          eq(tenantMembers.tenant_id, enrollment.tenant_id),
          eq(tenantMembers.principal_type, "user"),
          eq(tenantMembers.principal_id, enrollment.intended_user_id),
        ),
      );
    if (enrollment.recipient_grant_kind === "pending_owner") {
      await tx
        .update(tenants)
        .set({
          pending_owner_email: null,
          first_admin_claim_required: false,
          first_admin_claimed_at: now,
          first_admin_claimed_user_id: enrollment.intended_user_id,
          updated_at: now,
        })
        .where(eq(tenants.id, enrollment.tenant_id));
    }
    await tx
      .update(authIdentityEnrollments)
      .set({
        status: "consumed",
        consumed_at: now,
        updated_at: now,
        proof: {
          routeClientId: route.routeClientId,
          connectionId: route.connectionId,
          cognitoIssuer,
          cognitoSubDigest: createHash("sha256")
            .update(cognitoSub)
            .digest("hex"),
        },
      })
      .where(eq(authIdentityEnrollments.id, enrollment.id));
    await tx.insert(authSubscriptionInvalidations).values({
      tenant_id: enrollment.tenant_id,
      user_id: enrollment.intended_user_id,
      resource_kind: "identity_enrollment",
      reason: "identity_enrollment_consumed",
    });
    return "consumed";
  });
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const preflight = handleCors(event);
  if (preflight) return preflight;
  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }
  const auth = await authenticate(
    event.headers as Record<string, string | undefined>,
  );
  if (!auth || auth.authType !== "cognito") {
    return unauthorized("Authentication required");
  }
  let input: EnrollmentConsumeInput;
  try {
    const parsed = JSON.parse(
      event.body ?? "{}",
    ) as Partial<EnrollmentConsumeInput>;
    if (
      !parsed.startToken ||
      !parsed.recipientChallenge ||
      !parsed.redirectUri
    ) {
      return error("Invalid enrollment request", 400);
    }
    input = parsed as EnrollmentConsumeInput;
  } catch {
    return error("Invalid enrollment request", 400);
  }
  const outcome = await consumeEnrollment(input, auth);
  const status =
    outcome === "consumed" ? 200 : outcome === "identity_conflict" ? 409 : 400;
  return json({ outcome }, status);
}

function safeDigestEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

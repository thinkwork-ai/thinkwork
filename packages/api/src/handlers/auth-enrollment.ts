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
import { and, eq, ne, sql } from "drizzle-orm";
import {
  authIdentityEnrollments,
  authSubscriptionInvalidations,
  tenantMembers,
  tenants,
  userAuthIdentities,
} from "@thinkwork/database-pg/schema";

import { authenticate, type AuthResult } from "../lib/cognito-auth.js";
import {
  admitCognitoTenant,
  AuthAdmissionError,
} from "../lib/auth-admission.js";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
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

export interface IdentityRecoveryGrantInput {
  tenantId: string;
  userId: string;
  redirectUri: string;
}

export interface SessionMigrationGrantInput {
  redirectUri: string;
}

export class IdentityRecoveryGrantError extends Error {
  constructor(
    readonly code:
      | "active_membership_not_found"
      | "quarantined_identity_not_found",
  ) {
    super(code);
    this.name = "IdentityRecoveryGrantError";
  }
}

type AuthEnrollmentTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

const MAX_RECIPIENT_CHALLENGE_ATTEMPTS = 5;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  grantKind?:
    | "membership"
    | "pending_owner"
    | "identity_recovery"
    | "session_migration";
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

/**
 * Issue a recovery grant for an existing user without trusting an email
 * address or accepting a Cognito subject from the operator. The replacement
 * subject is bound only when the intended user authenticates through an
 * admitted Cognito route and proves possession of the recipient challenge.
 */
export async function issueIdentityRecoveryGrant(
  input: IdentityRecoveryGrantInput,
): Promise<IssuedEnrollmentGrant> {
  return db.transaction(async (tx) => {
    const [membership] = await tx
      .select({ id: tenantMembers.id })
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.tenant_id, input.tenantId),
          eq(tenantMembers.principal_type, "user"),
          eq(tenantMembers.principal_id, input.userId),
          eq(tenantMembers.status, "active"),
        ),
      )
      .for("update");
    if (!membership) {
      throw new IdentityRecoveryGrantError("active_membership_not_found");
    }

    const [quarantinedIdentity] = await tx
      .select({ id: userAuthIdentities.id })
      .from(userAuthIdentities)
      .where(
        and(
          eq(userAuthIdentities.tenant_id, input.tenantId),
          eq(userAuthIdentities.user_id, input.userId),
          eq(userAuthIdentities.status, "quarantined"),
        ),
      )
      .limit(1);
    if (!quarantinedIdentity) {
      throw new IdentityRecoveryGrantError("quarantined_identity_not_found");
    }

    return issueEnrollmentGrants({
      tenantId: input.tenantId,
      intendedUserId: input.userId,
      membershipId: membership.id,
      grantKind: "identity_recovery",
      redirectUri: input.redirectUri,
      transaction: tx,
    });
  });
}

/**
 * Turn an admitted, still-live WorkOS rollback session into a one-use native
 * proof grant. The grant is bound to the immutable user/membership admitted by
 * that session; email is never consulted.
 */
export async function issueSessionMigrationGrant(
  auth: AuthResult,
  input: SessionMigrationGrantInput,
  now = new Date(),
): Promise<IssuedEnrollmentGrant> {
  if (
    auth.authType !== "cognito" ||
    auth.route?.providerKind !== "legacy_workos" ||
    auth.route.lifecycleState !== "coexistence"
  ) {
    throw new AuthAdmissionError(
      "legacy_session_required",
      "An admitted WorkOS rollback session is required for migration.",
    );
  }
  const configuredDeadline =
    process.env.AUTH_MIGRATION_RECOVERY_DEADLINE?.trim() ?? "";
  const deadlineMillis = Date.parse(configuredDeadline);
  if (!configuredDeadline || !Number.isFinite(deadlineMillis)) {
    throw new AuthAdmissionError(
      "migration_deadline_unconfigured",
      "The identity migration deadline is not configured.",
    );
  }
  if (now.getTime() >= deadlineMillis) {
    throw new AuthAdmissionError(
      "migration_deadline_elapsed",
      "The identity migration recovery window has ended.",
    );
  }
  const admitted = await admitCognitoTenant(auth, auth.tenantId ?? undefined);
  return db.transaction(async (tx) => {
    const [membership] = await tx
      .select({ id: tenantMembers.id })
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.tenant_id, admitted.tenantId),
          eq(tenantMembers.principal_type, "user"),
          eq(tenantMembers.principal_id, admitted.userId),
          eq(tenantMembers.status, "active"),
        ),
      )
      .for("update");
    if (!membership) {
      throw new AuthAdmissionError(
        "tenant_not_admitted",
        "The migration session has no active membership.",
      );
    }
    return issueEnrollmentGrants({
      tenantId: admitted.tenantId,
      intendedUserId: admitted.userId,
      membershipId: membership.id,
      grantKind: "session_migration",
      redirectUri: input.redirectUri,
      transaction: tx,
    });
  });
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
    const [candidate] = await tx
      .select()
      .from(authIdentityEnrollments)
      .where(eq(authIdentityEnrollments.nonce_digest, nonceDigest));
    if (!candidate) return "invalid_grant";
    if (!candidate.intended_user_id) return "invalid_grant";
    const intendedUserId = candidate.intended_user_id;
    if (candidate.status === "consumed") return "already_consumed";
    if (candidate.status !== "pending") return "expired";

    // One grant can target several provider/client routes. Lock every pending
    // sibling in a deterministic order so changing routes cannot multiply the
    // recipient-challenge guess budget.
    const grantEnrollments = await tx
      .select()
      .from(authIdentityEnrollments)
      .where(
        and(
          eq(authIdentityEnrollments.tenant_id, candidate.tenant_id),
          eq(
            authIdentityEnrollments.recipient_grant_kind,
            candidate.recipient_grant_kind,
          ),
          eq(
            authIdentityEnrollments.recipient_grant_id,
            candidate.recipient_grant_id,
          ),
          eq(authIdentityEnrollments.status, "pending"),
        ),
      )
      .orderBy(authIdentityEnrollments.id)
      .for("update");
    const enrollment = grantEnrollments.find(
      (grant) => grant.id === candidate.id,
    );
    if (!enrollment) return "expired";
    if (enrollment.expires_at <= now) {
      await tx
        .update(authIdentityEnrollments)
        .set({ status: "expired", updated_at: now })
        .where(
          and(
            eq(authIdentityEnrollments.tenant_id, enrollment.tenant_id),
            eq(
              authIdentityEnrollments.recipient_grant_kind,
              enrollment.recipient_grant_kind,
            ),
            eq(
              authIdentityEnrollments.recipient_grant_id,
              enrollment.recipient_grant_id,
            ),
            eq(authIdentityEnrollments.status, "pending"),
          ),
        );
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
      const failedAttempts =
        Math.max(...grantEnrollments.map((grant) => grant.failed_attempts)) + 1;
      const locked = failedAttempts >= MAX_RECIPIENT_CHALLENGE_ATTEMPTS;
      await tx
        .update(authIdentityEnrollments)
        .set({
          failed_attempts: failedAttempts,
          ...(locked
            ? { status: "revoked", locked_at: now, updated_at: now }
            : { updated_at: now }),
        })
        .where(
          and(
            eq(authIdentityEnrollments.tenant_id, enrollment.tenant_id),
            eq(
              authIdentityEnrollments.recipient_grant_kind,
              enrollment.recipient_grant_kind,
            ),
            eq(
              authIdentityEnrollments.recipient_grant_id,
              enrollment.recipient_grant_id,
            ),
            eq(authIdentityEnrollments.status, "pending"),
          ),
        );
      return "invalid_challenge";
    }

    const [membership] = await tx
      .select({ id: tenantMembers.id, status: tenantMembers.status })
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.id, enrollment.recipient_grant_id),
          eq(tenantMembers.tenant_id, enrollment.tenant_id),
          eq(tenantMembers.principal_type, "user"),
          eq(tenantMembers.principal_id, intendedUserId),
        ),
      )
      .for("update");
    const preservesActiveMembership = [
      "identity_recovery",
      "session_migration",
    ].includes(enrollment.recipient_grant_kind);
    const expectedMembershipStatus = preservesActiveMembership
      ? "active"
      : "pending";
    if (!membership || membership.status !== expectedMembershipStatus) {
      return "invalid_grant";
    }

    const [conflict] = await tx
      .select({
        userId: userAuthIdentities.user_id,
        tenantId: userAuthIdentities.tenant_id,
        resourceId: userAuthIdentities.auth_provider_resource_id,
        status: userAuthIdentities.status,
      })
      .from(userAuthIdentities)
      .where(
        and(
          eq(userAuthIdentities.cognito_issuer, cognitoIssuer),
          eq(userAuthIdentities.cognito_sub, cognitoSub),
        ),
      )
      .limit(1);
    if (
      conflict &&
      (conflict.userId !== intendedUserId ||
        conflict.tenantId !== enrollment.tenant_id ||
        conflict.resourceId !== route.connectionId ||
        conflict.status !== "active")
    ) {
      return "identity_conflict";
    }

    if (!conflict) {
      await tx.insert(userAuthIdentities).values({
        tenant_id: enrollment.tenant_id,
        user_id: intendedUserId,
        auth_provider_resource_id: route.connectionId,
        cognito_issuer: cognitoIssuer,
        cognito_sub: cognitoSub,
        provider_issuer: route.providerIssuer ?? cognitoIssuer,
        // The route-specific Cognito profile is the immutable subject at the
        // application trust boundary. Email and domain claims are never used.
        provider_subject: cognitoSub,
        status: "active",
        proof_kind:
          enrollment.recipient_grant_kind === "identity_recovery"
            ? "recipient_challenge_recovery"
            : enrollment.recipient_grant_kind === "session_migration"
              ? "workos_session_native_proof"
              : "recipient_challenge",
        evidence: {
          appClientId: route.appClientId,
          connectionKey: route.connectionKey,
          routeKey: route.routeKey,
        },
        activated_at: now,
      });
    }

    if (!preservesActiveMembership) {
      await tx
        .update(tenantMembers)
        .set({ status: "active", updated_at: now })
        .where(
          and(
            eq(tenantMembers.id, enrollment.recipient_grant_id),
            eq(tenantMembers.tenant_id, enrollment.tenant_id),
            eq(tenantMembers.principal_type, "user"),
            eq(tenantMembers.principal_id, intendedUserId),
            eq(tenantMembers.status, "pending"),
          ),
        );
    }
    if (enrollment.recipient_grant_kind === "pending_owner") {
      await tx
        .update(tenants)
        .set({
          pending_owner_email: null,
          first_admin_claim_required: false,
          first_admin_claimed_at: now,
          first_admin_claimed_user_id: intendedUserId,
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
    // The bearer/challenge pair is a single grant even when it was projected
    // onto multiple route-specific rows. Consuming one route atomically burns
    // every sibling so the same proof cannot bind a second Cognito subject.
    await tx
      .update(authIdentityEnrollments)
      .set({ status: "revoked", updated_at: now })
      .where(
        and(
          eq(authIdentityEnrollments.tenant_id, enrollment.tenant_id),
          eq(
            authIdentityEnrollments.recipient_grant_kind,
            enrollment.recipient_grant_kind,
          ),
          eq(
            authIdentityEnrollments.recipient_grant_id,
            enrollment.recipient_grant_id,
          ),
          eq(authIdentityEnrollments.status, "pending"),
          ne(authIdentityEnrollments.id, enrollment.id),
        ),
      );
    await tx.insert(authSubscriptionInvalidations).values({
      tenant_id: enrollment.tenant_id,
      user_id: intendedUserId,
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
  if (event.rawPath === "/api/auth/enrollment/recover") {
    const bearer = extractBearerToken(event);
    if (!bearer || !validateApiSecret(bearer)) return unauthorized();
    let input: IdentityRecoveryGrantInput;
    try {
      const parsed = JSON.parse(
        event.body ?? "{}",
      ) as Partial<IdentityRecoveryGrantInput>;
      if (
        !parsed.tenantId ||
        !UUID_PATTERN.test(parsed.tenantId) ||
        !parsed.userId ||
        !UUID_PATTERN.test(parsed.userId) ||
        !parsed.redirectUri ||
        !isAbsoluteHttpUrl(parsed.redirectUri)
      ) {
        return error("Invalid identity recovery request", 400);
      }
      input = parsed as IdentityRecoveryGrantInput;
    } catch {
      return error("Invalid identity recovery request", 400);
    }
    try {
      const grant = await issueIdentityRecoveryGrant(input);
      console.info("[auth-enrollment] identity recovery grant issued", {
        tenantId: input.tenantId,
        userId: input.userId,
        routeCount: grant.routeKeys.length,
        expiresAt: grant.expiresAt.toISOString(),
      });
      return json(grant, 201);
    } catch (cause) {
      if (cause instanceof IdentityRecoveryGrantError) {
        return json({ error: cause.code }, 409);
      }
      throw cause;
    }
  }
  if (event.rawPath === "/api/auth/enrollment/migrate") {
    const auth = await authenticate(
      event.headers as Record<string, string | undefined>,
    );
    if (!auth || auth.authType !== "cognito") {
      return unauthorized("Authentication required");
    }
    let input: SessionMigrationGrantInput;
    try {
      const parsed = JSON.parse(
        event.body ?? "{}",
      ) as Partial<SessionMigrationGrantInput>;
      if (!parsed.redirectUri || !isAbsoluteHttpUrl(parsed.redirectUri)) {
        return error("Invalid session migration request", 400);
      }
      input = parsed as SessionMigrationGrantInput;
    } catch {
      return error("Invalid session migration request", 400);
    }
    try {
      return json(await issueSessionMigrationGrant(auth, input), 201);
    } catch (cause) {
      if (cause instanceof AuthAdmissionError) {
        return json({ error: cause.code }, 403);
      }
      throw cause;
    }
  }
  if (event.rawPath !== "/api/auth/enrollment/consume") {
    return error("Not found", 404);
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

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

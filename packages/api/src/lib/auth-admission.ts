import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@thinkwork/database-pg";
import {
  authProviderResources,
  authRouteClients,
  tenantAuthPolicies,
  tenantAuthProviderReferences,
  tenantMembers,
  userAuthIdentities,
} from "@thinkwork/database-pg/schema";

import { db } from "./db.js";
import type { AuthResult } from "./cognito-auth.js";

const VALIDATION_STATES = new Set(["valid", "partially_valid"]);

export interface CognitoRouteProvenance {
  routeClientId: string;
  routeKey: string;
  clientFamily: string;
  appClientId: string;
  lifecycleState: "native";
  connectionId: string;
  connectionKey: string;
  providerKind: string;
  providerIssuer: string | null;
}

export interface RouteAdmissionCandidate {
  routeClientId: string;
  routeKey: string;
  clientFamily: string;
  appClientId: string;
  routeLifecycleState: string;
  routeValidationStatus: string;
  providerNames: string[];
  connectionId: string;
  connectionKey: string;
  providerKind: string;
  identityProviderName: string;
  providerIssuer: string | null;
  connectionLifecycleState: string;
  connectionValidationStatus: string;
  connectionAppClientIds: string[];
}

export interface IdentityAdmissionCandidate {
  identityId: string;
  userId: string;
  identityTenantId: string | null;
  authProviderResourceId: string | null;
  status: string;
}

export interface MembershipAdmissionCandidate {
  tenantId: string;
  role: string;
  status: string;
}

export interface TenantPolicyAdmissionRecord {
  tenantId: string;
  status: string;
  localPasswordEnabled: boolean;
}

export interface TenantConnectionReference {
  connectionId: string;
  providerKind: string;
  status: string;
  lifecycleState: string;
  validationStatus: string;
}

export interface AuthAdmissionRepository {
  loadRouteCandidates(
    userPoolId: string,
    appClientId: string,
  ): Promise<RouteAdmissionCandidate[]>;
  loadIdentityCandidates(
    cognitoIssuer: string,
    cognitoSub: string,
  ): Promise<IdentityAdmissionCandidate[]>;
  loadMemberships(
    userId: string,
    requestedTenantId?: string,
  ): Promise<MembershipAdmissionCandidate[]>;
  loadTenantPolicies(
    tenantIds: string[],
  ): Promise<TenantPolicyAdmissionRecord[]>;
  loadTenantConnectionReferences(
    tenantIds: string[],
  ): Promise<Array<TenantConnectionReference & { tenantId: string }>>;
}

export interface TenantAdmissionResult {
  userId: string;
  tenantId: string;
  role: string;
  identityId: string;
  route: CognitoRouteProvenance;
}

export class AuthAdmissionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthAdmissionError";
  }
}

export function evaluateRouteAdmission(
  candidates: RouteAdmissionCandidate[],
): CognitoRouteProvenance {
  const admittedNative = candidates.filter((candidate) => {
    if (
      candidate.routeLifecycleState !== "native" ||
      candidate.connectionLifecycleState !== "native" ||
      !VALIDATION_STATES.has(candidate.routeValidationStatus) ||
      !VALIDATION_STATES.has(candidate.connectionValidationStatus) ||
      candidate.providerNames.length !== 1 ||
      candidate.providerNames[0] !== candidate.identityProviderName ||
      !candidate.connectionAppClientIds.includes(candidate.appClientId)
    ) {
      return false;
    }
    return true;
  });
  if (admittedNative.length !== 1) {
    throw new AuthAdmissionError(
      admittedNative.length === 0 ? "unknown_client" : "ambiguous_client",
      "Cognito app client is not admitted to exactly one authentication route.",
    );
  }
  const candidate = admittedNative[0]!;
  return {
    routeClientId: candidate.routeClientId,
    routeKey: candidate.routeKey,
    clientFamily: candidate.clientFamily,
    appClientId: candidate.appClientId,
    lifecycleState: "native",
    connectionId: candidate.connectionId,
    connectionKey: candidate.connectionKey,
    providerKind: candidate.providerKind,
    providerIssuer: candidate.providerIssuer,
  };
}

export async function resolveCognitoRouteProvenance(
  args: { userPoolId: string; appClientId: string },
  repository: AuthAdmissionRepository = createDbAuthAdmissionRepository(),
): Promise<CognitoRouteProvenance> {
  const candidates = await repository.loadRouteCandidates(
    args.userPoolId,
    args.appClientId,
  );
  return evaluateRouteAdmission(candidates);
}

export function evaluateTenantAdmission(args: {
  route: CognitoRouteProvenance;
  identities: IdentityAdmissionCandidate[];
  memberships: MembershipAdmissionCandidate[];
  policies: TenantPolicyAdmissionRecord[];
  references: Array<TenantConnectionReference & { tenantId: string }>;
  requestedTenantId?: string;
}): TenantAdmissionResult {
  const identities = args.identities.filter(
    (identity) =>
      identity.status === "active" &&
      identity.authProviderResourceId === args.route.connectionId,
  );
  if (identities.length !== 1) {
    throw new AuthAdmissionError(
      identities.length === 0 ? "identity_not_bound" : "identity_ambiguous",
      "Cognito principal is not bound to exactly one active ThinkWork identity.",
    );
  }
  const identity = identities[0];
  const policies = new Map(
    args.policies.map((policy) => [policy.tenantId, policy]),
  );
  const references = new Map<string, TenantConnectionReference[]>();
  for (const reference of args.references) {
    const values = references.get(reference.tenantId) ?? [];
    values.push(reference);
    references.set(reference.tenantId, values);
  }
  const memberships = args.memberships.filter((membership) => {
    if (
      membership.status !== "active" ||
      (args.requestedTenantId && membership.tenantId !== args.requestedTenantId)
    ) {
      return false;
    }
    const policy = policies.get(membership.tenantId);
    if (!policy || policy.status !== "active") return false;
    return tenantPolicyAllowsConnection(
      args.route,
      policy,
      references.get(membership.tenantId) ?? [],
    );
  });
  if (memberships.length !== 1) {
    throw new AuthAdmissionError(
      memberships.length === 0
        ? "tenant_not_admitted"
        : "tenant_selection_required",
      memberships.length === 0
        ? "No active membership permits this authentication connection."
        : "More than one tenant permits this connection; an explicit tenant is required.",
    );
  }
  const membership = memberships[0];
  return {
    userId: identity.userId,
    tenantId: membership.tenantId,
    role: membership.role,
    identityId: identity.identityId,
    route: args.route,
  };
}

export async function admitCognitoTenant(
  auth: AuthResult,
  requestedTenantId?: string,
  repository: AuthAdmissionRepository = createDbAuthAdmissionRepository(),
): Promise<TenantAdmissionResult> {
  if (
    auth.authType !== "cognito" ||
    !auth.principalId ||
    !auth.cognitoIssuer ||
    !auth.route
  ) {
    throw new AuthAdmissionError(
      "cognito_context_missing",
      "Cognito route provenance is required for tenant admission.",
    );
  }
  const identities = await repository.loadIdentityCandidates(
    auth.cognitoIssuer,
    auth.principalId,
  );
  const activeIdentity = identities.filter(
    (identity) =>
      identity.status === "active" &&
      identity.authProviderResourceId === auth.route?.connectionId,
  );
  if (activeIdentity.length !== 1) {
    return evaluateTenantAdmission({
      route: auth.route,
      identities,
      memberships: [],
      policies: [],
      references: [],
      requestedTenantId,
    });
  }
  const effectiveTenantId = requestedTenantId;
  const memberships = await repository.loadMemberships(
    activeIdentity[0].userId,
    effectiveTenantId,
  );
  const tenantIds = [...new Set(memberships.map((value) => value.tenantId))];
  const [policies, references] = await Promise.all([
    repository.loadTenantPolicies(tenantIds),
    repository.loadTenantConnectionReferences(tenantIds),
  ]);
  return evaluateTenantAdmission({
    route: auth.route,
    identities,
    memberships,
    policies,
    references,
    requestedTenantId: effectiveTenantId,
  });
}

function tenantPolicyAllowsConnection(
  route: CognitoRouteProvenance,
  policy: TenantPolicyAdmissionRecord,
  references: TenantConnectionReference[],
): boolean {
  const enabledNativeReferences = references.filter(
    (reference) =>
      reference.status === "enabled" &&
      reference.lifecycleState === "native" &&
      VALIDATION_STATES.has(reference.validationStatus),
  );
  switch (route.providerKind) {
    case "local":
      return policy.localPasswordEnabled;
    case "google":
      return true;
    case "microsoft_organizations":
      return !enabledNativeReferences.some(
        (reference) => reference.providerKind === "microsoft_tenant",
      );
    case "microsoft_tenant":
      return enabledNativeReferences.some(
        (reference) => reference.connectionId === route.connectionId,
      );
    default:
      return false;
  }
}

export function createDbAuthAdmissionRepository(
  database: Database = db,
): AuthAdmissionRepository {
  return {
    async loadRouteCandidates(userPoolId, appClientId) {
      const routes = await database
        .select({
          routeClientId: authRouteClients.id,
          routeKey: authRouteClients.route_key,
          clientFamily: authRouteClients.client_family,
          appClientId: authRouteClients.cognito_app_client_id,
          routeLifecycleState: authRouteClients.lifecycle_state,
          routeValidationStatus: authRouteClients.validation_status,
          providerNames: authRouteClients.provider_names,
        })
        .from(authRouteClients)
        .where(
          and(
            eq(authRouteClients.cognito_user_pool_id, userPoolId),
            eq(authRouteClients.cognito_app_client_id, appClientId),
          ),
        );
      if (routes.length !== 1 || routes[0].providerNames.length !== 1)
        return [];
      const route = routes[0];
      const connections = await database
        .select({
          connectionId: authProviderResources.id,
          connectionKey: authProviderResources.connection_key,
          providerKind: authProviderResources.provider_kind,
          identityProviderName:
            authProviderResources.cognito_identity_provider_name,
          providerIssuer: authProviderResources.issuer_url,
          connectionLifecycleState: authProviderResources.lifecycle_state,
          connectionValidationStatus: authProviderResources.validation_status,
          connectionAppClientIds: authProviderResources.cognito_app_client_ids,
        })
        .from(authProviderResources)
        .where(
          and(
            eq(authProviderResources.cognito_user_pool_id, userPoolId),
            eq(
              authProviderResources.cognito_identity_provider_name,
              route.providerNames[0],
            ),
          ),
        );
      return connections.map((connection) => ({ ...route, ...connection }));
    },
    async loadIdentityCandidates(cognitoIssuer, cognitoSub) {
      return database
        .select({
          identityId: userAuthIdentities.id,
          userId: userAuthIdentities.user_id,
          identityTenantId: userAuthIdentities.tenant_id,
          authProviderResourceId: userAuthIdentities.auth_provider_resource_id,
          status: userAuthIdentities.status,
        })
        .from(userAuthIdentities)
        .where(
          and(
            eq(userAuthIdentities.cognito_issuer, cognitoIssuer),
            eq(userAuthIdentities.cognito_sub, cognitoSub),
          ),
        );
    },
    async loadMemberships(userId, requestedTenantId) {
      return database
        .select({
          tenantId: tenantMembers.tenant_id,
          role: tenantMembers.role,
          status: tenantMembers.status,
        })
        .from(tenantMembers)
        .where(
          and(
            eq(tenantMembers.principal_type, "user"),
            eq(tenantMembers.principal_id, userId),
            ...(requestedTenantId
              ? [eq(tenantMembers.tenant_id, requestedTenantId)]
              : []),
          ),
        );
    },
    async loadTenantPolicies(tenantIds) {
      if (tenantIds.length === 0) return [];
      return database
        .select({
          tenantId: tenantAuthPolicies.tenant_id,
          status: tenantAuthPolicies.status,
          localPasswordEnabled: tenantAuthPolicies.local_password_enabled,
        })
        .from(tenantAuthPolicies)
        .where(inArray(tenantAuthPolicies.tenant_id, tenantIds));
    },
    async loadTenantConnectionReferences(tenantIds) {
      if (tenantIds.length === 0) return [];
      return database
        .select({
          tenantId: tenantAuthProviderReferences.tenant_id,
          connectionId: authProviderResources.id,
          providerKind: authProviderResources.provider_kind,
          status: tenantAuthProviderReferences.status,
          lifecycleState: authProviderResources.lifecycle_state,
          validationStatus: authProviderResources.validation_status,
        })
        .from(tenantAuthProviderReferences)
        .innerJoin(
          authProviderResources,
          eq(
            authProviderResources.id,
            tenantAuthProviderReferences.auth_provider_resource_id,
          ),
        )
        .where(inArray(tenantAuthProviderReferences.tenant_id, tenantIds));
    },
  };
}

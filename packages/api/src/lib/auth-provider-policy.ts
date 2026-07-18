export type NativeProviderKind = "google" | "microsoft" | "entra";

export interface AuthPolicyRouteRecord {
  routeKey: string;
  clientFamily: string;
  cognitoAppClientId: string;
  providerNames: string[];
  lifecycleState: string;
  validationStatus: string;
}

export interface AuthPolicyConnectionRecord {
  resourceId: string;
  connectionKey: string;
  providerKind: string;
  displayName: string;
  cognitoIdentityProviderName: string;
  cognitoAppClientIds: string[];
  lifecycleState: string;
  validationStatus: string;
  publicOptionsPublished: boolean;
  tenantId?: string | null;
  tenantReferenceStatus?: string | null;
  publicOptionLabel?: string | null;
}

export interface AuthPolicySnapshot {
  /** `ambiguous` must fail closed; `deployment` is the shared/default policy. */
  scope: "deployment" | "tenant" | "ambiguous";
  tenantId?: string;
  localPasswordEnabled: boolean;
  routes: AuthPolicyRouteRecord[];
  connections: AuthPolicyConnectionRecord[];
}

export interface NativeAuthOption {
  key: string;
  label: string;
  icon: "google" | "microsoft";
  provider: NativeProviderKind;
  providerSpecific: true;
  route: {
    type: "cognitoHostedUi";
    clientId: string;
    identityProvider: string;
    prompt: "select_account";
  };
}

export interface ResolvedNativeAuthPolicy {
  password: { enabled: boolean; clientId?: string };
  oauthOptions: NativeAuthOption[];
}

const VALIDATION_STATES = new Set(["valid", "partially_valid"]);

/**
 * Resolve a public login catalog from already-validated control-plane rows.
 * This function deliberately makes no authorization decision: the selected
 * route client is checked again against identity, membership, and target
 * tenant by the authenticated API path.
 */
export function resolveNativeAuthPolicy(
  snapshot: AuthPolicySnapshot,
): ResolvedNativeAuthPolicy {
  if (snapshot.scope === "ambiguous") {
    return { password: { enabled: false }, oauthOptions: [] };
  }

  const routes = snapshot.routes
    .filter(
      (route) =>
        route.clientFamily === "web" &&
        route.lifecycleState === "native" &&
        VALIDATION_STATES.has(route.validationStatus),
    )
    .sort((a, b) => a.routeKey.localeCompare(b.routeKey));
  const local = routes.find(
    (route) =>
      route.routeKey === "local" &&
      sameValues(route.providerNames, ["COGNITO"]),
  );

  const eligibleConnections = snapshot.connections.filter((connection) => {
    if (
      connection.lifecycleState !== "native" ||
      !VALIDATION_STATES.has(connection.validationStatus) ||
      !connection.publicOptionsPublished
    ) {
      return false;
    }
    if (snapshot.scope === "deployment") {
      return (
        connection.connectionKey === "google" ||
        connection.connectionKey === "microsoft:organizations"
      );
    }
    return (
      connection.tenantId === snapshot.tenantId &&
      connection.tenantReferenceStatus === "enabled"
    );
  });

  const tenantEntra = eligibleConnections.find(
    (connection) => connection.providerKind === "microsoft_tenant",
  );
  const google = eligibleConnections.find(
    (connection) => connection.providerKind === "google",
  );
  const microsoft = tenantEntra
    ? undefined
    : eligibleConnections.find(
        (connection) => connection.providerKind === "microsoft_organizations",
      );

  const oauthOptions = [
    buildOption(google, routes, {
      key: "google",
      label: "Continue with Google",
      icon: "google",
      provider: "google",
    }),
    tenantEntra
      ? buildOption(tenantEntra, routes, {
          key: "microsoft",
          label:
            safeLabel(tenantEntra.publicOptionLabel) ||
            safeTenantMicrosoftLabel(tenantEntra.displayName),
          icon: "microsoft",
          provider: "entra",
        })
      : buildOption(microsoft, routes, {
          key: "microsoft",
          label: "Continue with Microsoft",
          icon: "microsoft",
          provider: "microsoft",
        }),
  ].filter((option): option is NativeAuthOption => option !== null);

  return {
    password: {
      enabled: snapshot.localPasswordEnabled && Boolean(local),
      ...(local ? { clientId: local.cognitoAppClientId } : {}),
    },
    oauthOptions,
  };
}

function buildOption(
  connection: AuthPolicyConnectionRecord | undefined,
  routes: AuthPolicyRouteRecord[],
  presentation: Pick<NativeAuthOption, "key" | "label" | "icon" | "provider">,
): NativeAuthOption | null {
  if (!connection) return null;
  const route = routes.find(
    (candidate) =>
      candidate.providerNames.length === 1 &&
      candidate.providerNames[0] === connection.cognitoIdentityProviderName &&
      connection.cognitoAppClientIds.includes(candidate.cognitoAppClientId),
  );
  if (!route) return null;
  return {
    ...presentation,
    providerSpecific: true,
    route: {
      type: "cognitoHostedUi",
      clientId: route.cognitoAppClientId,
      identityProvider: connection.cognitoIdentityProviderName,
      prompt: "select_account",
    },
  };
}

function sameValues(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function safeLabel(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

function safeTenantMicrosoftLabel(displayName: string): string {
  const organization = safeLabel(displayName);
  return organization
    ? `Continue with Microsoft (${organization})`
    : "Continue with Microsoft";
}

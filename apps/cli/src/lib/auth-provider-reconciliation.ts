import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

export interface AuthRouteClientOutput {
  client_id: string;
  route_key: string;
  client_family: "web" | "mobile" | "desktop" | "cli";
  provider_names: string[];
  explicit_auth_flows: string[];
  callback_urls: string[];
  logout_urls: string[];
  lifecycle_state: "native" | "denied";
}

interface ReconciliationState {
  revision?: number;
  desiredFingerprint?: string;
  tenantConnections?: Array<Record<string, unknown>>;
}

export interface LocalAuthReconciliationInput {
  stage: string;
  accountId: string;
  region: string;
  userPoolId: string;
  apiEndpoint: string;
  apiAuthSecret: string;
  microsoftTenantId?: string;
  routeClients: Record<string, AuthRouteClientOutput>;
}

export interface LocalAuthReconciliationResult {
  status: string;
  revision: number;
  manifestFingerprint?: string;
}

type AwsExec = (args: string[]) => {
  status: number;
  stdout: string;
  stderr: string;
};

const ENTRA_TENANT_ALIASES = new Set(["common", "organizations", "consumers"]);

const GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function deterministicUuid(seed: string): string {
  const value = createHash("sha256").update(seed).digest("hex");
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    `5${value.slice(13, 16)}`,
    `8${value.slice(17, 20)}`,
    value.slice(20, 32),
  ].join("-");
}

function defaultAwsExec(args: string[]) {
  const result = spawnSync("aws", args, { encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function readState(
  stage: string,
  region: string,
  exec: AwsExec,
): ReconciliationState {
  const result = exec([
    "ssm",
    "get-parameter",
    "--name",
    `/thinkwork/${stage}/auth/reconciliation/state`,
    "--region",
    region,
    "--query",
    "Parameter.Value",
    "--output",
    "text",
  ]);
  if (result.status !== 0 || !result.stdout.trim()) return {};
  try {
    return JSON.parse(result.stdout) as ReconciliationState;
  } catch {
    throw new Error("Stored native-auth reconciliation state is malformed.");
  }
}

export function buildLocalAuthReconciliation(
  input: Omit<LocalAuthReconciliationInput, "apiEndpoint" | "apiAuthSecret">,
  previous: ReconciliationState = {},
) {
  const routeClients = Object.values(input.routeClients)
    .map((route) => ({
      routeKey: route.route_key,
      clientFamily: route.client_family,
      cognitoUserPoolId: input.userPoolId,
      cognitoAppClientId: route.client_id,
      providerNames: route.provider_names,
      explicitAuthFlows: route.explicit_auth_flows,
      redirectUris: route.callback_urls,
      logoutUris: route.logout_urls,
      lifecycleState: route.lifecycle_state,
    }))
    .sort((left, right) =>
      `${left.routeKey}:${left.clientFamily}`.localeCompare(
        `${right.routeKey}:${right.clientFamily}`,
      ),
    );
  if (routeClients.length === 0) {
    throw new Error("auth_route_clients Terraform output is empty.");
  }
  const providerNames = new Set(
    routeClients.flatMap((route) => route.providerNames),
  );
  const connections: Array<Record<string, unknown>> = [
    {
      connectionKey: "local",
      providerKey: "cognito",
      providerKind: "local",
      displayName: "Email and password",
      lifecycleState: "native",
      cognitoUserPoolId: input.userPoolId,
      cognitoIdentityProviderName: "COGNITO",
      authorizeScopes: "openid email profile",
      tenantBindings: [],
    },
  ];
  if (providerNames.has("Google")) {
    connections.push({
      connectionKey: "google",
      providerKey: "google",
      providerKind: "google",
      displayName: "Google",
      lifecycleState: "native",
      cognitoUserPoolId: input.userPoolId,
      cognitoIdentityProviderName: "Google",
      authorizeScopes: "openid email profile",
      tenantBindings: [],
    });
  }
  if (providerNames.has("MicrosoftOrganizations")) {
    const tenantId = input.microsoftTenantId?.trim().toLowerCase();
    if (
      !tenantId ||
      !(ENTRA_TENANT_ALIASES.has(tenantId) || GUID_RE.test(tenantId))
    ) {
      throw new Error(
        "Microsoft native auth reconciliation requires microsoft_oauth_tenant to be an Entra directory GUID or one of: common, organizations, consumers.",
      );
    }
    connections.push({
      connectionKey: "microsoft:organizations",
      providerKey: "microsoft",
      providerKind: "microsoft_organizations",
      displayName: "Microsoft",
      lifecycleState: "native",
      cognitoUserPoolId: input.userPoolId,
      cognitoIdentityProviderName: "MicrosoftOrganizations",
      issuerUrl: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      authorizeScopes: "openid email profile",
      tenantBindings: [],
    });
  }
  for (const connection of previous.tenantConnections ?? []) {
    connections.push(connection);
  }
  connections.sort((left, right) =>
    String(left.connectionKey).localeCompare(String(right.connectionKey)),
  );

  const desired = { connections, routeClients };
  const desiredFingerprint = sha256(desired);
  if (desiredFingerprint === previous.desiredFingerprint) {
    return { payload: null, nextState: previous };
  }
  const expectedPreviousRevision = Number(previous.revision ?? 0);
  const revision = expectedPreviousRevision + 1;
  const withoutFingerprint = {
    stage: input.stage,
    awsAccountId: input.accountId,
    awsRegion: input.region,
    revision,
    expectedPreviousRevision,
    idempotencyKey: deterministicUuid(
      `thinkwork-auth:${input.stage}:${revision}:${desiredFingerprint}`,
    ),
    connections,
    routeClients,
  };
  return {
    payload: {
      ...withoutFingerprint,
      manifestFingerprint: sha256(withoutFingerprint),
    },
    nextState: {
      revision,
      desiredFingerprint,
      tenantConnections: previous.tenantConnections ?? [],
    },
  };
}

export async function reconcileLocalNativeAuth(
  input: LocalAuthReconciliationInput,
  dependencies: { awsExec?: AwsExec; fetchImpl?: typeof fetch } = {},
): Promise<LocalAuthReconciliationResult> {
  const exec = dependencies.awsExec ?? defaultAwsExec;
  const previous = readState(input.stage, input.region, exec);
  const { payload, nextState } = buildLocalAuthReconciliation(input, previous);
  if (!payload) {
    return { status: "unchanged", revision: Number(previous.revision ?? 0) };
  }
  if (!input.apiEndpoint.trim() || !input.apiAuthSecret) {
    throw new Error(
      "Native auth reconciliation requires the deployed API endpoint and api_auth_secret.",
    );
  }
  const response = await (dependencies.fetchImpl ?? fetch)(
    `${input.apiEndpoint.replace(/\/+$/, "")}/api/auth/providers/reconcile`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiAuthSecret}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(
      `Native auth metadata reconciliation failed with HTTP ${response.status}: ${responseBody.slice(0, 500)}`,
    );
  }
  const result = responseBody
    ? (JSON.parse(responseBody) as { status?: string; revision?: number })
    : {};
  const put = exec([
    "ssm",
    "put-parameter",
    "--overwrite",
    "--type",
    "String",
    "--name",
    `/thinkwork/${input.stage}/auth/reconciliation/state`,
    "--value",
    JSON.stringify(nextState),
    "--region",
    input.region,
  ]);
  if (put.status !== 0) {
    throw new Error(
      `Native auth metadata was applied but reconciliation state could not be stored: ${put.stderr.trim().slice(0, 300)}`,
    );
  }
  return {
    status: result.status ?? "applied",
    revision: result.revision ?? payload.revision,
    manifestFingerprint: payload.manifestFingerprint,
  };
}

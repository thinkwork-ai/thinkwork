import {
  BedrockAgentCoreClient,
  CompleteResourceTokenAuthCommand,
  GetResourceOauth2TokenCommand,
  GetWorkloadAccessTokenForUserIdCommand,
} from "@aws-sdk/client-bedrock-agentcore";

export type AgentCoreUserOAuthResult =
  | { status: "connected"; accessToken: string }
  | {
      status: "authorization_required" | "in_progress";
      sessionUri: string;
      authorizationUrl?: string;
    }
  | { status: "failed" };

interface AgentCoreIdentityClient {
  send(command: unknown): Promise<Record<string, unknown>>;
  destroy?(): void;
}

export interface AgentCoreUserOAuthOptions {
  workloadName: string;
  credentialProviderName: string;
  resource: string;
  scopes?: string[];
  returnUrl?: string;
  client?: AgentCoreIdentityClient;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function agentCoreUserOAuthOptionsFromEnv(): AgentCoreUserOAuthOptions {
  return {
    workloadName: required(
      process.env.AGENTCORE_IDENTITY_WORKLOAD_NAME,
      "AGENTCORE_IDENTITY_WORKLOAD_NAME",
    ),
    credentialProviderName: required(
      process.env.AGENTCORE_TWENTY_CREDENTIAL_PROVIDER_NAME,
      "AGENTCORE_TWENTY_CREDENTIAL_PROVIDER_NAME",
    ),
    resource: required(
      process.env.AGENTCORE_TWENTY_OAUTH_RESOURCE,
      "AGENTCORE_TWENTY_OAUTH_RESOURCE",
    ),
    returnUrl: process.env.AGENTCORE_USER_OAUTH_RETURN_URL,
    scopes: ["api", "profile"],
  };
}

async function workloadToken(
  client: AgentCoreIdentityClient,
  workloadName: string,
  userId: string,
): Promise<string> {
  const response = await client.send(
    new GetWorkloadAccessTokenForUserIdCommand({ workloadName, userId }),
  );
  const token = response.workloadAccessToken;
  if (typeof token !== "string" || !token) {
    throw new Error("AgentCore Identity returned no workload access token");
  }
  return token;
}

export async function getAgentCoreUserOAuth(
  input: {
    userId: string;
    sessionUri?: string;
    customState?: string;
    forceAuthentication?: boolean;
  },
  options: AgentCoreUserOAuthOptions = agentCoreUserOAuthOptionsFromEnv(),
): Promise<AgentCoreUserOAuthResult> {
  const ownedClient = options.client === undefined;
  const client =
    options.client ??
    (new BedrockAgentCoreClient({}) as unknown as AgentCoreIdentityClient);
  try {
    const token = await workloadToken(
      client,
      options.workloadName,
      input.userId,
    );
    const response = await client.send(
      new GetResourceOauth2TokenCommand({
        workloadIdentityToken: token,
        resourceCredentialProviderName: options.credentialProviderName,
        scopes: options.scopes ?? ["api", "profile"],
        oauth2Flow: "USER_FEDERATION",
        ...(input.sessionUri ? { sessionUri: input.sessionUri } : {}),
        ...(options.returnUrl
          ? { resourceOauth2ReturnUrl: options.returnUrl }
          : {}),
        ...(input.customState ? { customState: input.customState } : {}),
        ...(input.forceAuthentication ? { forceAuthentication: true } : {}),
        resources: [options.resource],
      }),
    );
    if (typeof response.accessToken === "string" && response.accessToken) {
      return { status: "connected", accessToken: response.accessToken };
    }
    if (
      typeof response.authorizationUrl === "string" &&
      response.authorizationUrl &&
      typeof response.sessionUri === "string" &&
      response.sessionUri
    ) {
      return {
        status: "authorization_required",
        authorizationUrl: response.authorizationUrl,
        sessionUri: response.sessionUri,
      };
    }
    if (
      response.sessionStatus === "IN_PROGRESS" &&
      typeof response.sessionUri === "string" &&
      response.sessionUri
    ) {
      return { status: "in_progress", sessionUri: response.sessionUri };
    }
    return { status: "failed" };
  } finally {
    if (ownedClient) client.destroy?.();
  }
}

export async function completeAgentCoreUserOAuth(
  input: { userId: string; sessionUri: string },
  options: AgentCoreUserOAuthOptions = agentCoreUserOAuthOptionsFromEnv(),
): Promise<void> {
  const ownedClient = options.client === undefined;
  const client =
    options.client ??
    (new BedrockAgentCoreClient({}) as unknown as AgentCoreIdentityClient);
  try {
    await client.send(
      new CompleteResourceTokenAuthCommand({
        userIdentifier: { userId: input.userId },
        sessionUri: input.sessionUri,
      }),
    );
  } finally {
    if (ownedClient) client.destroy?.();
  }
}

export async function resolveAgentCoreUserOAuthAccessToken(
  userId: string,
  options: AgentCoreUserOAuthOptions = agentCoreUserOAuthOptionsFromEnv(),
): Promise<string> {
  const result = await getAgentCoreUserOAuth({ userId }, options);
  if (result.status !== "connected") {
    throw new Error("AgentCore user OAuth grant is not connected");
  }
  return result.accessToken;
}

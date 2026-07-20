#!/usr/bin/env node

import {
  BedrockAgentCoreControlClient,
  CreateOauth2CredentialProviderCommand,
  GetOauth2CredentialProviderCommand,
  ResourceNotFoundException,
  UpdateOauth2CredentialProviderCommand,
} from "@aws-sdk/client-bedrock-agentcore-control";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));

const client = new BedrockAgentCoreControlClient({ region: input.region });
const providerInput = {
  name: input.name,
  credentialProviderVendor: "CustomOauth2",
  oauth2ProviderConfigInput: {
    customOauth2ProviderConfig: {
      oauthDiscovery: {
        authorizationServerMetadata: {
          issuer: input.issuer,
          authorizationEndpoint: input.authorizationEndpoint,
          tokenEndpoint: input.tokenEndpoint,
          responseTypes: ["code"],
        },
      },
      clientId: input.clientId,
      clientSecretConfig: {
        secretId: input.secretArn,
        jsonKey: "client_secret",
      },
      clientSecretSource: "EXTERNAL",
      clientAuthenticationMethod: "CLIENT_SECRET_POST",
    },
  },
};

let exists = false;
try {
  await client.send(
    new GetOauth2CredentialProviderCommand({ name: input.name }),
  );
  exists = true;
} catch (error) {
  if (!(error instanceof ResourceNotFoundException)) throw error;
}

if (exists) {
  await client.send(new UpdateOauth2CredentialProviderCommand(providerInput));
} else {
  await client.send(new CreateOauth2CredentialProviderCommand(providerInput));
}

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

let response;
for (let attempt = 0; attempt < 30; attempt += 1) {
  response = await client.send(
    new GetOauth2CredentialProviderCommand({ name: input.name }),
  );
  const status = response.status;
  const provider =
    response.oauth2ProviderConfigOutput?.customOauth2ProviderConfig;
  const secretArn =
    typeof response.clientSecretArn === "string"
      ? response.clientSecretArn
      : response.clientSecretArn?.secretArn;
  const ready =
    response.callbackUrl &&
    response.credentialProviderArn &&
    provider?.clientId === input.clientId &&
    secretArn === input.secretArn &&
    response.clientSecretJsonKey === "client_secret" &&
    response.clientSecretSource === "EXTERNAL" &&
    status === "READY";
  if (ready) break;
  if (status?.endsWith("_FAILED")) {
    throw new Error(`AgentCore OAuth provider ${input.name} entered ${status}`);
  }
  if (attempt === 29) {
    throw new Error(
      `AgentCore OAuth provider ${input.name} did not converge to the requested client and external secret`,
    );
  }
  await sleep(2000);
}

const secretArn =
  typeof response.clientSecretArn === "string"
    ? response.clientSecretArn
    : response.clientSecretArn?.secretArn;
const provider =
  response.oauth2ProviderConfigOutput?.customOauth2ProviderConfig;

process.stdout.write(
  JSON.stringify({
    name: response.name,
    callbackUrl: response.callbackUrl,
    credentialProviderArn: response.credentialProviderArn,
    clientId: provider?.clientId,
    clientSecretArn: secretArn,
    clientSecretJsonKey: response.clientSecretJsonKey,
    clientSecretSource: response.clientSecretSource,
    status: response.status,
  }),
);

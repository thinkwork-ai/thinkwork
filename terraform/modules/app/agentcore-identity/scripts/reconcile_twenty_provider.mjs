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

const response = exists
  ? await client.send(new UpdateOauth2CredentialProviderCommand(providerInput))
  : await client.send(new CreateOauth2CredentialProviderCommand(providerInput));

process.stdout.write(
  JSON.stringify({
    name: response.name,
    callbackUrl: response.callbackUrl,
    credentialProviderArn: response.credentialProviderArn,
    clientSecretSource: response.clientSecretSource,
  }),
);

#!/usr/bin/env node

import {
  BedrockAgentCoreControlClient,
  CreateOauth2CredentialProviderCommand,
  GetOauth2CredentialProviderCommand,
  UpdateOauth2CredentialProviderCommand,
} from "@aws-sdk/client-bedrock-agentcore-control";
import runtimePackage from "./package.json" with { type: "json" };

const sdkPackage = "@aws-sdk/client-bedrock-agentcore-control";
const sdkVersion = runtimePackage.dependencies[sdkPackage];

const requiredExports = {
  BedrockAgentCoreControlClient,
  CreateOauth2CredentialProviderCommand,
  GetOauth2CredentialProviderCommand,
  UpdateOauth2CredentialProviderCommand,
};

for (const [name, value] of Object.entries(requiredExports)) {
  if (typeof value !== "function") {
    throw new Error(`AgentCore control runtime is missing ${name}`);
  }
}

process.stdout.write(
  `${JSON.stringify({
    package: sdkPackage,
    version: sdkVersion,
    requiredExports: Object.keys(requiredExports).sort(),
  })}\n`,
);

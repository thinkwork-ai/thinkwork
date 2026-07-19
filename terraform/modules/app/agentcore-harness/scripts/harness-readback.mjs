import {
  GetHarnessCommand,
  GetHarnessEndpointCommand,
} from "@aws-sdk/client-bedrock-agentcore-control";
import {
  buildGovernedHarnessTools,
  canonicalJson,
  GOVERNED_TOOL_TYPES,
} from "./harness-tool-contract.mjs";

const isRecord = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function invalidToolSnapshot() {
  throw new Error(
    "Harness invocation-tool snapshot violates the governed contract",
  );
}

/**
 * Fail before Terraform state/SSM serialization if the service adds an
 * ungoverned tool or field. Return only the non-secret fields InvokeHarness
 * needs, so a future control-plane response cannot accidentally persist
 * credential-bearing metadata.
 */
export function projectGovernedInvocationTools(
  value,
  { expectedGatewayArn, expectedOauthProviderArn } = {},
) {
  if (!Array.isArray(value) || value.length !== GOVERNED_TOOL_TYPES.size) {
    invalidToolSnapshot();
  }
  const names = new Set();
  const projected = value.map((tool) => {
    if (
      !isRecord(tool) ||
      typeof tool.name !== "string" ||
      GOVERNED_TOOL_TYPES.get(tool.name) !== tool.type ||
      names.has(tool.name) ||
      !isRecord(tool.config) ||
      Object.keys(tool.config).length !== 1
    ) {
      invalidToolSnapshot();
    }
    names.add(tool.name);
    if (tool.type === "agentcore_browser") {
      if (
        !isRecord(tool.config.agentCoreBrowser) ||
        Object.keys(tool.config.agentCoreBrowser).length !== 0
      ) {
        invalidToolSnapshot();
      }
      return {
        type: tool.type,
        name: tool.name,
        config: { agentCoreBrowser: {} },
      };
    }
    if (tool.type === "agentcore_gateway") {
      const gateway = tool.config.agentCoreGateway;
      const outboundAuth = isRecord(gateway) ? gateway.outboundAuth : undefined;
      const oauth = isRecord(outboundAuth) ? outboundAuth.oauth : undefined;
      if (
        !isRecord(gateway) ||
        typeof gateway.gatewayArn !== "string" ||
        (expectedGatewayArn && gateway.gatewayArn !== expectedGatewayArn) ||
        !isRecord(outboundAuth) ||
        Object.keys(outboundAuth).length !== 1 ||
        !isRecord(oauth) ||
        typeof oauth.providerArn !== "string" ||
        (expectedOauthProviderArn &&
          oauth.providerArn !== expectedOauthProviderArn) ||
        !Array.isArray(oauth.scopes) ||
        oauth.scopes.length !== 1 ||
        oauth.scopes[0] !== "gateway:invoke" ||
        oauth.grantType !== "TOKEN_EXCHANGE" ||
        !isRecord(oauth.customParameters) ||
        Object.keys(oauth.customParameters).some(
          (key) => key !== "subject_token_type",
        ) ||
        oauth.customParameters.subject_token_type !==
          "urn:ietf:params:oauth:token-type:jwt"
      ) {
        invalidToolSnapshot();
      }
      return {
        type: tool.type,
        name: tool.name,
        config: {
          agentCoreGateway: {
            gatewayArn: gateway.gatewayArn,
            outboundAuth: {
              oauth: {
                providerArn: oauth.providerArn,
                scopes: [...oauth.scopes],
                customParameters: {
                  subject_token_type: oauth.customParameters.subject_token_type,
                },
                grantType: oauth.grantType,
              },
            },
          },
        },
      };
    }
    const inlineFunction = tool.config.inlineFunction;
    if (
      !isRecord(inlineFunction) ||
      Object.keys(inlineFunction).some(
        (key) => !["description", "inputSchema"].includes(key),
      ) ||
      typeof inlineFunction.description !== "string" ||
      !inlineFunction.description.trim() ||
      !isRecord(inlineFunction.inputSchema) ||
      inlineFunction.inputSchema.type !== "object" ||
      inlineFunction.inputSchema.additionalProperties !== false
    ) {
      invalidToolSnapshot();
    }
    return {
      type: tool.type,
      name: tool.name,
      config: {
        inlineFunction: {
          description: inlineFunction.description,
          inputSchema: structuredClone(inlineFunction.inputSchema),
        },
      },
    };
  });
  for (const name of GOVERNED_TOOL_TYPES.keys()) {
    if (!names.has(name)) invalidToolSnapshot();
  }
  const expected = buildGovernedHarnessTools({
    gatewayArn: expectedGatewayArn,
    providerArn: expectedOauthProviderArn,
  });
  if (canonicalJson(projected) !== canonicalJson(expected)) {
    invalidToolSnapshot();
  }
  return projected;
}

/**
 * Read the immutable Harness version actually selected by the named endpoint.
 * GetHarness without harnessVersion returns the mutable current configuration,
 * which may be newer than the endpoint and must never attest invocation tools.
 */
export async function readVersionPinnedHarness(
  client,
  { harnessId, endpointName, expectedGatewayArn, expectedOauthProviderArn },
) {
  const endpointResponse = await client.send(
    new GetHarnessEndpointCommand({ harnessId, endpointName }),
  );
  const endpoint = endpointResponse.endpoint;
  const liveVersion = endpoint?.liveVersion;
  if (!liveVersion) {
    throw new Error("Harness endpoint readback is missing liveVersion");
  }
  const harnessResponse = await client.send(
    new GetHarnessCommand({ harnessId, harnessVersion: liveVersion }),
  );
  const harness = harnessResponse.harness;
  if (harness?.harnessVersion !== liveVersion) {
    throw new Error("Harness endpoint and tool snapshot versions do not match");
  }
  if (endpoint.targetVersion && endpoint.targetVersion !== liveVersion) {
    throw new Error("Harness endpoint target and live versions do not match");
  }
  return {
    endpoint,
    harness,
    liveVersion,
    invocationTools: projectGovernedInvocationTools(harness.tools, {
      expectedGatewayArn,
      expectedOauthProviderArn,
    }),
  };
}

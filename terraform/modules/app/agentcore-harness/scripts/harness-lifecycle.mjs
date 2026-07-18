#!/usr/bin/env node

import {
  BedrockAgentCoreControlClient,
  CreateHarnessCommand,
  CreateHarnessEndpointCommand,
  DeleteHarnessCommand,
  DeleteHarnessEndpointCommand,
  GetHarnessCommand,
  GetHarnessEndpointCommand,
  ListHarnessesCommand,
  ListWorkloadIdentitiesCommand,
  UpdateHarnessCommand,
  UpdateHarnessEndpointCommand,
  UpdateWorkloadIdentityCommand,
} from "@aws-sdk/client-bedrock-agentcore-control";

const operation = process.argv[2];
const region = process.env.AWS_REGION;

if (!operation || !["reconcile", "read", "delete"].includes(operation)) {
  throw new Error("usage: harness-lifecycle.mjs reconcile|read|delete");
}

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function required(name, source = process.env) {
  const value = source[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function isNotFound(error) {
  return error?.name === "ResourceNotFoundException";
}

async function readStdin() {
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return value ? JSON.parse(value) : {};
}

async function findHarness(client, harnessName) {
  let nextToken;
  do {
    const response = await client.send(
      new ListHarnessesCommand({ nextToken, maxResults: 100 }),
    );
    const found = response.harnesses?.find(
      (candidate) => candidate.harnessName === harnessName,
    );
    if (found) return found;
    nextToken = response.nextToken;
  } while (nextToken);
  return undefined;
}

function commonConfiguration() {
  const gatewayArn = required("GATEWAY_ARN");
  const providerArn = required("OAUTH_CREDENTIAL_PROVIDER_ARN");
  const targetToolNames = required("GATEWAY_TARGET_TOOL_NAMES")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    targetToolNames.length === 0 ||
    new Set(targetToolNames).size !== targetToolNames.length
  ) {
    throw new Error(
      "GATEWAY_TARGET_TOOL_NAMES must contain distinct tool names",
    );
  }
  return {
    executionRoleArn: required("EXECUTION_ROLE_ARN"),
    authorizerConfiguration: {
      customJWTAuthorizer: {
        discoveryUrl: required("DISCOVERY_URL"),
        allowedAudience: [required("HARNESS_AUDIENCE")],
        allowedScopes: ["harness:invoke"],
      },
    },
    model: {
      bedrockModelConfig: { modelId: required("MODEL_ID") },
    },
    systemPrompt: [
      {
        text: "You are ThinkWork, one shared logical agent. Use only the governed tools made available for this turn. For ThinkWork connectors, call list_connector_tools once with tenant_id, the connector name from the trusted turn context, and the user's complete connector task as query. It returns a small set of relevant direct tools with exact schemas. Then call call_connector_tool with the same tenant_id, connector, and query plus one returned direct tool name and arguments matching its schema. Do not call connector catalog, learn, or execute meta-tools yourself. Never claim a connector is unavailable or policy-restricted until a governed tool call returns that result. Never invent connector data. For calculations or generated text files, call execute_code with tenant_id, language=python, bounded code, and optional output_files under /tmp/thinkwork/. When the user asks for a report, plan, brief, ideation document, HTML artifact, or plate, call emit_document with complete markdown; ThinkWork compiles and persists the selected HTML plate. If emit_document returns diagnostics, correct every diagnostic and call it again. Never use ungoverned shell, filesystem, browser, or native code execution tools.",
      },
    ],
    memory: { disabled: {} },
    tools: [
      {
        type: "agentcore_gateway",
        name: "thinkwork_gateway",
        config: {
          agentCoreGateway: {
            gatewayArn,
            outboundAuth: {
              oauth: {
                providerArn,
                scopes: ["gateway:invoke"],
                customParameters: {
                  subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
                },
                grantType: "TOKEN_EXCHANGE",
              },
            },
          },
        },
      },
      {
        type: "inline_function",
        name: "emit_document",
        config: {
          inlineFunction: {
            description:
              "Emit a durable ThinkWork HTML plate from markdown. Use genre report, plan, brief, or ideation. The platform compiles, validates, persists, and attaches it to the thread. On rejection, fix every diagnostic and call again with document_id when supplied.",
            inputSchema: {
              type: "object",
              properties: {
                genre: {
                  type: "string",
                  enum: ["report", "plan", "brief", "ideation"],
                },
                title: { type: "string" },
                abstract: { type: "string" },
                digest_markdown: {
                  type: "string",
                  description: "Complete markdown document body.",
                },
                status: { type: "string", enum: ["draft", "final"] },
                document_id: { type: "string" },
                space_id: { type: "string" },
              },
              required: ["genre", "title", "abstract", "digest_markdown"],
              additionalProperties: false,
            },
          },
        },
      },
    ],
    allowedTools: [
      ...targetToolNames.map((name) => `@thinkwork_gateway/${name}`),
      "emit_document",
    ],
    maxIterations: 50,
    timeoutSeconds: 900,
  };
}

async function waitForHarness(client, harnessId) {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const response = await client.send(new GetHarnessCommand({ harnessId }));
    const harness = response.harness;
    if (harness?.status === "READY") return harness;
    if (harness?.status?.includes("FAILED")) {
      throw new Error(
        `Harness reconciliation failed: ${harness.failureReason ?? "redacted service failure"}`,
      );
    }
    await sleep(10_000);
  }
  throw new Error("Harness did not become READY within ten minutes");
}

async function waitForEndpoint(client, harnessId, endpointName, version) {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const response = await client.send(
      new GetHarnessEndpointCommand({ harnessId, endpointName }),
    );
    const endpoint = response.endpoint;
    if (
      endpoint?.status === "READY" &&
      endpoint.liveVersion === version &&
      (endpoint.targetVersion === undefined ||
        endpoint.targetVersion === version)
    ) {
      return endpoint;
    }
    if (endpoint?.status?.includes("FAILED")) {
      throw new Error(
        `Harness endpoint reconciliation failed: ${endpoint.failureReason ?? "redacted service failure"}`,
      );
    }
    await sleep(10_000);
  }
  throw new Error("Harness endpoint did not become READY within ten minutes");
}

async function waitForHarnessWorkloadIdentity(client, harnessName) {
  const deadline = Date.now() + 10 * 60_000;
  const prefix = `harness_${harnessName}-`;
  while (Date.now() < deadline) {
    let nextToken;
    do {
      const response = await client.send(
        // Identity's live API caps this page size at 20. Continue paging so a
        // busy directory cannot hide the Harness-managed workload identity.
        new ListWorkloadIdentitiesCommand({ nextToken, maxResults: 20 }),
      );
      const found = response.workloadIdentities?.find((identity) =>
        identity.name?.startsWith(prefix),
      );
      if (found?.name) return found.name;
      nextToken = response.nextToken;
    } while (nextToken);
    await sleep(10_000);
  }
  throw new Error(
    "Harness workload identity was not created within ten minutes",
  );
}

async function reconcile() {
  required("AWS_REGION");
  const client = new BedrockAgentCoreControlClient({ region });
  const harnessName = required("HARNESS_NAME");
  const endpointName = required("ENDPOINT_NAME");
  const existing = await findHarness(client, harnessName);
  let harnessId = existing?.harnessId;
  const configuration = commonConfiguration();

  if (!harnessId) {
    const response = await client.send(
      new CreateHarnessCommand({
        harnessName,
        ...configuration,
        tags: {
          "thinkwork:tenant": required("TENANT_SLUG"),
          "thinkwork:trust-profile": required("TRUST_PROFILE"),
          "thinkwork:proof": "THINK-316",
          "thinkwork:configuration": required("CONFIGURATION_HASH"),
          "managed-by": "terraform",
        },
      }),
    );
    harnessId = response.harness?.harnessId;
    if (!harnessId) throw new Error("CreateHarness returned no harness id");
  } else {
    await client.send(
      new UpdateHarnessCommand({
        harnessId,
        ...configuration,
        authorizerConfiguration: {
          optionalValue: configuration.authorizerConfiguration,
        },
        memory: { optionalValue: configuration.memory },
      }),
    );
  }

  const harness = await waitForHarness(client, harnessId);
  const version = harness.harnessVersion;
  if (!version) throw new Error("Ready Harness returned no immutable version");
  const workloadIdentityName = await waitForHarnessWorkloadIdentity(
    client,
    harnessName,
  );
  await client.send(
    new UpdateWorkloadIdentityCommand({
      name: workloadIdentityName,
      allowedResourceOauth2ReturnUrls: [required("OAUTH_RETURN_URL")],
    }),
  );

  try {
    await client.send(
      new GetHarnessEndpointCommand({ harnessId, endpointName }),
    );
    await client.send(
      new UpdateHarnessEndpointCommand({
        harnessId,
        endpointName,
        targetVersion: version,
      }),
    );
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await client.send(
      new CreateHarnessEndpointCommand({
        harnessId,
        endpointName,
        targetVersion: version,
        description: "ThinkWork managed multiplayer proof endpoint",
        tags: {
          "thinkwork:proof": "THINK-316",
          "managed-by": "terraform",
        },
      }),
    );
  }

  await waitForEndpoint(client, harnessId, endpointName, version);
  process.stdout.write(
    `Harness ready: name=${harnessName} endpoint=${endpointName} version=${version}\n`,
  );
}

async function read() {
  const query = await readStdin();
  const queryRegion = required("region", query);
  const harnessName = required("harness_name", query);
  const endpointName = required("endpoint_name", query);
  const client = new BedrockAgentCoreControlClient({ region: queryRegion });
  const summary = await findHarness(client, harnessName);
  if (!summary?.harnessId) {
    throw new Error(`Harness ${harnessName} is missing after reconciliation`);
  }
  const [harnessResponse, endpointResponse] = await Promise.all([
    client.send(new GetHarnessCommand({ harnessId: summary.harnessId })),
    client.send(
      new GetHarnessEndpointCommand({
        harnessId: summary.harnessId,
        endpointName,
      }),
    ),
  ]);
  const harness = harnessResponse.harness;
  const endpoint = endpointResponse.endpoint;
  process.stdout.write(
    JSON.stringify({
      harness_id: summary.harnessId,
      harness_arn: harness?.arn ?? "",
      harness_status: harness?.status ?? "UNKNOWN",
      endpoint_arn: endpoint?.arn ?? "",
      endpoint_status: endpoint?.status ?? "UNKNOWN",
      // The live service currently omits targetVersion after convergence.
      // liveVersion is the authoritative resolved mapping in that response.
      target_version: endpoint?.targetVersion ?? endpoint?.liveVersion ?? "",
      live_version: endpoint?.liveVersion ?? "",
    }),
  );
}

async function waitUntilMissing(check, label) {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    try {
      await check();
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
    await sleep(10_000);
  }
  throw new Error(`${label} was not deleted within ten minutes`);
}

async function remove() {
  required("AWS_REGION");
  const client = new BedrockAgentCoreControlClient({ region });
  const harnessName = required("HARNESS_NAME");
  const endpointName = required("ENDPOINT_NAME");
  const summary = await findHarness(client, harnessName);
  if (!summary?.harnessId) return;
  const harnessId = summary.harnessId;

  try {
    await client.send(
      new DeleteHarnessEndpointCommand({ harnessId, endpointName }),
    );
    await waitUntilMissing(
      () =>
        client.send(new GetHarnessEndpointCommand({ harnessId, endpointName })),
      "Harness endpoint",
    );
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  await client.send(
    new DeleteHarnessCommand({ harnessId, deleteManagedMemory: true }),
  );
  await waitUntilMissing(
    () => client.send(new GetHarnessCommand({ harnessId })),
    "Harness",
  );
}

if (operation === "reconcile") await reconcile();
if (operation === "read") await read();
if (operation === "delete") await remove();

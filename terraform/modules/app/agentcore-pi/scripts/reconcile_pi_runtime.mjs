#!/usr/bin/env node
// Reconcile the Pi Bedrock AgentCore Runtime to a digest-pinned image
// (THINK-584 U5). Invoked by the deployment-control-plane runner with a JSON
// request on STDIN (never argv — the mirrored env contains secrets):
//
//   {
//     "region": "us-east-1",
//     "runtimeName": "thinkwork_<stage>_pi",
//     "runtimeId": "<optional known id>",
//     "roleArn": "arn:aws:iam::...:role/thinkwork-<stage>-agentcore-pi-role",
//     "imageUri": "<account>.dkr.ecr...amazonaws.com/...@sha256:<digest>",
//     "environment": { ... mirrored Lambda env, control chars escaped ... },
//     "waitSeconds": 900
//   }
//
// Creates the runtime when absent, updates it when present, then waits for
// runtime READY + DEFAULT endpoint liveVersion == runtime version + the
// exact image URI. Prints a result JSON on stdout. Env VALUES are never
// printed — counts only (R19).

import {
  BedrockAgentCoreControlClient,
  CreateAgentRuntimeCommand,
  GetAgentRuntimeCommand,
  ListAgentRuntimesCommand,
  ListAgentRuntimeEndpointsCommand,
  UpdateAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore-control";

if (process.argv[2] === "--runtime-preflight") {
  process.stdout.write(
    JSON.stringify({
      entrypoint: "reconcile_pi_runtime",
      sdkImportReady:
        typeof BedrockAgentCoreControlClient === "function" &&
        typeof CreateAgentRuntimeCommand === "function" &&
        typeof GetAgentRuntimeCommand === "function" &&
        typeof ListAgentRuntimesCommand === "function" &&
        typeof ListAgentRuntimeEndpointsCommand === "function" &&
        typeof UpdateAgentRuntimeCommand === "function",
    }),
  );
  process.exit(0);
}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));

const environment = input.environment ?? {};
const envCount = Object.keys(environment).length;
if (envCount === 0) {
  // Atomic-or-abort: an empty mirrored env would strand the runtime.
  process.stderr.write(
    "reconcile_pi_runtime: refusing to proceed with an empty environment mirror\n",
  );
  process.exit(2);
}
if (!/@sha256:[0-9a-f]{64}$/.test(input.imageUri ?? "")) {
  process.stderr.write(
    "reconcile_pi_runtime: imageUri must be pinned to an immutable sha256 digest\n",
  );
  process.exit(2);
}

const client = new BedrockAgentCoreControlClient({ region: input.region });

let runtimeId = input.runtimeId || "";
if (!runtimeId) {
  let nextToken;
  do {
    const page = await client.send(new ListAgentRuntimesCommand({ nextToken }));
    const match = (page.agentRuntimes ?? []).find(
      (runtime) => runtime.agentRuntimeName === input.runtimeName,
    );
    if (match) {
      runtimeId = match.agentRuntimeId;
      break;
    }
    nextToken = page.nextToken;
  } while (nextToken);
}

const artifact = {
  containerConfiguration: { containerUri: input.imageUri },
};
let created = false;
if (runtimeId) {
  await client.send(
    new UpdateAgentRuntimeCommand({
      agentRuntimeId: runtimeId,
      roleArn: input.roleArn,
      agentRuntimeArtifact: artifact,
      networkConfiguration: { networkMode: "PUBLIC" },
      protocolConfiguration: { serverProtocol: "HTTP" },
      environmentVariables: environment,
    }),
  );
} else {
  const response = await client.send(
    new CreateAgentRuntimeCommand({
      agentRuntimeName: input.runtimeName,
      roleArn: input.roleArn,
      agentRuntimeArtifact: artifact,
      networkConfiguration: { networkMode: "PUBLIC" },
      protocolConfiguration: { serverProtocol: "HTTP" },
      environmentVariables: environment,
    }),
  );
  runtimeId = response.agentRuntimeId;
  created = true;
}

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitSeconds = Number(input.waitSeconds ?? 900);
const deadline = Date.now() + waitSeconds * 1000;
let detail;
let endpoint;
for (;;) {
  detail = await client.send(
    new GetAgentRuntimeCommand({ agentRuntimeId: runtimeId }),
  );
  const endpoints = await client.send(
    new ListAgentRuntimeEndpointsCommand({ agentRuntimeId: runtimeId }),
  );
  endpoint = (endpoints.runtimeEndpoints ?? []).find(
    (candidate) => candidate.name === "DEFAULT",
  );
  const mirroredCount = Object.keys(detail.environmentVariables ?? {}).length;
  const image =
    detail.agentRuntimeArtifact?.containerConfiguration?.containerUri ?? "";
  const settled =
    detail.status === "READY" &&
    endpoint?.status === "READY" &&
    (endpoint?.targetVersion == null ||
      endpoint.targetVersion === detail.agentRuntimeVersion) &&
    endpoint?.liveVersion === detail.agentRuntimeVersion &&
    image === input.imageUri;
  if (settled) {
    if (mirroredCount === 0) {
      // Post-update assertion half of atomic-or-abort: the runtime settled
      // but reports an EMPTY env — the mirror did not stick. Fail loudly.
      process.stderr.write(
        "reconcile_pi_runtime: runtime settled with an EMPTY environment\n",
      );
      process.exit(2);
    }
    break;
  }
  if (Date.now() >= deadline) {
    process.stderr.write(
      `reconcile_pi_runtime: timed out waiting for ${runtimeId} ` +
        `(runtime=${detail.status} endpoint=${endpoint?.status ?? "MISSING"} ` +
        `live=${endpoint?.liveVersion ?? "null"} target=${endpoint?.targetVersion ?? "null"} ` +
        `image=${image})\n`,
    );
    process.exit(1);
  }
  await sleep(15000);
}

process.stdout.write(
  JSON.stringify({
    runtimeId,
    created,
    version: detail.agentRuntimeVersion,
    status: detail.status,
    endpointStatus: endpoint?.status ?? "UNKNOWN",
    liveVersion: endpoint?.liveVersion ?? null,
    image: detail.agentRuntimeArtifact?.containerConfiguration?.containerUri,
    envCount,
  }),
);

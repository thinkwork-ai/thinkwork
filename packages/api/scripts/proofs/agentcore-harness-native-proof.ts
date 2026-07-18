import { randomUUID } from "node:crypto";

import {
  BedrockAgentCoreClient,
  InvokeHarnessCommand,
  type HarnessContentBlock,
  type HarnessToolUseBlock,
  type InvokeHarnessResponse,
} from "@aws-sdk/client-bedrock-agentcore";
import {
  BedrockAgentCoreControlClient,
  CreateHarnessCommand,
  DeleteHarnessCommand,
  GetHarnessCommand,
} from "@aws-sdk/client-bedrock-agentcore-control";
import {
  CreateRoleCommand,
  DeleteRoleCommand,
  DeleteRolePolicyCommand,
  IAMClient,
  PutRolePolicyCommand,
} from "@aws-sdk/client-iam";

const region = process.env.AWS_REGION ?? "us-east-1";
const accountId = process.env.AWS_ACCOUNT_ID;
const stamp = Date.now().toString().slice(-10);
const roleName = `Think316HarnessInline${stamp}`;
const policyName = "Think316HarnessInlineProof";
const harnessName = `Think316Inline${stamp}`;
const configuredAllowedTools = process.env.HARNESS_ALLOWED_TOOLS?.split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const iam = new IAMClient({ region });
const control = new BedrockAgentCoreControlClient({ region });
const data = new BedrockAgentCoreClient({ region });

let harnessId: string | undefined;
let roleCreated = false;
let policyCreated = false;

type StreamEvent = {
  contentBlockStart?: {
    contentBlockIndex: number;
    start?: { toolUse?: { toolUseId?: string; name?: string } };
  };
  contentBlockDelta?: {
    contentBlockIndex: number;
    delta?: { text?: string; toolUse?: { input?: string } };
  };
  messageStop?: { stopReason?: string };
  runtimeClientError?: { message?: string };
  internalServerException?: { message?: string };
  validationException?: { message?: string; reason?: string };
};

type ToolUse = {
  toolUseId: string;
  name: string;
  input: HarnessToolUseBlock["input"];
};

function requireAccountId(): string {
  if (!accountId || !/^\d{12}$/.test(accountId)) {
    throw new Error(
      "AWS_ACCOUNT_ID must be the current 12-digit AWS account id",
    );
  }
  return accountId;
}

async function createExecutionRole(): Promise<string> {
  const currentAccountId = requireAccountId();
  const created = await iam.send(
    new CreateRoleCommand({
      RoleName: roleName,
      Description: "Ephemeral THINK-316 official Harness inline-function proof",
      AssumeRolePolicyDocument: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: "bedrock-agentcore.amazonaws.com" },
            Action: "sts:AssumeRole",
          },
        ],
      }),
      Tags: [
        { Key: "thinkwork:proof", Value: "THINK-316" },
        { Key: "thinkwork:ephemeral", Value: "true" },
      ],
    }),
  );
  roleCreated = true;

  await iam.send(
    new PutRolePolicyCommand({
      RoleName: roleName,
      PolicyName: policyName,
      PolicyDocument: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "BedrockModelInvocation",
            Effect: "Allow",
            Action: [
              "bedrock:InvokeModel",
              "bedrock:InvokeModelWithResponseStream",
            ],
            Resource: [
              "arn:aws:bedrock:*::foundation-model/*",
              `arn:aws:bedrock:*:${currentAccountId}:inference-profile/*`,
            ],
          },
          {
            Sid: "EcrPublicTokenAccess",
            Effect: "Allow",
            Action: "ecr-public:GetAuthorizationToken",
            Resource: "*",
          },
          {
            Sid: "StsForEcrPublicPull",
            Effect: "Allow",
            Action: "sts:GetServiceBearerToken",
            Resource: "*",
          },
          {
            Sid: "HarnessTelemetry",
            Effect: "Allow",
            Action: [
              "logs:CreateLogGroup",
              "logs:CreateLogStream",
              "logs:DescribeLogGroups",
              "logs:DescribeLogStreams",
              "logs:PutLogEvents",
              "cloudwatch:PutMetricData",
              "xray:PutTraceSegments",
              "xray:PutTelemetryRecords",
              "xray:GetSamplingRules",
              "xray:GetSamplingTargets",
            ],
            Resource: "*",
          },
          {
            Sid: "HarnessSessionMemory",
            Effect: "Allow",
            Action: [
              "bedrock-agentcore:CreateEvent",
              "bedrock-agentcore:DeleteEvent",
              "bedrock-agentcore:GetEvent",
              "bedrock-agentcore:ListEvents",
              "bedrock-agentcore:ListSessions",
              "bedrock-agentcore:ListActors",
              "bedrock-agentcore:ListMemoryRecords",
              "bedrock-agentcore:RetrieveMemoryRecords",
              "bedrock-agentcore:GetMemoryRecord",
              "bedrock-agentcore:GetMemory",
            ],
            Resource: `arn:aws:bedrock-agentcore:${region}:${currentAccountId}:memory/harness_*`,
          },
        ],
      }),
    }),
  );
  policyCreated = true;

  const roleArn = created.Role?.Arn;
  if (!roleArn) throw new Error("CreateRole returned no ARN");
  return roleArn;
}

async function waitForHarnessReady(id: string): Promise<void> {
  const deadline = Date.now() + 8 * 60_000;
  while (Date.now() < deadline) {
    const response = await control.send(
      new GetHarnessCommand({ harnessId: id }),
    );
    const status = response.harness?.status;
    if (status === "READY") return;
    if (status === "CREATE_FAILED" || status === "UPDATE_FAILED") {
      throw new Error(
        `Harness entered ${status}: ${response.harness?.failureReason ?? "unknown"}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error("Harness did not become READY within eight minutes");
}

async function consume(
  response: InvokeHarnessResponse,
): Promise<{ text: string; stopReason?: string; toolUse?: ToolUse }> {
  const stream = response.stream as AsyncIterable<StreamEvent> | undefined;
  if (!stream) throw new Error("InvokeHarness returned no stream");

  let text = "";
  let stopReason: string | undefined;
  let toolUseId: string | undefined;
  let toolName: string | undefined;
  let toolInput = "";

  for await (const event of stream) {
    if (event.runtimeClientError) {
      throw new Error(
        `runtimeClientError: ${event.runtimeClientError.message ?? "unknown"}`,
      );
    }
    if (event.internalServerException) {
      throw new Error(
        `internalServerException: ${event.internalServerException.message ?? "unknown"}`,
      );
    }
    if (event.validationException) {
      throw new Error(
        `validationException: ${event.validationException.reason ?? "unknown"}: ${event.validationException.message ?? ""}`,
      );
    }
    if (event.contentBlockStart?.start?.toolUse) {
      toolUseId = event.contentBlockStart.start.toolUse.toolUseId;
      toolName = event.contentBlockStart.start.toolUse.name;
    }
    const delta = event.contentBlockDelta?.delta;
    if (delta?.text) text += delta.text;
    if (delta?.toolUse?.input) toolInput += delta.toolUse.input;
    if (event.messageStop?.stopReason)
      stopReason = event.messageStop.stopReason;
  }

  let toolUse: ToolUse | undefined;
  if (toolUseId && toolName) {
    toolUse = {
      toolUseId,
      name: toolName,
      input: toolInput
        ? (JSON.parse(toolInput) as HarnessToolUseBlock["input"])
        : {},
    };
  }
  return { text, stopReason, toolUse };
}

async function runInlineControl(roleArn: string): Promise<void> {
  const tools = [
    {
      type: "inline_function" as const,
      name: "get_weather",
      config: {
        inlineFunction: {
          description: "Get the current weather for a city.",
          inputSchema: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
          },
        },
      },
    },
  ];
  const created = await control.send(
    new CreateHarnessCommand({
      harnessName,
      executionRoleArn: roleArn,
      model: {
        bedrockModelConfig: {
          modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        },
      },
      systemPrompt: [{ text: "You are a helpful assistant." }],
      tools,
      ...(configuredAllowedTools?.length
        ? { allowedTools: configuredAllowedTools }
        : {}),
    }),
  );
  harnessId = created.harness?.harnessId;
  const harnessArn = created.harness?.arn;
  if (!harnessId || !harnessArn)
    throw new Error("CreateHarness returned no Harness identity");
  await waitForHarnessReady(harnessId);

  const persisted = (await control.send(new GetHarnessCommand({ harnessId })))
    .harness;
  const persistedTools = persisted?.tools ?? [];
  const persistedAllowedTools = persisted?.allowedTools ?? [];
  console.log(
    JSON.stringify({
      controlPlaneAttestation: {
        harnessVersion: persisted?.harnessVersion,
        status: persisted?.status,
        tools: persistedTools.map((tool) => ({
          type: tool.type,
          name: tool.name,
        })),
        allowedTools: persistedAllowedTools,
        memoryDisabled: persisted?.memory && "disabled" in persisted.memory,
      },
    }),
  );
  if (
    persistedTools.length !== 1 ||
    persistedTools[0]?.type !== "inline_function" ||
    persistedTools[0]?.name !== "get_weather"
  ) {
    throw new Error(
      "Harness control-plane readback does not match the inline control",
    );
  }

  const sessionId = `think316-inline-${randomUUID()}`;

  const first = await consume(
    await data.send(
      new InvokeHarnessCommand({
        harnessArn,
        runtimeSessionId: sessionId,
        tools,
        ...(configuredAllowedTools?.length
          ? { allowedTools: configuredAllowedTools }
          : {}),
        messages: [
          {
            role: "user",
            content: [
              { text: "What's the weather in Seattle? Use get_weather." },
            ],
          },
        ],
      }),
    ),
  );

  if (!first.toolUse) {
    throw new Error(
      `Official inline control emitted no structured toolUse (stopReason=${first.stopReason ?? "unknown"}, text=${JSON.stringify(first.text.slice(0, 500))})`,
    );
  }
  const city =
    first.toolUse.input &&
    typeof first.toolUse.input === "object" &&
    !Array.isArray(first.toolUse.input)
      ? (first.toolUse.input as Record<string, unknown>).city
      : undefined;
  if (first.toolUse.name !== "get_weather" || city !== "Seattle") {
    throw new Error(
      `Unexpected structured toolUse: ${JSON.stringify(first.toolUse)}`,
    );
  }

  const assistantToolUse: HarnessContentBlock = { toolUse: first.toolUse };
  const second = await consume(
    await data.send(
      new InvokeHarnessCommand({
        harnessArn,
        runtimeSessionId: sessionId,
        tools,
        ...(configuredAllowedTools?.length
          ? { allowedTools: configuredAllowedTools }
          : {}),
        messages: [
          { role: "assistant", content: [assistantToolUse] },
          {
            role: "user",
            content: [
              {
                toolResult: {
                  toolUseId: first.toolUse.toolUseId,
                  content: [{ text: "72°F, partly cloudy" }],
                  status: "success",
                },
              },
            ],
          },
        ],
      }),
    ),
  );

  if (!second.text.includes("72")) {
    throw new Error(
      `Continuation did not use the supplied result (stopReason=${second.stopReason ?? "unknown"}, text=${JSON.stringify(second.text.slice(0, 500))})`,
    );
  }

  console.log(
    JSON.stringify({
      result: "PASS",
      sdk: "3.1089.0",
      structuredToolUse: true,
      toolName: first.toolUse.name,
      toolInput: first.toolUse.input,
      firstStopReason: first.stopReason,
      continuationStopReason: second.stopReason,
      continuationUsedToolResult: true,
    }),
  );
}

async function cleanup(): Promise<void> {
  if (harnessId) {
    try {
      await control.send(new DeleteHarnessCommand({ harnessId }));
    } catch (error) {
      console.error(`cleanup warning: DeleteHarness failed: ${String(error)}`);
    }
  }
  if (policyCreated) {
    try {
      await iam.send(
        new DeleteRolePolicyCommand({
          RoleName: roleName,
          PolicyName: policyName,
        }),
      );
    } catch (error) {
      console.error(
        `cleanup warning: DeleteRolePolicy failed: ${String(error)}`,
      );
    }
  }
  if (roleCreated) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        await iam.send(new DeleteRoleCommand({ RoleName: roleName }));
        break;
      } catch (error) {
        if (attempt === 11) {
          console.error(`cleanup warning: DeleteRole failed: ${String(error)}`);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
  }
}

try {
  const roleArn = await createExecutionRole();
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  await runInlineControl(roleArn);
} finally {
  await cleanup();
}

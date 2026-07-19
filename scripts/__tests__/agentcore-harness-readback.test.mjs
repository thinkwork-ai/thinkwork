import assert from "node:assert/strict";
import test from "node:test";
import {
  GetHarnessCommand,
  GetHarnessEndpointCommand,
} from "@aws-sdk/client-bedrock-agentcore-control";
import {
  projectGovernedInvocationTools,
  readVersionPinnedHarness,
} from "../../terraform/modules/app/agentcore-harness/scripts/harness-readback.mjs";
import {
  buildGovernedHarnessTools,
  fingerprintGovernedHarnessTools,
  selectHarnessEndpointsForRetention,
} from "../../terraform/modules/app/agentcore-harness/scripts/harness-tool-contract.mjs";

const expectedReadback = {
  harnessId: "harness-1",
  endpointName: "ThinkworkProof",
  expectedGatewayArn: "arn:aws:bedrock-agentcore:us-east-1:123:gateway/g1",
  expectedOauthProviderArn:
    "arn:aws:bedrock-agentcore:us-east-1:123:token-vault/default/oauth2credentialprovider/p1",
};

const tools = buildGovernedHarnessTools({
  gatewayArn: expectedReadback.expectedGatewayArn,
  providerArn: expectedReadback.expectedOauthProviderArn,
});

test("reads tools from the immutable endpoint live version", async () => {
  const calls = [];
  const client = {
    async send(command) {
      calls.push(command);
      if (command instanceof GetHarnessEndpointCommand) {
        return {
          endpoint: {
            status: "READY",
            targetVersion: "4",
            liveVersion: "4",
          },
        };
      }
      assert.ok(command instanceof GetHarnessCommand);
      assert.equal(command.input.harnessVersion, "4");
      return {
        harness: {
          harnessVersion: "4",
          tools,
        },
      };
    },
  };

  const result = await readVersionPinnedHarness(client, expectedReadback);

  assert.equal(result.liveVersion, "4");
  assert.equal(result.harness.harnessVersion, "4");
  assert.equal(calls.length, 2);
});

test("rejects a tool snapshot that does not match the endpoint version", async () => {
  const client = {
    async send(command) {
      if (command instanceof GetHarnessEndpointCommand) {
        return { endpoint: { status: "READY", liveVersion: "4" } };
      }
      return { harness: { harnessVersion: "5", tools } };
    },
  };

  await assert.rejects(
    readVersionPinnedHarness(client, expectedReadback),
    /versions do not match/,
  );
});

test("does not fall back to the mutable current Harness configuration", async () => {
  const client = {
    async send(command) {
      if (command instanceof GetHarnessEndpointCommand) {
        return { endpoint: { status: "READY", liveVersion: "7" } };
      }
      assert.equal(command.input.harnessVersion, "7");
      return { harness: { harnessVersion: "7", tools } };
    },
  };

  await readVersionPinnedHarness(client, expectedReadback);
});

test("rejects an unexpected tool before it can enter Terraform state", () => {
  assert.throws(
    () =>
      projectGovernedInvocationTools([
        ...tools,
        {
          type: "remote_mcp",
          name: "unexpected",
          config: {
            remoteMcp: {
              url: "https://example.com/mcp",
              headers: { authorization: "must-not-be-persisted" },
            },
          },
        },
      ]),
    /violates the governed contract/,
  );
});

test("projects only the exact non-secret Gateway authentication fields", () => {
  const withUnexpectedMetadata = structuredClone(tools);
  withUnexpectedMetadata[0].serviceMetadata = {
    credential: "must-not-be-persisted",
  };
  const projected = projectGovernedInvocationTools(
    withUnexpectedMetadata,
    expectedReadback,
  );
  assert.equal(
    JSON.stringify(projected).includes("must-not-be-persisted"),
    false,
  );
  assert.deepEqual(Object.keys(projected[0]), ["type", "name", "config"]);
});

test("rejects a Gateway or OAuth provider redirected from Terraform intent", () => {
  const redirected = structuredClone(tools);
  redirected[0].config.agentCoreGateway.gatewayArn =
    "arn:aws:bedrock-agentcore:us-east-1:123:gateway/other";
  assert.throws(
    () => projectGovernedInvocationTools(redirected, expectedReadback),
    /violates the governed contract/,
  );
});

test("rejects OAuth contract drift before profile publication", () => {
  for (const mutate of [
    (candidate) =>
      candidate[0].config.agentCoreGateway.outboundAuth.oauth.scopes.push(
        "unexpected:scope",
      ),
    (candidate) => {
      candidate[0].config.agentCoreGateway.outboundAuth.oauth.customParameters.subject_token_type =
        "unexpected";
    },
  ]) {
    const candidate = structuredClone(tools);
    mutate(candidate);
    assert.throws(
      () => projectGovernedInvocationTools(candidate, expectedReadback),
      /violates the governed contract/,
    );
  }
});

test("rejects inline-function schema drift before profile publication", () => {
  for (const mutate of [
    (candidate) => {
      candidate[2].config.inlineFunction.description = " ";
    },
    (candidate) => {
      candidate[2].config.inlineFunction.inputSchema.additionalProperties = true;
    },
    (candidate) => {
      candidate[2].config.inlineFunction.inputSchema.type = "array";
    },
    (candidate) => {
      candidate[3].config.inlineFunction.inputSchema.required = [];
    },
    (candidate) => {
      candidate[4].config.inlineFunction.inputSchema.properties = {};
    },
  ]) {
    const candidate = structuredClone(tools);
    mutate(candidate);
    assert.throws(
      () => projectGovernedInvocationTools(candidate, expectedReadback),
      /violates the governed contract/,
    );
  }
});

test("uses one canonical fingerprint encoding for JSON-compatible text", () => {
  const candidate = structuredClone(tools);
  candidate[2].config.inlineFunction.description =
    "x < y & y > z\u2028next\u2029";
  assert.equal(
    fingerprintGovernedHarnessTools(candidate),
    "f436d93163de30618bea2e9b686182ce512e2fd134e682b862a921bb92c8bf8d",
  );
});

test("retains the active endpoint and one newest rollback endpoint", () => {
  const retention = selectHarnessEndpointsForRetention(
    [
      { endpointName: "ThinkworkProof", liveVersion: "14" },
      { endpointName: "ThinkworkProofV15", liveVersion: "15" },
      { endpointName: "ThinkworkProofV16", liveVersion: "16" },
      { endpointName: "unrelated", liveVersion: "99" },
    ],
    {
      activeEndpointName: "ThinkworkProofV16",
      endpointPrefix: "ThinkworkProofV",
      legacyEndpointName: "ThinkworkProof",
    },
  );

  assert.deepEqual(retention.retainedEndpointNames, [
    "ThinkworkProofV16",
    "ThinkworkProofV15",
  ]);
  assert.deepEqual(retention.deletedEndpointNames, ["ThinkworkProof"]);
});

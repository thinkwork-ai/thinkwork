import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFile(join(repoRoot, path), "utf8");

describe("managed multiplayer Harness topology", () => {
  it("derives one Harness from stage, tenant, and trust profile only", async () => {
    const terraform = await read(
      "terraform/modules/app/agentcore-harness/main.tf",
    );
    const outputs = await read(
      "terraform/modules/app/agentcore-harness/outputs.tf",
    );
    const rootModule = await read("terraform/modules/thinkwork/main.tf");

    assert.match(
      terraform,
      /harness_name\s+= "Thinkwork_\$\{local\.normalized_stage\}_\$\{local\.normalized_tenant\}_\$\{local\.normalized_profile\}"/,
    );
    assert.doesNotMatch(terraform, /participant_id|thread_id|agent_id/);
    assert.match(terraform, /endpoint_prefix\s+= "ThinkworkProofV"/);
    assert.match(outputs, /result\.endpoint_name/);
    const lifecycle = await read(
      "terraform/modules/app/agentcore-harness/scripts/harness-lifecycle.mjs",
    );
    assert.match(lifecycle, /`\$\{endpointPrefix\}\$\{version\}`/);
    assert.match(terraform, /LEGACY_ENDPOINT_NAME\s+= "ThinkworkProof"/);
    assert.match(
      lifecycle,
      /selectHarnessEndpointsForRetention\(endpoints, \{[\s\S]*?activeEndpointName: endpointName,[\s\S]*?CreateHarnessEndpointCommand/,
    );
    assert.doesNotMatch(lifecycle, /UpdateHarnessEndpointCommand/);
    assert.match(rootModule, /agentcore_harness_endpoint_retention/);
    assert.match(rootModule, /aws_ssm_parameter\.agentcore_harness_profile/);
    assert.match(outputs, /target_version/);
    assert.match(outputs, /live_version/);
  });

  it("keeps Harness control-plane and PassRole actions out of request-path IAM", async () => {
    const policy = await read(
      "terraform/modules/app/lambda-api/iam-grouped.tf",
    );
    const invocationSlice = policy.slice(
      policy.indexOf("THINK-316 U2 — request path receives data-plane"),
      policy.indexOf("Group 4: observability"),
    );

    assert.match(invocationSlice, /bedrock-agentcore:InvokeHarness/);
    assert.doesNotMatch(
      invocationSlice,
      /CreateHarness|UpdateHarness|DeleteHarness/,
    );
    assert.doesNotMatch(invocationSlice, /iam:PassRole/);
    assert.doesNotMatch(
      invocationSlice,
      /"bedrock-agentcore:InvokeAgentRuntimeCommand"/,
    );
  });

  it("scopes skills and native identity to the selected tenant profile", async () => {
    const terraform = await read(
      "terraform/modules/app/agentcore-harness/main.tf",
    );
    const lifecycle = await read(
      "terraform/modules/app/agentcore-harness/scripts/harness-lifecycle.mjs",
    );
    const toolContract = await read(
      "terraform/modules/app/agentcore-harness/scripts/harness-tool-contract.mjs",
    );

    assert.match(terraform, /tenant_skill_prefix/);
    assert.match(terraform, /SelectedTenantGateway/);
    assert.match(terraform, /ExactUserIdentityExchange/);
    assert.match(lifecycle, /customJWTAuthorizer/);
    assert.match(toolContract, /grantType: "TOKEN_EXCHANGE"/);
    assert.match(lifecycle, /memory: \{ disabled: \{\} \}/);
    assert.match(lifecycle, /required\("GATEWAY_TARGET_TOOL_NAMES"\)/);
    assert.match(lifecycle, /"@thinkwork_gateway\/\*"/);
    assert.match(toolContract, /name: "submit_skill_draft"/);
    assert.match(terraform, /governed-review-draft-v1/);
    assert.doesNotMatch(lifecycle, /targetToolNames\.map/);
    assert.match(
      lifecycle,
      /ListWorkloadIdentitiesCommand\(\{ nextToken, maxResults: 20 \}\)/,
    );
    assert.match(terraform, /___owner_probe/);
    assert.match(terraform, /___mixed_disclosure/);
    assert.match(terraform, /gateway-and-cedar-authoritative/);
    assert.match(terraform, /managed_multiplayer_harness_configuration/);
  });

  it("fails closed when managed cleanup runtime entrypoints are absent", async () => {
    const runtimeDir = await mkdtemp(
      join(tmpdir(), "thinkwork-agentcore-runtime-"),
    );
    try {
      for (const operation of ["delete", "prune", "read", "reconcile"]) {
        const wrapper = join(
          repoRoot,
          `terraform/modules/app/agentcore-harness/scripts/${operation}_harness.sh`,
        );
        const result = spawnSync("bash", [wrapper], {
          encoding: "utf8",
          env: {
            ...process.env,
            THINKWORK_AGENTCORE_CONTROL_RUNTIME_DIR: runtimeDir,
          },
        });
        assert.equal(result.status, 66, `${operation}: ${result.stderr}`);
        assert.match(
          result.stderr,
          /Managed AgentCore control runtime is missing harness-lifecycle\.js/,
        );
        assert.doesNotMatch(
          `${result.stdout}${result.stderr}`,
          /ERR_MODULE_NOT_FOUND/,
        );
      }
    } finally {
      await rm(runtimeDir, { recursive: true });
    }
  });
});

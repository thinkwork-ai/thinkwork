import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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

    assert.match(
      terraform,
      /harness_name\s+= "Thinkwork_\$\{local\.normalized_stage\}_\$\{local\.normalized_tenant\}_\$\{local\.normalized_profile\}"/,
    );
    assert.doesNotMatch(terraform, /participant_id|thread_id|agent_id/);
    assert.match(terraform, /endpoint_name\s+= "ThinkworkProof"/);
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

    assert.match(terraform, /tenant_skill_prefix/);
    assert.match(terraform, /SelectedTenantGateway/);
    assert.match(terraform, /ExactUserIdentityExchange/);
    assert.match(lifecycle, /customJWTAuthorizer/);
    assert.match(lifecycle, /grantType: "TOKEN_EXCHANGE"/);
    assert.match(lifecycle, /memory: \{ disabled: \{\} \}/);
    assert.match(lifecycle, /required\("GATEWAY_TARGET_TOOL_NAMES"\)/);
    assert.match(lifecycle, /targetToolNames\.map/);
    assert.match(terraform, /___owner_probe/);
    assert.match(terraform, /___mixed_disclosure/);
    assert.match(terraform, /gateway-and-cedar-authoritative/);
    assert.match(terraform, /managed_multiplayer_harness_configuration/);
  });
});

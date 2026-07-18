import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

async function source(path) {
  return readFile(join(repoRoot, path), "utf8");
}

describe("AgentCore Identity operational hardening", () => {
  it("publishes at most two rotation keys and signs with only the active key", async () => {
    const terraform = await source(
      "terraform/modules/app/lambda-api/mcp-oauth.tf",
    );
    const variables = await source(
      "terraform/modules/app/lambda-api/variables.tf",
    );

    assert.match(
      variables,
      /length\(var\.agentcore_turn_assertion_key_versions\) <= 2/,
    );
    assert.match(
      variables,
      /contains\(var\.agentcore_turn_assertion_key_versions, var\.agentcore_turn_assertion_active_key_version\)/,
    );
    assert.match(
      terraform,
      /Resource = \[local\.agentcore_turn_assertion_active_key\.key_id\]/,
    );
    assert.match(
      terraform,
      /Action\s+= \["kms:GetPublicKey"\][\s\S]*values\(local\.agentcore_turn_assertion_keys\)/,
    );
  });

  it("keeps signing authority out of the public issuer role", async () => {
    const terraform = await source(
      "terraform/modules/app/lambda-api/mcp-oauth.tf",
    );
    const jwksPolicy = terraform.slice(
      terraform.indexOf(
        'resource "aws_iam_role_policy" "turn_assertion_jwks_kms"',
      ),
    );

    assert.match(jwksPolicy, /kms:GetPublicKey/);
    assert.doesNotMatch(jwksPolicy, /kms:Sign/);
  });

  it("configures OBO token exchange and bounded operational alarms", async () => {
    const identity = await source(
      "terraform/modules/app/agentcore-identity/scripts/reconcile_identity.sh",
    );
    const alarms = await source(
      "terraform/modules/app/lambda-api/agentcore-identity-alarms.tf",
    );

    assert.match(identity, /onBehalfOfTokenExchangeConfig/);
    assert.match(identity, /grantType: "TOKEN_EXCHANGE"/);
    assert.match(alarms, /extended_statistic\s+= "p95"/);
    assert.match(alarms, /threshold\s+= 100/);
    assert.match(alarms, /extended_statistic\s+= "p99"/);
    assert.match(alarms, /threshold\s+= 250/);
    assert.match(alarms, /TurnAssertionKmsSignFailures/);
  });

  it("fails Gateway teardown when deletion or final absence cannot be verified", async () => {
    const teardown = await source(
      "terraform/modules/app/agentcore-gateway/scripts/delete_gateway.sh",
    );

    assert.doesNotMatch(
      teardown,
      /delete-(?:policy|gateway|policy-engine)[^\n]*\|\| true/,
    );
    assert.match(teardown, /Timed out waiting for %s deletion/);
    assert.match(teardown, /Unable to verify %s deletion/);
    assert.match(teardown, /ResourceNotFoundException/);
  });
});

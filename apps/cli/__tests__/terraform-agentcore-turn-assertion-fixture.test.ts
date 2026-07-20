import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

function read(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), "utf8");
}

describe("AgentCore turn assertion Terraform fixture", () => {
  const handlers = read("terraform/modules/app/lambda-api/handlers.tf");
  const oauth = read("terraform/modules/app/lambda-api/mcp-oauth.tf");
  const groupedIam = read("terraform/modules/app/lambda-api/iam-grouped.tf");
  const harnessModule = read("terraform/modules/app/agentcore-harness/main.tf");
  const harnessVariables = read(
    "terraform/modules/app/agentcore-harness/variables.tf",
  );
  const harnessOutputs = read(
    "terraform/modules/app/agentcore-harness/outputs.tf",
  );
  const harnessLifecycle = read(
    "terraform/modules/app/agentcore-harness/scripts/harness-lifecycle.mjs",
  );
  const gatewayModule = read("terraform/modules/app/agentcore-gateway/main.tf");
  const gatewayReconciler = read(
    "terraform/modules/app/agentcore-gateway/scripts/reconcile_gateway.sh",
  );
  const thinkworkOutputs = read("terraform/modules/thinkwork/outputs.tf");
  const identity = read("terraform/modules/app/agentcore-identity/main.tf");
  const identityReconciler = read(
    "terraform/modules/app/agentcore-identity/scripts/reconcile_twenty_identity.sh",
  );
  const twentyClientBootstrap = read(
    "terraform/modules/app/agentcore-identity/scripts/bootstrap_twenty_oauth_client.sh",
  );
  const twentyProviderReconciler = read(
    "terraform/modules/app/agentcore-identity/scripts/reconcile_twenty_provider.mjs",
  );
  const build = read("scripts/build-lambdas.sh");

  it("keeps mint authority on a direct-invoke Lambda with a sibling role", () => {
    expect(handlers).toContain('"turn-assertion-mint"');
    expect(handlers).toMatch(
      /each\.key == "turn-assertion-mint"\s*\?\s*aws_iam_role\.turn_assertion_mint\[0\]\.arn/,
    );
    expect(handlers).not.toMatch(
      /"(?:GET|POST|ANY) [^"]+"\s*=\s*"turn-assertion-mint"/,
    );
    expect(build).toMatch(
      /build_handler "turn-assertion-mint"[\s\\]+"\$REPO_ROOT\/packages\/api\/src\/handlers\/turn-assertion-mint\.ts"/,
    );
  });

  it("grants Sign only to the two token issuers and GetPublicKey only to discovery", () => {
    expect(oauth).toMatch(
      /resource "aws_iam_role_policy" "turn_assertion_mint_kms" \{[\s\S]*?role\s*=\s*aws_iam_role\.turn_assertion_mint\[0\]\.id[\s\S]*?Action\s*=\s*\["kms:Sign"\][\s\S]*?"kms:SigningAlgorithm"\s*=\s*"RSASSA_PKCS1_V1_5_SHA_256"/,
    );
    expect(oauth).toMatch(
      /resource "aws_iam_role_policy" "agentcore_proof_provider_kms" \{[\s\S]*?role\s*=\s*aws_iam_role\.agentcore_proof_provider\[0\]\.id[\s\S]*?Action\s*=\s*\["kms:Sign"\][\s\S]*?"kms:SigningAlgorithm"\s*=\s*"RSASSA_PKCS1_V1_5_SHA_256"/,
    );
    expect(oauth).toMatch(
      /resource "aws_iam_role_policy" "turn_assertion_jwks_kms" \{[\s\S]*?role\s*=\s*aws_iam_role\.lambda\.id[\s\S]*?Action\s*=\s*\["kms:GetPublicKey"\]/,
    );
    expect(oauth).toMatch(
      /resource "aws_kms_key" "agentcore_turn_assertion" \{[\s\S]*?Principal\s*=\s*\{ AWS = "arn:aws:iam::\$\{var\.account_id\}:root" \}/,
    );
    expect(groupedIam).not.toContain('"kms:Sign"');
  });

  it("keeps unrelated shared API secrets out of the mint environment", () => {
    const minimalEnv = handlers.match(
      /turn_assertion_mint_env\s*=\s*\{([\s\S]*?)\n\s*\}/,
    )?.[1];
    expect(minimalEnv).toBeDefined();
    expect(minimalEnv).toContain("DATABASE_URL");
    expect(minimalEnv).not.toContain("API_AUTH_SECRET");
    expect(minimalEnv).not.toContain("APPSYNC_API_KEY");
  });

  it("publishes the immutable AgentCore issuer and JWKS through API Gateway", () => {
    expect(handlers).toMatch(
      /"GET \/agentcore\/\.well-known\/openid-configuration"\s*=\s*"mcp-oauth"/,
    );
    expect(handlers).toMatch(
      /"GET \/agentcore\/oauth\/jwks"\s*=\s*"mcp-oauth"/,
    );
    expect(handlers).toMatch(
      /"mcp-oauth"\s*=\s*\{[\s\S]*?AGENTCORE_TURN_ASSERTION_ISSUER\s*=\s*local\.agentcore_turn_assertion_issuer/,
    );
  });

  it("keeps every proof-only Lambda, route, role, and KMS key behind one opt-in", () => {
    expect(handlers).toMatch(
      /var\.enable_agentcore_multiplayer_proof \? \[\] : \[[\s\S]*?"turn-assertion-mint"[\s\S]*?"agentcore-proof-oauth-provider"[\s\S]*?"agentcore-identity-boundary-target"/,
    );
    expect(handlers).toMatch(
      /var\.enable_agentcore_multiplayer_proof \|\| !startswith\(route_key, "GET \/agentcore\/"\)/,
    );
    expect(oauth).toMatch(
      /resource "aws_kms_key" "agentcore_turn_assertion" \{\s*for_each\s*=\s*var\.enable_agentcore_multiplayer_proof \? toset\(var\.agentcore_turn_assertion_key_versions\) : toset\(\[\]\)/,
    );
  });

  it("provisions Twenty as a separate confidential AgentCore Identity provider", () => {
    expect(identity).toContain("twenty_credential_provider_name");
    expect(identity).toContain(
      'resource "aws_secretsmanager_secret" "twenty_oauth_client"',
    );
    expect(identity).toContain("TWENTY_CLIENT_SECRET_ARN");
    expect(identity).toContain(
      'resource "terraform_data" "twenty_identity_lifecycle"',
    );
    expect(identity).toContain(
      'resource "terraform_data" "twenty_identity_cleanup_owner"',
    );
    expect(identity).toContain("bootstrap_script_sha256");
    expect(identity).toContain(
      "depends_on = [\n    terraform_data.identity_lifecycle",
    );
    expect(identityReconciler).toContain(
      'provider_response="$(bash "$script_dir/bootstrap_twenty_oauth_client.sh")"',
    );
    expect(twentyClientBootstrap).toContain(
      '"$issuer/.well-known/oauth-authorization-server"',
    );
    expect(twentyClientBootstrap).toContain(
      'token_endpoint_auth_method: "client_secret_post"',
    );
    expect(twentyClientBootstrap).toContain("registration_endpoint");
    expect(twentyClientBootstrap).not.toContain(
      "TWENTY_ADMIN_TOKEN_SECRET_ARN",
    );
    expect(twentyClientBootstrap).not.toContain("/metadata");
    const cleanupOwner = identity.match(
      /resource "terraform_data" "twenty_identity_cleanup_owner" \{([\s\S]*?)\n\}\n\n# Additive user-federation reconciliation/,
    )?.[1];
    const reconciliation = identity.match(
      /resource "terraform_data" "twenty_identity_lifecycle" \{([\s\S]*?)\n\}\n\n# Read back/,
    )?.[1];
    expect(cleanupOwner).toContain("when    = destroy");
    expect(cleanupOwner).toContain("delete_twenty_identity.sh");
    expect(cleanupOwner).not.toContain("triggers_replace");
    expect(reconciliation).toContain("triggers_replace");
    expect(reconciliation).not.toContain("when    = destroy");
    expect(reconciliation).not.toContain("delete_twenty_identity.sh");
    expect(twentyProviderReconciler).toContain(
      'clientAuthenticationMethod: "CLIENT_SECRET_POST"',
    );
    expect(twentyProviderReconciler).toContain(
      'clientSecretSource: "EXTERNAL"',
    );
    expect(twentyProviderReconciler).toContain("clientSecretConfig");
    expect(identityReconciler).toContain("TWENTY_CLIENT_SECRET_ARN");
    expect(identityReconciler).not.toContain("/oauth/register");
    expect(identityReconciler).not.toMatch(
      /printf[^\n]*(?:client_secret|clientSecret)/,
    );
    expect(twentyClientBootstrap).not.toMatch(
      /printf[^\n]*(?:client_secret|clientSecret)/,
    );
    expect(groupedIam).toContain(
      '"bedrock-agentcore:CompleteResourceTokenAuth"',
    );
  });

  it("exposes managed Harness lifecycle semantics without replacing rollout-era outputs", () => {
    expect(harnessVariables).toContain('variable "managed_runtime_enabled"');
    expect(harnessVariables).toContain('variable "tenant_slug"');
    expect(harnessVariables).not.toContain(
      'variable "multiplayer_proof_enabled"',
    );
    expect(harnessVariables).not.toContain('variable "pilot_tenant_slug"');
    expect(harnessModule).toContain('check "managed_harness_configuration"');
    expect(harnessOutputs).toContain('output "managed_harness_arn"');
    expect(harnessOutputs).toContain('output "managed_status"');
    expect(thinkworkOutputs).toContain('output "agentcore_harness_arn"');
    expect(thinkworkOutputs).toContain('output "agentcore_harness_status"');
    expect(thinkworkOutputs).toMatch(
      /output "agentcore_harness_proof_arn" \{[\s\S]*?Deprecated: use agentcore_harness_arn/,
    );
  });

  it("reconciles Harness and Gateway whenever their executable contracts change", () => {
    expect(harnessModule).toContain(
      'filesha256("${path.module}/scripts/reconcile_harness.sh")',
    );
    expect(harnessModule).toContain(
      'filesha256("${path.module}/scripts/harness-lifecycle.mjs")',
    );
    expect(harnessModule).toContain(
      'filesha256("${path.module}/scripts/harness-tool-contract.mjs")',
    );
    expect(gatewayModule).toContain(
      'filesha256("${path.module}/scripts/reconcile_gateway.sh")',
    );
  });

  it("keeps canonical dynamic workspace skills wired through Gateway, Cedar, Lambda, and Harness", () => {
    for (const operation of ["list_workspace_skills", "load_workspace_skill"]) {
      expect(gatewayReconciler).toContain(`operationId: "${operation}"`);
      expect(gatewayReconciler).toContain(
        `AgentCore::Action::"\${TARGET_NAME}___${operation}"`,
      );
      expect(harnessModule).toContain(`OwnerProof___${operation}`);
      expect(harnessLifecycle).toContain(operation);
    }
    expect(handlers).toContain(
      '"POST /agentcore/capabilities/workspace/skills/list"',
    );
    expect(handlers).toContain(
      '"POST /agentcore/capabilities/workspace/skills/load"',
    );
    expect(handlers).toContain("platform-tools-v4-user-questions");
  });

  it("keeps governed user questions wired through Gateway, Cedar, Lambda, and Harness", () => {
    expect(gatewayReconciler).toContain('operationId: "ask_user_question"');
    expect(gatewayReconciler).toContain(
      'AgentCore::Action::"${TARGET_NAME}___ask_user_question"',
    );
    expect(harnessModule).toContain("OwnerProof___ask_user_question");
    expect(harnessLifecycle).toContain("ask_user_question");
    expect(handlers).toContain(
      '"POST /agentcore/capabilities/user/questions/ask"',
    );
  });
});

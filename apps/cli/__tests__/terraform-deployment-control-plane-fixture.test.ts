import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

const CONTROL_PLANE_MAIN = resolve(
  REPO_ROOT,
  "terraform/modules/app/deployment-control-plane/main.tf",
);
const CONTROL_PLANE_VARS = resolve(
  REPO_ROOT,
  "terraform/modules/app/deployment-control-plane/variables.tf",
);
const CONTROL_PLANE_OUTPUTS = resolve(
  REPO_ROOT,
  "terraform/modules/app/deployment-control-plane/outputs.tf",
);
const CONTROL_PLANE_BUILDSPEC = resolve(
  REPO_ROOT,
  "terraform/modules/app/deployment-control-plane/buildspec.yml",
);
const CONTROL_PLANE_RUNNER = resolve(
  REPO_ROOT,
  "terraform/modules/app/deployment-control-plane/runner.py",
);
const CONTROL_PLANE_README = resolve(
  REPO_ROOT,
  "terraform/modules/app/deployment-control-plane/README.md",
);
const THINKWORK_MAIN = resolve(
  REPO_ROOT,
  "terraform/modules/thinkwork/main.tf",
);
const THINKWORK_VARS = resolve(
  REPO_ROOT,
  "terraform/modules/thinkwork/variables.tf",
);
const THINKWORK_OUTPUTS = resolve(
  REPO_ROOT,
  "terraform/modules/thinkwork/outputs.tf",
);

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("deployment control plane Terraform fixture", () => {
  it("creates Step Functions and a live CodeBuild runner substrate", () => {
    const source = read(CONTROL_PLANE_MAIN);
    const buildspec = read(CONTROL_PLANE_BUILDSPEC);
    const runner = read(CONTROL_PLANE_RUNNER);

    expect(source).toMatch(/resource "aws_sfn_state_machine" "deployment"/);
    expect(source).toMatch(/arn:aws:states:::codebuild:startBuild\.sync/);
    expect(source).toMatch(/resource "aws_codebuild_project" "runner"/);
    expect(source).toMatch(/resource "aws_s3_object" "runner_script"/);
    expect(source).toMatch(/type\s*=\s*"NO_SOURCE"/);
    expect(source).toMatch(/buildspec = file/);
    expect(buildspec).toMatch(/THINKWORK_RUNNER_SCRIPT_S3_URI/);
    expect(buildspec).toMatch(/python3 \/tmp\/thinkwork-runner\.py/);
    expect(source).toMatch(/THINKWORK_RUNNER_SCRIPT_S3_URI/);
    expect(source).toMatch(/THINKWORK_DEPLOYMENT_INPUT/);
    expect(source).toMatch(/States\.JsonToString\(\$\)/);
    expect(source).toMatch(/sessions\/\{\}\/\{\}/);
    expect(source).toMatch(/include_execution_data\s*=\s*false/);
    expect(runner).toMatch(/deployment-evidence\.json/);
    expect(runner).toMatch(/"terraform", "init"/);
    expect(runner).toMatch(/"terraform", "apply"/);
    expect(runner).toMatch(/"git", "clone", "--no-checkout"/);
    expect(runner).toMatch(
      /"git", "-C", str\(SOURCE\), "fetch", "--depth", "1", "origin", ref/,
    );
    expect(runner).toMatch(
      /"git", "-C", str\(SOURCE\), "checkout", "--detach", "FETCH_HEAD"/,
    );
    expect(runner).toMatch(/initialize_greenfield_database/);
    expect(runner).toMatch(/seed_platform_bootstrap_defaults/);
    expect(runner).toMatch(/public\.model_catalog/);
    expect(runner).toMatch(/public\.user_model_approvals/);
    expect(runner).toMatch(/output "appsync_api_key"/);
    expect(runner).toMatch(/output "auth_domain"/);
    expect(runner).toMatch(/thinkwork-runtime-config\.json/);
    expect(runner).toMatch(/index\.html/);
    expect(runner).toMatch(/--cache-control/);
    expect(runner).toMatch(/profile\/web-env/);
    expect(runner).toMatch(/VITE_GRAPHQL_HTTP_URL/);
    expect(runner).toMatch(/VITE_COGNITO_DOMAIN/);
    expect(runner).toMatch(/enable_cognee\s+= false/);
    expect(runner).toMatch(/twenty_provisioned\s+= false/);
    expect(runner).toMatch(/twenty_runtime_enabled\s+= false/);
    expect(runner).toMatch(/enable_stripe_billing\s+= false/);
    expect(runner).toMatch(/enable_slack_workspace_app\s+= false/);
    expect(source).toMatch(/aws_cloudwatch_log_group" "state_machine"/);
    expect(source).toMatch(/aws_cloudwatch_log_group" "codebuild"/);
  });

  it("stores evidence, config, release pins, and secret placeholders in AWS-native services", () => {
    const source = read(CONTROL_PLANE_MAIN);
    const vars = read(CONTROL_PLANE_VARS);
    const outputs = read(CONTROL_PLANE_OUTPUTS);
    const readme = read(CONTROL_PLANE_README);

    expect(source).toMatch(/resource "aws_s3_bucket" "evidence"/);
    expect(source).toMatch(/server_side_encryption_configuration/);
    expect(source).toMatch(/resource "aws_appconfig_application" "deployment"/);
    expect(source).toMatch(/resource "aws_appconfig_environment" "deployment"/);
    expect(source).toMatch(
      /resource "aws_appconfig_configuration_profile" "deployment"/,
    );
    expect(source).toMatch(/resource "aws_ssm_parameter" "deployment"/);
    expect(source).toMatch(/selected_release_manifest_sha256/);
    expect(source).toMatch(/terraform_state_bucket/);
    expect(source).toMatch(/release_artifact_bucket/);
    expect(source).toMatch(/resource "aws_secretsmanager_secret" "deployment"/);
    expect(source).toMatch(/ignore_changes\s*=\s*\[secret_string\]/);
    expect(vars).toMatch(/variable "release_manifest_sha256"/);
    expect(vars).toMatch(/variable "terraform_state_bucket"/);
    expect(outputs).toMatch(/output "state_machine_arn"/);
    expect(outputs).toMatch(/output "appconfig_configuration_profile_id"/);
    expect(readme).toContain("release-pinned Terraform runner");
    expect(readme).toContain(
      "sessions/<session>/<action>/deployment-evidence.json",
    );
  });

  it("is wired through the composite module with disable-safe outputs", () => {
    const main = read(THINKWORK_MAIN);
    const vars = read(THINKWORK_VARS);
    const outputs = read(THINKWORK_OUTPUTS);

    expect(vars).toMatch(/variable "enable_deployment_control_plane"/);
    expect(vars).toMatch(/variable "deployment_release_manifest_sha256"/);
    expect(vars).toMatch(/variable "deployment_terraform_state_bucket"/);
    expect(main).toMatch(/module "deployment_control_plane"/);
    expect(main).toMatch(
      /count\s*=\s*var\.enable_deployment_control_plane \? 1 : 0/,
    );
    expect(main).toMatch(
      /release_manifest_sha256\s*=\s*var\.deployment_release_manifest_sha256/,
    );
    expect(main).toMatch(
      /terraform_state_bucket\s*=\s*local\.deployment_terraform_state_bucket/,
    );
    expect(main).toMatch(
      /release_artifact_bucket\s*=\s*local\.deployment_release_artifact_bucket/,
    );
    expect(outputs).toMatch(/output "deployment_state_machine_arn"/);
    expect(outputs).toMatch(
      /var\.enable_deployment_control_plane \? module\.deployment_control_plane\[0\]\.state_machine_arn : null/,
    );
    expect(outputs).toMatch(/output "deployment_evidence_bucket_name"/);
    expect(outputs).toMatch(/output "deployment_appconfig_application_id"/);
  });

  it("wires deployment controller config into graphql-http for Settings release updates", () => {
    const lambdaHandlers = read(
      resolve(REPO_ROOT, "terraform/modules/app/lambda-api/handlers.tf"),
    );
    const lambdaVariables = read(
      resolve(REPO_ROOT, "terraform/modules/app/lambda-api/variables.tf"),
    );

    expect(lambdaHandlers).toMatch(/"graphql-http"\s*=\s*merge/);
    expect(lambdaHandlers).toMatch(
      /DEPLOYMENT_STATE_MACHINE_ARN\s*=\s*var\.deployment_state_machine_arn/,
    );
    expect(lambdaHandlers).toMatch(
      /DEPLOYMENT_EVIDENCE_BUCKET\s*=\s*var\.deployment_evidence_bucket/,
    );
    expect(lambdaVariables).toContain("Settings can start release updates");
  });
});

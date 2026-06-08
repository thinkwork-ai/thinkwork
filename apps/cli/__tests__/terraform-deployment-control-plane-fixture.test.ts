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
  it("creates inert Step Functions and CodeBuild substrate", () => {
    const source = read(CONTROL_PLANE_MAIN);

    expect(source).toMatch(/resource "aws_sfn_state_machine" "deployment"/);
    expect(source).toMatch(/arn:aws:states:::codebuild:startBuild\.sync/);
    expect(source).toMatch(/resource "aws_codebuild_project" "runner"/);
    expect(source).toMatch(/type\s*=\s*"NO_SOURCE"/);
    expect(source).toMatch(/ThinkWork deployment runner stub/);
    expect(source).toMatch(/deployment-evidence\.json/);
    expect(source).toMatch(/THINKWORK_DEPLOYMENT_INPUT/);
    expect(source).toMatch(/States\.JsonToString\(\$\)/);
    expect(source).toMatch(/sessions\/\{\}\/\{\}/);
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
    expect(source).toMatch(/resource "aws_ssm_parameter" "release"/);
    expect(source).toMatch(/selected_release_manifest_sha256/);
    expect(source).toMatch(/resource "aws_secretsmanager_secret" "deployment"/);
    expect(source).toMatch(/ignore_changes\s*=\s*\[secret_string\]/);
    expect(vars).toMatch(/variable "release_manifest_sha256"/);
    expect(outputs).toMatch(/output "state_machine_arn"/);
    expect(outputs).toMatch(/output "appconfig_configuration_profile_id"/);
    expect(readme).toContain("intentionally evidence-only");
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
    expect(main).toMatch(/module "deployment_control_plane"/);
    expect(main).toMatch(
      /count\s*=\s*var\.enable_deployment_control_plane \? 1 : 0/,
    );
    expect(main).toMatch(
      /release_manifest_sha256\s*=\s*var\.deployment_release_manifest_sha256/,
    );
    expect(outputs).toMatch(/output "deployment_state_machine_arn"/);
    expect(outputs).toMatch(
      /var\.enable_deployment_control_plane \? module\.deployment_control_plane\[0\]\.state_machine_arn : null/,
    );
    expect(outputs).toMatch(/output "deployment_evidence_bucket_name"/);
    expect(outputs).toMatch(/output "deployment_appconfig_application_id"/);
  });
});

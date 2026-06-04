/**
 * Structural fixture tests for the Cognee Terraform module.
 *
 * Pure file-content assertions keep this runnable without AWS credentials while
 * guarding the phase-1 infrastructure invariants that matter most: internal
 * endpoint only, secret indirection, persistent storage, Bedrock IAM, and
 * dogfood-mode single-task validation.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

const COGNEE_MAIN = resolve(REPO_ROOT, "terraform/modules/app/cognee/main.tf");
const COGNEE_VARS = resolve(
  REPO_ROOT,
  "terraform/modules/app/cognee/variables.tf",
);
const COGNEE_OUTPUTS = resolve(
  REPO_ROOT,
  "terraform/modules/app/cognee/outputs.tf",
);
const COGNEE_README = resolve(
  REPO_ROOT,
  "terraform/modules/app/cognee/README.md",
);

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function firstNestedBlock(source: string, blockHeader: string): string {
  const start = source.indexOf(blockHeader);
  expect(start).toBeGreaterThanOrEqual(0);

  let depth = 0;
  let opened = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (char === "{") {
      depth += 1;
      opened = true;
    } else if (char === "}") {
      depth -= 1;

      if (opened && depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error(`Block not closed: ${blockHeader}`);
}

describe("U1 - Cognee Terraform app module", () => {
  it("creates an internal-only ALB and public-subnet task egress pattern", () => {
    const source = read(COGNEE_MAIN);
    const cogneeSecurityGroup = firstNestedBlock(
      source,
      'resource "aws_security_group" "cognee"',
    );
    const cogneeIngress = firstNestedBlock(cogneeSecurityGroup, "ingress {");
    const albSecurityGroup = firstNestedBlock(
      source,
      'resource "aws_security_group" "alb"',
    );

    expect(source).toMatch(/resource "aws_lb" "cognee"/);
    expect(source).toMatch(/internal\s*=\s*true/);
    expect(source).toMatch(/assign_public_ip\s*=\s*true/);
    expect(source).not.toMatch(/internal\s*=\s*false/);
    expect(cogneeIngress).toMatch(
      /security_groups\s*=\s*\[aws_security_group\.alb\.id\]/,
    );
    expect(cogneeIngress).not.toMatch(/cidr_blocks/);
    expect(albSecurityGroup).toMatch(
      /for_each\s*=\s*var\.allowed_internal_cidr_blocks/,
    );
    expect(albSecurityGroup).toMatch(
      /for_each\s*=\s*var\.allowed_internal_security_group_ids/,
    );
  });

  it("does not expose phase-1 public endpoint, CORS, or auth variables", () => {
    const vars = read(COGNEE_VARS);

    expect(vars).not.toMatch(/public_endpoint/);
    expect(vars).not.toMatch(/cors/i);
    expect(vars).not.toMatch(/require_auth/i);
  });

  it("injects credentials through ECS secrets instead of plaintext provider env vars", () => {
    const source = read(COGNEE_MAIN);
    const environmentLocals = source.slice(
      source.indexOf("base_environment = ["),
      source.indexOf("container_secrets = concat("),
    );
    const containerSecrets = source.slice(
      source.indexOf("container_secrets = concat("),
      source.indexOf("secret_arns = compact("),
    );
    const secretNames = [
      "DB_PASSWORD",
      "LLM_API_KEY",
      "EMBEDDING_API_KEY",
      "VECTOR_DB_KEY",
      "GRAPH_DATABASE_PASSWORD",
    ];

    expect(source).toMatch(/secrets\s*=\s*local\.container_secrets/);
    expect(source).toMatch(/:password::/);

    for (const secretName of secretNames) {
      expect(containerSecrets).toMatch(
        new RegExp(`name\\s*=\\s*"${secretName}"[\\s\\S]*?valueFrom`),
      );
      expect(environmentLocals).not.toMatch(
        new RegExp(`name\\s*=\\s*"${secretName}"`),
      );
    }
  });

  it("adds persistent encrypted EFS storage for Cognee data and system paths", () => {
    const source = read(COGNEE_MAIN);

    expect(source).toMatch(/resource "aws_efs_file_system" "cognee"/);
    expect(source).toMatch(/encrypted\s*=\s*true/);
    expect(source).toMatch(/data "aws_subnet" "cognee"/);
    expect(source).toMatch(/subnet_ids_by_az/);
    expect(source).toMatch(/efs_mount_subnet_ids/);
    expect(source).toMatch(/resource "aws_efs_mount_target" "cognee"/);
    expect(source).toMatch(
      /for_each\s*=\s*toset\(local\.efs_mount_subnet_ids\)/,
    );
    expect(source).toMatch(/DATA_ROOT_DIRECTORY/);
    expect(source).toMatch(/SYSTEM_ROOT_DIRECTORY/);
    expect(source).toMatch(/transit_encryption\s*=\s*"ENABLED"/);
  });

  it("gives slow Cognee startups deploy-time health protection", () => {
    const source = read(COGNEE_MAIN);
    const vars = read(COGNEE_VARS);

    expect(source).toMatch(
      /health_check_grace_period_seconds\s*=\s*var\.health_check_grace_period_seconds/,
    );
    expect(source).toMatch(
      /wait_for_steady_state\s*=\s*var\.wait_for_steady_state/,
    );
    expect(vars).toMatch(/variable "health_check_grace_period_seconds"/);
    expect(vars).toMatch(/default\s*=\s*300/);
    expect(vars).toMatch(/variable "wait_for_steady_state"/);
    expect(vars).toMatch(/default\s*=\s*true/);
  });

  it("guards dogfood and remote backend mode combinations", () => {
    const source = read(COGNEE_MAIN);

    expect(source).toMatch(
      /resource "terraform_data" "configuration_guardrails"/,
    );
    expect(source).toMatch(/precondition/);
    expect(source).toMatch(/var\.desired_count == 1/);
    expect(source).toMatch(/var\.vector_db_url != ""/);
    expect(source).toMatch(/var\.graph_database_url != ""/);
    expect(source).toMatch(/length\(var\.bedrock_model_resource_arns\) > 0/);
  });

  it("rejects risky defaults before parent-module wiring", () => {
    const vars = read(COGNEE_VARS);

    expect(vars).toMatch(/db_username must be a dedicated least-privilege/);
    expect(vars).toMatch(/image_uri must be pinned to an immutable sha256/);
    expect(vars).toMatch(/allowed_internal_cidr_blocks must not include/);
    expect(vars).toMatch(/vector_db_url must not embed credentials/);
    expect(vars).toMatch(/graph_database_url must not embed credentials/);
    expect(vars).not.toMatch(/default\s*=\s*"thinkwork_admin"/);
    expect(vars).not.toMatch(/default\s*=\s*"cognee\/cognee:main"/);
    expect(vars).not.toMatch(/default\s*=\s*\["\*"\]/);
  });

  it("grants Bedrock invoke permissions to the Cognee task role", () => {
    const source = read(COGNEE_MAIN);

    expect(source).toMatch(/resource "aws_iam_role_policy" "bedrock_access"/);
    expect(source).toMatch(/count\s*=\s*var\.llm_provider == "bedrock"/);
    expect(source).toMatch(/bedrock:InvokeModel/);
    expect(source).toMatch(/bedrock:InvokeModelWithResponseStream/);
  });

  it("exposes stable operator outputs", () => {
    const source = read(COGNEE_OUTPUTS);

    expect(source).toMatch(/output "cognee_endpoint"/);
    expect(source).toMatch(/output "cognee_log_group_name"/);
    expect(source).toMatch(/output "cognee_task_role_arn"/);
    expect(source).toMatch(/output "cognee_backend_mode"/);
    expect(source).toMatch(/output "cognee_storage_file_system_id"/);
  });

  it("documents the phase-1 network, backend, and secret contracts", () => {
    const source = read(COGNEE_README);

    expect(source).toMatch(/internal-only/);
    expect(source).toMatch(/assign_public_ip = true/);
    expect(source).toMatch(/desired_count = 1/);
    expect(source).toMatch(/ECS secret injection/);
  });
});

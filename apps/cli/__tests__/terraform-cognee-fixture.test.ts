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

const COGNEE_MAIN = resolve(
  REPO_ROOT,
  "plugins/company-brain/terraform/cognee/main.tf",
);
const COGNEE_VARS = resolve(
  REPO_ROOT,
  "plugins/company-brain/terraform/cognee/variables.tf",
);
const COGNEE_OUTPUTS = resolve(
  REPO_ROOT,
  "plugins/company-brain/terraform/cognee/outputs.tf",
);
const COGNEE_README = resolve(
  REPO_ROOT,
  "plugins/company-brain/terraform/cognee/README.md",
);
const COGNEE_DOCKERFILE = resolve(
  REPO_ROOT,
  "plugins/company-brain/runtime/cognee/Dockerfile",
);
const BUSINESS_ONTOLOGY_OPS_DOC = resolve(
  REPO_ROOT,
  "docs/src/content/docs/guides/business-ontology-operations.mdx",
);
const BUSINESS_ONTOLOGY_CONCEPT_DOC = resolve(
  REPO_ROOT,
  "docs/src/content/docs/concepts/knowledge/business-ontology.mdx",
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
const LAMBDA_API_HANDLERS = resolve(
  REPO_ROOT,
  "terraform/modules/app/lambda-api/handlers.tf",
);
const GREENFIELD_MAIN = resolve(
  REPO_ROOT,
  "terraform/examples/greenfield/main.tf",
);
const INIT_COMMAND = resolve(REPO_ROOT, "apps/cli/src/commands/init.ts");
const BUNDLE_TERRAFORM_SCRIPT = resolve(
  REPO_ROOT,
  "apps/cli/scripts/bundle-terraform.js",
);
const ENTERPRISE_TEMPLATE_MAIN = resolve(
  REPO_ROOT,
  "apps/cli/src/commands/enterprise/templates/deploy-repo/terraform/main.tf",
);
const VERIFY_WORKFLOW = resolve(REPO_ROOT, ".github/workflows/verify.yml");
const DEPLOY_WORKFLOW = resolve(REPO_ROOT, ".github/workflows/deploy.yml");

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

  it("keeps the endpoint private while making security posture explicit", () => {
    const vars = read(COGNEE_VARS);
    const source = read(COGNEE_MAIN);

    expect(vars).not.toMatch(/public_endpoint/);
    expect(vars).toMatch(/variable "private_substrate_mode"/);
    expect(vars).toMatch(/variable "require_authentication"/);
    expect(vars).toMatch(/variable "enable_backend_access_control"/);
    expect(vars).toMatch(/variable "cors_allowed_origins"/);
    expect(source).toMatch(/Company Brain substrate must remain private/);
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

  it("can create operator-owned placeholder secret containers without exposing values", () => {
    const source = read(COGNEE_MAIN);
    const vars = read(COGNEE_VARS);
    const outputs = read(COGNEE_OUTPUTS);
    const secretVersion = firstNestedBlock(
      source,
      'resource "aws_secretsmanager_secret_version" "cognee"',
    );

    expect(vars).toMatch(/variable "create_secret_placeholders"/);
    expect(vars).toMatch(/default\s*=\s*false/);
    expect(source).toMatch(/managed_secret_specs/);
    expect(source).toMatch(
      /thinkwork\/\$\{var\.stage\}\/cognee\/db-credentials/,
    );
    expect(source).toMatch(
      /thinkwork\/\$\{var\.stage\}\/brain\/\$\{local\.normalized_brain_instance_key\}\/db-credentials/,
    );
    expect(source).toMatch(/resource "aws_secretsmanager_secret" "cognee"/);
    expect(source).toMatch(/for_each\s*=\s*local\.managed_secrets/);
    expect(source).toMatch(/PLACEHOLDER_SET_VIA_CLI/);
    expect(secretVersion).toMatch(
      /secret_string\s*=\s*each\.value\.secret_string/,
    );
    expect(secretVersion).toMatch(/ignore_changes\s*=\s*\[secret_string\]/);
    expect(source).toMatch(/effective_db_password_secret_arn/);
    expect(source).toMatch(/effective_llm_api_key_secret_arn/);
    expect(outputs).toMatch(/output "cognee_db_password_secret_arn"/);
    expect(outputs).toMatch(/output "cognee_llm_api_key_secret_arn"/);
    expect(outputs).not.toMatch(/secret_string/);
    expect(outputs).not.toMatch(/PLACEHOLDER_SET_VIA_CLI/);
  });

  it("adds persistent encrypted EFS storage for Cognee data and system paths", () => {
    const source = read(COGNEE_MAIN);

    expect(source).toMatch(/resource "aws_efs_file_system" "cognee"/);
    expect(source).toMatch(/encrypted\s*=\s*true/);
    expect(source).not.toMatch(/data "aws_subnet" "cognee"/);
    expect(source).toMatch(/efs_mount_subnet_ids_by_index/);
    expect(source).toMatch(
      /for index, subnet_id in var\.subnet_ids : tostring\(index\) => subnet_id/,
    );
    expect(source).toMatch(/resource "aws_efs_mount_target" "cognee"/);
    expect(source).toMatch(
      /for_each\s*=\s*local\.efs_mount_subnet_ids_by_index/,
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
    expect(source).toMatch(/production Brain tier must use remote mode/);
    expect(source).toMatch(/var\.vector_db_provider == "neptune_analytics"/);
    expect(source).toMatch(
      /var\.graph_database_provider == "neptune_analytics"/,
    );
    expect(source).toMatch(/var\.neptune_endpoint != ""/);
    expect(source).toMatch(/length\(var\.bedrock_model_resource_arns\) > 0/);
  });

  it("derives tenant-scoped Brain names, logs, secret paths, and data-store URLs", () => {
    const source = read(COGNEE_MAIN);
    const vars = read(COGNEE_VARS);

    expect(vars).toMatch(/variable "brain_tenant_id"/);
    expect(vars).toMatch(/variable "brain_instance_key"/);
    expect(vars).toMatch(/variable "brain_storage_tier"/);
    expect(source).toMatch(/normalized_brain_instance_key/);
    expect(source).toMatch(/tenant_scoped_brain_instance/);
    expect(source).toMatch(
      /thinkwork-\$\{var\.stage\}-cb-\$\{local\.brain_instance_hash\}/,
    );
    expect(source).toMatch(
      /\/thinkwork\/\$\{var\.stage\}\/brain\/\$\{local\.normalized_brain_instance_key\}\/cognee/,
    );
    expect(source).toMatch(/var\.vector_db_provider == "neptune_analytics"/);
    expect(source).toMatch(
      /var\.graph_database_provider == "neptune_analytics"/,
    );
    expect(source).toMatch(/var\.neptune_endpoint/);
  });

  it("isolates the legacy stage-wide ECS cluster name from Cognee implementation names", () => {
    const source = read(COGNEE_MAIN);
    const outputs = read(COGNEE_OUTPUTS);

    expect(source).toMatch(
      /legacy_name\s*=\s*"thinkwork-\$\{var\.stage\}-cognee"/,
    );
    expect(source).toMatch(
      /legacy_cluster_name\s*=\s*"thinkwork-\$\{var\.stage\}-brain-cluster"/,
    );
    expect(source).toMatch(
      /cluster_name\s*=\s*local\.tenant_scoped_brain_instance \? "\$\{local\.name\}-cluster" : local\.legacy_cluster_name/,
    );
    expect(
      firstNestedBlock(source, 'resource "aws_ecs_cluster" "main"'),
    ).toMatch(/name\s*=\s*local\.cluster_name/);
    expect(source).toMatch(
      /resource_short_name\s*=\s*local\.tenant_scoped_brain_instance \? "tw-\$\{substr\(var\.stage, 0, 8\)\}-cb-\$\{substr\(local\.brain_instance_hash, 0, 10\)\}" : "tw-\$\{var\.stage\}-cognee"/,
    );
    expect(source).toMatch(/name\s*=\s*local\.name/);
    expect(source).toMatch(/family\s*=\s*local\.name/);
    expect(source).toMatch(/container_name\s*=\s*"cognee"/);
    expect(source).toMatch(/"awslogs-stream-prefix"\s*=\s*"cognee"/);
    expect(outputs).toMatch(
      /Company Brain ECS cluster ARN hosting the Cognee service/,
    );
  });

  it("scopes optional Brain S3 and Neptune IAM to tenant resources", () => {
    const source = read(COGNEE_MAIN);
    const vars = read(COGNEE_VARS);

    expect(vars).toMatch(/variable "brain_artifacts_bucket_arn"/);
    expect(vars).toMatch(/variable "brain_artifacts_prefixes"/);
    expect(vars).toMatch(/variable "neptune_graph_arn"/);
    expect(source).toMatch(/resource "aws_iam_role_policy" "brain_artifacts"/);
    expect(source).toMatch(/"s3:prefix"/);
    expect(source).toMatch(/local\.brain_artifact_object_arns/);
    expect(source).toMatch(
      /resource "aws_iam_role_policy" "neptune_graph_access"/,
    );
    expect(source).toMatch(/neptune-graph:ReadDataViaQuery/);
    expect(source).toMatch(/Resource = var\.neptune_graph_arn/);
  });

  it("rejects risky defaults before parent-module wiring", () => {
    const vars = read(COGNEE_VARS);

    expect(vars).toMatch(/db_username must be a dedicated least-privilege/);
    expect(vars).toMatch(/image_uri must be pinned to an immutable sha256/);
    expect(vars).toMatch(/bedrock_model_resource_arns must list explicit/);
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
    expect(source).toMatch(/output "cognee_brain_storage_tier"/);
    expect(source).toMatch(/output "cognee_vector_db_provider"/);
    expect(source).toMatch(/output "cognee_neptune_graph_id"/);
  });

  it("documents the phase-1 network, backend, and secret contracts", () => {
    const source = read(COGNEE_README);

    expect(source).toMatch(/internal-only/);
    expect(source).toMatch(/assign_public_ip = true/);
    expect(source).toMatch(/desired_count = 1/);
    expect(source).toMatch(/ECS secret injection/);
    expect(source).toMatch(/tenant-scoped/);
    expect(source).toMatch(/default/);
    expect(source).toMatch(/production/);
  });
});

describe("U2 - Cognee composite Thinkwork wiring", () => {
  it("keeps Cognee disabled by default with explicit safe enablement inputs", () => {
    const vars = read(THINKWORK_VARS);

    expect(vars).toMatch(/variable "enable_cognee"/);
    expect(vars).toMatch(/default\s*=\s*false/);
    expect(vars).toMatch(/variable "cognee_image_uri"/);
    expect(vars).toMatch(/cognee_image_uri must be empty or pinned/);
    expect(vars).toMatch(/variable "cognee_db_password_secret_arn"/);
    expect(vars).toMatch(/variable "cognee_bedrock_model_resource_arns"/);
    expect(vars).toMatch(/variable "cognee_db_username"/);
    expect(vars).toMatch(/variable "cognee_db_name"/);
    expect(vars).toMatch(/default\s*=\s*"thinkwork_cognee"/);
    expect(vars).toMatch(/lower\(var\.cognee_db_username\)/);
    expect(vars).toMatch(
      /cognee_bedrock_model_resource_arns must list explicit/,
    );
  });

  it("wires the Cognee module behind enable_cognee without implicitly changing memory selection", () => {
    const source = read(THINKWORK_MAIN);
    const cogneeModule = firstNestedBlock(source, 'module "cognee"');

    expect(source).toMatch(/cognee_enabled\s*=\s*var\.enable_cognee/);
    expect(source).toMatch(/resolved_memory_engine/);
    expect(source).not.toMatch(
      /enable_cognee[\s\S]{0,120}resolved_memory_engine/,
    );
    expect(cogneeModule).toMatch(/count\s*=\s*local\.cognee_enabled \? 1 : 0/);
    expect(cogneeModule).toMatch(
      /source\s*=\s*"\.\.\/\.\.\/\.\.\/plugins\/company-brain\/terraform\/cognee"/,
    );
    expect(cogneeModule).toMatch(/vpc_id\s*=\s*module\.vpc\.vpc_id/);
    expect(cogneeModule).toMatch(
      /subnet_ids\s*=\s*module\.vpc\.public_subnet_ids/,
    );
    expect(cogneeModule).toMatch(
      /db_security_group_id\s*=\s*module\.database\.db_security_group_id/,
    );
    expect(cogneeModule).toMatch(
      /db_host\s*=\s*module\.database\.cluster_endpoint/,
    );
    expect(cogneeModule).toMatch(/db_name\s*=\s*var\.cognee_db_name/);
    expect(cogneeModule).not.toMatch(/db_name\s*=\s*var\.database_name/);
    expect(cogneeModule).toMatch(
      /db_password_secret_arn\s*=\s*var\.cognee_db_password_secret_arn/,
    );
    expect(cogneeModule).not.toMatch(
      /db_password_secret_arn\s*=\s*module\.database/,
    );
  });

  it("allows Cognee to be selected as the canonical memory engine", () => {
    const vars = read(THINKWORK_VARS);
    const source = read(THINKWORK_MAIN);

    expect(vars).toMatch(/"agentcore", "cognee"/);
    expect(vars).toMatch(/memory_engine = 'cognee' requires enable_cognee/);
    expect(source).toMatch(/var\.memory_engine == "cognee"/);
  });

  it("attaches graphql-http to the Cognee VPC path when Cognee owns memory", () => {
    const source = read(LAMBDA_API_HANDLERS);

    expect(source).toMatch(/each\.key == "graphql-http"/);
    expect(source).toMatch(/var\.memory_engine == "cognee"/);
    expect(source).toMatch(/local\.cognee_worker_vpc_enabled/);
    expect(source).toMatch(
      /security_group_ids = each\.key == "okf-efs-refresh" \? var\.okf_efs_security_group_ids : var\.cognee_worker_security_group_ids/,
    );
  });

  it("fails unsafe enabled Cognee parent configurations at plan time", () => {
    const source = read(THINKWORK_MAIN);
    const guardrails = firstNestedBlock(
      source,
      'resource "terraform_data" "cognee_configuration_guardrails"',
    );

    expect(guardrails).toMatch(/count\s*=\s*var\.enable_cognee \? 1 : 0/);
    expect(guardrails).toMatch(/enable_cognee requires cognee_image_uri/);
    expect(guardrails).toMatch(
      /enable_cognee requires cognee_db_password_secret_arn/,
    );
    expect(guardrails).toMatch(
      /not the shared Thinkwork admin database secret/,
    );
    expect(guardrails).toMatch(
      /cognee_db_name must be distinct from the shared Thinkwork database name/,
    );
    expect(guardrails).toMatch(
      /enable_cognee requires at least one public subnet/,
    );
    expect(guardrails).toMatch(
      /cognee_backend_mode = dogfood requires cognee_desired_count = 1/,
    );
    expect(guardrails).toMatch(
      /cognee_backend_mode = remote requires vector\/graph URLs/,
    );
    expect(guardrails).toMatch(/cognee_brain_storage_tier = production/);
    expect(guardrails).toMatch(/cognee_neptune_endpoint/);
    expect(guardrails).toMatch(/Non-Bedrock Cognee LLM or embedding providers/);
    expect(guardrails).toMatch(/Bedrock Cognee providers require explicit/);
  });

  it("exposes nullable stable Cognee outputs from the composite module", () => {
    const outputs = read(THINKWORK_OUTPUTS);

    expect(outputs).toMatch(/output "cognee_enabled"/);
    expect(outputs).toMatch(/output "cognee_endpoint"/);
    expect(outputs).toMatch(/output "cognee_log_group_name"/);
    expect(outputs).toMatch(/output "cognee_task_role_arn"/);
    expect(outputs).toMatch(/output "cognee_backend_mode"/);
    expect(outputs).toMatch(/output "cognee_storage_file_system_id"/);
    expect(outputs).toMatch(/output "cognee_brain_storage_tier"/);
    expect(outputs).toMatch(/output "cognee_s3_artifact_root"/);
    expect(outputs).toMatch(/output "cognee_neptune_graph_id"/);
    expect(outputs).toMatch(/local\.cognee_enabled \? module\.cognee\[0\]/);
    expect(outputs).toMatch(
      /Company Brain ECS cluster ARN hosting the Cognee service/,
    );
    expect(outputs).toMatch(/: null/);
  });
});

describe("U4 - Cognee deployment template propagation", () => {
  it("adds safe disabled Cognee defaults to the greenfield example", () => {
    const source = read(GREENFIELD_MAIN);
    const thinkworkModule = firstNestedBlock(source, 'module "thinkwork"');

    expect(source).toMatch(/variable "enable_cognee"/);
    expect(source).toMatch(/default\s*=\s*false/);
    expect(source).toMatch(/variable "cognee_image_uri"/);
    expect(source).toMatch(/variable "cognee_db_name"/);
    expect(source).toMatch(/variable "cognee_db_password_secret_arn"/);
    expect(source).toMatch(/variable "cognee_bedrock_model_resource_arns"/);
    expect(thinkworkModule).toMatch(/enable_cognee\s*=\s*var\.enable_cognee/);
    expect(thinkworkModule).toMatch(
      /cognee_image_uri\s*=\s*var\.cognee_image_uri/,
    );
    expect(thinkworkModule).toMatch(/cognee_db_name\s*=\s*var\.cognee_db_name/);
    expect(thinkworkModule).toMatch(
      /cognee_db_password_secret_arn\s*=\s*var\.cognee_db_password_secret_arn/,
    );
    expect(source).toMatch(/output "cognee_enabled"/);
    expect(source).toMatch(/output "cognee_endpoint"/);
  });

  it("generates init tfvars and wrapper HCL with Cognee disabled by default", () => {
    const source = read(INIT_COMMAND);

    expect(source).toMatch(/enable_cognee = false/);
    expect(source).toMatch(/variable "enable_cognee"/);
    expect(source).toMatch(/variable "cognee_image_uri"/);
    expect(source).toMatch(/variable "cognee_db_name"/);
    expect(source).toMatch(/variable "cognee_db_password_secret_arn"/);
    expect(source).toMatch(/variable "cognee_bedrock_model_resource_arns"/);
    expect(source).toMatch(/enable_cognee\s*=\s*var\.enable_cognee/);
    expect(source).toMatch(/cognee_image_uri\s*=\s*var\.cognee_image_uri/);
    expect(source).toMatch(/cognee_db_name\s*=\s*var\.cognee_db_name/);
    expect(source).toMatch(
      /cognee_db_password_secret_arn\s*=\s*var\.cognee_db_password_secret_arn/,
    );
    expect(source).toMatch(/output "cognee_enabled"/);
    expect(source).toMatch(/output "cognee_endpoint"/);
  });

  it("bundles plugin-owned Terraform and runtime source with init scaffolds", () => {
    const initSource = read(INIT_COMMAND);
    const bundleSource = read(BUNDLE_TERRAFORM_SCRIPT);

    expect(bundleSource).toMatch(
      /const pluginsSrc = resolve\(repoRoot, "plugins"\)/,
    );
    expect(bundleSource).toMatch(
      /const pluginsDst = resolve\(cliRoot, "dist\/plugins"\)/,
    );
    expect(bundleSource).toMatch(/cpSync\(pluginsSrc, pluginsDst/);
    expect(bundleSource).toMatch(/path\.includes\("node_modules"\)/);
    expect(initSource).toMatch(
      /const bundledPlugins = resolve\(bundledTf, "\.\.", "plugins"\)/,
    );
    expect(initSource).toMatch(
      /const targetPlugins = join\(targetDir, "plugins"\)/,
    );
    expect(initSource).toMatch(/cpSync\(bundledPlugins, targetPlugins/);
  });

  it("exposes safe Cognee defaults in the enterprise deploy template", () => {
    const source = read(ENTERPRISE_TEMPLATE_MAIN);
    const thinkworkModule = firstNestedBlock(source, 'module "thinkwork"');

    expect(source).toMatch(/variable "enable_cognee"/);
    expect(source).toMatch(/default\s*=\s*false/);
    expect(source).toMatch(/variable "cognee_image_uri"/);
    expect(source).toMatch(/variable "cognee_db_name"/);
    expect(source).toMatch(/variable "cognee_db_password_secret_arn"/);
    expect(source).toMatch(/variable "cognee_bedrock_model_resource_arns"/);
    expect(thinkworkModule).toMatch(/enable_cognee\s*=\s*var\.enable_cognee/);
    expect(thinkworkModule).toMatch(/cognee_db_name\s*=\s*var\.cognee_db_name/);
    expect(thinkworkModule).toMatch(
      /cognee_bedrock_model_resource_arns\s*=\s*var\.cognee_bedrock_model_resource_arns/,
    );
    expect(source).toMatch(/output "cognee_enabled"/);
    expect(source).toMatch(/output "cognee_endpoint"/);
  });

  it("keeps CI Terraform runs disabled by default but aligned with Cognee deployment inputs", () => {
    for (const workflow of [read(VERIFY_WORKFLOW), read(DEPLOY_WORKFLOW)]) {
      expect(workflow).toMatch(/COGNEE_ENABLED_INPUT/);
      expect(workflow).toMatch(/vars\.COGNEE_ENABLED \|\| 'false'/);
      expect(workflow).toMatch(/cognee\/cognee@sha256:5ce7e4052b1d/);
      expect(workflow).toMatch(
        /thinkwork\/\$\{STAGE\}\/cognee\/db-credentials/,
      );
      expect(workflow).toMatch(/cognee_bedrock_model_resource_arns/);
      expect(workflow).toMatch(/amazon\.nova-lite-v1:0/);
      expect(workflow).toMatch(/amazon\.titan-embed-text-v2:0/);
      expect(workflow).toMatch(/-var "enable_cognee=\$/);
      expect(workflow).toMatch(/-var "cognee_image_uri=\$/);
      expect(workflow).toMatch(/-var "cognee_db_username=\$/);
      expect(workflow).toMatch(/-var "cognee_db_name=\$/);
      expect(workflow).toMatch(/-var "cognee_db_password_secret_arn=\$/);
      expect(workflow).toMatch(/-var "cognee_backend_mode=\$/);
      expect(workflow).toMatch(/-var "cognee_desired_count=\$/);
      expect(workflow).toMatch(/-var "cognee_llm_provider=\$/);
      expect(workflow).toMatch(/-var "cognee_embedding_provider=\$/);
    }
  });

  it("builds a pinned Cognee image with Bedrock runtime dependencies for deploy", () => {
    const dockerfile = read(COGNEE_DOCKERFILE);
    const deployWorkflow = read(DEPLOY_WORKFLOW);

    expect(dockerfile).toMatch(
      /ARG COGNEE_BASE_IMAGE=cognee\/cognee@sha256:5ce7e4052b1d/,
    );
    expect(dockerfile).toMatch(/\/usr\/local\/bin\/python -m pip install/);
    expect(dockerfile).toMatch(
      /--target \/app\/\.venv\/lib\/python3\.12\/site-packages/,
    );
    expect(dockerfile).toMatch(/"boto3>=1\.34\.0"/);
    expect(dockerfile).not.toMatch(/cognee\/cognee:main/);

    expect(deployWorkflow).toMatch(
      /'plugins\/company-brain\/runtime\/cognee\/\*\*'/,
    );
    expect(deployWorkflow).toMatch(
      /'plugins\/company-brain\/terraform\/cognee\/\*\*'/,
    );
    expect(deployWorkflow).toMatch(/Build and push Cognee Bedrock image/);
    expect(deployWorkflow).toMatch(
      /file: plugins\/company-brain\/runtime\/cognee\/Dockerfile/,
    );
    expect(deployWorkflow).toMatch(/github\.sha }}-cognee/);
    expect(deployWorkflow).toMatch(/COGNEE_BUILT_IMAGE_DIGEST/);
    expect(deployWorkflow).toMatch(/COGNEE_BUILT_IMAGE_REPOSITORY/);
    expect(deployWorkflow).toMatch(/COGNEE_IMAGE_URI_INPUT/);
    expect(deployWorkflow).toMatch(
      /cognee_image_uri="\$\{COGNEE_BUILT_IMAGE_REPOSITORY\}@\$\{COGNEE_BUILT_IMAGE_DIGEST\}"/,
    );
  });

  it("prepares the Cognee DB secret and role before Terraform apply when enabled", () => {
    const workflow = read(DEPLOY_WORKFLOW);
    const cogneeDbPrep = workflow.slice(
      workflow.indexOf("Prepare Cognee database credentials"),
      workflow.indexOf("Prepare Twenty CRM runtime secrets and database"),
    );

    expect(workflow).toMatch(/Prepare Cognee database credentials/);
    expect(workflow).toMatch(
      /if \[ "\$\{COGNEE_ENABLED:-false\}" != "true" \]/,
    );
    expect(workflow).toMatch(/Cognee disabled; skipping Cognee database/);
    expect(workflow).toMatch(/openssl rand -hex 32/);
    expect(workflow).toMatch(
      /\[\[ ! "\$cognee_password" =~ \^\[A-Za-z0-9\._~-\]\+\$ \]\]/,
    );
    expect(workflow).toMatch(/aws secretsmanager create-secret/);
    expect(workflow).toMatch(/aws secretsmanager put-secret-value/);
    expect(workflow).toMatch(/COGNEE_DB_PASSWORD_SECRET_ARN=\$secret_arn/);
    expect(workflow).toMatch(/CREATE ROLE %I LOGIN PASSWORD %L/);
    expect(workflow).toMatch(/ALTER ROLE %I LOGIN PASSWORD %L/);
    expect(workflow).toMatch(/COGNEE_DB_NAME_INPUT/);
    expect(workflow).toMatch(/CREATE DATABASE %I/);
    expect(cogneeDbPrep).not.toMatch(/CREATE DATABASE %I OWNER %I/);
    expect(cogneeDbPrep).not.toMatch(/ALTER DATABASE %I OWNER TO %I/);
    expect(workflow).toMatch(/GRANT CONNECT ON DATABASE :\"cognee_db\"/);
    expect(workflow).toMatch(/\\connect :\"cognee_db\"/);
    expect(workflow).toMatch(/GRANT USAGE, CREATE ON SCHEMA public/);
    expect(workflow).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES ON ALL TABLES/,
    );
    expect(workflow).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES ON TABLES/,
    );
    expect(workflow).toMatch(/ALTER DEFAULT PRIVILEGES IN SCHEMA public/);
  });

  it("keeps Knowledge Graph deploy dispatch defaults out of the GraphQL Lambda env", () => {
    const source = read(LAMBDA_API_HANDLERS);

    expect(source).toMatch(
      /COGNEE = "\$\{var\.cognee_backend_mode\}\|\$\{var\.cognee_endpoint\}"/,
    );
    expect(source).not.toMatch(/COGNEE_ENDPOINT = var\.cognee_endpoint/);
    expect(source).not.toMatch(/COGNEE_CLUSTER_ARN = var\.cognee_cluster_arn/);
    expect(source).not.toMatch(/KNOWLEDGE_GRAPH_DEPLOY_REPOSITORY/);
    expect(source).not.toMatch(/KNOWLEDGE_GRAPH_DEPLOY_WORKFLOW_FILE/);
    expect(source).not.toMatch(/KNOWLEDGE_GRAPH_DEPLOY_REF/);
    expect(source).not.toMatch(/KNOWLEDGE_GRAPH_GITHUB_TOKEN_SECRET_ID/);
  });
});

describe("U5 - Cognee operational handoff guidance", () => {
  it("documents operator outputs, smoke checks, and rollback in the module README", () => {
    const source = read(COGNEE_README);

    expect(source).toMatch(/enable_cognee = true/);
    expect(source).toMatch(/disabled by default/);
    expect(source).toMatch(/cognee_endpoint/);
    expect(source).toMatch(/cognee_log_group_name/);
    expect(source).toMatch(/cognee_backend_mode/);
    expect(source).toMatch(/health endpoint is reachable/);
    expect(source).toMatch(/provider,\s+database,\s+graph,\s+vector/i);
    expect(source).toMatch(/set `enable_cognee = false`/);
    expect(source).toMatch(/snapshot or export/);
  });

  it("gives operators a Cognee smoke and troubleshooting checklist", () => {
    const source = read(BUSINESS_ONTOLOGY_OPS_DOC);

    expect(source).toMatch(/Operate the Cognee substrate/);
    expect(source).toMatch(
      /Cognee is an optional Terraform-provisioned substrate/,
    );
    expect(source).toMatch(/disabled by default/);
    expect(source).toMatch(/cognee_endpoint/);
    expect(source).toMatch(/cognee_log_group_name/);
    expect(source).toMatch(/cognee_backend_mode/);
    expect(source).toMatch(/provider,\s+database,\s+graph,\s+vector/i);
    expect(source).toMatch(
      /Terraform success is not the same as product readiness/,
    );
    expect(source).toMatch(/set `enable_cognee = false`/);
  });

  it("keeps the concept page clear that Cognee infra does not migrate ontology content", () => {
    const source = read(BUSINESS_ONTOLOGY_CONCEPT_DOC);

    expect(source).toMatch(/Cognee substrate boundary/);
    expect(source).toMatch(/enable_cognee = false/);
    expect(source).toMatch(/enable_cognee = true/);
    expect(source).toMatch(/migrate retained Hindsight memories/);
    expect(source).toMatch(/rewrite compiled Wiki or Brain pages/);
    expect(source).toMatch(/change agent context retrieval/);
    expect(source).toMatch(/Terraform success means the substrate deployed/);
  });
});

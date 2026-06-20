/**
 * Structural fixture tests for the n8n Terraform app module.
 *
 * These assertions keep the optional n8n substrate runnable in CI without AWS
 * credentials while guarding the important invariants: public HTTPS, queue-mode
 * ECS/Fargate main + worker services, managed Valkey/Redis, retained storage,
 * parked runtime semantics, and secret indirection.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

const N8N_MAIN = resolve(REPO_ROOT, "plugins/n8n/terraform/n8n/main.tf");
const N8N_VARS = resolve(REPO_ROOT, "plugins/n8n/terraform/n8n/variables.tf");
const N8N_OUTPUTS = resolve(REPO_ROOT, "plugins/n8n/terraform/n8n/outputs.tf");
const N8N_README = resolve(REPO_ROOT, "plugins/n8n/terraform/n8n/README.md");
const N8N_DB_SCRIPT = resolve(
  REPO_ROOT,
  "plugins/n8n/terraform/n8n/scripts/sync-database.py",
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
const WWW_DNS_MAIN = resolve(
  REPO_ROOT,
  "terraform/modules/app/www-dns/main.tf",
);
const WWW_DNS_VARS = resolve(
  REPO_ROOT,
  "terraform/modules/app/www-dns/variables.tf",
);
const GREENFIELD_MAIN = resolve(
  REPO_ROOT,
  "terraform/examples/greenfield/main.tf",
);
const GREENFIELD_TFVARS_EXAMPLE = resolve(
  REPO_ROOT,
  "terraform/examples/greenfield/terraform.tfvars.example",
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

describe("n8n Terraform app module", () => {
  it("creates a public HTTPS ALB for the n8n main service", () => {
    const source = read(N8N_MAIN);
    const vars = read(N8N_VARS);

    expect(source).toMatch(/resource "aws_lb" "n8n"/);
    expect(source).toMatch(/internal\s*=\s*false/);
    expect(source).toMatch(/resource "aws_lb_target_group" "n8n"/);
    expect(source).toMatch(/resource "aws_lb_listener" "https"/);
    expect(source).toMatch(/certificate_arn\s*=\s*var\.certificate_arn/);
    expect(source).toMatch(/resource "aws_lb_listener" "http_redirect"/);
    expect(source).toMatch(/status_code\s*=\s*"HTTP_301"/);
    expect(source).toMatch(/container_name\s*=\s*"n8n-main"/);
    expect(vars).toMatch(/variable "container_port"/);
    expect(vars).toMatch(/default\s*=\s*5678/);
  });

  it("models queue mode as separate main and worker ECS services", () => {
    const source = read(N8N_MAIN);
    const mainService = firstNestedBlock(
      source,
      'resource "aws_ecs_service" "main"',
    );
    const workerService = firstNestedBlock(
      source,
      'resource "aws_ecs_service" "worker"',
    );

    expect(source).toMatch(/resource "aws_ecs_task_definition" "main"/);
    expect(source).toMatch(/resource "aws_ecs_task_definition" "worker"/);
    expect(source).toMatch(/name\s*=\s*"n8n-main"/);
    expect(source).toMatch(/name\s*=\s*"n8n-worker"/);
    expect(source).toMatch(/command\s*=\s*\["worker", "--concurrency=/);
    expect(source).toMatch(/name = "EXECUTIONS_MODE"/);
    expect(source).toMatch(/value = var\.queue_mode \? "queue" : "regular"/);
    expect(mainService).toMatch(
      /desired_count\s*=\s*var\.runtime_enabled \? var\.main_desired_count : 0/,
    );
    expect(workerService).toMatch(
      /desired_count\s*=\s*var\.runtime_enabled \? var\.worker_desired_count : 0/,
    );
  });

  it("uses managed Valkey/Redis for queue mode instead of sidecars", () => {
    const source = read(N8N_MAIN);
    const vars = read(N8N_VARS);
    const cacheSecurityGroup = firstNestedBlock(
      source,
      'resource "aws_security_group" "cache"',
    );

    expect(source).toMatch(
      /resource "aws_elasticache_replication_group" "n8n"/,
    );
    expect(source).toMatch(/resource "aws_elasticache_subnet_group" "n8n"/);
    expect(source).toMatch(/resource "aws_elasticache_parameter_group" "n8n"/);
    expect(source).toMatch(/name = "QUEUE_BULL_REDIS_HOST"/);
    expect(source).toMatch(/name = "QUEUE_BULL_REDIS_TLS"/);
    expect(vars).toMatch(/default\s*=\s*"valkey"/);
    expect(vars).toMatch(/cache_engine must be valkey or redis/);
    expect(cacheSecurityGroup).toMatch(
      /security_groups\s*=\s*\[aws_security_group\.n8n\.id\]/,
    );
    expect(source).not.toMatch(/redis:\/\/127\.0\.0\.1/);
    expect(source).not.toMatch(/image\s*=\s*var\.redis_image_uri/);
  });

  it("keeps OSS queue mode on database-backed execution and binary data by default", () => {
    const source = read(N8N_MAIN);
    const vars = read(N8N_VARS);
    const readme = read(N8N_README);

    expect(source).toMatch(/resource "aws_s3_bucket" "n8n"/);
    expect(vars).toMatch(/variable "execution_data_storage_mode"/);
    expect(vars).toMatch(/default\s*=\s*"database"/);
    expect(vars).toMatch(/variable "binary_data_mode"/);
    expect(source).toMatch(/name = "N8N_EXECUTION_DATA_STORAGE_MODE"/);
    expect(source).toMatch(/name = "N8N_DEFAULT_BINARY_DATA_MODE"/);
    expect(source).toMatch(/name = "N8N_STORAGE_BUCKET_NAME"/);
    expect(source).toMatch(/custom_package_allow_list/);
    expect(source).toMatch(
      /name = "NODE_FUNCTION_ALLOW_EXTERNAL", value = join\(",", local\.custom_package_allow_list\)/,
    );
    expect(readme).toMatch(/queue mode/);
    expect(readme).toMatch(/filesystem binary storage/);
    expect(readme).toMatch(/enterprise-gated/);
  });

  it("injects n8n secrets through ECS secret references", () => {
    const source = read(N8N_MAIN);
    const vars = read(N8N_VARS);

    for (const name of [
      "database_admin_secret_arn",
      "database_url_secret_arn",
      "encryption_key_secret_arn",
      "operator_secret_arn",
      "service_credential_secret_arn",
    ]) {
      expect(vars).toMatch(new RegExp(`variable "${name}"`));
    }
    expect(source).toMatch(/resource "terraform_data" "database_lifecycle"/);
    expect(source).toMatch(/name = "DATABASE_URL"/);
    expect(source).toMatch(/name = "DB_POSTGRESDB_PASSWORD"/);
    expect(source).toMatch(/name = "DB_POSTGRESDB_SSL_ENABLED"/);
    expect(source).toMatch(/name = "DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED"/);
    expect(source).toMatch(/name = "N8N_ENCRYPTION_KEY"/);
    expect(source).toMatch(/name = "N8N_OPERATOR_EMAIL"/);
    expect(source).toMatch(/name = "N8N_OPERATOR_PASSWORD"/);
    expect(source).toMatch(/name = "N8N_MCP_SERVICE_CREDENTIAL"/);
  });

  it("makes generated n8n placeholders safe for immediate reinstall", () => {
    const source = read(N8N_MAIN);
    const placeholderSecret = firstNestedBlock(
      source,
      'resource "aws_secretsmanager_secret" "n8n"',
    );

    expect(placeholderSecret).toMatch(
      /name_prefix\s*=\s*"\$\{each\.value\.name\}-"/,
    );
    expect(placeholderSecret).toMatch(/recovery_window_in_days\s*=\s*0/);
    expect(placeholderSecret).not.toMatch(/\n\s*name\s*=/);
  });

  it("synchronizes the dedicated n8n database role before ECS starts", () => {
    const source = read(N8N_MAIN);
    const script = read(N8N_DB_SCRIPT);
    const databaseLifecycle = firstNestedBlock(
      source,
      'resource "terraform_data" "database_lifecycle"',
    );
    const mainTaskDefinition = firstNestedBlock(
      source,
      'resource "aws_ecs_task_definition" "main"',
    );
    const workerTaskDefinition = firstNestedBlock(
      source,
      'resource "aws_ecs_task_definition" "worker"',
    );

    expect(databaseLifecycle).toMatch(/triggers_replace\s*=\s*\{/);
    expect(databaseLifecycle).toMatch(/sync-database\.py up/);
    expect(databaseLifecycle).toMatch(/when\s*=\s*destroy/);
    expect(databaseLifecycle).toMatch(
      /self\.input\.sync_script_path\} destroy/,
    );
    expect(databaseLifecycle).toMatch(/database_url_version_id/);
    expect(databaseLifecycle).toMatch(/aws_secretsmanager_secret_version\.n8n/);
    expect(mainTaskDefinition).toMatch(/terraform_data\.database_lifecycle/);
    expect(workerTaskDefinition).toMatch(/terraform_data\.database_lifecycle/);
    expect(script).toMatch(/CREATE DATABASE/);
    expect(script).toMatch(/ALTER ROLE %I WITH LOGIN PASSWORD %L/);
    expect(script).toMatch(/args\.append\("-tA"\)/);
    expect(script).toMatch(/DROP DATABASE IF EXISTS/);
  });

  it("exposes outputs matching the deployment-runner n8n adapter", () => {
    const outputs = read(N8N_OUTPUTS);

    for (const name of [
      "n8n_provisioned",
      "n8n_runtime_enabled",
      "n8n_url",
      "n8n_alb_arn",
      "n8n_target_group_arn",
      "n8n_cluster_arn",
      "n8n_main_service_name",
      "n8n_worker_service_name",
      "n8n_main_log_group_name",
      "n8n_worker_log_group_name",
      "n8n_database_name",
      "n8n_database_secret_arn",
      "n8n_valkey_endpoint",
      "n8n_storage_bucket_name",
      "n8n_storage_prefix",
      "n8n_image_digest",
      "n8n_package_config_digest",
      "n8n_service_credential_secret_arn",
    ]) {
      expect(outputs).toMatch(new RegExp(`output "${name}"`));
    }
  });

  it("wires the n8n module behind retained provisioned state", () => {
    const source = read(THINKWORK_MAIN);
    const vars = read(THINKWORK_VARS);
    const outputs = read(THINKWORK_OUTPUTS);
    const n8nModule = firstNestedBlock(source, 'module "n8n"');
    const guardrails = firstNestedBlock(
      source,
      'resource "terraform_data" "n8n_configuration_guardrails"',
    );

    expect(vars).toMatch(/variable "n8n_provisioned"/);
    expect(vars).toMatch(/variable "n8n_runtime_enabled"/);
    expect(vars).toMatch(/variable "n8n_image_uri"/);
    expect(vars).toMatch(/default\s*=\s*"thinkwork_n8n"/);
    expect(vars).toMatch(
      /n8n_database_name must be a valid PostgreSQL identifier/,
    );
    expect(vars).toMatch(/variable "n8n_storage_bucket_name"/);
    expect(source).toMatch(/n8n_domain.*n8n\.\$\{var\.www_domain\}/);
    expect(n8nModule).toMatch(/count\s*=\s*local\.n8n_provisioned \? 1 : 0/);
    expect(n8nModule).toMatch(
      /source\s*=\s*"\.\.\/\.\.\/\.\.\/plugins\/n8n\/terraform\/n8n"/,
    );
    expect(n8nModule).toMatch(
      /runtime_enabled\s*=\s*local\.n8n_runtime_enabled/,
    );
    expect(n8nModule).toMatch(
      /database_host\s*=\s*module\.database\.cluster_endpoint/,
    );
    expect(n8nModule).toMatch(
      /cache_subnet_ids\s*=\s*module\.vpc\.private_subnet_ids/,
    );
    expect(n8nModule).toMatch(
      /storage_bucket_name\s*=\s*var\.n8n_storage_bucket_name/,
    );
    expect(guardrails).toMatch(/n8n_provisioned requires n8n_image_uri/);
    expect(guardrails).toMatch(/n8n_database_name must be distinct/);
    expect(guardrails).toMatch(
      /n8n_provisioned requires n8n_storage_bucket_name/,
    );
    expect(outputs).toMatch(/output "n8n_provisioned"/);
    expect(outputs).toMatch(/output "n8n_url"/);
  });

  it("keeps greenfield n8n variables and defaults disabled", () => {
    const source = read(GREENFIELD_MAIN);
    const tfvars = read(GREENFIELD_TFVARS_EXAMPLE);
    const thinkworkModule = firstNestedBlock(source, 'module "thinkwork"');

    expect(source).toMatch(/variable "n8n_provisioned"/);
    expect(source).toMatch(/variable "n8n_runtime_enabled"/);
    expect(source).toMatch(/variable "n8n_domain"/);
    expect(source).toMatch(/variable "n8n_container_port"/);
    expect(source).toMatch(/n8n_managed_certificate_enabled/);
    expect(source).toMatch(/resource "aws_acm_certificate" "n8n"/);
    expect(thinkworkModule).toMatch(
      /n8n_provisioned\s*=\s*var\.n8n_provisioned/,
    );
    expect(thinkworkModule).toMatch(
      /n8n_runtime_enabled\s*=\s*var\.n8n_runtime_enabled/,
    );
    expect(thinkworkModule).toMatch(
      /n8n_database_name\s*=\s*var\.n8n_database_name/,
    );
    expect(thinkworkModule).toMatch(
      /n8n_storage_bucket_name\s*=\s*var\.n8n_storage_bucket_name/,
    );
    expect(thinkworkModule).toMatch(/n8n_public_url\s*=\s*local\.n8n_url/);
    expect(source).toMatch(/output "n8n_provisioned"/);
    expect(source).toMatch(/output "n8n_url"/);
    expect(tfvars).toMatch(/n8n_provisioned\s*=\s*false/);
    expect(tfvars).toMatch(/n8n_runtime_enabled\s*=\s*false/);
    expect(tfvars).toMatch(/n8n_database_name\s*=\s*"thinkwork_n8n"/);
    expect(tfvars).toMatch(/n8n_container_port\s*=\s*5678/);
    expect(tfvars).toMatch(/n8n_domain\s*=\s*""/);
    expect(tfvars).toMatch(/empty derives n8n\.<www_domain>/);
  });

  it("adds n8n.<domain> DNS support without rotating the shared site certificate", () => {
    const source = read(WWW_DNS_MAIN);
    const vars = read(WWW_DNS_VARS);
    const greenfield = read(GREENFIELD_MAIN);
    const wwwDnsModule = firstNestedBlock(greenfield, 'module "www_dns"');
    const n8nRecord = firstNestedBlock(
      source,
      'resource "cloudflare_record" "n8n"',
    );

    expect(vars).toMatch(/variable "include_n8n"/);
    expect(vars).toMatch(/variable "n8n_alb_dns_name"/);
    expect(source).toMatch(/n8n\s*=\s*"n8n\.\$\{var\.domain\}"/);
    expect(source).toMatch(/create_n8n_record\s*=\s*var\.include_n8n/);
    expect(n8nRecord).toMatch(/name\s*=\s*local\.n8n/);
    expect(n8nRecord).toMatch(/content\s*=\s*var\.n8n_alb_dns_name/);
    expect(n8nRecord).toMatch(/proxied\s*=\s*false/);
    expect(wwwDnsModule).toMatch(/include_n8n\s*=\s*var\.n8n_provisioned/);
    expect(wwwDnsModule).toMatch(
      /n8n_alb_dns_name\s*=\s*module\.thinkwork\.n8n_alb_dns_name/,
    );
    expect(source).not.toMatch(/var\.include_n8n \? \[local\.n8n\] : \[\]/);
  });
});

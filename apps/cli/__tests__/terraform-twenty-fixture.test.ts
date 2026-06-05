/**
 * Structural fixture tests for the Twenty CRM Terraform app module.
 *
 * These assertions keep the optional CRM substrate runnable in CI without AWS
 * credentials while guarding the important invariants: public HTTPS, retained
 * storage/cache, parked runtime semantics, and secret indirection.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

const TWENTY_MAIN = resolve(REPO_ROOT, "terraform/modules/app/twenty/main.tf");
const TWENTY_VARS = resolve(
  REPO_ROOT,
  "terraform/modules/app/twenty/variables.tf",
);
const TWENTY_OUTPUTS = resolve(
  REPO_ROOT,
  "terraform/modules/app/twenty/outputs.tf",
);
const TWENTY_README = resolve(
  REPO_ROOT,
  "terraform/modules/app/twenty/README.md",
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

describe("U1 - Twenty Terraform app module", () => {
  it("creates a public HTTPS ALB with HTTP redirect and target-group health checks", () => {
    const source = read(TWENTY_MAIN);
    const vars = read(TWENTY_VARS);

    expect(source).toMatch(/resource "aws_lb" "twenty"/);
    expect(source).toMatch(/internal\s*=\s*false/);
    expect(source).toMatch(/resource "aws_lb_listener" "https"/);
    expect(source).toMatch(/protocol\s*=\s*"HTTPS"/);
    expect(source).toMatch(/certificate_arn\s*=\s*var\.certificate_arn/);
    expect(source).toMatch(/resource "aws_lb_listener" "http_redirect"/);
    expect(source).toMatch(/status_code\s*=\s*"HTTP_301"/);
    expect(source).toMatch(/path\s*=\s*var\.health_check_path/);
    expect(vars).toMatch(/default\s*=\s*"\/healthz"/);
  });

  it("uses separate ECS server and worker services with parked runtime desired counts", () => {
    const source = read(TWENTY_MAIN);
    const serverService = firstNestedBlock(
      source,
      'resource "aws_ecs_service" "server"',
    );
    const workerService = firstNestedBlock(
      source,
      'resource "aws_ecs_service" "worker"',
    );
    const workerTask = firstNestedBlock(
      source,
      'resource "aws_ecs_task_definition" "worker"',
    );

    expect(source).toMatch(/resource "aws_ecs_task_definition" "server"/);
    expect(source).toMatch(/resource "aws_ecs_task_definition" "worker"/);
    expect(serverService).toMatch(
      /desired_count\s*=\s*var\.runtime_enabled \? var\.server_desired_count : 0/,
    );
    expect(workerService).toMatch(
      /desired_count\s*=\s*var\.runtime_enabled \? var\.worker_desired_count : 0/,
    );
    expect(workerTask).toMatch(/command\s*=\s*\["yarn", "worker:prod"\]/);
    expect(serverService).toMatch(/load_balancer/);
    expect(workerService).not.toMatch(/load_balancer/);
  });

  it("injects Twenty database and encryption secrets through ECS secrets", () => {
    const source = read(TWENTY_MAIN);
    const environmentLocals = source.slice(
      source.indexOf("base_environment = ["),
      source.indexOf("container_secrets = concat("),
    );
    const containerSecrets = source.slice(
      source.indexOf("container_secrets = concat("),
      source.indexOf('data "aws_region" "current"'),
    );

    expect(source).toMatch(/secrets\s*=\s*local\.container_secrets/);
    expect(containerSecrets).toMatch(
      /name\s*=\s*"PG_DATABASE_URL"[\s\S]*?:PG_DATABASE_URL::/,
    );
    expect(containerSecrets).toMatch(
      /name\s*=\s*"ENCRYPTION_KEY"[\s\S]*?:ENCRYPTION_KEY::/,
    );
    expect(containerSecrets).toMatch(/FALLBACK_ENCRYPTION_KEY/);
    expect(containerSecrets).toMatch(/APP_SECRET/);
    expect(environmentLocals).not.toMatch(/PG_DATABASE_URL/);
    expect(environmentLocals).not.toMatch(/ENCRYPTION_KEY/);
  });

  it("can create placeholder secret containers without exposing real values", () => {
    const source = read(TWENTY_MAIN);
    const vars = read(TWENTY_VARS);
    const outputs = read(TWENTY_OUTPUTS);
    const secretVersion = firstNestedBlock(
      source,
      'resource "aws_secretsmanager_secret_version" "twenty"',
    );

    expect(vars).toMatch(/variable "create_secret_placeholders"/);
    expect(source).toMatch(/managed_secret_specs/);
    expect(source).toMatch(/thinkwork\/\$\{var\.stage\}\/twenty\/db-url/);
    expect(source).toMatch(
      /thinkwork\/\$\{var\.stage\}\/twenty\/encryption-key/,
    );
    expect(source).toMatch(/resource "aws_secretsmanager_secret" "twenty"/);
    expect(secretVersion).toMatch(/ignore_changes\s*=\s*\[secret_string\]/);
    expect(outputs).toMatch(/output "twenty_db_url_secret_arn"/);
    expect(outputs).toMatch(/output "twenty_encryption_key_secret_arn"/);
    expect(outputs).not.toMatch(/PLACEHOLDER_SET_VIA_CI/);
  });

  it("adds retained encrypted EFS storage for Twenty local server files", () => {
    const source = read(TWENTY_MAIN);

    expect(source).toMatch(/resource "aws_efs_file_system" "twenty"/);
    expect(source).toMatch(/encrypted\s*=\s*true/);
    expect(source).toMatch(/resource "aws_efs_mount_target" "twenty"/);
    expect(source).toMatch(/transit_encryption\s*=\s*"ENABLED"/);
    expect(source).toMatch(/STORAGE_TYPE/);
    expect(source).toMatch(/STORAGE_LOCAL_PATH/);
    expect(source).toMatch(/\/app\/packages\/twenty-server\/\.local-storage/);
  });

  it("uses AWS-managed Valkey or Redis OSS instead of a sidecar cache", () => {
    const source = read(TWENTY_MAIN);
    const vars = read(TWENTY_VARS);
    const cacheSecurityGroup = firstNestedBlock(
      source,
      'resource "aws_security_group" "cache"',
    );

    expect(source).toMatch(
      /resource "aws_elasticache_replication_group" "twenty"/,
    );
    expect(source).toMatch(/resource "aws_elasticache_subnet_group" "twenty"/);
    expect(source).toMatch(
      /resource "aws_elasticache_parameter_group" "twenty"/,
    );
    expect(source).toMatch(/maxmemory-policy/);
    expect(source).toMatch(/noeviction/);
    expect(vars).toMatch(/default\s*=\s*"valkey"/);
    expect(vars).toMatch(/cache_engine must be valkey or redis/);
    expect(cacheSecurityGroup).toMatch(
      /security_groups\s*=\s*\[aws_security_group\.twenty\.id\]/,
    );
    expect(source).not.toMatch(/image\s*=\s*"redis/);
  });

  it("guards required runtime inputs and immutable image pins", () => {
    const source = read(TWENTY_MAIN);
    const vars = read(TWENTY_VARS);
    const guardrails = firstNestedBlock(
      source,
      'resource "terraform_data" "configuration_guardrails"',
    );

    expect(vars).toMatch(/image_uri must be pinned to an immutable sha256/);
    expect(vars).toMatch(/public_url must be an HTTPS origin/);
    expect(guardrails).toMatch(/Twenty requires db_url_secret_arn/);
    expect(guardrails).toMatch(/Twenty requires encryption_key_secret_arn/);
    expect(guardrails).toMatch(
      /runtime_enabled requires server_desired_count > 0/,
    );
    expect(guardrails).toMatch(
      /runtime_enabled requires worker_desired_count > 0/,
    );
  });

  it("exports operational details for later deployment status and CRM settings", () => {
    const outputs = read(TWENTY_OUTPUTS);

    expect(outputs).toMatch(/output "twenty_url"/);
    expect(outputs).toMatch(/output "twenty_alb_dns_name"/);
    expect(outputs).toMatch(/output "twenty_cluster_arn"/);
    expect(outputs).toMatch(/output "twenty_server_service_name"/);
    expect(outputs).toMatch(/output "twenty_worker_service_name"/);
    expect(outputs).toMatch(/output "twenty_server_log_group_name"/);
    expect(outputs).toMatch(/output "twenty_worker_log_group_name"/);
    expect(outputs).toMatch(/output "twenty_cache_endpoint"/);
    expect(outputs).toMatch(/output "twenty_storage_file_system_id"/);
    expect(outputs).toMatch(/output "twenty_runtime_enabled"/);
  });

  it("documents retained runtime parking and deferred destructive deletes", () => {
    const readme = read(TWENTY_README);

    expect(readme).toMatch(/runtime_enabled = false/);
    expect(readme).toMatch(/parks the ECS server and worker/);
    expect(readme).toMatch(/retaining the database secret references/);
    expect(readme).toMatch(/Destroying retained CRM data is intentionally/);
  });
});

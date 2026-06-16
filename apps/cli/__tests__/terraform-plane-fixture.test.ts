/**
 * Structural fixture tests for the Plane Terraform app module.
 *
 * These assertions keep the optional Plane substrate runnable in CI without
 * AWS credentials while guarding the important invariants: public HTTPS,
 * an ECS/Fargate AIO runtime with managed stateful services, parked runtime
 * semantics, and secret indirection.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

const PLANE_MAIN = resolve(REPO_ROOT, "terraform/modules/app/plane/main.tf");
const PLANE_VARS = resolve(
  REPO_ROOT,
  "terraform/modules/app/plane/variables.tf",
);
const PLANE_OUTPUTS = resolve(
  REPO_ROOT,
  "terraform/modules/app/plane/outputs.tf",
);
const PLANE_README = resolve(
  REPO_ROOT,
  "terraform/modules/app/plane/README.md",
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

describe("Plane Terraform app module", () => {
  it("creates a public HTTPS ALB for the compact Plane app service", () => {
    const source = read(PLANE_MAIN);
    const vars = read(PLANE_VARS);

    expect(source).toMatch(/resource "aws_lb" "plane"/);
    expect(source).toMatch(/internal\s*=\s*false/);
    expect(source).toMatch(/resource "aws_lb_target_group" "service"/);
    expect(source).toMatch(
      /target_group_arn = aws_lb_target_group\.service\["app"\]\.arn/,
    );
    expect(source).toMatch(/resource "aws_lb_listener" "https"/);
    expect(source).toMatch(/certificate_arn\s*=\s*var\.certificate_arn/);
    expect(source).toMatch(/resource "aws_lb_listener" "http_redirect"/);
    expect(source).toMatch(/status_code\s*=\s*"HTTP_301"/);
    expect(vars).toMatch(/variable "web_container_port"/);
    expect(vars).toMatch(/default\s*=\s*8080/);
    expect(source).toMatch(/name = "LISTEN_HTTP_PORT"/);
  });

  it("models Plane as one ECS service with AIO and MCP containers", () => {
    const source = read(PLANE_MAIN);
    const containerSpecs = firstNestedBlock(source, "container_specs = {");
    const listenerRules = firstNestedBlock(source, "listener_rules = {");
    const ecsService = firstNestedBlock(
      source,
      'resource "aws_ecs_service" "plane"',
    );

    expect(containerSpecs).toMatch(/app\s*=\s*{/);
    expect(containerSpecs).toMatch(/mcp\s*=\s*{/);
    expect(containerSpecs).not.toMatch(/redis\s*=\s*{/);
    expect(containerSpecs).not.toMatch(/rabbitmq\s*=\s*{/);
    expect(containerSpecs).not.toMatch(/worker\s*=\s*{/);
    expect(source).toMatch(/resource "aws_ecs_task_definition" "plane"/);
    expect(ecsService).toMatch(
      /desired_count\s*=\s*var\.runtime_enabled \? var\.web_desired_count : 0/,
    );
    expect(ecsService).toMatch(/for_each\s*=\s*local\.public_services/);
    expect(listenerRules).toMatch(/mcp_oauth\s*=\s*{/);
    expect(listenerRules).toMatch(/mcp_stream\s*=\s*{/);
    expect(listenerRules).toMatch(/priority\s*=\s*12/);
    expect(listenerRules).toMatch(/priority\s*=\s*11/);
    expect(listenerRules).toMatch(/"\/\.well-known\/\*"/);
    expect(listenerRules).toMatch(/"\/authorize"/);
    expect(listenerRules).toMatch(/"\/token"/);
    expect(listenerRules).toMatch(/"\/register"/);
    expect(listenerRules).toMatch(/"\/mcp"/);
    expect(listenerRules).toMatch(/"\/mcp\/\*"/);
    expect(listenerRules).toMatch(/"\/header\/mcp"/);
    expect(listenerRules).toMatch(/"\/header\/mcp\/\*"/);
  });

  it("uses managed Valkey/Redis and RabbitMQ instead of sidecars", () => {
    const source = read(PLANE_MAIN);
    const vars = read(PLANE_VARS);
    const readme = read(PLANE_README);
    const cacheSecurityGroup = firstNestedBlock(
      source,
      'resource "aws_security_group" "cache"',
    );
    const queueSecurityGroup = firstNestedBlock(
      source,
      'resource "aws_security_group" "queue"',
    );
    const ecsServiceResources = source.match(
      /resource "aws_ecs_service" "plane"/g,
    );

    expect(source).toMatch(/resource "aws_s3_bucket" "plane"/);
    expect(ecsServiceResources).toHaveLength(1);
    expect(source).toMatch(
      /resource "aws_elasticache_replication_group" "plane"/,
    );
    expect(source).toMatch(/resource "aws_elasticache_subnet_group" "plane"/);
    expect(source).toMatch(
      /resource "aws_elasticache_parameter_group" "plane"/,
    );
    expect(source).toMatch(/resource "aws_mq_broker" "plane"/);
    expect(source).toMatch(/engine_type\s*=\s*"RabbitMQ"/);
    expect(source).toMatch(/publicly_accessible\s*=\s*false/);
    expect(vars).toMatch(/default\s*=\s*"valkey"/);
    expect(vars).toMatch(/cache_engine must be valkey or redis/);
    expect(vars).toMatch(/default\s*=\s*"SINGLE_INSTANCE"/);
    expect(cacheSecurityGroup).toMatch(
      /security_groups\s*=\s*\[aws_security_group\.plane\.id\]/,
    );
    expect(queueSecurityGroup).toMatch(
      /security_groups\s*=\s*\[aws_security_group\.plane\.id\]/,
    );
    expect(source).toMatch(/name = "REDIS_URL"/);
    expect(source).toMatch(/aws_elasticache_replication_group\.plane/);
    expect(source).toMatch(/name = "AMQP_URL"/);
    expect(source).toMatch(
      /resource "aws_secretsmanager_secret" "plane_amqp_url"/,
    );
    expect(source).toMatch(/aws_mq_broker\.plane\.instances/);
    expect(source).not.toMatch(/redis:\/\/127\.0\.0\.1/);
    expect(source).not.toMatch(/image\s*=\s*var\.redis_image_uri/);
    expect(source).not.toMatch(/image\s*=\s*var\.rabbitmq_image_uri/);
    expect(readme).toMatch(/runtime_enabled = false/);
    expect(readme).toMatch(/parks the compact Plane ECS service/);
    expect(readme).toMatch(/one ECS service/);
    expect(readme).toMatch(/two\s+containers/);
  });

  it("injects Plane secrets through ECS secret references", () => {
    const source = read(PLANE_MAIN);
    const vars = read(PLANE_VARS);

    for (const name of [
      "db_url_secret_arn",
      "secret_key_secret_arn",
      "live_server_secret_key_secret_arn",
      "aes_secret_key_secret_arn",
      "s3_access_key_id_secret_arn",
      "s3_secret_access_key_secret_arn",
    ]) {
      expect(vars).toMatch(new RegExp(`variable "${name}"`));
    }
    expect(source).toMatch(/name = "DATABASE_URL"/);
    expect(source).toMatch(/name = "SECRET_KEY"/);
    expect(source).toMatch(/name = "LIVE_SERVER_SECRET_KEY"/);
    expect(source).toMatch(/name = "AES_SECRET_KEY"/);
    expect(source).toMatch(/name = "AWS_ACCESS_KEY_ID"/);
    expect(source).toMatch(/name = "AWS_SECRET_ACCESS_KEY"/);
  });

  it("exposes outputs matching the deployment-runner Plane adapter", () => {
    const outputs = read(PLANE_OUTPUTS);

    for (const name of [
      "plane_url",
      "plane_alb_arn",
      "plane_target_group_arn",
      "plane_cluster_arn",
      "plane_web_service_name",
      "plane_api_service_name",
      "plane_worker_service_name",
      "plane_beat_worker_service_name",
      "plane_live_service_name",
      "plane_mcp_service_name",
      "plane_web_log_group_name",
      "plane_api_log_group_name",
      "plane_worker_log_group_name",
      "plane_beat_worker_log_group_name",
      "plane_live_log_group_name",
      "plane_mcp_log_group_name",
      "plane_cache_endpoint",
      "plane_rabbitmq_broker_arn",
      "plane_storage_bucket_name",
      "plane_runtime_enabled",
    ]) {
      expect(outputs).toMatch(new RegExp(`output "${name}"`));
    }
  });

  it("wires the Plane module behind retained provisioned state", () => {
    const source = read(THINKWORK_MAIN);
    const vars = read(THINKWORK_VARS);
    const outputs = read(THINKWORK_OUTPUTS);
    const planeModule = firstNestedBlock(source, 'module "plane"');
    const guardrails = firstNestedBlock(
      source,
      'resource "terraform_data" "plane_configuration_guardrails"',
    );

    expect(vars).toMatch(/variable "plane_provisioned"/);
    expect(vars).toMatch(/variable "plane_runtime_enabled"/);
    expect(vars).toMatch(/variable "plane_image_uri"/);
    expect(vars).toMatch(/variable "plane_db_username"/);
    expect(vars).toMatch(/default\s*=\s*"thinkwork_plane"/);
    expect(vars).toMatch(/variable "plane_db_name"/);
    expect(vars).toMatch(/plane_db_name must be a valid PostgreSQL identifier/);
    expect(vars).toMatch(/variable "plane_s3_bucket_name"/);
    expect(vars).toMatch(/variable "plane_web_container_port"/);
    expect(vars).toMatch(/variable "plane_cache_engine"/);
    expect(vars).toMatch(/plane_cache_engine must be valkey or redis/);
    expect(vars).toMatch(/variable "plane_rabbitmq_deployment_mode"/);
    expect(source).toMatch(/plane_domain.*plane\.\$\{var\.www_domain\}/);
    expect(planeModule).toMatch(
      /count\s*=\s*local\.plane_provisioned \? 1 : 0/,
    );
    expect(planeModule).toMatch(/source\s*=\s*"\.\.\/app\/plane"/);
    expect(planeModule).toMatch(
      /runtime_enabled\s*=\s*local\.plane_runtime_enabled/,
    );
    expect(planeModule).toMatch(
      /web_container_port\s*=\s*var\.plane_web_container_port/,
    );
    expect(planeModule).toMatch(
      /cache_subnet_ids\s*=\s*module\.vpc\.private_subnet_ids/,
    );
    expect(planeModule).toMatch(
      /queue_subnet_ids\s*=\s*module\.vpc\.private_subnet_ids/,
    );
    expect(planeModule).toMatch(
      /s3_bucket_name\s*=\s*var\.plane_s3_bucket_name/,
    );
    expect(planeModule).toMatch(/cache_engine\s*=\s*var\.plane_cache_engine/);
    expect(planeModule).toMatch(
      /rabbitmq_deployment_mode\s*=\s*var\.plane_rabbitmq_deployment_mode/,
    );
    expect(guardrails).toMatch(
      /plane_provisioned requires Plane AIO plane_image_uri and plane_mcp_image_uri/,
    );
    expect(guardrails).toMatch(/plane_db_name must be distinct/);
    expect(guardrails).toMatch(
      /plane_provisioned requires plane_s3_bucket_name/,
    );
    expect(guardrails).toMatch(
      /plane_provisioned requires at least one private subnet/,
    );
    expect(outputs).toMatch(/output "plane_provisioned"/);
    expect(outputs).toMatch(/output "plane_url"/);
  });

  it("keeps greenfield Plane variables and defaults disabled", () => {
    const source = read(GREENFIELD_MAIN);
    const tfvars = read(GREENFIELD_TFVARS_EXAMPLE);
    const thinkworkModule = firstNestedBlock(source, 'module "thinkwork"');

    expect(source).toMatch(/variable "plane_provisioned"/);
    expect(source).toMatch(/variable "plane_runtime_enabled"/);
    expect(source).toMatch(/plane_managed_certificate_enabled/);
    expect(source).toMatch(/resource "aws_acm_certificate" "plane"/);
    expect(thinkworkModule).toMatch(
      /plane_provisioned\s*=\s*var\.plane_provisioned/,
    );
    expect(thinkworkModule).toMatch(
      /plane_runtime_enabled\s*=\s*var\.plane_runtime_enabled/,
    );
    expect(thinkworkModule).toMatch(/plane_public_url\s*=\s*local\.plane_url/);
    expect(source).toMatch(/output "plane_provisioned"/);
    expect(source).toMatch(/output "plane_url"/);
    expect(tfvars).toMatch(/plane_provisioned\s*=\s*false/);
    expect(tfvars).toMatch(/plane_runtime_enabled\s*=\s*false/);
    expect(tfvars).toMatch(/empty derives https:\/\/plane\.<www_domain>/);
  });

  it("adds plane.<domain> DNS support without rotating the shared site certificate", () => {
    const source = read(WWW_DNS_MAIN);
    const vars = read(WWW_DNS_VARS);
    const greenfield = read(GREENFIELD_MAIN);
    const wwwDnsModule = firstNestedBlock(greenfield, 'module "www_dns"');
    const planeRecord = firstNestedBlock(
      source,
      'resource "cloudflare_record" "plane"',
    );

    expect(vars).toMatch(/variable "include_plane"/);
    expect(vars).toMatch(/variable "plane_alb_dns_name"/);
    expect(source).toMatch(/plane\s*=\s*"plane\.\$\{var\.domain\}"/);
    expect(source).toMatch(/create_plane_record\s*=\s*var\.include_plane/);
    expect(planeRecord).toMatch(/name\s*=\s*local\.plane/);
    expect(planeRecord).toMatch(/content\s*=\s*var\.plane_alb_dns_name/);
    expect(planeRecord).toMatch(/proxied\s*=\s*false/);
    expect(wwwDnsModule).toMatch(/include_plane\s*=\s*var\.plane_provisioned/);
    expect(wwwDnsModule).toMatch(
      /plane_alb_dns_name\s*=\s*module\.thinkwork\.plane_alb_dns_name/,
    );
    expect(source).not.toMatch(/var\.include_plane \? \[local\.plane\] : \[\]/);
  });
});

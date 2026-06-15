/**
 * Structural fixture tests for the Plane Terraform app module.
 *
 * These assertions keep the optional Plane substrate runnable in CI without
 * AWS credentials while guarding the important invariants: public HTTPS,
 * ECS/Fargate service split, retained S3/cache/RabbitMQ resources, parked
 * runtime semantics, and secret indirection.
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
  it("creates a public HTTPS ALB for the Plane web service", () => {
    const source = read(PLANE_MAIN);
    const vars = read(PLANE_VARS);

    expect(source).toMatch(/resource "aws_lb" "plane"/);
    expect(source).toMatch(/internal\s*=\s*false/);
    expect(source).toMatch(/resource "aws_lb_target_group" "service"/);
    expect(source).toMatch(/target_group_arn = aws_lb_target_group\.service\["web"\]\.arn/);
    expect(source).toMatch(/resource "aws_lb_listener" "https"/);
    expect(source).toMatch(/certificate_arn\s*=\s*var\.certificate_arn/);
    expect(source).toMatch(/resource "aws_lb_listener" "http_redirect"/);
    expect(source).toMatch(/status_code\s*=\s*"HTTP_301"/);
    expect(vars).toMatch(/variable "web_container_port"/);
  });

  it("models Plane web, API, worker, beat worker, and live ECS services", () => {
    const source = read(PLANE_MAIN);
    const serviceDefs = firstNestedBlock(source, "service_definitions = {");
    const ecsService = firstNestedBlock(
      source,
      'resource "aws_ecs_service" "service"',
    );

    expect(serviceDefs).toMatch(/web\s*=\s*{/);
    expect(serviceDefs).toMatch(/api\s*=\s*{/);
    expect(serviceDefs).toMatch(/worker\s*=\s*{/);
    expect(serviceDefs).toMatch(/beat_worker\s*=\s*{/);
    expect(serviceDefs).toMatch(/live\s*=\s*{/);
    expect(source).toMatch(/resource "aws_ecs_task_definition" "service"/);
    expect(ecsService).toMatch(
      /desired_count\s*=\s*var\.runtime_enabled \? each\.value\.desired_count : 0/,
    );
    expect(ecsService).toMatch(/for_each\s*=\s*local\.service_definitions/);
  });

  it("uses S3, ElastiCache, and Amazon MQ RabbitMQ as retained Plane data resources", () => {
    const source = read(PLANE_MAIN);
    const readme = read(PLANE_README);

    expect(source).toMatch(/resource "aws_s3_bucket" "plane"/);
    expect(source).toMatch(
      /resource "aws_elasticache_replication_group" "plane"/,
    );
    expect(source).toMatch(/resource "aws_mq_broker" "rabbitmq"/);
    expect(source).toMatch(/engine_type\s*=\s*"RabbitMQ"/);
    expect(readme).toMatch(/runtime_enabled = false/);
    expect(readme).toMatch(/parks all Plane ECS services/);
    expect(readme).toMatch(/S3, cache, RabbitMQ, secrets, logs, ALB/);
  });

  it("injects Plane secrets through ECS secret references", () => {
    const source = read(PLANE_MAIN);
    const vars = read(PLANE_VARS);

    for (const name of [
      "db_url_secret_arn",
      "secret_key_secret_arn",
      "live_server_secret_key_secret_arn",
      "aes_secret_key_secret_arn",
      "amqp_url_secret_arn",
      "s3_access_key_id_secret_arn",
      "s3_secret_access_key_secret_arn",
    ]) {
      expect(vars).toMatch(new RegExp(`variable "${name}"`));
    }
    expect(source).toMatch(/name = "DATABASE_URL"/);
    expect(source).toMatch(/name = "SECRET_KEY"/);
    expect(source).toMatch(/name = "LIVE_SERVER_SECRET_KEY"/);
    expect(source).toMatch(/name = "AES_SECRET_KEY"/);
    expect(source).toMatch(/name = "AMQP_URL"/);
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
      "plane_web_log_group_name",
      "plane_api_log_group_name",
      "plane_worker_log_group_name",
      "plane_beat_worker_log_group_name",
      "plane_live_log_group_name",
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
    expect(vars).toMatch(/variable "plane_s3_bucket_name"/);
    expect(source).toMatch(/plane_domain.*plane\.\$\{var\.www_domain\}/);
    expect(planeModule).toMatch(
      /count\s*=\s*local\.plane_provisioned \? 1 : 0/,
    );
    expect(planeModule).toMatch(/source\s*=\s*"\.\.\/app\/plane"/);
    expect(planeModule).toMatch(
      /runtime_enabled\s*=\s*local\.plane_runtime_enabled/,
    );
    expect(planeModule).toMatch(
      /s3_bucket_name\s*=\s*var\.plane_s3_bucket_name/,
    );
    expect(guardrails).toMatch(
      /plane_provisioned requires either legacy plane_image_uri or all per-service Plane image URIs/,
    );
    expect(guardrails).toMatch(
      /plane_provisioned requires plane_s3_bucket_name/,
    );
    expect(outputs).toMatch(/output "plane_provisioned"/);
    expect(outputs).toMatch(/output "plane_url"/);
    expect(outputs).toMatch(/output "plane_rabbitmq_broker_arn"/);
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
});

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

const TWENTY_MAIN = resolve(
  REPO_ROOT,
  "plugins/twenty/terraform/twenty/main.tf",
);
const TWENTY_VARS = resolve(
  REPO_ROOT,
  "plugins/twenty/terraform/twenty/variables.tf",
);
const TWENTY_OUTPUTS = resolve(
  REPO_ROOT,
  "plugins/twenty/terraform/twenty/outputs.tf",
);
const TWENTY_README = resolve(
  REPO_ROOT,
  "plugins/twenty/terraform/twenty/README.md",
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
const WWW_DNS_MAIN = resolve(
  REPO_ROOT,
  "terraform/modules/app/www-dns/main.tf",
);
const WWW_DNS_VARS = resolve(
  REPO_ROOT,
  "terraform/modules/app/www-dns/variables.tf",
);
const WWW_DNS_OUTPUTS = resolve(
  REPO_ROOT,
  "terraform/modules/app/www-dns/outputs.tf",
);
const GREENFIELD_MAIN = resolve(
  REPO_ROOT,
  "terraform/examples/greenfield/main.tf",
);
const GREENFIELD_TFVARS_EXAMPLE = resolve(
  REPO_ROOT,
  "terraform/examples/greenfield/terraform.tfvars.example",
);
const INIT_COMMAND = resolve(REPO_ROOT, "apps/cli/src/commands/init.ts");
const ENTERPRISE_TEMPLATE_MAIN = resolve(
  REPO_ROOT,
  "apps/cli/src/commands/enterprise/templates/deploy-repo/terraform/main.tf",
);
const DEPLOY_WORKFLOW = resolve(REPO_ROOT, ".github/workflows/deploy.yml");
const VERIFY_WORKFLOW = resolve(REPO_ROOT, ".github/workflows/verify.yml");

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
    expect(environmentLocals).toMatch(/PG_SSL_ALLOW_SELF_SIGNED/);
    expect(environmentLocals).toMatch(/NODE_TLS_REJECT_UNAUTHORIZED/);
    expect(environmentLocals).not.toMatch(/PG_DATABASE_URL/);
    expect(environmentLocals).not.toMatch(/ENCRYPTION_KEY/);
  });

  it("configures Twenty app email through ThinkWork SES SMTP", () => {
    const source = read(TWENTY_MAIN);
    const vars = read(TWENTY_VARS);
    const readme = read(TWENTY_README);
    const emailEnvironment = source.slice(
      source.indexOf("email_environment = local.smtp_enabled ? ["),
      source.indexOf("server_environment = concat("),
    );
    const containerSecrets = source.slice(
      source.indexOf("container_secrets = concat("),
      source.indexOf('data "aws_region" "current"'),
    );
    const iamPolicy = firstNestedBlock(
      source,
      'resource "aws_iam_user_policy" "ses_smtp"',
    );

    expect(vars).toMatch(/variable "email_from_address"/);
    expect(vars).toMatch(/variable "email_from_name"/);
    expect(vars).toMatch(/variable "email_smtp_host"/);
    expect(vars).toMatch(/variable "email_smtp_port"/);
    expect(vars).toMatch(/default\s*=\s*587/);
    expect(source).toMatch(/smtp_enabled\s*=\s*var\.email_from_address != ""/);
    expect(source).toMatch(
      /smtp_host\s*=.*email-smtp\.\$\{data\.aws_region\.current\.name\}\.amazonaws\.com/,
    );
    expect(emailEnvironment).toMatch(/name\s*=\s*"EMAIL_DRIVER"/);
    expect(emailEnvironment).toMatch(/value\s*=\s*"SMTP"/);
    expect(emailEnvironment).toMatch(/EMAIL_FROM_ADDRESS/);
    expect(emailEnvironment).toMatch(/EMAIL_FROM_NAME/);
    expect(emailEnvironment).toMatch(/EMAIL_SMTP_HOST/);
    expect(emailEnvironment).toMatch(/EMAIL_SMTP_NO_TLS/);
    expect(emailEnvironment).toMatch(/EMAIL_SMTP_PORT/);
    expect(source).toMatch(/resource "aws_iam_user" "ses_smtp"/);
    expect(source).toMatch(/resource "aws_iam_access_key" "ses_smtp"/);
    expect(source).toMatch(/ses_smtp_password_v4/);
    expect(source).toMatch(/resource "aws_secretsmanager_secret" "ses_smtp"/);
    expect(source).toMatch(
      /name\s*=\s*"thinkwork\/\$\{var\.stage\}\/twenty\/ses-smtp"/,
    );
    expect(iamPolicy).toMatch(/ses:SendEmail/);
    expect(iamPolicy).toMatch(/ses:SendRawEmail/);
    expect(containerSecrets).toMatch(/EMAIL_SMTP_USER/);
    expect(containerSecrets).toMatch(/EMAIL_SMTP_PASSWORD/);
    expect(readme).toMatch(/ThinkWork-owned SES SMTP/);
    expect(readme).toMatch(/noreply@<ses_inbound_domain>/);
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
    expect(source).toMatch(/resource "aws_efs_access_point" "twenty"/);
    expect(source).toMatch(/path\s*=\s*"\/local-storage"/);
    expect(source).toMatch(/owner_uid\s*=\s*1000/);
    expect(source).toMatch(/resource "aws_efs_mount_target" "twenty"/);
    expect(source).toMatch(/transit_encryption\s*=\s*"ENABLED"/);
    expect(source).toMatch(
      /access_point_id\s*=\s*aws_efs_access_point\.twenty\.id/,
    );
    expect(source).toMatch(/iam\s*=\s*"ENABLED"/);
    expect(source).toMatch(/resource "aws_iam_role_policy" "ecs_task_efs"/);
    expect(source).toMatch(/elasticfilesystem:ClientMount/);
    expect(source).toMatch(/elasticfilesystem:ClientWrite/);
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

  it("exposes composite module inputs for provisioned and parked Twenty states", () => {
    const vars = read(THINKWORK_VARS);

    expect(vars).toMatch(/variable "twenty_provisioned"/);
    expect(vars).toMatch(/variable "twenty_runtime_enabled"/);
    expect(vars).toMatch(/variable "twenty_image_uri"/);
    expect(vars).toMatch(/twenty_image_uri must be empty or pinned/);
    expect(vars).toMatch(/variable "twenty_db_username"/);
    expect(vars).toMatch(/default\s*=\s*"thinkwork_twenty"/);
    expect(vars).toMatch(/variable "twenty_db_name"/);
    expect(vars).toMatch(
      /twenty_db_name must be a valid PostgreSQL identifier/,
    );
    expect(vars).toMatch(/variable "twenty_db_url_secret_arn"/);
    expect(vars).toMatch(/variable "twenty_encryption_key_secret_arn"/);
    expect(vars).toMatch(/variable "twenty_cache_engine"/);
    expect(vars).toMatch(/twenty_cache_engine must be valkey or redis/);
    expect(vars).toMatch(/variable "twenty_email_domain"/);
    expect(vars).toMatch(/variable "twenty_email_from_address"/);
    expect(vars).toMatch(/variable "twenty_email_from_name"/);
    expect(vars).toMatch(/variable "twenty_email_smtp_host"/);
  });

  it("wires the Twenty module behind retained provisioned state", () => {
    const source = read(THINKWORK_MAIN);
    const twentyModule = firstNestedBlock(source, 'module "twenty"');
    const guardrails = firstNestedBlock(
      source,
      'resource "terraform_data" "twenty_configuration_guardrails"',
    );
    const runtimeStateGuardrails = firstNestedBlock(
      source,
      'resource "terraform_data" "twenty_runtime_state_guardrails"',
    );

    expect(source).toMatch(/twenty_provisioned\s*=\s*var\.twenty_provisioned/);
    expect(source).toMatch(
      /twenty_runtime_enabled\s*=\s*var\.twenty_provisioned && var\.twenty_runtime_enabled/,
    );
    expect(source).toMatch(/twenty_domain.*crm\.\$\{var\.www_domain\}/);
    expect(source).toMatch(
      /twenty_email_domain\s*=\s*var\.twenty_email_domain != "" \? var\.twenty_email_domain : var\.ses_inbound_domain/,
    );
    expect(source).toMatch(/noreply@\$\{local\.twenty_email_domain\}/);
    expect(twentyModule).toMatch(
      /count\s*=\s*local\.twenty_provisioned \? 1 : 0/,
    );
    expect(twentyModule).toMatch(
      /source\s*=\s*"\.\.\/\.\.\/\.\.\/plugins\/twenty\/terraform\/twenty"/,
    );
    expect(twentyModule).toMatch(
      /subnet_ids\s*=\s*module\.vpc\.public_subnet_ids/,
    );
    expect(twentyModule).toMatch(
      /cache_subnet_ids\s*=\s*module\.vpc\.private_subnet_ids/,
    );
    expect(twentyModule).toMatch(
      /storage_subnet_ids\s*=\s*module\.vpc\.private_subnet_ids/,
    );
    expect(twentyModule).toMatch(
      /runtime_enabled\s*=\s*local\.twenty_runtime_enabled/,
    );
    expect(twentyModule).toMatch(
      /db_url_secret_arn\s*=\s*var\.twenty_db_url_secret_arn/,
    );
    expect(twentyModule).toMatch(
      /encryption_key_secret_arn\s*=\s*var\.twenty_encryption_key_secret_arn/,
    );
    expect(twentyModule).toMatch(
      /email_from_address\s*=\s*local\.twenty_email_from_address/,
    );
    expect(twentyModule).toMatch(
      /email_from_name\s*=\s*var\.twenty_email_from_name/,
    );
    expect(twentyModule).toMatch(
      /email_smtp_host\s*=\s*var\.twenty_email_smtp_host/,
    );
    expect(guardrails).toMatch(/twenty_provisioned requires twenty_image_uri/);
    expect(guardrails).toMatch(
      /twenty_provisioned requires twenty_db_url_secret_arn/,
    );
    expect(guardrails).toMatch(
      /twenty_provisioned requires twenty_encryption_key_secret_arn/,
    );
    expect(guardrails).toMatch(
      /twenty_runtime_enabled requires twenty_provisioned/,
    );
    expect(guardrails).toMatch(/twenty_db_name must be distinct/);
    expect(runtimeStateGuardrails).toMatch(
      /var\.twenty_runtime_enabled && !var\.twenty_provisioned \? 1 : 0/,
    );
    expect(runtimeStateGuardrails).toMatch(
      /twenty_runtime_enabled requires twenty_provisioned/,
    );
  });

  it("no longer injects Twenty deployment status into graphql-http config (DB-served — plan 2026-06-12-001 U10)", () => {
    const handlers = read(LAMBDA_API_HANDLERS);

    // Twenty status is read from managed_applications + deployment jobs in
    // Aurora; the TWENTY config key and its env/SSM projection are retired.
    expect(handlers).not.toMatch(/twenty_env/);
    expect(handlers).not.toMatch(/TWENTY\s*=/);
    expect(handlers).not.toMatch(/TWENTY_URL\s*=/);
    // Cognee's compact status projection is intentionally unchanged.
    expect(handlers).toMatch(/cognee_env = var\.cognee_enabled \? {/);
    expect(handlers).toMatch(/local\.cognee_env,\s*\)/);
    const runtimeConfig = read(
      resolve(REPO_ROOT, "terraform/modules/app/lambda-api/runtime-config.tf"),
    );
    expect(runtimeConfig).toMatch(/local\.graphql_http_config_env/);
  });

  it("adds crm.<domain> DNS support without rotating the shared site certificate", () => {
    const source = read(WWW_DNS_MAIN);
    const vars = read(WWW_DNS_VARS);
    const outputs = read(WWW_DNS_OUTPUTS);
    const crmRecord = firstNestedBlock(
      source,
      'resource "cloudflare_record" "crm"',
    );

    expect(vars).toMatch(/variable "include_crm"/);
    expect(vars).toMatch(/variable "crm_alb_dns_name"/);
    expect(source).toMatch(/crm\s*=\s*"crm\.\$\{var\.domain\}"/);
    expect(source).not.toMatch(/var\.include_crm \? \[local\.crm\] : \[\]/);
    expect(source).toMatch(/create_crm_record\s*=\s*var\.include_crm/);
    expect(crmRecord).toMatch(/name\s*=\s*local\.crm/);
    expect(crmRecord).toMatch(/content\s*=\s*var\.crm_alb_dns_name/);
    expect(crmRecord).toMatch(/proxied\s*=\s*false/);
    expect(outputs).toMatch(/output "crm_custom_domain_name"/);
  });

  it("keeps greenfield Twenty variables, module wiring, DNS, and outputs aligned", () => {
    const source = read(GREENFIELD_MAIN);
    const tfvars = read(GREENFIELD_TFVARS_EXAMPLE);
    const thinkworkModule = firstNestedBlock(source, 'module "thinkwork"');
    const wwwDnsModule = firstNestedBlock(source, 'module "www_dns"');

    expect(source).toMatch(/variable "twenty_provisioned"/);
    expect(source).toMatch(/variable "twenty_runtime_enabled"/);
    expect(source).toMatch(
      /crm_domain\s*=\s*var\.www_domain != "" \? "crm\.\$\{var\.www_domain\}"/,
    );
    expect(source).toMatch(/twenty_managed_certificate_enabled/);
    expect(source).toMatch(/resource "aws_acm_certificate" "twenty"/);
    expect(source).toMatch(
      /resource "cloudflare_record" "twenty_acm_validation"/,
    );
    expect(source).toMatch(
      /resource "aws_acm_certificate_validation" "twenty"/,
    );
    expect(source).toMatch(
      /from\s*=\s*module\.www_dns\[0\]\.cloudflare_record\.acm_validation\["crm\.thinkwork\.ai"\]/,
    );
    expect(source).toMatch(
      /to\s*=\s*cloudflare_record\.twenty_acm_validation\["crm\.thinkwork\.ai"\]/,
    );
    expect(thinkworkModule).toMatch(
      /twenty_provisioned\s*=\s*var\.twenty_provisioned/,
    );
    expect(thinkworkModule).toMatch(
      /twenty_runtime_enabled\s*=\s*var\.twenty_runtime_enabled/,
    );
    expect(thinkworkModule).toMatch(
      /twenty_email_from_address\s*=\s*var\.twenty_email_from_address/,
    );
    expect(thinkworkModule).toMatch(
      /twenty_email_from_name\s*=\s*var\.twenty_email_from_name/,
    );
    expect(thinkworkModule).toMatch(
      /twenty_public_url\s*=\s*local\.twenty_url/,
    );
    expect(thinkworkModule).toMatch(
      /twenty_certificate_arn\s*=\s*var\.twenty_certificate_arn != "" \? var\.twenty_certificate_arn : \(local\.twenty_managed_certificate_enabled \? aws_acm_certificate_validation\.twenty\[0\]\.certificate_arn : ""\)/,
    );
    expect(wwwDnsModule).toMatch(/include_crm\s*=\s*var\.twenty_provisioned/);
    expect(wwwDnsModule).toMatch(
      /crm_alb_dns_name\s*=\s*module\.thinkwork\.twenty_alb_dns_name/,
    );
    expect(source).toMatch(/output "twenty_provisioned"/);
    expect(source).toMatch(/output "twenty_url"/);
    expect(source).toMatch(/output "twenty_cluster_arn"/);
    expect(source).toMatch(/output "twenty_server_service_name"/);
    expect(source).toMatch(/output "twenty_worker_service_name"/);
    expect(tfvars).toMatch(/twenty_provisioned\s*=\s*false/);
    expect(tfvars).toMatch(/twenty_runtime_enabled\s*=\s*false/);
    expect(tfvars).toMatch(/empty derives https:\/\/crm\.<www_domain>/);
    expect(tfvars).toMatch(/empty derives noreply@ses_inbound_domain/);
  });

  it("generates init tfvars and wrapper HCL with Twenty disabled by default", () => {
    const source = read(INIT_COMMAND);

    expect(source).toMatch(/twenty_provisioned\s+= false/);
    expect(source).toMatch(/twenty_runtime_enabled = false/);
    expect(source).toMatch(/variable "twenty_provisioned"/);
    expect(source).toMatch(/variable "twenty_runtime_enabled"/);
    expect(source).toMatch(/variable "twenty_image_uri"/);
    expect(source).toMatch(/variable "twenty_db_url_secret_arn"/);
    expect(source).toMatch(/variable "twenty_encryption_key_secret_arn"/);
    expect(source).toMatch(/variable "twenty_email_from_address"/);
    expect(source).toMatch(/variable "twenty_email_from_name"/);
    expect(source).toMatch(/twenty_provisioned = var\.twenty_provisioned/);
    expect(source).toMatch(
      /twenty_runtime_enabled = var\.twenty_runtime_enabled/,
    );
    expect(source).toMatch(/twenty_db_name = var\.twenty_db_name/);
    expect(source).toMatch(
      /twenty_email_from_address = var\.twenty_email_from_address/,
    );
    expect(source).toMatch(
      /twenty_email_from_name = var\.twenty_email_from_name/,
    );
    expect(source).toMatch(/output "twenty_provisioned"/);
    expect(source).toMatch(/output "twenty_url"/);
  });

  it("exposes safe Twenty defaults in the enterprise deploy template", () => {
    const source = read(ENTERPRISE_TEMPLATE_MAIN);
    const thinkworkModule = firstNestedBlock(source, 'module "thinkwork"');

    expect(source).toMatch(/variable "twenty_provisioned"/);
    expect(source).toMatch(/default\s*=\s*false/);
    expect(source).toMatch(/variable "twenty_runtime_enabled"/);
    expect(source).toMatch(/variable "twenty_image_uri"/);
    expect(source).toMatch(/variable "twenty_db_name"/);
    expect(source).toMatch(/variable "twenty_db_url_secret_arn"/);
    expect(source).toMatch(/variable "twenty_encryption_key_secret_arn"/);
    expect(source).toMatch(/variable "twenty_email_from_address"/);
    expect(source).toMatch(/variable "twenty_email_from_name"/);
    expect(thinkworkModule).toMatch(
      /twenty_provisioned\s*=\s*var\.twenty_provisioned/,
    );
    expect(thinkworkModule).toMatch(
      /twenty_runtime_enabled\s*=\s*var\.twenty_runtime_enabled/,
    );
    expect(thinkworkModule).toMatch(
      /twenty_db_url_secret_arn\s*=\s*var\.twenty_db_url_secret_arn/,
    );
    expect(thinkworkModule).toMatch(
      /twenty_email_from_address\s*=\s*var\.twenty_email_from_address/,
    );
    expect(thinkworkModule).toMatch(
      /twenty_email_from_name\s*=\s*var\.twenty_email_from_name/,
    );
    expect(source).toMatch(/output "twenty_provisioned"/);
    expect(source).toMatch(/output "twenty_url"/);
  });

  it("keeps CI Terraform runs disabled by default but aligned with Twenty inputs", () => {
    for (const workflow of [read(DEPLOY_WORKFLOW), read(VERIFY_WORKFLOW)]) {
      expect(workflow).toMatch(/TWENTY_PROVISIONED_INPUT/);
      expect(workflow).toMatch(/vars\.TWENTY_PROVISIONED \|\| 'false'/);
      expect(workflow).toMatch(/TWENTY_RUNTIME_ENABLED_INPUT/);
      expect(workflow).toMatch(/vars\.TWENTY_RUNTIME_ENABLED \|\| 'false'/);
      expect(workflow).toMatch(/TWENTY_DESTROY_DATA_INPUT/);
      expect(workflow).toMatch(/vars\.TWENTY_DESTROY_DATA \|\| 'false'/);
      expect(workflow).toMatch(
        /TWENTY_DESTROY_DATA=true requires TWENTY_PROVISIONED=false and TWENTY_RUNTIME_ENABLED=false/,
      );
      expect(workflow).toMatch(/TWENTY_IMAGE_URI_INPUT/);
      expect(workflow).toMatch(/TWENTY_DB_USERNAME_INPUT/);
      expect(workflow).toMatch(/TWENTY_DB_NAME_INPUT/);
      expect(workflow).toMatch(/thinkwork\/\$\{STAGE\}\/twenty\/db-url/);
      expect(workflow).toMatch(
        /thinkwork\/\$\{STAGE\}\/twenty\/encryption-key/,
      );
      expect(workflow).toMatch(/-var "twenty_provisioned=\$/);
      expect(workflow).toMatch(/-var "twenty_runtime_enabled=\$/);
      expect(workflow).toMatch(/-var "twenty_image_uri=\$/);
      expect(workflow).toMatch(/-var "twenty_db_username=\$/);
      expect(workflow).toMatch(/-var "twenty_db_name=\$/);
      expect(workflow).toMatch(/-var "twenty_db_url_secret_arn=\$/);
      expect(workflow).toMatch(/-var "twenty_encryption_key_secret_arn=\$/);
    }
  });

  it("prepares Twenty runtime secrets and database before Terraform apply when provisioned", () => {
    const workflow = read(DEPLOY_WORKFLOW);

    expect(workflow).toMatch(/Prepare Twenty CRM runtime secrets and database/);
    expect(workflow).toMatch(
      /if \[ "\$\{TWENTY_PROVISIONED:-false\}" != "true" \]/,
    );
    expect(workflow).toMatch(/Twenty CRM not provisioned; skipping Twenty/);
    expect(workflow).toMatch(/openssl rand -hex 32/);
    expect(workflow).toMatch(/PG_DATABASE_URL/);
    expect(workflow).toMatch(
      /twenty_database_url="postgresql:\/\/\$\{TWENTY_DB_USERNAME\}:\$\{twenty_password\}@\$\{DB_ENDPOINT\}:5432\/\$\{TWENTY_DB_NAME\}\?sslmode=require"/,
    );
    expect(workflow).toMatch(/ENCRYPTION_KEY/);
    expect(workflow).toMatch(/aws secretsmanager create-secret/);
    expect(workflow).toMatch(/aws secretsmanager put-secret-value/);
    expect(workflow).toMatch(/retrying by stable secret name/);
    expect(workflow).toMatch(/TWENTY_DB_URL_SECRET_ARN=\$db_secret_arn/);
    expect(workflow).toMatch(
      /TWENTY_ENCRYPTION_KEY_SECRET_ARN=\$encryption_secret_arn/,
    );
    expect(workflow).toMatch(/CREATE ROLE %I LOGIN PASSWORD %L/);
    expect(workflow).toMatch(/ALTER ROLE %I LOGIN PASSWORD %L/);
    expect(workflow).toMatch(/CREATE DATABASE %I/);
    expect(workflow).not.toMatch(/CREATE DATABASE %I OWNER %I/);
    expect(workflow).toMatch(/GRANT %I TO %I/);
    expect(workflow).toMatch(/ALTER DATABASE %I OWNER TO %I/);
    expect(workflow).toMatch(
      /GRANT CONNECT, CREATE ON DATABASE :\"twenty_db\"/,
    );
    expect(workflow).toMatch(/\\connect :\"twenty_db\"/);
    expect(workflow).toMatch(/SET ROLE :\"twenty_user\"/);
    expect(workflow).toMatch(/DROP SCHEMA core CASCADE/);
    expect(workflow).not.toMatch(/CREATE SCHEMA IF NOT EXISTS core/);
    expect(workflow).toMatch(/ALTER SCHEMA public OWNER TO/);
    expect(workflow).toMatch(/CREATE EXTENSION IF NOT EXISTS "uuid-ossp"/);
    expect(workflow).toMatch(/CREATE EXTENSION IF NOT EXISTS "unaccent"/);
    expect(workflow).toMatch(/RESET ROLE/);
    expect(workflow).toMatch(/GRANT USAGE, CREATE ON SCHEMA public/);
    expect(workflow).not.toMatch(/GRANT USAGE, CREATE ON SCHEMA core/);
    expect(workflow).toMatch(/Restart Twenty CRM runtime after database prep/);
    expect(workflow).toMatch(/aws ecs update-service/);
    expect(workflow).toMatch(/--force-new-deployment/);
    expect(workflow).toMatch(/aws ecs wait services-stable/);
  });

  it("destroys Twenty retained database and secrets only after Terraform teardown is requested", () => {
    const workflow = read(DEPLOY_WORKFLOW);

    expect(workflow).toMatch(/Destroy Twenty CRM retained data/);
    expect(workflow).toMatch(
      /if \[ "\$\{TWENTY_DESTROY_DATA:-false\}" != "true" \]/,
    );
    expect(workflow).toMatch(/Refusing destructive cleanup while Twenty CRM/);
    expect(workflow).toMatch(/DROP DATABASE IF EXISTS %I/);
    expect(workflow).toMatch(/DROP ROLE IF EXISTS %I/);
    expect(workflow).toMatch(/aws secretsmanager delete-secret/);
    expect(workflow).toMatch(/--force-delete-without-recovery/);
  });

  it("keeps verify read-only and fails enabled Twenty plans without deploy-prepared secrets", () => {
    const workflow = read(VERIFY_WORKFLOW);

    expect(workflow).not.toMatch(/Prepare Twenty CRM runtime secrets/);
    expect(workflow).not.toMatch(/aws secretsmanager create-secret/);
    expect(workflow).toMatch(
      /TWENTY_PROVISIONED=true but the Twenty DB URL secret does not exist yet/,
    );
    expect(workflow).toMatch(
      /TWENTY_PROVISIONED=true but the Twenty encryption key secret does not exist yet/,
    );
    expect(workflow).toMatch(/Run the deploy workflow once to create it/);
  });
});

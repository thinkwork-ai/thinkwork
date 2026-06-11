/**
 * Structural fixture tests for Kestra managed-app Terraform composition.
 *
 * The standalone app module has terraform tests; these assertions keep the
 * composite module, generated roots, DNS, and compact GraphQL status wiring
 * aligned without requiring AWS credentials in CI.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

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
const LAMBDA_API_VARS = resolve(
  REPO_ROOT,
  "terraform/modules/app/lambda-api/variables.tf",
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

describe("Kestra Terraform managed app composition", () => {
  it("exposes composite inputs for retained and parked Kestra states", () => {
    const vars = read(THINKWORK_VARS);

    expect(vars).toMatch(/variable "kestra_provisioned"/);
    expect(vars).toMatch(/variable "kestra_runtime_enabled"/);
    expect(vars).toMatch(/variable "kestra_image_uri"/);
    expect(vars).toMatch(/kestra_image_uri must be empty or pinned/);
    expect(vars).toMatch(/variable "kestra_db_username"/);
    expect(vars).toMatch(/default\s*=\s*"thinkwork_kestra"/);
    expect(vars).toMatch(/variable "kestra_db_name"/);
    expect(vars).toMatch(
      /kestra_db_name must be a valid PostgreSQL identifier/,
    );
    expect(vars).toMatch(/variable "kestra_db_password_secret_arn"/);
    expect(vars).toMatch(/variable "kestra_basic_auth_secret_arn"/);
    expect(vars).toMatch(/variable "kestra_storage_force_destroy"/);
    expect(vars).toMatch(/variable "kestra_allowed_public_cidr_blocks"/);
  });

  it("wires the Kestra module behind retained provisioned state", () => {
    const source = read(THINKWORK_MAIN);
    const kestraModule = firstNestedBlock(source, 'module "kestra"');
    const guardrails = firstNestedBlock(
      source,
      'resource "terraform_data" "kestra_configuration_guardrails"',
    );
    const runtimeStateGuardrails = firstNestedBlock(
      source,
      'resource "terraform_data" "kestra_runtime_state_guardrails"',
    );

    expect(source).toMatch(/kestra_provisioned\s*=\s*var\.kestra_provisioned/);
    expect(source).toMatch(
      /kestra_runtime_enabled\s*=\s*var\.kestra_provisioned && var\.kestra_runtime_enabled/,
    );
    expect(source).toMatch(/kestra_domain.*orchestrate\.\$\{var\.www_domain\}/);
    expect(kestraModule).toMatch(
      /count\s*=\s*local\.kestra_provisioned \? 1 : 0/,
    );
    expect(kestraModule).toMatch(/source\s*=\s*"\.\.\/app\/kestra"/);
    expect(kestraModule).toMatch(
      /subnet_ids\s*=\s*module\.vpc\.public_subnet_ids/,
    );
    expect(kestraModule).toMatch(
      /runtime_enabled\s*=\s*local\.kestra_runtime_enabled/,
    );
    expect(kestraModule).toMatch(
      /db_password_secret_arn\s*=\s*var\.kestra_db_password_secret_arn/,
    );
    expect(kestraModule).toMatch(
      /basic_auth_secret_arn\s*=\s*var\.kestra_basic_auth_secret_arn/,
    );
    expect(kestraModule).toMatch(
      /storage_force_destroy\s*=\s*var\.kestra_storage_force_destroy/,
    );
    expect(guardrails).toMatch(/kestra_provisioned requires kestra_image_uri/);
    expect(guardrails).toMatch(
      /kestra_provisioned requires kestra_db_password_secret_arn/,
    );
    expect(guardrails).toMatch(
      /kestra_provisioned requires kestra_basic_auth_secret_arn/,
    );
    expect(guardrails).toMatch(
      /kestra_runtime_enabled requires kestra_provisioned/,
    );
    expect(guardrails).toMatch(/kestra_db_name must be distinct/);
    expect(runtimeStateGuardrails).toMatch(
      /var\.kestra_runtime_enabled && !var\.kestra_provisioned \? 1 : 0/,
    );
  });

  it("passes compact Kestra deployment status into GraphQL and control MCP env", () => {
    const handlers = read(LAMBDA_API_HANDLERS);
    const vars = read(LAMBDA_API_VARS);

    expect(vars).toMatch(/variable "kestra_provisioned"/);
    expect(vars).toMatch(/variable "kestra_runtime_enabled"/);
    expect(vars).toMatch(/variable "kestra_url"/);
    expect(vars).toMatch(/variable "kestra_basic_auth_secret_arn"/);
    expect(handlers).toMatch(/kestra_env = var\.kestra_provisioned \? {/);
    expect(handlers).toMatch(/KESTRA = "\$\{var\.kestra_provisioned/);
    expect(handlers).toMatch(
      /KESTRA = "\$\{var\.kestra_provisioned \? "1" : "0"\}\|\$\{var\.kestra_runtime_enabled \? "1" : "0"\}"/,
    );
    expect(handlers).not.toMatch(
      /KESTRA = ".*var\.kestra_storage_bucket_name/s,
    );
    expect(handlers).not.toMatch(
      /KESTRA = ".*var\.kestra_basic_auth_secret_arn/s,
    );
    expect(handlers).toMatch(/local\.cognee_env,\s*\)/);
    expect(handlers).toMatch(/}, local\.twenty_env, local\.kestra_env\)/);
    expect(handlers).toMatch(/"kestra-control-mcp"\s*=\s*local\.kestra_env/);
  });

  it("adds orchestrate.<domain> DNS support without rotating the shared site certificate", () => {
    const source = read(WWW_DNS_MAIN);
    const vars = read(WWW_DNS_VARS);
    const outputs = read(WWW_DNS_OUTPUTS);
    const kestraRecord = firstNestedBlock(
      source,
      'resource "cloudflare_record" "kestra"',
    );

    expect(vars).toMatch(/variable "include_kestra"/);
    expect(vars).toMatch(/variable "kestra_domain"/);
    expect(vars).toMatch(/variable "kestra_alb_dns_name"/);
    expect(source).toMatch(/orchestrate\.\$\{var\.domain\}/);
    expect(source).not.toMatch(
      /var\.include_kestra \? \[local\.kestra\] : \[\]/,
    );
    expect(source).toMatch(/create_kestra_record\s*=\s*var\.include_kestra/);
    expect(kestraRecord).toMatch(/name\s*=\s*local\.kestra/);
    expect(kestraRecord).toMatch(/content\s*=\s*var\.kestra_alb_dns_name/);
    expect(kestraRecord).toMatch(/proxied\s*=\s*false/);
    expect(outputs).toMatch(/output "kestra_custom_domain_name"/);
  });

  it("keeps greenfield Kestra variables, module wiring, DNS, and outputs aligned", () => {
    const source = read(GREENFIELD_MAIN);
    const tfvars = read(GREENFIELD_TFVARS_EXAMPLE);
    const thinkworkModule = firstNestedBlock(source, 'module "thinkwork"');
    const wwwDnsModule = firstNestedBlock(source, 'module "www_dns"');

    expect(source).toMatch(/variable "kestra_provisioned"/);
    expect(source).toMatch(/variable "kestra_runtime_enabled"/);
    expect(source).toMatch(
      /kestra_domain\s*=\s*var\.www_domain != "" \? "orchestrate\.\$\{var\.www_domain\}"/,
    );
    expect(source).toMatch(/kestra_managed_certificate_enabled/);
    expect(source).toMatch(/resource "aws_acm_certificate" "kestra"/);
    expect(source).toMatch(
      /resource "cloudflare_record" "kestra_acm_validation"/,
    );
    expect(source).toMatch(
      /resource "aws_acm_certificate_validation" "kestra"/,
    );
    expect(thinkworkModule).toMatch(
      /kestra_provisioned\s*=\s*var\.kestra_provisioned/,
    );
    expect(thinkworkModule).toMatch(
      /kestra_runtime_enabled\s*=\s*var\.kestra_runtime_enabled/,
    );
    expect(thinkworkModule).toMatch(
      /kestra_public_url\s*=\s*local\.kestra_url/,
    );
    expect(thinkworkModule).toMatch(
      /kestra_certificate_arn\s*=\s*var\.kestra_certificate_arn != "" \? var\.kestra_certificate_arn : \(local\.kestra_managed_certificate_enabled \? aws_acm_certificate_validation\.kestra\[0\]\.certificate_arn : ""\)/,
    );
    expect(wwwDnsModule).toMatch(
      /include_kestra\s*=\s*var\.kestra_provisioned/,
    );
    expect(wwwDnsModule).toMatch(
      /kestra_alb_dns_name\s*=\s*module\.thinkwork\.kestra_alb_dns_name/,
    );
    expect(source).toMatch(/output "kestra_provisioned"/);
    expect(source).toMatch(/output "kestra_url"/);
    expect(source).toMatch(/output "kestra_cluster_arn"/);
    expect(source).toMatch(/output "kestra_service_name"/);
    expect(source).toMatch(/output "kestra_storage_bucket_name"/);
    expect(tfvars).toMatch(/kestra_provisioned\s*=\s*false/);
    expect(tfvars).toMatch(/kestra_runtime_enabled\s*=\s*false/);
    expect(tfvars).toMatch(/empty derives https:\/\/orchestrate\.<www_domain>/);
    expect(tfvars).toMatch(/kestra_storage_force_destroy\s*=\s*false/);
  });

  it("generates init tfvars and wrapper HCL with Kestra disabled by default", () => {
    const source = read(INIT_COMMAND);

    expect(source).toMatch(/kestra_provisioned\s+= false/);
    expect(source).toMatch(/kestra_runtime_enabled = false/);
    expect(source).toMatch(/variable "kestra_provisioned"/);
    expect(source).toMatch(/variable "kestra_runtime_enabled"/);
    expect(source).toMatch(/variable "kestra_image_uri"/);
    expect(source).toMatch(/variable "kestra_db_password_secret_arn"/);
    expect(source).toMatch(/variable "kestra_basic_auth_secret_arn"/);
    expect(source).toMatch(/variable "kestra_storage_force_destroy"/);
    expect(source).toMatch(/kestra_provisioned = var\.kestra_provisioned/);
    expect(source).toMatch(
      /kestra_runtime_enabled = var\.kestra_runtime_enabled/,
    );
    expect(source).toMatch(/kestra_db_name = var\.kestra_db_name/);
    expect(source).toMatch(
      /kestra_basic_auth_secret_arn = var\.kestra_basic_auth_secret_arn/,
    );
    expect(source).toMatch(/output "kestra_provisioned"/);
    expect(source).toMatch(/output "kestra_url"/);
    expect(source).toMatch(/output "kestra_storage_bucket_name"/);
  });

  it("exposes safe Kestra defaults in the enterprise deploy template", () => {
    const source = read(ENTERPRISE_TEMPLATE_MAIN);
    const thinkworkModule = firstNestedBlock(source, 'module "thinkwork"');

    expect(source).toMatch(/variable "kestra_provisioned"/);
    expect(source).toMatch(/default\s*=\s*false/);
    expect(source).toMatch(/variable "kestra_runtime_enabled"/);
    expect(source).toMatch(/variable "kestra_image_uri"/);
    expect(source).toMatch(/variable "kestra_db_name"/);
    expect(source).toMatch(/variable "kestra_db_password_secret_arn"/);
    expect(source).toMatch(/variable "kestra_basic_auth_secret_arn"/);
    expect(source).toMatch(/variable "kestra_storage_force_destroy"/);
    expect(thinkworkModule).toMatch(
      /kestra_provisioned\s*=\s*var\.kestra_provisioned/,
    );
    expect(thinkworkModule).toMatch(
      /kestra_runtime_enabled\s*=\s*var\.kestra_runtime_enabled/,
    );
    expect(thinkworkModule).toMatch(
      /kestra_db_password_secret_arn\s*=\s*var\.kestra_db_password_secret_arn/,
    );
    expect(thinkworkModule).toMatch(
      /kestra_basic_auth_secret_arn\s*=\s*var\.kestra_basic_auth_secret_arn/,
    );
    expect(source).toMatch(/output "kestra_provisioned"/);
    expect(source).toMatch(/output "kestra_url"/);
    expect(source).toMatch(/output "kestra_storage_bucket_name"/);
  });

  it("exports Kestra operational details for deployment status", () => {
    const outputs = read(THINKWORK_OUTPUTS);

    expect(outputs).toMatch(/output "kestra_url"/);
    expect(outputs).toMatch(/output "kestra_alb_dns_name"/);
    expect(outputs).toMatch(/output "kestra_cluster_arn"/);
    expect(outputs).toMatch(/output "kestra_service_name"/);
    expect(outputs).toMatch(/output "kestra_log_group_name"/);
    expect(outputs).toMatch(/output "kestra_storage_bucket_name"/);
    expect(outputs).toMatch(/output "kestra_database_name"/);
    expect(outputs).toMatch(/output "kestra_basic_auth_secret_arn"/);
    expect(outputs).toMatch(/output "kestra_runtime_enabled"/);
  });

  it("prepares Kestra basic-auth secrets that satisfy runtime password rules", () => {
    const workflow = read(DEPLOY_WORKFLOW);

    expect(workflow).toMatch(/Prepare Kestra runtime secrets and database/);
    expect(workflow).toMatch(/printf 'K3stra-%s'/);
    expect(workflow).toMatch(/kestra_basic_auth_password_valid\(\)/);
    expect(workflow).toMatch(/\[\s*"\$\{#password\}"\s*-ge\s*8\s*\]/);
    expect(workflow).toMatch(/\[\[ "\$password" =~ \[A-Z\] \]\]/);
    expect(workflow).toMatch(/\[\[ "\$password" =~ \[a-z\] \]\]/);
    expect(workflow).toMatch(/\[\[ "\$password" =~ \[0-9\] \]\]/);
    expect(workflow).toMatch(
      /! kestra_basic_auth_password_valid "\$kestra_basic_auth_password"/,
    );
  });
});

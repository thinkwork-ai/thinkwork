import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Fixture assertions for U5/U9 wiring in the init-scaffolded main.tf template.
 * TEI's invite-email failure came from domain/SES vars dropped at TWO wiring
 * points (tfvars AND the module block) — these assert the template threads
 * every var through the module block and passes the required provider alias.
 */
describe("init-generated main.tf template wiring", () => {
  const initSource = readFileSync(
    join(__dirname, "..", "src", "commands", "init.ts"),
    "utf8",
  );

  it("declares the us_east_1 provider alias the module requires", () => {
    expect(initSource).toContain('alias  = "us_east_1"');
    expect(initSource).toContain("aws.us_east_1 = aws.us_east_1");
  });

  it("threads domain, SES, operator-email, and memory vars through the module block", () => {
    for (const wiring of [
      "customer_domain           = var.customer_domain",
      "customer_domain_delegated = var.customer_domain_delegated",
      "platform_operator_emails  = var.platform_operator_emails",
      "ses_parent_domain         = var.ses_parent_domain",
      "cognito_email_source_arn  = var.cognito_email_source_arn",
      "memory_engine             = var.memory_engine",
    ]) {
      expect(initSource).toContain(wiring);
    }
  });

  it("threads release-artifact vars so placeholder mode is avoidable (U9)", () => {
    for (const wiring of [
      "lambda_artifact_bucket        = var.lambda_artifact_bucket",
      "lambda_artifact_prefix        = var.lambda_artifact_prefix",
      "agentcore_pi_source_image_uri = var.agentcore_pi_source_image_uri",
    ]) {
      expect(initSource).toContain(wiring);
    }
  });

  it("exposes the app bucket output the web-asset publish step reads", () => {
    expect(initSource).toContain('output "app_bucket_name"');
  });

  it("module variables referenced by the template are declared in it", () => {
    for (const decl of [
      'variable "customer_domain"',
      'variable "customer_domain_delegated"',
      'variable "platform_operator_emails"',
      'variable "ses_parent_domain"',
      'variable "cognito_email_source_arn"',
      'variable "memory_engine"',
      'variable "lambda_artifact_bucket"',
      'variable "lambda_artifact_prefix"',
      'variable "agentcore_pi_source_image_uri"',
    ]) {
      expect(initSource).toContain(decl);
    }
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "../../..");

function read(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), "utf8");
}

describe("tenant model catalog Terraform fixture", () => {
  it("grants graphql-http read access to Bedrock model metadata and AWS Price List APIs", () => {
    const source = read("terraform/modules/app/lambda-api/main.tf");

    expect(source).toMatch(
      /resource "aws_iam_policy" "lambda_model_catalog_import_read"/,
    );
    expect(source).toMatch(
      /resource "aws_iam_role_policy_attachment" "lambda_model_catalog_import_read"/,
    );
    expect(source).toMatch(/bedrock:ListFoundationModels/);
    expect(source).toMatch(/pricing:DescribeServices/);
    expect(source).toMatch(/pricing:GetAttributeValues/);
    expect(source).toMatch(/pricing:GetProducts/);
  });

  it("bundles the AWS Pricing client into graphql-http instead of externalizing it", () => {
    const script = read("scripts/build-lambdas.sh");
    const bundledBlock = script.match(
      /BUNDLED_AGENTCORE_ESBUILD_FLAGS=\([\s\S]*?\n\)/,
    )?.[0];

    expect(bundledBlock).toBeTruthy();
    expect(script).toMatch(/\[ "\$name" = "graphql-http" \]/);
    expect(read("packages/api/package.json")).toMatch(
      /"@aws-sdk\/client-pricing"/,
    );
    expect(bundledBlock).not.toContain("@aws-sdk/client-pricing");
  });
});

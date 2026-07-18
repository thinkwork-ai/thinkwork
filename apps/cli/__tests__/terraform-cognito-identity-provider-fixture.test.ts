import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

function read(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), "utf8");
}

describe("Cognito identity provider Terraform fixture", () => {
  it("documents the current shared-provider and shared-auth-flow client posture", () => {
    const main = read("terraform/modules/foundation/cognito/main.tf");

    expect(
      main.match(
        /supported_identity_providers\s*=\s*local\.identity_providers/g,
      ),
    ).toHaveLength(2);
    expect(main).toMatch(/\["COGNITO"\]/);
    expect(main).toMatch(/aws_cognito_identity_provider\.google/);
    expect(main).toMatch(/keys\(local\.oidc_identity_providers\)/);
    expect(main).toMatch(/keys\(local\.saml_identity_providers\)/);
    expect(main).toMatch(/"ALLOW_CUSTOM_AUTH"/);
    expect(main).toMatch(/"ALLOW_USER_PASSWORD_AUTH"/);
    expect(main).toMatch(/"ALLOW_USER_SRP_AUTH"/);
    expect(main).toMatch(/"ALLOW_REFRESH_TOKEN_AUTH"/);
  });

  it("declares OIDC and SAML providers in the foundation Cognito module", () => {
    const vars = read("terraform/modules/foundation/cognito/variables.tf");
    const main = read("terraform/modules/foundation/cognito/main.tf");
    const outputs = read("terraform/modules/foundation/cognito/outputs.tf");

    expect(vars).toMatch(/variable "oidc_identity_providers"/);
    expect(vars).toMatch(/variable "saml_identity_providers"/);
    expect(main).toMatch(/resource "aws_cognito_identity_provider" "oidc"/);
    expect(main).toMatch(/provider_type\s*=\s*"OIDC"/);
    expect(main).toMatch(/resource "aws_cognito_identity_provider" "saml"/);
    expect(main).toMatch(/provider_type\s*=\s*"SAML"/);
    expect(main).toMatch(/MetadataURL/);
    expect(main).toMatch(
      /supported_identity_providers = local.identity_providers/,
    );
    expect(outputs).toMatch(/output "identity_provider_names"/);
  });

  it("passes identity provider variables through the composite module", () => {
    const vars = read("terraform/modules/thinkwork/variables.tf");
    const main = read("terraform/modules/thinkwork/main.tf");
    const outputs = read("terraform/modules/thinkwork/outputs.tf");

    expect(vars).toMatch(/variable "oidc_identity_providers"/);
    expect(vars).toMatch(/variable "saml_identity_providers"/);
    expect(main).toMatch(
      /oidc_identity_providers\s*=\s*var\.oidc_identity_providers/,
    );
    expect(main).toMatch(
      /saml_identity_providers\s*=\s*var\.saml_identity_providers/,
    );
    expect(outputs).toMatch(/output "identity_provider_names"/);
  });
});

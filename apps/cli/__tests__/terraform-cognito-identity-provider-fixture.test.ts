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

    // web-family, mobile-family, and the optional console client (U13)
    expect(
      main.match(
        /supported_identity_providers\s*=\s*local\.identity_providers/g,
      ),
    ).toHaveLength(3);
    expect(main).toMatch(/\["COGNITO"\]/);
    expect(main).toMatch(/aws_cognito_identity_provider\.google/);
    expect(main).toMatch(/keys\(local\.oidc_identity_providers\)/);
    expect(main).toMatch(/keys\(local\.saml_identity_providers\)/);
    expect(main).toMatch(/"ALLOW_CUSTOM_AUTH"/);
    expect(main).toMatch(/"ALLOW_USER_PASSWORD_AUTH"/);
    expect(main).toMatch(/"ALLOW_USER_SRP_AUTH"/);
    expect(main).toMatch(/"ALLOW_REFRESH_TOKEN_AUTH"/);
  });

  it("creates isolated local, Google, Microsoft, and tenant-Entra route clients", () => {
    const vars = read("terraform/modules/foundation/cognito/variables.tf");
    const main = read("terraform/modules/foundation/cognito/main.tf");
    const outputs = read("terraform/modules/foundation/cognito/outputs.tf");

    expect(vars).toMatch(/variable "microsoft_oauth_client_id"/);
    expect(vars).toMatch(/variable "microsoft_oauth_tenant"/);
    expect(vars).toMatch(/variable "tenant_entra_connections"/);
    expect(main).toMatch(
      /resource "aws_cognito_identity_provider" "microsoft_organizations"/,
    );
    expect(main).toMatch(
      /oidc_issuer\s*=\s*"https:\/\/login\.microsoftonline\.com\/\$\{lower\(var\.microsoft_oauth_tenant\)\}\/v2\.0"/,
    );
    expect(main).toMatch(/"custom:entra_tenant_id"\s*=\s*"tid"/);
    expect(main).toMatch(/"custom:entra_object_id"\s*=\s*"oid"/);
    expect(main).toMatch(
      /resource "aws_cognito_user_pool_client" "auth_route"/,
    );
    expect(main).toMatch(/provider_names\s*=\s*\["COGNITO"\]/);
    expect(main).toMatch(/provider_names\s*=\s*\["Google"\]/);
    expect(main).toMatch(/provider_names\s*=\s*\["MicrosoftOrganizations"\]/);
    expect(main).toMatch(
      /explicit_auth_flows\s*=\s*\["ALLOW_REFRESH_TOKEN_AUTH"\]/,
    );
    expect(main).toMatch(
      /explicit_auth_flows\s*=\s*\["ALLOW_USER_PASSWORD_AUTH", "ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"\]/,
    );
    expect(main).toMatch(/generate_secret\s*=\s*false/);
    expect(main).toMatch(/allowed_oauth_flows\s*=\s*\["code"\]/);
    expect(main).toMatch(/enable_token_revocation\s*=\s*true/);
    expect(outputs).toMatch(/output "auth_route_clients"/);
    expect(outputs).not.toMatch(/client_secret/);
  });

  it("preserves Google's verified-email proof for automatic identity admission", () => {
    const main = read("terraform/modules/foundation/cognito/main.tf");
    const googleProvider = main.match(
      /resource "aws_cognito_identity_provider" "google" \{[\s\S]*?\n\}/,
    )?.[0];
    const routeClient = main.match(
      /resource "aws_cognito_user_pool_client" "auth_route" \{[\s\S]*?\n\}/,
    )?.[0];

    expect(googleProvider).toMatch(/email_verified\s*=\s*"email_verified"/);
    expect(routeClient).not.toMatch(
      /write_attributes\s*=\s*\[[\s\S]*?"email_verified"/,
    );
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
    expect(vars).toMatch(/variable "microsoft_oauth_client_id"/);
    expect(vars).toMatch(/variable "microsoft_oauth_tenant"/);
    expect(vars).toMatch(/variable "tenant_entra_connections"/);
    expect(main).toMatch(
      /oidc_identity_providers\s*=\s*var\.oidc_identity_providers/,
    );
    expect(main).toMatch(
      /saml_identity_providers\s*=\s*var\.saml_identity_providers/,
    );
    expect(main).toMatch(
      /microsoft_oauth_client_id\s*=\s*var\.microsoft_oauth_client_id/,
    );
    expect(main).toMatch(
      /microsoft_oauth_tenant\s*=\s*var\.microsoft_oauth_tenant/,
    );
    expect(main).toMatch(
      /tenant_entra_connections\s*=\s*var\.tenant_entra_connections/,
    );
    expect(outputs).toMatch(/output "identity_provider_names"/);
    expect(outputs).toMatch(/output "auth_route_clients"/);
  });

  it("wires a V2 pre-token cutoff without granting Cognito mutation access", () => {
    const vars = read("terraform/modules/foundation/cognito/variables.tf");
    const main = read("terraform/modules/foundation/cognito/main.tf");

    expect(vars).toMatch(/variable "denied_app_client_ids"/);
    expect(main).toMatch(
      /resource "aws_lambda_function" "pre_token_generation"/,
    );
    expect(main).toMatch(/pre_token_generation_config/);
    expect(main).toMatch(/lambda_version\s*=\s*"V2_0"/);
    expect(main).toMatch(/COGNITO_DENIED_APP_CLIENT_IDS/);
    expect(main).not.toMatch(/AdminLinkProviderForUser/);
    expect(main).not.toMatch(/AdminSetUserPassword/);
  });

  it("keeps the WorkOS custom challenge as a phase-gated rollback runtime", () => {
    const vars = read("terraform/modules/foundation/cognito/variables.tf");
    const main = read("terraform/modules/foundation/cognito/main.tf");
    const apiVars = read("terraform/modules/app/lambda-api/variables.tf");
    const handlers = read("terraform/modules/app/lambda-api/handlers.tf");
    const build = read("scripts/build-lambdas.sh");

    expect(vars).toMatch(/variable "auth_retirement_phase"/);
    expect(vars).toMatch(/\["coexistence", "cutover", "retired"\]/);
    expect(main).toMatch(
      /create_custom_auth\s*=\s*local\.create && local\.workos_rollback_enabled/,
    );
    expect(main).toMatch(/resource "aws_lambda_function" "custom_auth"/);
    expect(apiVars).toMatch(/variable "auth_retirement_phase"/);
    expect(handlers).toMatch(/"workos-auth"/);
    expect(handlers).toMatch(/GET \/api\/auth\/workos\/callback/);
    expect(build).toMatch(/build_handler "cognito-custom-auth"/);
    expect(build).toMatch(/build_handler "workos-auth"/);
  });
});

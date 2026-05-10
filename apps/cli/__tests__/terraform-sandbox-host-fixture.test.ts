/**
 * Structural fixture test for the sandbox subdomain Terraform (plan-012 U3).
 *
 * Pure file-content assertions — does not invoke `terraform plan` because
 * CI doesn't have AWS creds wired into apps/cli's vitest run. The
 * `thinkwork plan -s dev` workflow remains the live deploy gate; this
 * test guards against accidental drift in the terraform module surface
 * (e.g. a refactor that strips the response-headers policy off the
 * sandbox distribution and silently regresses the iframe CSP).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

const STATIC_SITE_MAIN = resolve(
  REPO_ROOT,
  "terraform/modules/app/static-site/main.tf",
);
const THINKWORK_MAIN = resolve(REPO_ROOT, "terraform/modules/thinkwork/main.tf");
const THINKWORK_VARS = resolve(
  REPO_ROOT,
  "terraform/modules/thinkwork/variables.tf",
);
const BUILD_COMPUTER = resolve(REPO_ROOT, "scripts/build-computer.sh");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("U3 — static-site response-headers extension", () => {
  it("static-site main.tf declares the new optional inputs", () => {
    const source = read(STATIC_SITE_MAIN);
    expect(source).toMatch(/variable "response_headers_policy_id"/);
    expect(source).toMatch(/variable "inline_response_headers"/);
  });

  it("static-site main.tf wires response_headers_policy_id into the default_cache_behavior", () => {
    const source = read(STATIC_SITE_MAIN);
    expect(source).toMatch(/response_headers_policy_id\s*=/);
  });

  it("static-site main.tf mints aws_cloudfront_response_headers_policy.inline when inline_response_headers is set", () => {
    const source = read(STATIC_SITE_MAIN);
    expect(source).toMatch(
      /resource "aws_cloudfront_response_headers_policy" "inline"/,
    );
  });

  it("static-site main.tf rejects passing both inputs simultaneously", () => {
    // The mutual-exclusion validator surfaces as a `check` block whose
    // assertion fails when both inputs are non-empty (terraform check
    // blocks are post-plan validators, no resource side-effect needed).
    const source = read(STATIC_SITE_MAIN);
    expect(source).toMatch(/check "policy_inputs_are_mutually_exclusive"/);
    expect(source).toMatch(/mutually exclusive/);
  });

  it("static-site main.tf exposes response_headers_policy_id as an output", () => {
    const source = read(STATIC_SITE_MAIN);
    expect(source).toMatch(/output "response_headers_policy_id"/);
  });
});

describe("U3 — computer_sandbox_site instance", () => {
  it("thinkwork main.tf declares module \"computer_sandbox_site\"", () => {
    const source = read(THINKWORK_MAIN);
    expect(source).toMatch(/module "computer_sandbox_site"/);
  });

  it("computer_sandbox_site uses the static-site module via source = \"../app/static-site\"", () => {
    const source = read(THINKWORK_MAIN);
    expect(source).toMatch(
      /module "computer_sandbox_site"\s*\{[^}]*source\s*=\s*"\.\.\/app\/static-site"/s,
    );
  });

  it("computer_sandbox_site site_name is computer-sandbox (dedicated bucket + distribution)", () => {
    const source = read(THINKWORK_MAIN);
    expect(source).toMatch(
      /module "computer_sandbox_site"\s*\{[^}]*site_name\s*=\s*"computer-sandbox"/s,
    );
  });

  it("computer_sandbox_site is gated on var.computer_sandbox_domain", () => {
    const source = read(THINKWORK_MAIN);
    expect(source).toMatch(/computer_sandbox_enabled/);
    expect(source).toMatch(
      /module "computer_sandbox_site"\s*\{[^}]*count\s*=\s*local\.computer_sandbox_enabled/s,
    );
  });

  it("computer_sandbox_site CSP profile carries the load-bearing directives", () => {
    const source = read(THINKWORK_MAIN);
    expect(source).toMatch(/default-src 'none'/);
    expect(source).toMatch(/script-src 'self' blob:/);
    expect(source).toMatch(/worker-src 'self' blob:/);
    expect(source).toMatch(/connect-src 'none'/);
    expect(source).toMatch(/frame-ancestors/);
  });

  it("computer_sandbox_site CSP only allows the map embed/tile origins needed by applets", () => {
    const source = read(THINKWORK_MAIN);
    expect(source).toMatch(/computer_sandbox_map_img_src/);
    expect(source).toMatch(/https:\/\/\*\.tile\.openstreetmap\.org/);
    expect(source).toMatch(/https:\/\/api\.mapbox\.com/);
    expect(source).toMatch(/computer_sandbox_map_frame_src/);
    expect(source).toMatch(/frame-src \$\{local\.computer_sandbox_map_frame_src\}/);
    expect(source).toMatch(/https:\/\/www\.openstreetmap\.org/);
    expect(source).not.toMatch(/frame-src \*/);
  });

  it("computer_sandbox_site enables CORS for opaque-origin sandbox module scripts", () => {
    const source = read(THINKWORK_MAIN);
    const sandboxSiteBlock = source.match(
      /module "computer_sandbox_site"\s*\{[\s\S]*?\n\}/,
    )?.[0];
    expect(sandboxSiteBlock).toBeDefined();
    expect(sandboxSiteBlock!).toMatch(/cors\s*=/);
    expect(sandboxSiteBlock!).toMatch(/allow_origins\s*=\s*\["\*"\]/);
    expect(sandboxSiteBlock!).toMatch(/allow_credentials\s*=\s*false/);
  });

  it("computer_sandbox_site CSP frame-ancestors derives from var.computer_sandbox_allowed_parent_origins", () => {
    const source = read(THINKWORK_MAIN);
    expect(source).toMatch(/computer_sandbox_allowed_parent_origins/);
  });

  it("computer_sandbox_site does NOT use 'allow-same-origin' as a configured value (architectural invariant)", () => {
    // The Terraform module never sets the iframe sandbox attribute (that
    // lives on the parent app at iframe construction time) but a
    // hypothetical regression that ever introduced `allow-same-origin`
    // as a *value* (vs. an explainer comment) anywhere in the sandbox
    // terraform module would silently undo the cross-origin barrier.
    // Filter out comment lines so the explainer block in main.tf is OK.
    const source = read(THINKWORK_MAIN);
    const noComments = source
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    expect(noComments).not.toMatch(/allow-same-origin/);
  });
});

describe("U3 — sandbox variables", () => {
  it("thinkwork variables.tf declares computer_sandbox_domain", () => {
    const source = read(THINKWORK_VARS);
    expect(source).toMatch(/variable "computer_sandbox_domain"/);
  });

  it("thinkwork variables.tf declares computer_sandbox_certificate_arn", () => {
    const source = read(THINKWORK_VARS);
    expect(source).toMatch(/variable "computer_sandbox_certificate_arn"/);
  });

  it("thinkwork variables.tf declares computer_sandbox_allowed_parent_origins", () => {
    const source = read(THINKWORK_VARS);
    expect(source).toMatch(/variable "computer_sandbox_allowed_parent_origins"/);
  });
});

describe("U10 — host CSP wired for computer_site", () => {
  it("computer_site opts into inline_response_headers carrying the host CSP profile", () => {
    // Plan-012 U10: the parent SPA's host CSP is set via the
    // CloudFront response-headers policy, not via <meta> in
    // index.html. Host CSP allowlists the sandbox subdomain in
    // frame-src and keeps frame-ancestors 'none' so the parent is
    // never framed by hostile pages.
    const source = read(THINKWORK_MAIN);
    const computerSiteBlock = source.match(
      /module "computer_site"\s*\{[\s\S]*?\n\}/,
    )?.[0];
    expect(computerSiteBlock).toBeDefined();
    expect(computerSiteBlock!).toMatch(/inline_response_headers/);
    expect(computerSiteBlock!).toMatch(/computer_host_csp/);
  });

  it("host CSP locals carry the load-bearing directives", () => {
    const source = read(THINKWORK_MAIN);
    expect(source).toMatch(/computer_host_csp/);
    expect(source).toMatch(/computer_host_script_src/);
    expect(source).toMatch(/computer_host_worker_src/);
    expect(source).toMatch(/script-src \$\{local\.computer_host_script_src\}/);
    expect(source).toMatch(/worker-src \$\{local\.computer_host_worker_src\}/);
    expect(source).toMatch(/frame-ancestors 'none'/);
    // connect-src must allow API Gateway for GraphQL queries/mutations,
    // AppSync for the streaming wire, and Cognito for auth flow.
    expect(source).toMatch(/execute-api/);
    expect(source).toMatch(/appsync-api/);
    expect(source).toMatch(/cognito-idp/);
  });

  it("host CSP API Gateway + AppSync + Cognito endpoints are region-parameterized (not hardcoded us-east-1)", () => {
    // Plan-012: non-us-east-1 stages (e.g. eu-west-1) would have a
    // broken host CSP if the region were hardcoded. var.region drives
    // the API Gateway, AppSync API, AppSync realtime, and Cognito IdP
    // host segments. API Gateway is required for GraphQL
    // queries/mutations; AppSync is subscriptions only.
    const source = read(THINKWORK_MAIN);
    expect(source).toMatch(/execute-api\.\$\{var\.region\}\.amazonaws\.com/);
    expect(source).toMatch(/appsync-api\.\$\{var\.region\}\.amazonaws\.com/);
    expect(source).toMatch(
      /appsync-realtime-api\.\$\{var\.region\}\.amazonaws\.com/,
    );
    expect(source).toMatch(/cognito-idp\.\$\{var\.region\}\.amazonaws\.com/);
    // Defensive negative: no remaining hardcoded us-east-1 in the
    // host CSP. (Other terraform resources legitimately reference
    // us-east-1 — e.g. CloudFront ACM cert region — so we scope the
    // regex to the known CSP host suffixes.)
    expect(source).not.toMatch(/execute-api\.us-east-1\.amazonaws\.com/);
    expect(source).not.toMatch(/appsync-api\.us-east-1\.amazonaws\.com/);
    expect(source).not.toMatch(
      /appsync-realtime-api\.us-east-1\.amazonaws\.com/,
    );
    expect(source).not.toMatch(/cognito-idp\.us-east-1\.amazonaws\.com/);
  });

  it("host CSP frame-src allowlists the sandbox subdomain when provisioned", () => {
    const source = read(THINKWORK_MAIN);
    expect(source).toMatch(/computer_host_frame_src/);
    expect(source).toMatch(/computer_sandbox_domain/);
  });

  it("host CSP permits legacy blob applet modules only while sandbox is unprovisioned", () => {
    const source = read(THINKWORK_MAIN);
    expect(source).toMatch(
      /computer_host_script_src\s*=\s*local\.computer_sandbox_enabled\s*\?\s*"'self'"\s*:\s*"'self' blob:"/,
    );
    expect(source).toMatch(
      /computer_host_worker_src\s*=\s*local\.computer_sandbox_enabled\s*\?\s*"'self'"\s*:\s*"'self' blob:"/,
    );
    expect(source).toMatch(
      /computer_host_frame_src\s*=\s*local\.computer_sandbox_enabled\s*\?\s*"https:\/\/\$\{var\.computer_sandbox_domain\}"\s*:\s*"'none'"/,
    );
  });
});

describe("U11.5 — computer deploy script sandbox fallback", () => {
  it("build-computer enables the legacy applet loader when sandbox outputs are absent", () => {
    const source = read(BUILD_COMPUTER);
    expect(source).toMatch(/COMPUTER_SANDBOX_URL="\$\(tf_output_raw computer_sandbox_url/);
    expect(source).toMatch(/elif \[\[ -z "\$COMPUTER_SANDBOX_URL" \]\]/);
    expect(source).toMatch(/APPLET_LEGACY_LOADER="true"/);
    expect(source).toMatch(/APPLET_LEGACY_LOADER="false"/);
    expect(source).toMatch(/VITE_APPLET_LEGACY_LOADER=\$\{APPLET_LEGACY_LOADER\}/);
  });
});

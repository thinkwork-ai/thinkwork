import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { renderEnterpriseDeployRepoTemplate } from "../src/commands/enterprise/template.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "thinkwork-enterprise-workflow-"));
  tempDirs.push(dir);
  return dir;
}

function render(stages = ["dev", "prod"]): string {
  const root = tempRepo();
  renderEnterpriseDeployRepoTemplate({
    targetDir: root,
    customerSlug: "acme",
    accountId: "111122223333",
    region: "us-west-2",
    releaseVersion: "v1.2.3",
    releaseManifestSha256: "abc123",
    terraformModuleVersion: "1.2.3",
    stages,
  });
  return root;
}

function read(root: string, path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("enterprise deploy workflow template", () => {
  it("renders an auditable release-artifact CI workflow with OIDC, Terraform, overlays, smokes, runtime updates, and summary", () => {
    const root = render();
    const workflow = read(root, ".github/workflows/deploy.yml");

    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("role-to-assume: ${{ vars.AWS_ROLE_ARN }}");
    expect(workflow).toContain("operation:");
    expect(workflow).toContain("component:");
    expect(workflow).toContain("run_smokes:");
    expect(workflow).toContain("Fetch and verify release manifest");
    expect(workflow).toContain("sha256sum -c -");
    expect(workflow).toContain("Prepare release artifacts");
    expect(workflow).toContain("Select Terraform workspace");
    expect(workflow).toContain("Terraform apply");
    expect(workflow).toContain("Terraform destroy");
    expect(workflow).toContain("Copy runtime images into customer ECR");
    expect(workflow).toContain("Update AgentCore runtimes");
    expect(workflow).toContain("Sync static site bundles");
    expect(workflow).toContain("Apply customer overlay contract");
    expect(workflow).toContain("thinkwork-cli@${CLI_VERSION}");
    expect(workflow).toContain("enterprise overlay apply");
    expect(workflow).toContain("Run smoke checks");
    expect(workflow).toContain("Write deploy summary");
    expect(workflow).toContain('--operation "$OPERATION"');
    expect(workflow).toContain(
      "thinkwork-${{ github.event.inputs.operation }}-${{ github.event.inputs.stage }}-${{ github.run_id }}",
    );
  });

  it("never references long-lived AWS access key secrets", () => {
    const root = render();
    const workflow = read(root, ".github/workflows/deploy.yml");

    expect(workflow).not.toContain("AWS_ACCESS_KEY_ID");
    expect(workflow).not.toContain("AWS_SECRET_ACCESS_KEY");
  });

  it("verifies the release manifest before configuring AWS credentials", () => {
    const root = render();
    const workflow = read(root, ".github/workflows/deploy.yml");

    expect(workflow.indexOf("Fetch and verify release manifest")).toBeLessThan(
      workflow.indexOf("Configure AWS credentials"),
    );
  });

  it("uses rendered stage choices, stage tfvars, and backend files consistently", () => {
    const root = render(["qa", "prod"]);
    const workflow = read(root, ".github/workflows/deploy.yml");
    const deployment = JSON.parse(read(root, "customer/deployment.json"));

    expect(workflow).toContain('test -f "terraform/backend-${STAGE}.hcl"');
    expect(workflow).toContain('test -f "terraform/stages/${STAGE}.tfvars"');
    expect(workflow).toContain(
      'terraform init -backend-config="backend-${STAGE}.hcl"',
    );
    expect(existsSync(join(root, "terraform/backend-qa.hcl"))).toBe(true);
    expect(existsSync(join(root, "terraform/stages/qa.tfvars"))).toBe(true);
    expect(read(root, "terraform/backend-qa.hcl")).toContain(
      'key            = "thinkwork/qa/terraform.tfstate"',
    );
    expect(deployment.stages.qa.tenantSlug).toBe("acme-qa");
    expect(deployment.stages.prod.tenantSlug).toBe("acme");
  });

  it("renders helper scripts with valid JavaScript syntax", () => {
    const root = render();

    execFileSync(process.execPath, [
      "--check",
      join(root, "scripts/apply-release.mjs"),
    ]);
    execFileSync(process.execPath, [
      "--check",
      join(root, "scripts/smoke.mjs"),
    ]);
  });

  it("preserves AgentCore runtime configuration when updating runtime images", () => {
    const root = render();
    const helper = read(root, "scripts/apply-release.mjs");

    expect(helper).toContain("get-agent-runtime");
    expect(helper).toContain("--role-arn");
    expect(helper).toContain("--network-configuration");
    expect(helper).toContain("--protocol-configuration");
    expect(helper).toContain("list-agent-runtime-endpoints");
  });
});

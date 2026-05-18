import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  renderEnterpriseDeployRepoTemplate,
  validateCustomerSlug,
  validateStages,
} from "../src/commands/enterprise/template.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "thinkwork-enterprise-template-"));
  tempDirs.push(dir);
  return dir;
}

function read(root: string, path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("enterprise deployment repo template", () => {
  it("renders the default deploy repo shape for a customer and dev/prod stages", () => {
    const root = tempRepo();
    const result = renderEnterpriseDeployRepoTemplate({
      targetDir: root,
      customerSlug: "acme",
      accountId: "111122223333",
      region: "us-west-2",
      releaseVersion: "v1.2.3",
      releaseManifestSha256: "abc123",
      terraformModuleVersion: "1.2.3",
    });

    expect(result.preserved).toEqual([]);
    expect(existsSync(join(root, "thinkwork.lock"))).toBe(true);
    expect(existsSync(join(root, ".github/workflows/deploy.yml"))).toBe(true);
    expect(existsSync(join(root, "terraform/main.tf"))).toBe(true);
    expect(existsSync(join(root, "terraform/stages/dev.tfvars"))).toBe(true);
    expect(existsSync(join(root, "terraform/stages/prod.tfvars"))).toBe(true);
    expect(existsSync(join(root, "customer/deployment.json"))).toBe(true);
    expect(existsSync(join(root, "customer/evals/README.md"))).toBe(true);
    expect(existsSync(join(root, "customer/seeds/README.md"))).toBe(true);
    expect(existsSync(join(root, "customer/skills/README.md"))).toBe(true);
    expect(
      existsSync(join(root, "customer/workspace-defaults/README.md")),
    ).toBe(true);
    expect(existsSync(join(root, "customer/branding/README.md"))).toBe(true);
    expect(read(root, "thinkwork.lock")).not.toContain("{{");
    expect(read(root, "terraform/stages/dev.tfvars")).toContain(
      'account_id      = "111122223333"',
    );
  });

  it("pins release metadata and references the overlay contract without monorepo source paths", () => {
    const root = tempRepo();
    renderEnterpriseDeployRepoTemplate({
      targetDir: root,
      customerSlug: "acme",
      releaseVersion: "v1.2.3",
      releaseManifestUrl:
        "https://github.com/thinkwork-ai/thinkwork/releases/download/v1.2.3/thinkwork-release.json",
      releaseManifestSha256: "abc123",
    });

    const lock = JSON.parse(read(root, "thinkwork.lock"));
    expect(lock.thinkwork.release).toBe("v1.2.3");
    expect(lock.thinkwork.manifestSha256).toBe("abc123");
    expect(lock.artifacts.lambdaPrefix).toBe("releases/v1.2.3/lambdas");

    const workflow = read(root, ".github/workflows/deploy.yml");
    expect(workflow).toContain("thinkwork.lock");
    expect(workflow).toContain("customer/deployment.json");
    expect(workflow).not.toContain("packages/");
    expect(workflow).not.toContain("apps/");
    expect(workflow).not.toContain("scripts/build-lambdas.sh");

    const terraform = read(root, "terraform/main.tf");
    expect(terraform).toContain('source  = "thinkwork-ai/thinkwork/aws"');
    expect(terraform).toContain("require_lambda_artifacts = true");
  });

  it("preserves customer-owned overlay files and updates managed files on rerender", () => {
    const root = tempRepo();
    renderEnterpriseDeployRepoTemplate({
      targetDir: root,
      customerSlug: "acme",
      releaseVersion: "v1.2.3",
    });

    const customerEvalPath = join(root, "customer/evals/custom-dataset.jsonl");
    writeFileSync(customerEvalPath, '{"id":"customer-owned"}\n');
    writeFileSync(
      join(root, "README.md"),
      "<!-- thinkwork-managed: enterprise-deploy-template -->\nold managed content\n",
    );
    writeFileSync(
      join(root, "customer/seeds/README.md"),
      "customer edited docs\n",
    );

    const result = renderEnterpriseDeployRepoTemplate({
      targetDir: root,
      customerSlug: "acme",
      releaseVersion: "v2.0.0",
    });

    expect(readFileSync(customerEvalPath, "utf8")).toBe(
      '{"id":"customer-owned"}\n',
    );
    expect(read(root, "README.md")).toContain(
      "This repository deploys a pinned ThinkWork foundation",
    );
    expect(read(root, "thinkwork.lock")).toContain("v2.0.0");
    expect(read(root, "customer/seeds/README.md")).toBe(
      "customer edited docs\n",
    );
    expect(result.preserved).toContain(join(root, "customer/seeds/README.md"));
  });

  it("validates customer slugs and stage names using CLI-compatible rules", () => {
    expect(validateCustomerSlug("acme-123")).toBe("acme-123");
    expect(() => validateCustomerSlug("Acme")).toThrow(/Invalid customer slug/);
    expect(validateStages(["dev", "prod"])).toEqual(["dev", "prod"]);
    expect(() => validateStages(["INVALID_UPPERCASE"])).toThrow(
      /Invalid stage name/,
    );
  });
});

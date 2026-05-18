import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { renderEnterpriseDeployRepoTemplate } from "../src/commands/enterprise/template.js";

const repoRoot = resolve(__dirname, "../../..");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "thinkwork-enterprise-docs-"));
  tempDirs.push(dir);
  return dir;
}

describe("enterprise deployment docs and generated runbook", () => {
  it("links the enterprise deploy docs from the deploy docs set", () => {
    const sidebar = read("docs/astro.config.mjs");

    expect(
      existsSync(
        join(
          repoRoot,
          "docs/src/content/docs/deploy/enterprise-deployment-repo.mdx",
        ),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(
          repoRoot,
          "docs/src/content/docs/deploy/customer-overlay-contract.mdx",
        ),
      ),
    ).toBe(true);
    expect(sidebar).toContain('slug: "deploy/enterprise-deployment-repo"');
    expect(sidebar).toContain('slug: "deploy/customer-overlay-contract"');
  });

  it("documents secrets outside the repo and break-glass source forks", () => {
    const enterpriseDoc = read(
      "docs/src/content/docs/deploy/enterprise-deployment-repo.mdx",
    );
    const overlayDoc = read(
      "docs/src/content/docs/deploy/customer-overlay-contract.mdx",
    );

    expect(enterpriseDoc).toMatch(
      /not a fork of\s+the ThinkWork source repository/,
    );
    expect(enterpriseDoc).toContain("--repo acme-corp/acme-thinkwork-deploy");
    expect(enterpriseDoc).not.toContain("--github-owner");
    expect(enterpriseDoc).toContain(
      "full ThinkWork source fork is break-glass debt",
    );
    expect(overlayDoc).toContain("GitHub Environment secrets");
    expect(overlayDoc).toContain("AWS Secrets Manager");
    expect(overlayDoc).toContain("SSM Parameter Store");
  });

  it("renders a generated repo runbook with the exact deployment sequence", () => {
    const root = tempRepo();
    renderEnterpriseDeployRepoTemplate({
      targetDir: root,
      customerSlug: "acme",
      releaseVersion: "v1.2.3",
      releaseManifestSha256: "abc123",
    });

    const runbook = readFileSync(join(root, "docs/runbook.md"), "utf8");
    const readme = readFileSync(join(root, "README.md"), "utf8");

    expect(runbook).toContain(
      "bootstrap -> workflow dispatch -> CI deploy -> overlay apply -> smoke summary",
    );
    expect(runbook).toContain("Never commit secrets");
    expect(runbook).toContain("GitHub Environment secrets");
    expect(runbook).toContain("AWS Secrets Manager");
    expect(runbook).toContain("SSM Parameter Store");
    expect(runbook).toContain("source fork is emergency debt");
    expect(readme).toContain("docs/runbook.md");
  });
});

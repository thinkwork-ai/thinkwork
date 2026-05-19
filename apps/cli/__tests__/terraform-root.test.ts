import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveTerraformRoot, resolveTierDir } from "../src/terraform.js";

const tempDirs: string[] = [];
const originalTerraformDir = process.env.THINKWORK_TERRAFORM_DIR;

afterEach(() => {
  if (originalTerraformDir === undefined) {
    delete process.env.THINKWORK_TERRAFORM_DIR;
  } else {
    process.env.THINKWORK_TERRAFORM_DIR = originalTerraformDir;
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "thinkwork-terraform-root-"));
  tempDirs.push(dir);
  return dir;
}

describe("resolveTerraformRoot", () => {
  it("finds the repo terraform directory from nested workspace directories", () => {
    const repo = tempDir();
    const terraformRoot = join(repo, "terraform");
    const greenfield = join(terraformRoot, "examples", "greenfield");
    const nested = join(repo, "apps", "mobile");
    mkdirSync(greenfield, { recursive: true });
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(greenfield, "main.tf"), "");

    expect(resolveTerraformRoot(nested)).toBe(terraformRoot);
    expect(
      resolveTierDir(resolveTerraformRoot(nested), "test", "foundation"),
    ).toBe(greenfield);
  });

  it("honors THINKWORK_TERRAFORM_DIR before walking parents", () => {
    const configured = tempDir();
    const nested = tempDir();
    process.env.THINKWORK_TERRAFORM_DIR = configured;

    expect(resolveTerraformRoot(nested)).toBe(configured);
  });

  it("falls back to the start directory when no terraform layout is found", () => {
    const start = tempDir();

    expect(resolveTerraformRoot(start)).toBe(start);
  });
});

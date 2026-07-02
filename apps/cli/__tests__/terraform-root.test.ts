import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  resolveTerraformRoot,
  resolveTerraformRootForStage,
  resolveTierDir,
} from "../src/terraform.js";

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

describe("resolveTerraformRootForStage", () => {
  it("prefers the cwd-derived root when it has a layout for the stage", () => {
    const repo = tempDir();
    const terraformRoot = join(repo, "terraform");
    const greenfield = join(terraformRoot, "examples", "greenfield");
    mkdirSync(greenfield, { recursive: true });
    writeFileSync(join(greenfield, "main.tf"), "");
    const recorded = tempDir();
    writeFileSync(join(recorded, "main.tf"), "");

    expect(resolveTerraformRootForStage("hci", recorded, repo)).toBe(
      terraformRoot,
    );
  });

  it("falls back to the registry-recorded terraform dir when cwd has no layout", () => {
    const start = tempDir();
    const recorded = tempDir();
    writeFileSync(join(recorded, "main.tf"), "");
    writeFileSync(join(recorded, "terraform.tfvars"), 'stage = "hci"\n');

    expect(resolveTerraformRootForStage("hci", recorded, start)).toBe(recorded);
  });

  it("returns the cwd-derived root when the recorded dir is missing too", () => {
    const start = tempDir();
    const recorded = join(tempDir(), "gone");

    expect(resolveTerraformRootForStage("hci", recorded, start)).toBe(start);
    expect(resolveTerraformRootForStage("hci", undefined, start)).toBe(start);
  });
});

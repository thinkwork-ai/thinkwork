import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Fixture assertions for the U2 backend wiring (KTD-1):
 * - the init-scaffolded main.tf template declares a partial `backend "s3" {}`
 *   block so -backend-config injection has somewhere to land;
 * - the repo greenfield layout keeps its own hardcoded backend (dev CI
 *   depends on it) and must NOT gain the partial block.
 */
describe("terraform backend fixtures", () => {
  it("init-scaffolded main.tf template declares a partial s3 backend", () => {
    const initSource = readFileSync(
      join(__dirname, "..", "src", "commands", "init.ts"),
      "utf8",
    );
    expect(initSource).toContain('backend "s3" {}');
    // The partial block must live inside the generated terraform{} template,
    // before the required_providers block it precedes.
    const templateStart = initSource.indexOf("terraform {");
    const backendPos = initSource.indexOf('backend "s3" {}');
    const providersPos = initSource.indexOf(
      "required_providers",
      templateStart,
    );
    expect(backendPos).toBeGreaterThan(templateStart);
    expect(backendPos).toBeLessThan(providersPos);
  });

  it("repo greenfield layout keeps its hardcoded backend untouched", () => {
    const greenfield = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "..",
        "terraform",
        "examples",
        "greenfield",
        "main.tf",
      ),
      "utf8",
    );
    expect(greenfield).toContain('backend "s3"');
    expect(greenfield).toContain("thinkwork-terraform-state");
    expect(greenfield).not.toContain('backend "s3" {}');
  });
});

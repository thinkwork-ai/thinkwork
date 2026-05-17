import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const packageJson = JSON.parse(
  readFileSync(join(process.cwd(), "package.json"), "utf8"),
) as {
  dependencies?: Record<string, string>;
  version?: string;
};

describe("published package manifest", () => {
  it("does not expose workspace-only dependencies to npm installs", () => {
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);

    for (const [name, range] of Object.entries(packageJson.dependencies ?? {})) {
      expect(`${name}@${range}`).not.toContain("workspace:");
    }
  });
});

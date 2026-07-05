import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("sign-in screen label audit", () => {
  it("does not render legacy deployment-profile or fallback-chip labels", () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../app/sign-in.tsx"),
      "utf8",
    );

    expect(source).not.toContain("Deployment profile");
    expect(source).not.toContain("Build-time fallback");
    expect(source).not.toContain("Import");
    expect(source).not.toContain("Continue with Google");
  });
});

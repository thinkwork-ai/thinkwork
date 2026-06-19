import { describe, expect, it } from "vitest";
import { normalizeN8nPackageConfig } from "../src/package-config";

describe("n8n package config", () => {
  it("normalizes exact public npm specs into a deterministic digest", () => {
    const first = normalizeN8nPackageConfig({
      customPackageSpecs: [
        "zod@3.25.76",
        "lodash@4.17.21",
        "@aws-sdk/client-s3@3.844.0",
        "lodash@4.17.21",
      ],
    });
    const second = normalizeN8nPackageConfig([
      "lodash@4.17.21",
      "@aws-sdk/client-s3@3.844.0",
      "zod@3.25.76",
    ]);

    expect(first.packageSpecs).toEqual([
      "@aws-sdk/client-s3@3.844.0",
      "lodash@4.17.21",
      "zod@3.25.76",
    ]);
    expect(first.packageNames).toEqual(["@aws-sdk/client-s3", "lodash", "zod"]);
    expect(first.allowExternal).toBe("@aws-sdk/client-s3,lodash,zod");
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.digest).toBe(second.digest);
  });

  it("rejects unpinned ranges, tags, URLs, paths, and private registry aliases", () => {
    const invalidSpecs = [
      "lodash",
      "lodash@^4.17.21",
      "lodash@latest",
      "lodash@*",
      "git+https://github.com/lodash/lodash.git",
      "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz",
      "file:../lodash",
      "workspace:lodash",
      "npm:lodash@4.17.21",
      "../local-package",
    ];

    for (const spec of invalidSpecs) {
      expect(() => normalizeN8nPackageConfig([spec]), spec).toThrow(
        /exact public npm|exact semver|public npm registry|URL|path|workspace/,
      );
    }
  });

  it("rejects conflicting package versions", () => {
    expect(() =>
      normalizeN8nPackageConfig(["date-fns@4.1.0", "date-fns@4.0.0"]),
    ).toThrow(/multiple versions/);
  });
});

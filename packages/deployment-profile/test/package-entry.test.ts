import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

describe("@thinkwork/deployment-profile package entry", () => {
  it("does not expose TypeScript source as the runtime entry", async () => {
    const pkg = JSON.parse(
      await readFile(resolve(packageRoot, "package.json"), "utf8"),
    ) as {
      main?: string;
      types?: string;
      exports?: Record<string, unknown>;
    };

    expect(pkg.main).toBe("./dist/index.js");
    expect(pkg.types).toBe("./dist/index.d.ts");
    expect(pkg.exports?.["."]).toMatchObject({
      types: "./dist/index.d.ts",
      "react-native": "./src/index.ts",
      browser: "./src/index.ts",
      development: "./src/index.ts",
      source: "./src/index.ts",
      import: "./dist/index.js",
      default: "./dist/index.js",
    });
  });
});

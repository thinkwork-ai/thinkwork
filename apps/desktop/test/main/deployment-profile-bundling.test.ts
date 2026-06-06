import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop deployment-profile bundling", () => {
  it("bundles the shared deployment-profile package into Electron output", async () => {
    const config = await readFile(
      resolve(__dirname, "../../electron.vite.config.ts"),
      "utf8",
    );

    expect(config).toContain("@thinkwork/deployment-profile");
    expect(config).toContain("@thinkwork/desktop-ipc");
  });

  it("does not package deployment-profile as an Electron runtime dependency", async () => {
    const pkg = JSON.parse(
      await readFile(resolve(__dirname, "../../package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(pkg.dependencies).not.toHaveProperty(
      "@thinkwork/deployment-profile",
    );
    expect(pkg.devDependencies).toHaveProperty("@thinkwork/deployment-profile");
  });

  it("excludes deployment-profile from app.asar node_modules", async () => {
    const [script, builderConfig] = await Promise.all([
      readFile(resolve(__dirname, "../../../../scripts/build-desktop.sh"), "utf8"),
      readFile(resolve(__dirname, "../../electron-builder.yml"), "utf8"),
    ]);

    for (const config of [script, builderConfig]) {
      expect(config).toContain(
        '"!node_modules/@thinkwork/deployment-profile/**"',
      );
    }
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

describe("@thinkwork/computer-stdlib package contract", () => {
  it("keeps dependency direction one-way", () => {
    const packageJson = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const allDependencyNames = Object.keys({
      ...packageJson.dependencies,
      ...packageJson.peerDependencies,
      ...packageJson.devDependencies,
    });

    expect(allDependencyNames).toContain("@thinkwork/ui");
    expect(allDependencyNames).not.toContain("@thinkwork/computer");
    expect(allDependencyNames).not.toContain("@thinkwork/admin");
  });

  it("does not import from app packages or expose dangerouslySetInnerHTML props", () => {
    const testDir = join("src", "__tests__");
    const sourceFiles = collectFiles(join(packageRoot, "src")).filter(
      (file) => /\.(ts|tsx)$/.test(file) && !file.includes(testDir),
    );

    for (const file of sourceFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(
        /from ["'](?:@\/|apps\/|@thinkwork\/computer|@thinkwork\/admin)/,
      );
      expect(source, file).not.toMatch(/dangerouslySetInnerHTML/);
    }
  });
});

function collectFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? collectFiles(path) : [path];
  });
}

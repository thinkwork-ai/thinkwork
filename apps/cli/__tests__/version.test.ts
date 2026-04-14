import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { VERSION } from "../src/index.js";

describe("thinkwork-cli", () => {
  it("exports a version string", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("prints version via --version flag", () => {
    const output = execSync("npx tsx src/cli.ts --version", {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf-8",
    }).trim();
    expect(output).toBe(VERSION);
  });
});

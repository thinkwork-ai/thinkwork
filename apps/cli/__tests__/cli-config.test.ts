import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCliConfig, saveCliConfig } from "../src/cli-config.js";

let tempDir: string;
let configPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "twcli-config-"));
  configPath = join(tempDir, "config.json");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("cli-config", () => {
  it("returns {} when no config file exists", () => {
    expect(loadCliConfig(configPath)).toEqual({});
  });

  it("persists and merges defaultProfile across save/load", () => {
    saveCliConfig({ defaultProfile: "eric-personal" }, configPath);
    expect(loadCliConfig(configPath).defaultProfile).toBe("eric-personal");

    saveCliConfig({ defaultProfile: "work-sso" }, configPath);
    expect(loadCliConfig(configPath).defaultProfile).toBe("work-sso");
  });

  it("returns {} if the file exists but is malformed JSON", () => {
    writeFileSync(configPath, "not-json{{{");
    expect(loadCliConfig(configPath)).toEqual({});
  });

  it("creates the parent directory if missing", () => {
    const nested = join(tempDir, "nested", "deeper", "config.json");
    saveCliConfig({ defaultProfile: "x" }, nested);
    expect(loadCliConfig(nested).defaultProfile).toBe("x");
  });
});

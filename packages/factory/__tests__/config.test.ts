import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ConfigError,
  getStateDir,
  getConfigPath,
  loadConfig,
  DEFAULT_POLL_INTERVAL_SECONDS,
  DEFAULT_PHASES,
} from "../src/config.js";

let dir: string;

function writeConfig(obj: unknown): void {
  writeFileSync(
    join(dir, "config.json"),
    typeof obj === "string" ? obj : JSON.stringify(obj),
  );
}

const minimalConfig = {
  linear: { apiKey: "lin_api_x", teamKey: "THINK" },
  hosts: [
    {
      name: "local",
      kind: "local",
      repoPath: "/tmp/repo",
      capabilities: ["claude"],
      maxConcurrent: 2,
    },
  ],
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-config-test-"));
  process.env.THINKWORK_FACTORY_DIR = dir;
});

afterEach(() => {
  delete process.env.THINKWORK_FACTORY_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("state dir resolution", () => {
  it("honors THINKWORK_FACTORY_DIR for all paths", () => {
    expect(getStateDir()).toBe(dir);
    expect(getConfigPath()).toBe(join(dir, "config.json"));
  });

  it("reads env at call time, not module load (vitest stubbing works)", () => {
    const other = mkdtempSync(join(tmpdir(), "factory-config-test2-"));
    process.env.THINKWORK_FACTORY_DIR = other;
    expect(getStateDir()).toBe(other);
    rmSync(other, { recursive: true, force: true });
  });

  it("defaults to ~/.thinkwork-factory when env is unset", () => {
    delete process.env.THINKWORK_FACTORY_DIR;
    expect(getStateDir()).toMatch(/\.thinkwork-factory$/);
  });
});

describe("loadConfig", () => {
  it("loads a minimal config and applies defaults", () => {
    writeConfig(minimalConfig);
    const cfg = loadConfig();
    expect(cfg.linear.apiKey).toBe("lin_api_x");
    expect(cfg.linear.teamKey).toBe("THINK");
    expect(cfg.hosts).toHaveLength(1);
    expect(cfg.hosts[0].name).toBe("local");
    expect(cfg.pollIntervalSeconds).toBe(DEFAULT_POLL_INTERVAL_SECONDS);
    // Phase defaults filled in for every default phase.
    for (const phase of Object.keys(DEFAULT_PHASES)) {
      expect(cfg.phases[phase]).toBeDefined();
      expect(cfg.phases[phase].model).toBeTruthy();
      expect(cfg.phases[phase].wallClockSlaMinutes).toBeGreaterThan(0);
      expect(cfg.phases[phase].silenceBudgetMinutes).toBeGreaterThan(0);
    }
    expect(cfg.slack).toEqual({});
  });

  it("merges user phase overrides over defaults", () => {
    writeConfig({
      ...minimalConfig,
      phases: { implement: { model: "opus", wallClockSlaMinutes: 90 } },
      pollIntervalSeconds: 5,
    });
    const cfg = loadConfig();
    expect(cfg.phases.implement.model).toBe("opus");
    expect(cfg.phases.implement.wallClockSlaMinutes).toBe(90);
    // silenceBudgetMinutes still falls back to the default.
    expect(cfg.phases.implement.silenceBudgetMinutes).toBe(
      DEFAULT_PHASES.implement.silenceBudgetMinutes,
    );
    expect(cfg.pollIntervalSeconds).toBe(5);
  });

  it("parses linear.trustedUserIds when present, absent otherwise", () => {
    writeConfig({
      ...minimalConfig,
      linear: {
        ...minimalConfig.linear,
        trustedUserIds: ["u-eric", "u-worker"],
      },
    });
    expect(loadConfig().linear.trustedUserIds).toEqual(["u-eric", "u-worker"]);

    writeConfig(minimalConfig);
    expect(loadConfig().linear.trustedUserIds).toBeUndefined();
  });

  it("throws ConfigError listing missing required keys", () => {
    writeConfig({ slack: {}, hosts: [] });
    let err: unknown;
    try {
      loadConfig();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    const ce = err as ConfigError;
    expect(ce.missing).toContain("linear.apiKey");
    expect(ce.missing).toContain("linear.teamKey");
    expect(ce.missing).toContain("hosts[0]");
  });

  it("throws ConfigError when the file does not exist", () => {
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("throws ConfigError on malformed JSON", () => {
    writeConfig("{ not json !!");
    let err: unknown;
    try {
      loadConfig();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
  });

  it("throws ConfigError on an empty file", () => {
    writeConfig("");
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("flags invalid host entries (missing repoPath / bad kind)", () => {
    writeConfig({
      linear: { apiKey: "k", teamKey: "T" },
      hosts: [
        { name: "h1", kind: "teleport", capabilities: [], maxConcurrent: 1 },
      ],
    });
    let err: unknown;
    try {
      loadConfig();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    const ce = err as ConfigError;
    expect(ce.missing.some((m) => m.startsWith("hosts[0]"))).toBe(true);
  });
});

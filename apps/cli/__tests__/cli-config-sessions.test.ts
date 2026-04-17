import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadCliConfig,
  saveCliConfig,
  saveStageSession,
  loadStageSession,
  clearStageSession,
} from "../src/cli-config.js";

let tempDir: string;
let configPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "twcli-sessions-"));
  configPath = join(tempDir, "config.json");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("stage sessions", () => {
  it("round-trips a Cognito session and leaves other keys alone", () => {
    saveCliConfig({ defaultProfile: "eric" }, configPath);
    saveStageSession(
      "dev",
      {
        kind: "cognito",
        idToken: "idtok",
        accessToken: "acc",
        refreshToken: "refresh",
        expiresAt: 42,
        userPoolId: "pool",
        userPoolClientId: "client",
        cognitoDomain: "thinkwork-dev",
        region: "us-east-1",
        principalId: "sub-123",
        email: "eric@example.com",
        tenantId: "ten-1",
        tenantSlug: "acme",
      },
      configPath,
    );

    const loaded = loadStageSession("dev", configPath);
    expect(loaded?.kind).toBe("cognito");
    expect(loaded).toMatchObject({ principalId: "sub-123", tenantSlug: "acme" });

    // defaultProfile survives the session write.
    expect(loadCliConfig(configPath).defaultProfile).toBe("eric");
  });

  it("round-trips an api-key session", () => {
    saveStageSession(
      "prod",
      { kind: "api-key", authSecret: "secret", tenantSlug: "acme", tenantId: "t1" },
      configPath,
    );
    const loaded = loadStageSession("prod", configPath);
    expect(loaded?.kind).toBe("api-key");
    expect(loaded).toMatchObject({ authSecret: "secret", tenantSlug: "acme" });
  });

  it("keeps sessions for other stages when one is cleared", () => {
    saveStageSession(
      "dev",
      { kind: "api-key", authSecret: "dev-secret" },
      configPath,
    );
    saveStageSession(
      "prod",
      { kind: "api-key", authSecret: "prod-secret" },
      configPath,
    );
    clearStageSession("dev", configPath);
    expect(loadStageSession("dev", configPath)).toBeNull();
    expect(loadStageSession("prod", configPath)?.kind).toBe("api-key");
  });

  it("returns null for an unknown stage", () => {
    expect(loadStageSession("never", configPath)).toBeNull();
  });

  it("a later saveStageSession doesn't clobber earlier stages", () => {
    saveStageSession("a", { kind: "api-key", authSecret: "1" }, configPath);
    saveStageSession("b", { kind: "api-key", authSecret: "2" }, configPath);
    saveStageSession("c", { kind: "api-key", authSecret: "3" }, configPath);
    const all = loadCliConfig(configPath).sessions;
    expect(Object.keys(all ?? {})).toEqual(["a", "b", "c"]);
  });
});

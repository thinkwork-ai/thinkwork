import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { saveStageSession } from "../src/cli-config.js";
import { resolveAuth } from "../src/lib/resolve-auth.js";

// resolveAuth reads ~/.thinkwork/config.json; tests sandbox HOME so we don't
// touch the developer's real config.
let sandbox: string;
let originalHome: string | undefined;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "twcli-auth-"));
  originalHome = process.env.HOME;
  process.env.HOME = sandbox;
});

afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  rmSync(sandbox, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("resolveAuth", () => {
  it("returns cognito headers when the stage has a Cognito session", async () => {
    saveStageSession("dev", {
      kind: "cognito",
      idToken: "IDTOK",
      accessToken: "ACC",
      refreshToken: "REF",
      // 1 hour in the future — no refresh needed.
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      userPoolId: "pool",
      userPoolClientId: "client",
      cognitoDomain: "thinkwork-dev",
      region: "us-east-1",
      principalId: "sub",
      tenantId: "t1",
      tenantSlug: "acme",
    });
    const auth = await resolveAuth({ stage: "dev" });
    expect(auth.mode).toBe("cognito");
    expect(auth.headers.Authorization).toBe("IDTOK");
    expect(auth.principalId).toBe("sub");
    expect(auth.tenantSlug).toBe("acme");
  });

  it("returns api-key headers when the stage has an api-key session", async () => {
    saveStageSession("prod", {
      kind: "api-key",
      authSecret: "SECRET",
      tenantId: "t1",
      tenantSlug: "acme",
    });
    const auth = await resolveAuth({ stage: "prod" });
    expect(auth.mode).toBe("api-key");
    expect(auth.headers.Authorization).toBe("Bearer SECRET");
    expect(auth.headers["x-tenant-id"]).toBe("t1");
    expect(auth.tenantSlug).toBe("acme");
  });

  it("exits when requireCognito is set and no Cognito session exists", async () => {
    saveStageSession("prod", { kind: "api-key", authSecret: "SECRET" });
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    await resolveAuth({ stage: "prod", requireCognito: true }).catch(() => undefined);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

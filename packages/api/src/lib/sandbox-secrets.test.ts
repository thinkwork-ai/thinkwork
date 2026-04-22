/**
 * Unit tests for sandbox-secrets. Exercises the pure helpers and the
 * writeSandboxSecrets decision tree against an injected token resolver.
 *
 * The PutSecretValue / CreateSecret / close-to-use DB recheck paths go
 * through AWS + Postgres and aren't covered here — they get verified
 * during Unit 9's dev-stage integration.
 */
import { describe, it, expect, vi } from "vitest";
import {
  buildSandboxSecretPath,
  SANDBOX_ALLOWED_CONNECTION_TYPES,
} from "./sandbox-secrets.js";

describe("buildSandboxSecretPath", () => {
  it("builds the documented format", () => {
    const path = buildSandboxSecretPath({
      stage: "dev",
      tenantId: "aaaa-bbbb",
      userId: "cccc-dddd",
      connectionType: "github",
    });
    expect(path).toBe("thinkwork/dev/sandbox/aaaa-bbbb/cccc-dddd/oauth/github");
  });

  it("keeps stages isolated in the path", () => {
    const dev = buildSandboxSecretPath({
      stage: "dev",
      tenantId: "t",
      userId: "u",
      connectionType: "slack",
    });
    const prod = buildSandboxSecretPath({
      stage: "prod",
      tenantId: "t",
      userId: "u",
      connectionType: "slack",
    });
    expect(dev).not.toBe(prod);
    expect(dev).toContain("/dev/");
    expect(prod).toContain("/prod/");
  });
});

describe("SANDBOX_ALLOWED_CONNECTION_TYPES", () => {
  it("matches the brainstorm R11 + Unit 2 provider set", () => {
    expect([...SANDBOX_ALLOWED_CONNECTION_TYPES].sort()).toEqual(
      ["github", "google", "slack"].sort(),
    );
  });
});

// Exercising writeSandboxSecrets requires mocking Secrets Manager + the
// close-to-use DB recheck. Both are infrastructure paths. We assert
// shape via the injected resolver instead — the point-of-failure the
// unit tests protect is the request-shaping logic, not the AWS wire.
//
// We do verify the pre-flight validation: unknown connection types must
// throw before any resolver call, even when an injected resolver would
// otherwise succeed.
describe("writeSandboxSecrets — input validation", () => {
  it("throws on an unknown connection_type before touching the resolver", async () => {
    const { writeSandboxSecrets } = await import("./sandbox-secrets.js");
    const spy = vi.fn();
    await expect(
      writeSandboxSecrets({
        stage: "dev",
        tenantId: "t",
        userId: "u",
        requiredConnections: ["notion" as any],
        resolveTokenForUserProvider: spy,
      }),
    ).rejects.toThrow(/Unknown connection_type 'notion'/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("surfaces ConnectionRevokedError when the resolver returns null", async () => {
    const { writeSandboxSecrets, ConnectionRevokedError } =
      await import("./sandbox-secrets.js");
    await expect(
      writeSandboxSecrets({
        stage: "dev",
        tenantId: "t",
        userId: "u",
        requiredConnections: ["github"],
        resolveTokenForUserProvider: async () => null,
      }),
    ).rejects.toBeInstanceOf(ConnectionRevokedError);
  });
});

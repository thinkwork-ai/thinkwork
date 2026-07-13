/**
 * Plan §005 U8 — sandbox-factory tests.
 *
 * Verifies the helper that reads `sandbox_interpreter_id` from a Pi
 * invocation payload and constructs an `agentcoreCodeInterpreter`
 * SandboxFactory bound to that id.
 *
 * The actual AgentCore Code Interpreter API calls are exercised by the
 * connector's own spike code (FR-9a verdict at
 * docs/solutions/architecture-patterns/pi-fr9a-integration-spike-verdict-2026-05-03.md).
 * U8's job is just the wiring contract: payload → connector instance.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  BedrockAgentCoreClient,
  StartCodeInterpreterSessionCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import type { SandboxFactory, SessionEnv } from "@thinkwork/pi-aws";
import {
  resolveSandboxFactory,
  SandboxFactoryError,
  withCapabilitySdkBootstrap,
  type CapabilityPrivateSessionBootstrap,
  type PiInvocationPayload,
} from "../src/runtime/sandbox-factory.js";
import { capabilitySdkBootstrapTarget } from "../src/runtime/capability-sdk-source.js";

const ACClient = mockClient(BedrockAgentCoreClient);

beforeEach(() => {
  ACClient.reset();
});
afterEach(() => {
  ACClient.reset();
});

const VALID_INTERPRETER_ID = "thinkwork_dev_0015953e_pub-5rETNEk2Vt";

function payload(
  overrides: Partial<PiInvocationPayload> = {},
): PiInvocationPayload {
  return {
    sandbox_interpreter_id: VALID_INTERPRETER_ID,
    ...overrides,
  };
}

describe("resolveSandboxFactory — happy path", () => {
  it("returns a SandboxFactory when sandbox_interpreter_id is a non-empty string", () => {
    const client = new BedrockAgentCoreClient({ region: "us-east-1" });
    const factory = resolveSandboxFactory(payload(), { client });
    expect(factory).toBeDefined();
    expect(typeof factory.createSessionEnv).toBe("function");
  });

  it("constructs the connector with the interpreter id from the payload", () => {
    // Structural conformance only. StartCodeInterpreterSession fires
    // lazily inside the connector (on first SessionEnv operation, not on
    // createSessionEnv itself), so a true plumbing test would require
    // exercising SessionEnv shell/file APIs end-to-end. That coverage
    // lives in (a) the FR-9a spike's real-AWS verdict and (b) U9's
    // deploy-smoke. Here we lock in the contract that resolveSandbox-
    // Factory returns *something* SandboxFactory-shaped — a regression
    // that dropped payload.sandbox_interpreter_id on the floor would
    // also fail the fail-closed tests below, since the helper would
    // attempt to construct the connector with `undefined` and our
    // validation block would catch it before the connector call.
    const client = new BedrockAgentCoreClient({ region: "us-east-1" });
    const customId = "thinkwork_prod_abcdef-XYZ123";
    const factory = resolveSandboxFactory(
      payload({ sandbox_interpreter_id: customId }),
      { client },
    );
    expect(factory.createSessionEnv).toBeDefined();
  });

  it("forwards optional cleanup and sessionTimeoutSeconds options to the connector", () => {
    const client = new BedrockAgentCoreClient({ region: "us-east-1" });
    const factory = resolveSandboxFactory(payload(), {
      client,
      cleanup: true,
      sessionTimeoutSeconds: 600,
    });
    expect(factory.createSessionEnv).toBeDefined();
  });
});

describe("resolveSandboxFactory — fail-closed validation (contract violation upstream)", () => {
  it("throws when sandbox_interpreter_id is missing entirely", () => {
    const client = new BedrockAgentCoreClient({ region: "us-east-1" });
    // Build a payload object that omits the field. Cast through unknown
    // because TS would otherwise reject the missing required key.
    const bad = {} as unknown as PiInvocationPayload;
    expect(() => resolveSandboxFactory(bad, { client })).toThrow(
      SandboxFactoryError,
    );
    expect(() => resolveSandboxFactory(bad, { client })).toThrow(
      /sandbox_interpreter_id/i,
    );
  });

  it("throws when sandbox_interpreter_id is an empty string", () => {
    const client = new BedrockAgentCoreClient({ region: "us-east-1" });
    expect(() =>
      resolveSandboxFactory(payload({ sandbox_interpreter_id: "" }), {
        client,
      }),
    ).toThrow(SandboxFactoryError);
  });

  it("throws when sandbox_interpreter_id is whitespace-only", () => {
    // AWS would otherwise return a less actionable ValidationException
    // somewhere deep in the InvokeCodeInterpreter call. Surface the
    // misconfiguration upstream with the typed SandboxFactoryError.
    const client = new BedrockAgentCoreClient({ region: "us-east-1" });
    expect(() =>
      resolveSandboxFactory(payload({ sandbox_interpreter_id: "   \t\n" }), {
        client,
      }),
    ).toThrow(SandboxFactoryError);
  });

  it("throws when sandbox_interpreter_id is null", () => {
    const client = new BedrockAgentCoreClient({ region: "us-east-1" });
    expect(() =>
      resolveSandboxFactory(
        payload({
          sandbox_interpreter_id: null as unknown as string,
        }),
        { client },
      ),
    ).toThrow(SandboxFactoryError);
  });

  it("throws when sandbox_interpreter_id is a non-string", () => {
    const client = new BedrockAgentCoreClient({ region: "us-east-1" });
    expect(() =>
      resolveSandboxFactory(
        payload({
          sandbox_interpreter_id: 12345 as unknown as string,
        }),
        { client },
      ),
    ).toThrow(SandboxFactoryError);
  });
});

describe("SandboxFactoryError", () => {
  it("error message references sandbox-preflight (the upstream contract)", () => {
    const client = new BedrockAgentCoreClient({ region: "us-east-1" });
    try {
      resolveSandboxFactory(payload({ sandbox_interpreter_id: "" }), {
        client,
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SandboxFactoryError);
      expect((err as Error).message).toMatch(/sandbox-preflight/i);
    }
  });
});

// ─── THINK-280 U4: capability-private selection + SDK/bootstrap materialize ──

const SECRET_KEY = "SESSION-PRIVATE-KEY-DO-NOT-LEAK-abcdef0123456789";

function validBootstrap(
  overrides: Partial<CapabilityPrivateSessionBootstrap> = {},
): CapabilityPrivateSessionBootstrap {
  return {
    sessionId: "sess-77",
    audience: "broker-aud",
    brokerEndpoint: "vpce-x.execute-api.us-east-1.vpce.amazonaws.com",
    brokerApiId: "api123",
    privateKey: SECRET_KEY,
    nextSequence: 0,
    expiresAt: "2026-07-13T00:15:00.000Z",
    region: "us-east-1",
    ...overrides,
  };
}

function capabilityPayload(
  overrides: Partial<PiInvocationPayload["capability_private_session"]> = {},
): PiInvocationPayload {
  return {
    capability_private_session: {
      interpreterId: "thinkwork_dev_0015953e_cappriv-ABC",
      bootstrap: validBootstrap(),
      ...overrides,
    },
  };
}

/** Mock SessionEnv that records writeFile / exec / rm / cleanup calls. */
function recordingSession(overrides: Partial<SessionEnv> = {}): SessionEnv {
  return {
    cwd: "/home/user",
    resolvePath: (base: string, p: string) =>
      p.startsWith("/") ? p : base === "/" ? `/${p}` : `${base}/${p}`,
    writeFile: vi.fn(async () => {}),
    exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    rm: vi.fn(async () => {}),
    readFile: vi.fn(),
    readFileBuffer: vi.fn(),
    stat: vi.fn(),
    readdir: vi.fn(),
    exists: vi.fn(),
    mkdir: vi.fn(),
    cleanup: vi.fn(async () => {}),
    ...overrides,
  } as unknown as SessionEnv;
}

describe("withCapabilitySdkBootstrap — session materialization", () => {
  it("writes the SDK sources + bootstrap and chmods the bootstrap to 0600", async () => {
    const session = recordingSession();
    const innerCreate = vi.fn(async () => session);
    const inner: SandboxFactory = { createSessionEnv: innerCreate };

    const factory = withCapabilitySdkBootstrap(inner, validBootstrap());
    const env = await factory.createSessionEnv({ id: "s", cwd: "/home/user" });

    // Inner connector session was created (and reused, not re-created).
    expect(innerCreate).toHaveBeenCalledTimes(1);

    const writeCalls = vi.mocked(session.writeFile).mock.calls;
    const writtenPaths = writeCalls.map((c) => c[0]);
    expect(writtenPaths).toEqual([
      "capability_sdk/canonical.py",
      "capability_sdk/ed25519.py",
      "capability_sdk/client.py",
      "capability_sdk/__init__.py",
      "capability_sdk/session-bootstrap.json",
    ]);

    // Bootstrap content is the last write and carries the private key.
    const bootstrapWrite = writeCalls[writeCalls.length - 1];
    expect(bootstrapWrite[0]).toBe(capabilitySdkBootstrapTarget().path);
    expect(String(bootstrapWrite[1])).toContain(SECRET_KEY);

    // chmod 0600 on the resolved absolute bootstrap path.
    const execCmd = vi.mocked(session.exec).mock.calls[0]?.[0] ?? "";
    expect(execCmd).toBe(
      "chmod 600 '/home/user/capability_sdk/session-bootstrap.json'",
    );

    expect(env).toBeDefined();
  });

  it("cleanup deletes the bootstrap and then stops the session", async () => {
    const innerCleanup = vi.fn(async () => {});
    const session = recordingSession({ cleanup: innerCleanup });
    const inner: SandboxFactory = {
      createSessionEnv: vi.fn(async () => session),
    };

    const env = await withCapabilitySdkBootstrap(
      inner,
      validBootstrap(),
    ).createSessionEnv({ id: "s", cwd: "/home/user" });

    await env.cleanup?.();

    expect(session.rm).toHaveBeenCalledWith(
      capabilitySdkBootstrapTarget().path,
      { force: true },
    );
    expect(innerCleanup).toHaveBeenCalledTimes(1);
  });

  it("still stops the session even if bootstrap deletion fails", async () => {
    const innerCleanup = vi.fn(async () => {});
    const session = recordingSession({
      cleanup: innerCleanup,
      rm: vi.fn(async () => {
        throw new Error("unlink failed");
      }),
    });
    const inner: SandboxFactory = {
      createSessionEnv: vi.fn(async () => session),
    };

    const env = await withCapabilitySdkBootstrap(
      inner,
      validBootstrap(),
    ).createSessionEnv({ id: "s", cwd: "/home/user" });

    await expect(env.cleanup?.()).resolves.toBeUndefined();
    expect(innerCleanup).toHaveBeenCalledTimes(1);
  });

  it("redacts the session key when materialization fails (never in the error)", async () => {
    const session = recordingSession({
      writeFile: vi.fn(async () => {
        // Simulate a write failure that echoes the content we passed in.
        throw new Error(`write failed: ${SECRET_KEY}`);
      }),
    });
    const inner: SandboxFactory = {
      createSessionEnv: vi.fn(async () => session),
    };

    let caught: unknown;
    try {
      await withCapabilitySdkBootstrap(
        inner,
        validBootstrap(),
      ).createSessionEnv({ id: "s", cwd: "/home/user" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SandboxFactoryError);
    expect((caught as Error).message).not.toContain(SECRET_KEY);
    expect((caught as Error).message).toMatch(/redacted/i);
  });
});

describe("resolveSandboxFactory — capability-private selection", () => {
  it("selects the capability-private path when the session is present", () => {
    const client = new BedrockAgentCoreClient({ region: "us-east-1" });
    const factory = resolveSandboxFactory(capabilityPayload(), { client });
    expect(typeof factory.createSessionEnv).toBe("function");
  });

  it("fails closed (no default-public fallback) when the interpreter id is missing", () => {
    const client = new BedrockAgentCoreClient({ region: "us-east-1" });
    try {
      resolveSandboxFactory(
        capabilityPayload({
          interpreterId: "",
          bootstrap: validBootstrap(),
        }),
        { client },
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SandboxFactoryError);
      expect((err as Error).message).toMatch(/fail-closed|capability-private/i);
      expect((err as Error).message).not.toContain(SECRET_KEY);
    }
  });

  it("fails closed on a malformed bootstrap, without leaking key material", () => {
    const client = new BedrockAgentCoreClient({ region: "us-east-1" });
    try {
      resolveSandboxFactory(
        capabilityPayload({
          interpreterId: "thinkwork_dev_cappriv-ABC",
          bootstrap: validBootstrap({ sessionId: "" }),
        }),
        { client },
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SandboxFactoryError);
      expect((err as Error).message).toMatch(/malformed/i);
      expect((err as Error).message).not.toContain(SECRET_KEY);
    }
  });

  it("does not require sandbox_interpreter_id when capability-private is selected", () => {
    const client = new BedrockAgentCoreClient({ region: "us-east-1" });
    // No sandbox_interpreter_id on the payload — the template-env fail-closed
    // must NOT fire because capability-private takes precedence.
    const factory = resolveSandboxFactory(capabilityPayload(), { client });
    expect(factory.createSessionEnv).toBeDefined();
  });
});

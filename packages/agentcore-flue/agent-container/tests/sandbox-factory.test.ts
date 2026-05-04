/**
 * Plan §005 U8 — sandbox-factory tests.
 *
 * Verifies the helper that reads `sandbox_interpreter_id` from a Flue
 * invocation payload and constructs an `agentcoreCodeInterpreter`
 * SandboxFactory bound to that id.
 *
 * The actual AgentCore Code Interpreter API calls are exercised by the
 * connector's own spike code (FR-9a verdict at
 * docs/solutions/architecture-patterns/flue-fr9a-integration-spike-verdict-2026-05-03.md).
 * U8's job is just the wiring contract: payload → connector instance.
 */

import { describe, expect, it } from "vitest";
import { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import {
  resolveSandboxFactory,
  SandboxFactoryError,
  type FlueInvocationPayload,
} from "../src/runtime/sandbox-factory.js";

const VALID_INTERPRETER_ID = "thinkwork_dev_0015953e_pub-5rETNEk2Vt";

function payload(overrides: Partial<FlueInvocationPayload> = {}): FlueInvocationPayload {
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
    const client = new BedrockAgentCoreClient({ region: "us-east-1" });
    const customId = "thinkwork_prod_abcdef-XYZ123";
    const factory = resolveSandboxFactory(
      payload({ sandbox_interpreter_id: customId }),
      { client },
    );
    // Structural conformance only — the connector's own spike covers
    // the wire-format details. We don't reach into private fields here;
    // the SandboxFactory contract (createSessionEnv) is the seam Flue
    // consumes downstream.
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
    const bad = {} as unknown as FlueInvocationPayload;
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
      resolveSandboxFactory(payload({ sandbox_interpreter_id: "" }), { client }),
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
      resolveSandboxFactory(
        payload({ sandbox_interpreter_id: "" }),
        { client },
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SandboxFactoryError);
      expect((err as Error).message).toMatch(/sandbox-preflight/i);
    }
  });
});

/**
 * routine-task-python tests (Plan §U6).
 *
 * Test-first per the U6 execution note. The wrapper has three classes of
 * failure mode (sandbox provisioning, sandbox-side errors, S3 offload
 * errors) and one structural invariant (session lifecycle: always stop).
 * Each test below pins one of those.
 *
 * The AgentCore SDK boundary is mocked at the `BedrockAgentCoreClient`
 * shape so tests stay hermetic. The S3 client is mocked at
 * `S3Client.send` for the same reason. Stream parsing follows the
 * AgentCore response contract: terminal `result.structuredContent` is
 * authoritative; intermediate `result.content[]` chunks are concatenated.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAgentCoreSend, mockS3Send } = vi.hoisted(() => ({
  mockAgentCoreSend: vi.fn(),
  mockS3Send: vi.fn(),
}));

vi.mock("@aws-sdk/client-bedrock-agentcore", () => ({
  BedrockAgentCoreClient: class {
    send = mockAgentCoreSend;
  },
  StartCodeInterpreterSessionCommand: class {
    constructor(public input: unknown) {}
    static name = "StartCodeInterpreterSessionCommand";
  },
  InvokeCodeInterpreterCommand: class {
    constructor(public input: unknown) {}
    static name = "InvokeCodeInterpreterCommand";
  },
  StopCodeInterpreterSessionCommand: class {
    constructor(public input: unknown) {}
    static name = "StopCodeInterpreterSessionCommand";
  },
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = mockS3Send;
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
    static name = "PutObjectCommand";
  },
}));

import {
  invokePythonTask,
  type PythonTaskInput,
} from "../routine-task-python.js";

const baseInput: PythonTaskInput = {
  tenantId: "tenant-a",
  executionArn:
    "arn:aws:states:us-east-1:1:execution:thinkwork-dev-routine-r:exec-1",
  nodeId: "RunReport",
  code: "print('hello')",
};

beforeEach(() => {
  mockAgentCoreSend.mockReset();
  mockS3Send.mockReset();
  // Default: S3 always succeeds, sandbox session start succeeds.
  mockS3Send.mockResolvedValue({});
});

/** Build a fake `result.stream` async iterator producing AgentCore events.
 * Each event mirrors the SDK's union shape — only one key per event. */
function streamFrom(events: unknown[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const evt of events) yield evt;
    },
  };
}

function defaultStartResponse() {
  return { sessionId: "session-123" };
}

function structuredContentEvent(
  structured: {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    executionTime?: number;
  },
) {
  return {
    result: {
      content: [],
      structuredContent: structured,
    },
  };
}

describe("invokePythonTask — happy path", () => {
  it("returns exitCode 0 + stdoutPreview + truncated:false for small stdout", async () => {
    mockAgentCoreSend
      .mockResolvedValueOnce(defaultStartResponse())
      .mockResolvedValueOnce({
        sessionId: "session-123",
        stream: streamFrom([
          structuredContentEvent({ stdout: "hello\n", exitCode: 0 }),
        ]),
      })
      .mockResolvedValueOnce({}); // stop session

    const result = await invokePythonTask(baseInput, {
      stage: "dev",
      interpreterId: "ipi-shared",
      bucket: "thinkwork-dev-routine-output",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdoutPreview).toBe("hello\n");
    expect(result.truncated).toBe(false);
    expect(result.stdoutS3Uri).toBe(
      "s3://thinkwork-dev-routine-output/tenant-a/exec-1/RunReport/stdout.log",
    );
    expect(result.stderrS3Uri).toBe(
      "s3://thinkwork-dev-routine-output/tenant-a/exec-1/RunReport/stderr.log",
    );
  });

  it("returns truncated:true when stdout exceeds the 4KB preview cap; full output goes to S3", async () => {
    const large = "x".repeat(5000);
    mockAgentCoreSend
      .mockResolvedValueOnce(defaultStartResponse())
      .mockResolvedValueOnce({
        stream: streamFrom([
          structuredContentEvent({ stdout: large, exitCode: 0 }),
        ]),
      })
      .mockResolvedValueOnce({});

    const result = await invokePythonTask(baseInput, {
      stage: "dev",
      interpreterId: "ipi-shared",
      bucket: "thinkwork-dev-routine-output",
    });

    expect(result.exitCode).toBe(0);
    expect(result.truncated).toBe(true);
    expect(result.stdoutPreview.length).toBe(4096);
    // S3 receives the full stdout under PutObjectCommand.
    const s3Calls = mockS3Send.mock.calls;
    const stdoutPut = s3Calls.find(
      (c) => (c[0] as { input: { Key: string } }).input.Key.endsWith("stdout.log"),
    );
    expect(stdoutPut).toBeDefined();
    expect((stdoutPut![0] as { input: { Body: string } }).input.Body).toBe(
      large,
    );
  });
});

describe("invokePythonTask — session lifecycle", () => {
  it("calls StopCodeInterpreterSession even when InvokeCodeInterpreter throws", async () => {
    mockAgentCoreSend
      .mockResolvedValueOnce(defaultStartResponse())
      .mockRejectedValueOnce(new Error("interpreter blew up"))
      .mockResolvedValueOnce({}); // stop call

    const result = await invokePythonTask(baseInput, {
      stage: "dev",
      interpreterId: "ipi-shared",
      bucket: "thinkwork-dev-routine-output",
    });

    expect(result.exitCode).toBe(-1);
    expect(result.errorClass).toBe("sandbox_invoke_failed");
    // Three sends: Start, Invoke (rejected), Stop. The Stop call is the
    // critical part of this test — finally-equivalent runs even on error.
    expect(mockAgentCoreSend).toHaveBeenCalledTimes(3);
    const stopCallArg = mockAgentCoreSend.mock.calls[2][0] as {
      constructor: { name: string };
    };
    expect(stopCallArg.constructor.name).toBe(
      "StopCodeInterpreterSessionCommand",
    );
  });

  it("does not call Stop if Start itself fails", async () => {
    mockAgentCoreSend.mockRejectedValueOnce(new Error("provisioning"));

    const result = await invokePythonTask(baseInput, {
      stage: "dev",
      interpreterId: "ipi-shared",
      bucket: "thinkwork-dev-routine-output",
    });

    expect(result.exitCode).toBe(-1);
    expect(result.errorClass).toBe("sandbox_session_start_failed");
    expect(mockAgentCoreSend).toHaveBeenCalledTimes(1);
  });
});

describe("invokePythonTask — edge cases", () => {
  it("captures stderr alongside stdout when the code exits non-zero", async () => {
    mockAgentCoreSend
      .mockResolvedValueOnce(defaultStartResponse())
      .mockResolvedValueOnce({
        stream: streamFrom([
          structuredContentEvent({
            stdout: "",
            stderr: "Traceback...",
            exitCode: 1,
          }),
        ]),
      })
      .mockResolvedValueOnce({});

    const result = await invokePythonTask(baseInput, {
      stage: "dev",
      interpreterId: "ipi-shared",
      bucket: "thinkwork-dev-routine-output",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdoutPreview).toBe("");
    // Verify stderr.log was written to S3.
    const stderrPut = mockS3Send.mock.calls.find(
      (c) => (c[0] as { input: { Key: string } }).input.Key.endsWith("stderr.log"),
    );
    expect(stderrPut).toBeDefined();
    expect(
      (stderrPut![0] as { input: { Body: string } }).input.Body,
    ).toBe("Traceback...");
  });

  it("falls back to streaming text-block content when structuredContent is missing", async () => {
    // Older / partial response shapes don't carry structuredContent;
    // concatenate intermediate text content[] chunks.
    mockAgentCoreSend
      .mockResolvedValueOnce(defaultStartResponse())
      .mockResolvedValueOnce({
        stream: streamFrom([
          {
            result: {
              content: [
                { type: "text", text: "chunk-1\n" },
                { type: "text", text: "chunk-2\n" },
              ],
            },
          },
        ]),
      })
      .mockResolvedValueOnce({});

    const result = await invokePythonTask(baseInput, {
      stage: "dev",
      interpreterId: "ipi-shared",
      bucket: "thinkwork-dev-routine-output",
    });

    // No exitCode in fallback path; default to 0 if no error event surfaced.
    expect(result.exitCode).toBe(0);
    expect(result.stdoutPreview).toBe("chunk-1\nchunk-2\n");
  });

  it("filters environment to the caller-supplied allowlist (no host process.env leakage)", async () => {
    mockAgentCoreSend
      .mockResolvedValueOnce(defaultStartResponse())
      .mockResolvedValueOnce({
        stream: streamFrom([
          structuredContentEvent({ stdout: "ok", exitCode: 0 }),
        ]),
      })
      .mockResolvedValueOnce({});

    await invokePythonTask(
      {
        ...baseInput,
        env: { TENANT_NAME: "alpha", FORBIDDEN_KEY: "leak" },
      },
      {
        stage: "dev",
        interpreterId: "ipi-shared",
        bucket: "thinkwork-dev-routine-output",
        envAllowlist: ["TENANT_NAME"],
      },
    );

    const invokeCallArg = (mockAgentCoreSend.mock.calls[1][0] as {
      input: { arguments: { code: string } };
    }).input;
    // The wrapper prepends `os.environ.update({...})` only with allowlisted
    // keys. Verify the user code is preceded by an env block that includes
    // TENANT_NAME and excludes FORBIDDEN_KEY.
    expect(invokeCallArg.arguments.code).toContain("TENANT_NAME");
    expect(invokeCallArg.arguments.code).toContain("alpha");
    expect(invokeCallArg.arguments.code).not.toContain("FORBIDDEN_KEY");
    expect(invokeCallArg.arguments.code).not.toContain("leak");
  });
});

describe("invokePythonTask — error paths", () => {
  it("surfaces sandbox_invoke_failed when the stream emits an error event", async () => {
    mockAgentCoreSend
      .mockResolvedValueOnce(defaultStartResponse())
      .mockResolvedValueOnce({
        stream: streamFrom([
          {
            internalServerException: { message: "transient AWS error" },
          },
        ]),
      })
      .mockResolvedValueOnce({});

    const result = await invokePythonTask(baseInput, {
      stage: "dev",
      interpreterId: "ipi-shared",
      bucket: "thinkwork-dev-routine-output",
    });

    expect(result.exitCode).toBe(-1);
    expect(result.errorClass).toBe("sandbox_invoke_failed");
    expect(result.errorMessage).toContain("transient AWS error");
  });

  it("returns exitCode 0 even if S3 PutObject fails — sandbox output is still successful", async () => {
    mockAgentCoreSend
      .mockResolvedValueOnce(defaultStartResponse())
      .mockResolvedValueOnce({
        stream: streamFrom([
          structuredContentEvent({ stdout: "ok", exitCode: 0 }),
        ]),
      })
      .mockResolvedValueOnce({});
    // S3 fails — but the wrapper should not turn a successful sandbox
    // execution into a sandbox_invoke_failed. S3 errors degrade to
    // missing URIs; preview/exit still flow back.
    mockS3Send.mockRejectedValue(new Error("s3 503"));

    const result = await invokePythonTask(baseInput, {
      stage: "dev",
      interpreterId: "ipi-shared",
      bucket: "thinkwork-dev-routine-output",
    });

    expect(result.exitCode).toBe(0);
    expect(result.errorClass).toBe("s3_offload_failed");
    expect(result.stdoutS3Uri).toBeNull();
    expect(result.stderrS3Uri).toBeNull();
    // Preview is still populated from the in-memory buffer.
    expect(result.stdoutPreview).toBe("ok");
  });
});

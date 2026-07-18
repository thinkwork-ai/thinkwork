import { describe, expect, it } from "vitest";
import {
  HARNESS_SANDBOX_MAX_CODE_BYTES,
  HarnessSandboxPolicyError,
  sandboxSessionAlias,
  sandboxSessionName,
  sanitizeHarnessSandboxResult,
  validateHarnessSandboxRequest,
} from "./sandbox-session-policy.js";

describe("Harness sandbox session policy", () => {
  it("accepts bounded Python and output files under the isolated export root", () => {
    expect(
      validateHarnessSandboxRequest({
        code: "print(6 * 7)",
        language: "python",
        output_files: ["/tmp/thinkwork/result.txt"],
      }),
    ).toEqual({
      code: "print(6 * 7)",
      language: "python",
      outputFiles: ["/tmp/thinkwork/result.txt"],
    });
  });

  it.each([
    ["unsupported_language", { code: "1 + 1", language: "javascript" }],
    [
      "invalid_output_file",
      { code: "1 + 1", language: "python", output_files: ["/etc/passwd"] },
    ],
    [
      "invalid_output_file",
      {
        code: "1 + 1",
        language: "python",
        output_files: ["/tmp/thinkwork/../secret"],
      },
    ],
    [
      "invalid_code",
      {
        code: "x".repeat(HARNESS_SANDBOX_MAX_CODE_BYTES + 1),
        language: "python",
      },
    ],
  ])("rejects %s", (code, input) => {
    try {
      validateHarnessSandboxRequest(input);
      expect.unreachable("policy input should be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessSandboxPolicyError);
      expect((error as HarnessSandboxPolicyError).code).toBe(code);
    }
  });

  it("caps all returned text under one output budget", () => {
    const result = sanitizeHarnessSandboxResult({
      stdout: "x".repeat(100_000),
      stderr: "y".repeat(100_000),
      exitCode: 0,
      executionTimeSeconds: 0.2,
      files: [{ path: "/tmp/thinkwork/result.txt", text: "z".repeat(100_000) }],
      truncated: false,
    });
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(
      140_000,
    );
    expect(result.truncated).toBe(true);
  });

  it("derives stable opaque session labels without exposing the session id", () => {
    expect(sandboxSessionName("turn-123", "tool-456")).toBe(
      sandboxSessionName("turn-123", "tool-456"),
    );
    expect(sandboxSessionAlias("secret-session-id")).toMatch(
      /^sandbox:[a-f0-9]{16}$/,
    );
    expect(sandboxSessionAlias("secret-session-id")).not.toContain(
      "secret-session-id",
    );
  });
});

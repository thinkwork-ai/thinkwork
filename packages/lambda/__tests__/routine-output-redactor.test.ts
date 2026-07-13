import { describe, expect, it } from "vitest";
import {
  collectSecretLeafValues,
  createRoutineOutputRedactor,
} from "../routine-output-redactor.js";

describe("routine-output-redactor", () => {
  it("collects non-empty secret leaf values and skips empty/null leaves", () => {
    expect(
      collectSecretLeafValues({
        apiUrl: "https://pdi.example.test",
        password: "super-secret-password",
        nested: { token: "tok_123", enabled: true, empty: "", nil: null },
        list: ["partner-123", 123, undefined],
      }),
    ).toEqual([
      "https://pdi.example.test",
      "super-secret-password",
      "tok_123",
      "partner-123",
    ]);
  });

  it("redacts exact credential values and known token shapes", () => {
    const redactor = createRoutineOutputRedactor([
      {
        password: "super-secret-password",
        nested: { partnerId: "partner-123" },
      },
    ]);

    const output = redactor.redact(
      "password=super-secret-password partner=partner-123 token=ghp_123456789012345678901234",
    );

    expect(output).toBe(
      "password=<redacted> partner=<redacted> token=<redacted>",
    );
  });

  it("redacts values from resolved-credential-shaped sources (broker adapter evidence path)", () => {
    // The capability broker feeds its resolved credential payloads (the same
    // shape Secrets Manager returns) as secret sources so adapter evidence —
    // bodies and error messages — never echoes a live token. No extension of
    // the redactor is required: a resolved credential is a plain object whose
    // leaf values are already collected.
    const resolvedCredentials = [
      { token: "ghp_abcdefghijklmnopqrstuvwxyz012345" },
      { apiKey: "sk-live-DEADBEEFcafef00d" },
    ];
    const redactor = createRoutineOutputRedactor(resolvedCredentials);

    const scrubbed = redactor.redact(
      "GET failed with Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz012345 and key sk-live-DEADBEEFcafef00d",
    );

    expect(scrubbed).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz012345");
    expect(scrubbed).not.toContain("sk-live-DEADBEEFcafef00d");
    expect(scrubbed).toContain("<redacted>");
  });
});

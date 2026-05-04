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
});

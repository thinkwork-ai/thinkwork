import { describe, expect, it } from "vitest";
import { genUIError, genUIWarning, firstErrorCode } from "./diagnostics.js";
import type { ThreadGenUIDiagnostic } from "./spec.js";

describe("genUIError", () => {
  it("creates an error diagnostic with all fields", () => {
    const diagnostic = genUIError("GENUI_MISSING", "Element missing", "$.root");
    expect(diagnostic).toEqual({
      code: "GENUI_MISSING",
      message: "Element missing",
      path: "$.root",
      severity: "error",
    });
  });

  it("creates an error diagnostic without path", () => {
    const diagnostic = genUIError("GENUI_INVALID", "Invalid payload");
    expect(diagnostic.path).toBeUndefined();
    expect(diagnostic.severity).toBe("error");
  });
});

describe("genUIWarning", () => {
  it("creates a warning diagnostic", () => {
    const diagnostic = genUIWarning(
      "GENUI_DEPRECATED",
      "Feature deprecated",
      "$.spec",
    );
    expect(diagnostic).toEqual({
      code: "GENUI_DEPRECATED",
      message: "Feature deprecated",
      path: "$.spec",
      severity: "warning",
    });
  });
});

describe("firstErrorCode", () => {
  it("returns the code of the first error-severity diagnostic", () => {
    const diagnostics: ThreadGenUIDiagnostic[] = [
      { code: "WARN_1", message: "warn", severity: "warning" },
      { code: "ERR_1", message: "error one", severity: "error" },
      { code: "ERR_2", message: "error two", severity: "error" },
    ];
    expect(firstErrorCode(diagnostics)).toBe("ERR_1");
  });

  it("falls back to the first diagnostic code when no errors exist", () => {
    const diagnostics: ThreadGenUIDiagnostic[] = [
      { code: "WARN_1", message: "warn", severity: "warning" },
    ];
    expect(firstErrorCode(diagnostics)).toBe("WARN_1");
  });

  it("returns the sentinel code for an empty array", () => {
    expect(firstErrorCode([])).toBe("GENUI_UNKNOWN_DIAGNOSTIC");
  });
});

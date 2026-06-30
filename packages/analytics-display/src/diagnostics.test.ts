import { describe, expect, it } from "vitest";
import { errorDiagnostic, warningDiagnostic } from "./diagnostics.js";

describe("errorDiagnostic", () => {
  it("creates an error diagnostic with path", () => {
    const diagnostic = errorDiagnostic(
      "AD_MISSING",
      "Missing field",
      "$.spec.title",
    );
    expect(diagnostic).toEqual({
      code: "AD_MISSING",
      message: "Missing field",
      path: "$.spec.title",
      severity: "error",
    });
  });

  it("creates an error diagnostic without path", () => {
    const diagnostic = errorDiagnostic("AD_INVALID", "Invalid payload");
    expect(diagnostic.path).toBeUndefined();
    expect(diagnostic.severity).toBe("error");
  });
});

describe("warningDiagnostic", () => {
  it("creates a warning diagnostic with path", () => {
    const diagnostic = warningDiagnostic(
      "AD_DEPRECATED",
      "Deprecated field",
      "$.spec.filters",
    );
    expect(diagnostic).toEqual({
      code: "AD_DEPRECATED",
      message: "Deprecated field",
      path: "$.spec.filters",
      severity: "warning",
    });
  });

  it("creates a warning diagnostic without path", () => {
    const diagnostic = warningDiagnostic("AD_HINT", "Consider upgrading");
    expect(diagnostic.path).toBeUndefined();
    expect(diagnostic.severity).toBe("warning");
  });
});

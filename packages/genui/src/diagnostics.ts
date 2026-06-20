import type { ThreadGenUIDiagnostic } from "./spec.js";

export function genUIError(
  code: string,
  message: string,
  path?: string,
): ThreadGenUIDiagnostic {
  return { code, message, path, severity: "error" };
}

export function genUIWarning(
  code: string,
  message: string,
  path?: string,
): ThreadGenUIDiagnostic {
  return { code, message, path, severity: "warning" };
}

export function firstErrorCode(diagnostics: ThreadGenUIDiagnostic[]): string {
  return (
    diagnostics.find((diagnostic) => diagnostic.severity === "error")?.code ??
    diagnostics[0]?.code ??
    "GENUI_UNKNOWN_DIAGNOSTIC"
  );
}

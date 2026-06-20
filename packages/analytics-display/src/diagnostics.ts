import type { AnalyticsDisplayDiagnostic } from "./spec.js";

export function errorDiagnostic(
  code: string,
  message: string,
  path?: string,
): AnalyticsDisplayDiagnostic {
  return { code, message, path, severity: "error" };
}

export function warningDiagnostic(
  code: string,
  message: string,
  path?: string,
): AnalyticsDisplayDiagnostic {
  return { code, message, path, severity: "warning" };
}

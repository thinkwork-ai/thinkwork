import type { PiExtensionManifest } from "./manifest.js";

export interface PiExtensionVerificationFinding {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
}

export interface PiExtensionVerificationReport {
  schemaVersion: 1;
  status: "passed" | "failed";
  checkedAt: string;
  findings: PiExtensionVerificationFinding[];
}

const SUPPORTED_RUNTIME_TARGETS = new Set(["agentcore-pi", "cloud"]);
const REVIEW_REQUIRED_PERMISSION_CLASSES = new Set([
  "network",
  "workspace_read",
  "workspace_write",
  "provider",
  "secrets",
  "aws",
  "runtime",
]);

export function verifyPiExtensionManifest(input: {
  manifest: PiExtensionManifest;
  checkedAt?: Date;
}): PiExtensionVerificationReport {
  const findings: PiExtensionVerificationFinding[] = [];
  const { manifest } = input;

  if (!SUPPORTED_RUNTIME_TARGETS.has(manifest.runtimeTarget)) {
    findings.push({
      severity: "error",
      code: "unsupported_runtime_target",
      message: `Unsupported runtime target: ${manifest.runtimeTarget}`,
    });
  }

  if (manifest.tools.length === 0 && manifest.lifecycleHooks.length === 0) {
    findings.push({
      severity: "error",
      code: "empty_extension_capabilities",
      message: "Extension must declare at least one tool or lifecycle hook",
    });
  }

  if (!manifest.entrypoint) {
    findings.push({
      severity: "warning",
      code: "missing_entrypoint",
      message:
        "No entrypoint declared; runtime import will remain unavailable until an artifact descriptor is reviewed",
    });
  }

  for (const permissionClass of manifest.permissionClasses) {
    if (!REVIEW_REQUIRED_PERMISSION_CLASSES.has(permissionClass)) {
      findings.push({
        severity: "warning",
        code: "unknown_permission_class",
        message: `Unknown permission class will require explicit reviewer handling: ${permissionClass}`,
      });
    }
  }

  return {
    schemaVersion: 1,
    status: findings.some((finding) => finding.severity === "error")
      ? "failed"
      : "passed",
    checkedAt: (input.checkedAt ?? new Date()).toISOString(),
    findings,
  };
}

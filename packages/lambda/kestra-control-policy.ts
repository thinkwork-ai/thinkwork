export type FlowPolicyResult = {
  ok: boolean;
  namespace: string | null;
  flowId: string | null;
  errors: string[];
  warnings: string[];
};

export type FlowPolicyOptions = {
  allowedNamespacePrefix?: string;
};

const DEFAULT_NAMESPACE_PREFIX = "thinkwork";
const NAMESPACE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*(\.[a-zA-Z0-9_-]+)*$/;
const FLOW_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

const UNSUPPORTED_TASK_PATTERNS = [
  /io\.kestra\.plugin\.docker\./i,
  /io\.kestra\.plugin\.scripts\.runner\.docker\./i,
  /\bDockerOptions\b/i,
  /\btaskRunner\s*:\s*\n(?:[^\n]*\n){0,6}?\s*type\s*:\s*io\.kestra\.plugin\.scripts\.runner\.docker\./i,
];

export function validateKestraNamespace(
  namespace: string,
  options: FlowPolicyOptions = {},
): { ok: true; namespace: string } | { ok: false; error: string } {
  const normalized = namespace.trim();
  const prefix = normalizeNamespacePrefix(options.allowedNamespacePrefix);
  if (!normalized) {
    return { ok: false, error: "namespace is required" };
  }
  if (!NAMESPACE_PATTERN.test(normalized)) {
    return {
      ok: false,
      error:
        "namespace must start with a letter and contain only letters, digits, underscores, hyphens, and dots",
    };
  }
  if (normalized !== prefix && !normalized.startsWith(`${prefix}.`)) {
    return {
      ok: false,
      error: `namespace must be "${prefix}" or start with "${prefix}."`,
    };
  }
  return { ok: true, namespace: normalized };
}

export function evaluateKestraFlowPolicy(
  source: string,
  options: FlowPolicyOptions = {},
): FlowPolicyResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const namespace = readYamlScalar(source, "namespace");
  const flowId = readYamlScalar(source, "id");

  if (!flowId) {
    errors.push("flow source must include a top-level id");
  } else if (!FLOW_ID_PATTERN.test(flowId)) {
    errors.push(
      "flow id must start with a letter and contain only letters, digits, underscores, and hyphens",
    );
  }

  if (!namespace) {
    errors.push("flow source must include a top-level namespace");
  } else {
    const namespaceResult = validateKestraNamespace(namespace, options);
    if (!namespaceResult.ok) {
      errors.push(namespaceResult.error);
    }
  }

  for (const pattern of UNSUPPORTED_TASK_PATTERNS) {
    if (pattern.test(source)) {
      errors.push(
        "flow contains Docker or host-execution task runner configuration that is not supported by the managed Fargate runtime",
      );
      break;
    }
  }

  if (/type\s*:\s*io\.kestra\.plugin\.scripts\./i.test(source)) {
    warnings.push(
      "script tasks must use runtime-safe task runners and dependencies in the managed Fargate profile",
    );
  }

  return {
    ok: errors.length === 0,
    namespace,
    flowId,
    errors,
    warnings,
  };
}

function normalizeNamespacePrefix(prefix: string | undefined): string {
  const normalized = (prefix || DEFAULT_NAMESPACE_PREFIX).trim();
  return normalized || DEFAULT_NAMESPACE_PREFIX;
}

function readYamlScalar(source: string, key: string): string | null {
  const match = source.match(new RegExp(`^${key}\\s*:\\s*([^#\\n]+)`, "m"));
  if (!match) return null;
  return match[1]!.trim().replace(/^["']|["']$/g, "") || null;
}

const DEFAULT_MAX_STRING_LENGTH = 500;
const DEFAULT_MAX_ARRAY_LENGTH = 20;
const MAX_ALLOWLIST_PATHS = 64;
const MAX_PATH_DEPTH = 8;

const SENSITIVE_SEGMENT_PATTERNS = [
  "authorization",
  "cookie",
  "headers",
  "token",
  "secret",
  "password",
  "apikey",
  "credential",
  "vaulthandle",
] as const;

interface PathNode {
  leaf: boolean;
  array: boolean;
  children: Map<string, PathNode>;
}

export interface ToolRecordRedactionOptions {
  /** Dot paths are scalar leaves; append [] to traverse an array. */
  allowPaths: readonly string[];
  /** Exact secret/canary values that must be removed from allowed text. */
  forbiddenValues?: readonly string[];
  maxStringLength?: number;
  maxArrayLength?: number;
}

export class ToolRecordRedactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolRecordRedactionError";
  }
}

function emptyNode(array = false): PathNode {
  return { leaf: false, array, children: new Map() };
}

function normalizedSegment(segment: string): string {
  return segment.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function assertSafeSegment(segment: string, path: string): void {
  const normalized = normalizedSegment(segment);
  if (
    !normalized ||
    SENSITIVE_SEGMENT_PATTERNS.some((pattern) => normalized.includes(pattern))
  ) {
    throw new ToolRecordRedactionError(
      `credential-bearing field is forbidden in tool record allowlist: ${path}`,
    );
  }
}

function buildAllowlistTrie(paths: readonly string[]): PathNode {
  if (paths.length > MAX_ALLOWLIST_PATHS) {
    throw new ToolRecordRedactionError(
      `tool record allowlist exceeds ${MAX_ALLOWLIST_PATHS} paths`,
    );
  }
  const root = emptyNode();
  for (const path of paths) {
    const rawSegments = path.split(".");
    if (
      !path.trim() ||
      rawSegments.some((segment) => !segment) ||
      rawSegments.length > MAX_PATH_DEPTH
    ) {
      throw new ToolRecordRedactionError(`invalid tool record path: ${path}`);
    }
    let node = root;
    for (const [index, rawSegment] of rawSegments.entries()) {
      const array = rawSegment.endsWith("[]");
      const key = array ? rawSegment.slice(0, -2) : rawSegment;
      assertSafeSegment(key, path);
      const existing = node.children.get(key);
      if (existing && existing.array !== array) {
        throw new ToolRecordRedactionError(
          `inconsistent array marker in tool record path: ${path}`,
        );
      }
      const child = existing ?? emptyNode(array);
      node.children.set(key, child);
      node = child;
      if (index === rawSegments.length - 1) node.leaf = true;
    }
  }
  return root;
}

function scrubText(
  value: string,
  forbiddenValues: readonly string[],
  maxLength: number,
): string {
  let result = value;
  for (const forbidden of forbiddenValues) {
    if (forbidden) result = result.split(forbidden).join("[REDACTED]");
  }
  result = result
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]{6,}/gi, "[REDACTED]")
    .replace(
      /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
      "[REDACTED]",
    )
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED]");
  if (result.length <= maxLength) return result;
  if (maxLength === 0) return "";
  return `${result.slice(0, Math.max(0, maxLength - 1))}…`;
}

function projectScalar(
  value: unknown,
  options: Required<
    Pick<ToolRecordRedactionOptions, "maxStringLength" | "maxArrayLength">
  > & { forbiddenValues: readonly string[] },
  path: string,
): string | number | boolean | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "number" || typeof value === "boolean")
    return value;
  if (typeof value === "string") {
    return scrubText(value, options.forbiddenValues, options.maxStringLength);
  }
  throw new ToolRecordRedactionError(
    `tool record allowlist path must end at a scalar leaf: ${path}`,
  );
}

function projectNode(
  source: unknown,
  node: PathNode,
  options: Required<
    Pick<ToolRecordRedactionOptions, "maxStringLength" | "maxArrayLength">
  > & { forbiddenValues: readonly string[] },
  path: string,
): Record<string, unknown> {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new ToolRecordRedactionError(
      `tool record allowlist expected an object at ${path || "root"}`,
    );
  }
  const record = source as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, child] of node.children) {
    const value = record[key];
    if (value === undefined) continue;
    const childPath = path ? `${path}.${key}` : key;
    if (child.array) {
      if (!Array.isArray(value)) {
        throw new ToolRecordRedactionError(
          `tool record allowlist expected an array at ${childPath}`,
        );
      }
      result[key] = value
        .slice(0, options.maxArrayLength)
        .map((item, index) =>
          child.children.size > 0
            ? projectNode(item, child, options, `${childPath}[${index}]`)
            : projectScalar(item, options, `${childPath}[${index}]`),
        )
        .filter((item) => item !== undefined);
      continue;
    }
    if (child.children.size > 0) {
      result[key] = projectNode(value, child, options, childPath);
      continue;
    }
    const scalar = projectScalar(value, options, childPath);
    if (scalar !== undefined) result[key] = scalar;
  }
  return result;
}

/**
 * Produce the only JSON shape callers may pass to durable tool evidence.
 * Unknown paths are dropped, credential-shaped paths are rejected, and
 * allowed scalar values are bounded and scrubbed before the store sees them.
 */
export function redactToolRecord(
  value: unknown,
  options: ToolRecordRedactionOptions,
): Record<string, unknown> {
  const maxStringLength = options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH;
  const maxArrayLength = options.maxArrayLength ?? DEFAULT_MAX_ARRAY_LENGTH;
  if (!Number.isInteger(maxStringLength) || maxStringLength < 0) {
    throw new ToolRecordRedactionError("maxStringLength must be nonnegative");
  }
  if (!Number.isInteger(maxArrayLength) || maxArrayLength < 0) {
    throw new ToolRecordRedactionError("maxArrayLength must be nonnegative");
  }
  const trie = buildAllowlistTrie(options.allowPaths);
  if (trie.children.size === 0) return {};
  return projectNode(
    value,
    trie,
    {
      forbiddenValues: options.forbiddenValues ?? [],
      maxStringLength,
      maxArrayLength,
    },
    "",
  );
}

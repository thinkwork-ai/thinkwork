export type WorkspaceTargetResult =
  | {
      valid: true;
      normalizedPath: string;
      depth: number;
      reason: null;
    }
  | {
      valid: false;
      normalizedPath: null;
      depth: number;
      reason:
        | "empty"
        | "absolute"
        | "traversal"
        | "malformed"
        | "reserved_name"
        | "depth_exceeded"
        | "not_routable";
    };

const TARGET_RE =
  /^[a-z0-9][a-z0-9-]{0,63}(\/[a-z0-9][a-z0-9-]{0,63})*$/;
const RESERVED_SEGMENTS = new Set(["memory", "skills"]);
export const WORKSPACE_TARGET_DEPTH_CAP = 4;

function normalizeRoute(route: string): string | null {
  const trimmed = route.trim().replace(/\/+$/g, "");
  if (!trimmed || trimmed === ".") return "";
  if (!TARGET_RE.test(trimmed)) return null;
  if (trimmed.split("/").some((segment) => RESERVED_SEGMENTS.has(segment))) {
    return null;
  }
  return trimmed;
}

export function parseWorkspaceTarget(
  input: string,
  agentsMdRoutes: string[],
): WorkspaceTargetResult {
  if (input == null) {
    return { valid: false, normalizedPath: null, depth: 0, reason: "empty" };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return { valid: false, normalizedPath: null, depth: 0, reason: "empty" };
  }
  if (trimmed === ".") {
    return { valid: true, normalizedPath: "", depth: 0, reason: null };
  }
  if (trimmed.startsWith("/")) {
    return { valid: false, normalizedPath: null, depth: 0, reason: "absolute" };
  }
  if (trimmed.includes("\\") || trimmed.includes("?") || trimmed.includes("#")) {
    return { valid: false, normalizedPath: null, depth: 0, reason: "malformed" };
  }
  if (trimmed.includes("..")) {
    return { valid: false, normalizedPath: null, depth: 0, reason: "traversal" };
  }
  if (!TARGET_RE.test(trimmed)) {
    return { valid: false, normalizedPath: null, depth: 0, reason: "malformed" };
  }

  const segments = trimmed.split("/");
  const depth = segments.length;
  if (segments.some((segment) => RESERVED_SEGMENTS.has(segment))) {
    return {
      valid: false,
      normalizedPath: null,
      depth,
      reason: "reserved_name",
    };
  }
  if (depth > WORKSPACE_TARGET_DEPTH_CAP) {
    return {
      valid: false,
      normalizedPath: null,
      depth,
      reason: "depth_exceeded",
    };
  }

  const routable = new Set(
    agentsMdRoutes
      .map(normalizeRoute)
      .filter((route): route is string => route !== null),
  );
  if (!routable.has(trimmed)) {
    return {
      valid: false,
      normalizedPath: null,
      depth,
      reason: "not_routable",
    };
  }

  return { valid: true, normalizedPath: trimmed, depth, reason: null };
}


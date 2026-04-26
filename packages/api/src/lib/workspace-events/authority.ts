import { parseWorkspaceTarget } from "../workspace-target.js";

export interface WorkspaceTargetAuthorityResult {
  ok: boolean;
  normalizedPath?: string;
  depth?: number;
  reason?: string;
}

export function validateWorkspaceEventTarget(
  targetPath: string,
  agentsMdRoutes: string[],
): WorkspaceTargetAuthorityResult {
  if (!targetPath) {
    return { ok: true, normalizedPath: "", depth: 0 };
  }
  const result = parseWorkspaceTarget(targetPath, agentsMdRoutes);
  if (!result.valid) {
    return { ok: false, reason: result.reason, depth: result.depth };
  }
  return {
    ok: true,
    normalizedPath: result.normalizedPath,
    depth: result.depth,
  };
}


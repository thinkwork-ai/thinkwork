import type {
  WorkspaceCache,
  WorkspaceCachePartition,
} from "../workspace-cache";
import type { WorkspaceTarget } from "@/lib/workspace-api";

export interface WorkspaceToolOptions {
  cache: WorkspaceCache;
  partition: WorkspaceCachePartition;
  targets: readonly WorkspaceTarget[];
}

export async function ensureWorkspaceCache(
  options: WorkspaceToolOptions,
): Promise<void> {
  await options.cache.sync({
    partition: options.partition,
    targets: options.targets,
  });
}

export function requiredStringArg(
  args: Record<string, unknown>,
  name: string,
): string | null {
  const value = args[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

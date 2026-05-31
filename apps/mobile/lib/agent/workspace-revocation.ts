import {
  getDefaultWorkspaceCache,
  type WorkspaceCache,
  type WorkspaceWipeResult,
} from "./workspace-cache";

export interface WorkspaceAccessRevokedEvent {
  tenantId: string;
  spaceId: string;
  userId: string;
  revokedAt: string;
}

export async function handleWorkspaceAccessRevoked(
  event: WorkspaceAccessRevokedEvent,
  options: {
    cache?: Pick<WorkspaceCache, "wipeRevokedSpace">;
    stage?: string | null;
  } = {},
): Promise<WorkspaceWipeResult> {
  const cache = options.cache ?? getDefaultWorkspaceCache();
  return cache.wipeRevokedSpace({
    stage:
      options.stage?.trim() ||
      process.env.EXPO_PUBLIC_STAGE ||
      process.env.EXPO_PUBLIC_THINKWORK_STAGE ||
      "dev",
    tenantId: event.tenantId,
    spaceId: event.spaceId,
    userId: event.userId,
  });
}

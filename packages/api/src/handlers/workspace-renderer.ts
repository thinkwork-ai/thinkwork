import {
  renderWorkspaceTuple,
  WorkspaceRenderError,
  type EffectiveWorkspacePolicy,
  type RenderWorkspaceTupleDeps,
} from "../lib/workspace-renderer/index.js";

export interface WorkspaceRendererEvent {
  tenantId?: string;
  agentId?: string;
  spaceId?: string;
  userId?: string | null;
  invokingServiceIdentity?: string | null;
  agentBlockedTools?: unknown;
  agentAllowedTools?: unknown;
  bucket?: string;
}

export interface WorkspaceRendererResponse {
  ok: boolean;
  statusCode: number;
  renderedPrefix?: string;
  cacheStatus?: "hit" | "miss";
  sourcePrefixes?: string[];
  writtenFiles?: string[];
  activeSpace?: {
    id: string;
    slug: string;
    name: string;
    isDefault: boolean;
  };
  effectivePolicy?: EffectiveWorkspacePolicy;
  error?: {
    code: string;
    message: string;
  };
}

function missingFieldResponse(field: string): WorkspaceRendererResponse {
  return {
    ok: false,
    statusCode: 400,
    error: {
      code: "InvalidInput",
      message: `${field} is required.`,
    },
  };
}

function statusForError(error: WorkspaceRenderError): number {
  switch (error.code) {
    case "WorkspaceBucketNotConfigured":
      return 500;
    case "WorkspaceTupleNotFound":
    case "AgentBaselineNotFound":
    case "SpaceSourcesNotFound":
      return 404;
    case "SpaceAccessDenied":
      return 403;
  }
}

export function createWorkspaceRendererHandler(
  deps: RenderWorkspaceTupleDeps = {},
) {
  return async function workspaceRendererHandler(
    event: WorkspaceRendererEvent,
  ): Promise<WorkspaceRendererResponse> {
    if (!event.tenantId) return missingFieldResponse("tenantId");
    if (!event.agentId) return missingFieldResponse("agentId");
    if (!event.spaceId) return missingFieldResponse("spaceId");

    try {
      const result = await renderWorkspaceTuple(
        {
          tenantId: event.tenantId,
          agentId: event.agentId,
          spaceId: event.spaceId,
          userId: event.userId,
          invokingServiceIdentity: event.invokingServiceIdentity,
          agentBlockedTools: event.agentBlockedTools,
          agentAllowedTools: event.agentAllowedTools,
        },
        {
          ...deps,
          bucket: event.bucket ?? deps.bucket,
        },
      );
      return {
        ok: true,
        statusCode: 200,
        renderedPrefix: result.renderedPrefix,
        cacheStatus: result.cacheStatus,
        sourcePrefixes: result.sourcePrefixes,
        writtenFiles: result.writtenFiles,
        activeSpace: result.activeSpace,
        effectivePolicy: result.effectivePolicy,
      };
    } catch (error) {
      if (error instanceof WorkspaceRenderError) {
        return {
          ok: false,
          statusCode: statusForError(error),
          error: {
            code: error.code,
            message: error.message,
          },
        };
      }
      throw error;
    }
  };
}

export const handler = createWorkspaceRendererHandler();

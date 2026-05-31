import type { EffectiveWorkspacePolicy } from "./effective-policy-composer.js";

export interface WorkspaceRenderTupleInput {
  tenantId: string;
  agentId: string;
  spaceId: string;
  threadId?: string | null;
  threadSlug?: string | null;
  userId?: string | null;
  invokingServiceIdentity?: string | null;
  agentBlockedTools?: unknown;
  agentAllowedTools?: unknown;
}

export interface ResolvedWorkspaceRenderTuple {
  tenantId: string;
  tenantSlug: string;
  agentId: string;
  agentSlug: string;
  agentName: string;
  spaceId: string;
  spaceSlug: string;
  spaceName: string;
  spaceKind: string;
  spaceAccessMode: string;
  spacePrompt: string | null;
  spaceToolPolicy: unknown;
  spaceMcpPolicy: unknown;
  threadId?: string | null;
  threadSlug?: string | null;
  userId: string | null;
  userSlug: string | null;
  userName: string | null;
}

export interface WorkspaceRuntimeOverrides {
  modelOverride: string | null;
  guardrailIdOverride: string | null;
  budgetMonthlyCentsOverride: number | null;
  budgetPausedOverride: boolean | null;
  sandboxOverride: boolean | null;
}

export interface WorkspaceObjectMetadata {
  key: string;
  lastModified?: Date;
}

export interface WorkspaceRendererObjectStore {
  listObjects(input: {
    bucket: string;
    prefix: string;
  }): Promise<WorkspaceObjectMetadata[]>;
  getText(input: { bucket: string; key: string }): Promise<string | null>;
  putText(input: {
    bucket: string;
    key: string;
    content: string;
    contentType?: string;
  }): Promise<void>;
}

export interface WorkspaceTupleRepository {
  resolve(
    input: WorkspaceRenderTupleInput,
  ): Promise<ResolvedWorkspaceRenderTuple | null>;
}

export type WorkspaceRenderCacheStatus = "hit" | "miss";

export interface RenderedWorkspaceTuple {
  renderedPrefix: string;
  cacheStatus: WorkspaceRenderCacheStatus;
  sourcePrefixes: string[];
  writtenFiles: string[];
  activeSpace: {
    id: string;
    slug: string;
    name: string;
    isDefault: boolean;
  };
  effectivePolicy: EffectiveWorkspacePolicy;
  user: {
    id: string | null;
    slug: string | null;
    name: string | null;
  };
}

export class WorkspaceRenderError extends Error {
  constructor(
    readonly code:
      | "WorkspaceBucketNotConfigured"
      | "WorkspaceTupleNotFound"
      | "AgentBaselineNotFound"
      | "SpaceSourcesNotFound"
      | "SpaceAccessDenied",
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceRenderError";
  }
}

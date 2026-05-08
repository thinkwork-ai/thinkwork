import { GraphQLError } from "graphql";

export interface DashboardArtifactRow {
  id: string;
  tenant_id: string;
  thread_id?: string | null;
  type: string;
  s3_key?: string | null;
  metadata?: unknown;
}

export interface DashboardArtifactMetadata {
  kind: "research_dashboard";
  dashboardKind: "pipeline_risk";
  computerId?: string;
  ownerUserId?: string;
  threadId?: string;
}

export function parseDashboardArtifactMetadata(
  metadata: unknown,
): DashboardArtifactMetadata {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw badDashboardArtifact();
  }
  const raw = metadata as Record<string, unknown>;
  if (
    raw.kind !== "research_dashboard" ||
    raw.dashboardKind !== "pipeline_risk"
  ) {
    throw badDashboardArtifact();
  }
  return {
    kind: "research_dashboard",
    dashboardKind: "pipeline_risk",
    computerId:
      typeof raw.computerId === "string" ? raw.computerId : undefined,
    ownerUserId:
      typeof raw.ownerUserId === "string" ? raw.ownerUserId : undefined,
    threadId: typeof raw.threadId === "string" ? raw.threadId : undefined,
  };
}

export function assertDashboardArtifactAccess(
  artifact: DashboardArtifactRow,
  caller: { tenantId: string | null; userId: string | null },
): DashboardArtifactMetadata {
  if (!caller.tenantId || artifact.tenant_id !== caller.tenantId) {
    throw forbidden();
  }
  if (artifact.type !== "data_view" && artifact.type !== "DATA_VIEW") {
    throw badDashboardArtifact();
  }
  if (!artifact.s3_key) {
    throw badDashboardArtifact("Dashboard artifact manifest is missing");
  }

  const metadata = parseDashboardArtifactMetadata(artifact.metadata);
  if (
    metadata.ownerUserId &&
    caller.userId &&
    metadata.ownerUserId !== caller.userId
  ) {
    throw forbidden();
  }
  if (
    metadata.threadId &&
    artifact.thread_id &&
    metadata.threadId !== artifact.thread_id
  ) {
    throw badDashboardArtifact("Dashboard artifact thread linkage is invalid");
  }
  return metadata;
}

function forbidden() {
  return new GraphQLError("Dashboard artifact not found", {
    extensions: { code: "NOT_FOUND" },
  });
}

function badDashboardArtifact(message = "Artifact is not a dashboard artifact") {
  return new GraphQLError(message, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

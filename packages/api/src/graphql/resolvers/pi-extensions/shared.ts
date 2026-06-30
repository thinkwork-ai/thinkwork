export interface PiExtensionAssignmentRow {
  id: string;
  tenant_id: string;
  version_id: string;
  target_type: string;
  agent_profile_id: string | null;
  enabled: boolean;
  granted_permissions: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface PiExtensionVersionRow {
  id: string;
  tenant_id: string;
  source_id: string;
  display_name: string | null;
  description: string | null;
  source_ref: string;
  commit_sha: string | null;
  manifest_hash: string | null;
  artifact_hash: string | null;
  artifact_uri: string | null;
  runtime_target: string | null;
  status: string;
  status_reason: string | null;
  manifest: Record<string, unknown>;
  tool_names: string[];
  lifecycle_hooks: string[];
  permission_classes: string[];
  verification_report: Record<string, unknown>;
  reviewed_by_user_id: string | null;
  reviewed_at: Date | string | null;
  approved_by_user_id: string | null;
  approved_at: Date | string | null;
  rejected_by_user_id: string | null;
  rejected_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface PiExtensionSourceRow {
  id: string;
  tenant_id: string;
  source_type: string;
  repository_url: string;
  repository_owner: string | null;
  repository_name: string | null;
  display_name: string | null;
}

export function isPiExtensionVersionExecutable(
  status: string,
  assignments: readonly PiExtensionAssignmentRow[],
): boolean {
  return (
    status === "approved" &&
    assignments.some((assignment) => assignment.enabled)
  );
}

export function piExtensionAssignmentSummary(
  assignments: readonly PiExtensionAssignmentRow[],
) {
  return {
    defaultAgentEnabled: assignments.some(
      (assignment) =>
        assignment.target_type === "default_agent" && assignment.enabled,
    ),
    enabledProfileCount: assignments.filter(
      (assignment) =>
        assignment.target_type === "agent_profile" && assignment.enabled,
    ).length,
    disabledCount: assignments.filter((assignment) => !assignment.enabled)
      .length,
  };
}

export function toGraphqlEnum(value: string): string {
  return value.toUpperCase();
}

export function toPiExtensionAssignmentGraphql(
  assignment: PiExtensionAssignmentRow,
) {
  return {
    id: assignment.id,
    tenantId: assignment.tenant_id,
    versionId: assignment.version_id,
    targetType: toGraphqlEnum(assignment.target_type),
    agentProfileId: assignment.agent_profile_id,
    enabled: assignment.enabled,
    grantedPermissions: assignment.granted_permissions,
    createdAt: assignment.created_at,
    updatedAt: assignment.updated_at,
  };
}

export function toPiExtensionGraphql(input: {
  version: PiExtensionVersionRow;
  source: PiExtensionSourceRow;
  assignments: readonly PiExtensionAssignmentRow[];
}) {
  const { version, source, assignments } = input;
  return {
    id: version.id,
    tenantId: version.tenant_id,
    sourceId: version.source_id,
    sourceType: toGraphqlEnum(source.source_type),
    repositoryUrl: source.repository_url,
    repositoryOwner: source.repository_owner,
    repositoryName: source.repository_name,
    displayName: version.display_name ?? source.display_name,
    description: version.description,
    sourceRef: version.source_ref,
    commitSha: version.commit_sha,
    manifestHash: version.manifest_hash,
    artifactHash: version.artifact_hash,
    artifactUri: version.artifact_uri,
    runtimeTarget: version.runtime_target,
    status: toGraphqlEnum(version.status),
    statusReason: version.status_reason,
    manifest: version.manifest,
    toolNames: version.tool_names,
    lifecycleHooks: version.lifecycle_hooks,
    permissionClasses: version.permission_classes,
    verificationReport: version.verification_report,
    reviewedByUserId: version.reviewed_by_user_id,
    reviewedAt: version.reviewed_at,
    approvedByUserId: version.approved_by_user_id,
    approvedAt: version.approved_at,
    rejectedByUserId: version.rejected_by_user_id,
    rejectedAt: version.rejected_at,
    executable: isPiExtensionVersionExecutable(version.status, assignments),
    assignmentSummary: piExtensionAssignmentSummary(assignments),
    assignments: assignments.map(toPiExtensionAssignmentGraphql),
    createdAt: version.created_at,
    updatedAt: version.updated_at,
  };
}

export interface NormalizedWorkspaceWakeupPayload {
  workspaceRunId: string;
  workspaceEventId: unknown;
  targetPath: string;
  sourceObjectKey: string;
  requestObjectKey: string;
  causeEventId: unknown;
  causeType: string;
  depth: unknown;
  resumeReason: unknown;
}

export function normalizeWorkspaceWakeupPayload(
  payload: Record<string, unknown> | null | undefined,
): NormalizedWorkspaceWakeupPayload {
  return {
    workspaceRunId: stringValue(payload?.workspaceRunId),
    workspaceEventId: payload?.workspaceEventId,
    targetPath:
      stringValue(payload?.workspaceTargetPath) ||
      stringValue(payload?.targetPath) ||
      ".",
    sourceObjectKey:
      stringValue(payload?.workspaceSourceObjectKey) ||
      stringValue(payload?.sourceObjectKey),
    requestObjectKey:
      stringValue(payload?.workspaceRequestObjectKey) ||
      stringValue(payload?.requestObjectKey) ||
      stringValue(payload?.sourceObjectKey),
    causeEventId: payload?.causeEventId,
    causeType: stringValue(payload?.causeType) || "workspace_event",
    depth: payload?.depth,
    resumeReason: payload?.workspaceResumeReason,
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

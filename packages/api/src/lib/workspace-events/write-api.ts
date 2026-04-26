import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

export interface WorkspaceWakeWriteInput {
  bucket: string;
  tenantSlug: string;
  agentSlug: string;
  targetPath: string;
  requestMd: string;
  requestId: string;
  parentRunId?: string;
  waitForResult?: boolean;
}

export interface WorkspaceWakeWriteResult {
  sourceObjectKey: string;
  blockedObjectKey?: string;
}

export function workspaceInboxObjectKey(input: WorkspaceWakeWriteInput): string {
  const targetPrefix = input.targetPath ? `${input.targetPath}/` : "";
  return `tenants/${input.tenantSlug}/agents/${input.agentSlug}/workspace/${targetPrefix}work/inbox/${input.requestId}.md`;
}

export function workspaceBlockedObjectKey(input: WorkspaceWakeWriteInput): string {
  if (!input.parentRunId) {
    throw new Error("parentRunId is required when waitForResult is true");
  }
  return `tenants/${input.tenantSlug}/agents/${input.agentSlug}/workspace/work/runs/${input.parentRunId}/events/blocked.json`;
}

export async function writeWorkspaceWakeRequest(
  s3: S3Client,
  input: WorkspaceWakeWriteInput,
): Promise<WorkspaceWakeWriteResult> {
  const sourceObjectKey = workspaceInboxObjectKey(input);
  let blockedObjectKey: string | undefined;

  if (input.waitForResult) {
    blockedObjectKey = workspaceBlockedObjectKey(input);
    await s3.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: blockedObjectKey,
        Body: JSON.stringify(
          {
            event_type: "run.blocked",
            reason: "subrun",
            wait_for_target_path: input.targetPath,
            child_request_object_key: sourceObjectKey,
          },
          null,
          2,
        ),
        ContentType: "application/json",
      }),
    );
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: sourceObjectKey,
      Body: input.requestMd,
      ContentType: "text/markdown; charset=utf-8",
    }),
  );

  return { sourceObjectKey, blockedObjectKey };
}


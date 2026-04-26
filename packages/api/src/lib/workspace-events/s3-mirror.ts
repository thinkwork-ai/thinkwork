import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

export function workspaceAuditMirrorKey(input: {
  tenantSlug: string;
  agentSlug: string;
  eventId: string | number;
  date?: Date;
}): string {
  const day = (input.date ?? new Date()).toISOString().slice(0, 10);
  return `tenants/${input.tenantSlug}/agents/${input.agentSlug}/workspace/events/audit/${day}/${input.eventId}.json`;
}

export async function writeWorkspaceAuditMirror(
  s3: S3Client,
  input: {
    bucket: string;
    key: string;
    body: unknown;
  },
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      Body: JSON.stringify(input.body, null, 2),
      ContentType: "application/json",
    }),
  );
}


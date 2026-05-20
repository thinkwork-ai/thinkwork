import {
  CopyObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export interface WorkspaceObjectStore {
  copyObject(input: {
    bucket: string;
    sourceKey: string;
    targetKey: string;
  }): Promise<void>;
  listKeys(input: { bucket: string; prefix: string }): Promise<string[]>;
  putText(input: {
    bucket: string;
    key: string;
    content: string;
    contentType?: string;
  }): Promise<void>;
}

export class S3WorkspaceObjectStore implements WorkspaceObjectStore {
  constructor(private readonly client: Pick<S3Client, "send">) {}

  async copyObject(input: {
    bucket: string;
    sourceKey: string;
    targetKey: string;
  }): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: input.bucket,
        CopySource: `${input.bucket}/${input.sourceKey}`,
        Key: input.targetKey,
      }),
    );
  }

  async listKeys(input: { bucket: string; prefix: string }): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: input.bucket,
          Prefix: input.prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of page.Contents ?? []) {
        if (object.Key) keys.push(object.Key);
      }
      continuationToken = page.IsTruncated
        ? page.NextContinuationToken
        : undefined;
    } while (continuationToken);
    return keys;
  }

  async putText(input: {
    bucket: string;
    key: string;
    content: string;
    contentType?: string;
  }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        Body: input.content,
        ContentType: input.contentType ?? "text/plain; charset=utf-8",
      }),
    );
  }
}

export function contentTypeForWorkspacePath(path: string): string {
  if (path.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (path.endsWith(".json")) return "application/json";
  return "text/plain; charset=utf-8";
}

export function shouldRenderWorkspaceSourcePath(path: string): boolean {
  return (
    Boolean(path) && path !== "manifest.json" && path !== "_defaults_version"
  );
}

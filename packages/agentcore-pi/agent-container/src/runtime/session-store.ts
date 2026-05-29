import {
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import {
  SessionConflictError,
  type SessionStore,
} from "@thinkwork/pi-runtime-core";

export interface S3SessionStoreOptions {
  s3: Pick<S3Client, "send">;
  bucket: string;
  /** Key prefix for tenant isolation, e.g. `pi-sessions/<tenantSlug>/`. */
  keyPrefix: string;
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    ?.$metadata?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}

function isPreconditionFailed(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    ?.$metadata?.httpStatusCode;
  return name === "PreconditionFailed" || status === 412;
}

/**
 * {@link SessionStore} backed by S3: one object per thread under
 * `<keyPrefix><threadId>.jsonl`, with optimistic concurrency via the object's
 * ETag. Creates use `If-None-Match: *` (write only if absent); updates use
 * `If-Match: <etag>` (write only if unchanged). A precondition failure surfaces
 * as {@link SessionConflictError} so a concurrent same-thread turn fails loud
 * rather than silently clobbering the session. U4.
 */
export function createS3SessionStore(
  options: S3SessionStoreOptions,
): SessionStore {
  const fullKey = (key: string): string => `${options.keyPrefix}${key}`;

  return {
    async read(key) {
      try {
        const response = await options.s3.send(
          new GetObjectCommand({ Bucket: options.bucket, Key: fullKey(key) }),
        );
        const body = (await response.Body?.transformToString()) ?? "";
        // An object that exists but is empty/whitespace is never a legitimate
        // persisted session (a real one always has at least a header line).
        // Treat it as missing so the caller seeds a fresh session instead of
        // resuming an empty context.
        if (body.trim() === "") return null;
        const version = response.ETag ?? "";
        return { body, version };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async write(key, body, expectedVersion) {
      try {
        const response = await options.s3.send(
          new PutObjectCommand({
            Bucket: options.bucket,
            Key: fullKey(key),
            Body: body,
            ContentType: "application/x-ndjson",
            ...(expectedVersion === null
              ? { IfNoneMatch: "*" }
              : { IfMatch: expectedVersion }),
          }),
        );
        return response.ETag ?? "";
      } catch (error) {
        if (isPreconditionFailed(error)) {
          throw new SessionConflictError(
            `Session ${fullKey(key)} changed concurrently (precondition failed).`,
          );
        }
        throw error;
      }
    },
  };
}

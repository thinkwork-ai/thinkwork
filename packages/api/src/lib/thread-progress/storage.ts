import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { S3Client as S3ClientType } from "@aws-sdk/client-s3";

const SAFE_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;
const MAX_THREAD_PROGRESS_BYTES = 64 * 1024;
const MAX_INJECTED_THREAD_PROGRESS_CHARS = 24_000;

const s3 = new S3Client({});

export interface ThreadProgressStorageDeps {
  s3Client?: S3ClientType;
  bucket?: string;
}

export interface ThreadProgressAddress {
  tenantSlug: string;
  threadId: string;
}

export function threadProgressKey(input: ThreadProgressAddress): string {
  assertSafeSegment(input.tenantSlug, "tenantSlug");
  assertSafeSegment(input.threadId, "threadId");
  return `tenants/${input.tenantSlug}/threads/${input.threadId}/PROGRESS.md`;
}

export async function readThreadProgressMarkdown(
  input: ThreadProgressAddress,
  deps: ThreadProgressStorageDeps = {},
): Promise<string | null> {
  try {
    const response = await client(deps).send(
      new GetObjectCommand({
        Bucket: bucket(deps),
        Key: threadProgressKey(input),
      }),
    );
    const content = (await response.Body?.transformToString("utf-8")) ?? "";
    if (Buffer.byteLength(content, "utf8") > MAX_THREAD_PROGRESS_BYTES) {
      return truncateThreadProgressMarkdown(content);
    }
    return content;
  } catch (error) {
    if (isNoSuchKey(error)) return null;
    throw error;
  }
}

export async function writeThreadProgressMarkdown(
  input: ThreadProgressAddress & { content: string },
  deps: ThreadProgressStorageDeps = {},
): Promise<{ key: string; bytes: number }> {
  const content = assertThreadProgressBudget(input.content);
  const key = threadProgressKey(input);
  await client(deps).send(
    new PutObjectCommand({
      Bucket: bucket(deps),
      Key: key,
      Body: content,
      ContentType: "text/markdown; charset=utf-8",
      CacheControl: "no-cache",
    }),
  );
  return { key, bytes: Buffer.byteLength(content, "utf8") };
}

export function formatThreadProgressPromptBlock(content: string): string {
  const bounded = truncateThreadProgressMarkdown(content);
  return [
    "<thread_progress_md>",
    "The following is the current thread PROGRESS.md. Treat it as the latest operational state for this Thread. Do not edit it directly unless a workflow tool explicitly writes thread progress.",
    "",
    bounded,
    "</thread_progress_md>",
  ].join("\n");
}

export function prependThreadProgressPromptBlock(
  agentMessage: string,
  content: string | null,
): string {
  if (!content) return agentMessage;
  return `${formatThreadProgressPromptBlock(content)}\n\n---\n\n${agentMessage}`;
}

export function truncateThreadProgressMarkdown(content: string): string {
  if (content.length <= MAX_INJECTED_THREAD_PROGRESS_CHARS) return content;
  return `${content.slice(0, MAX_INJECTED_THREAD_PROGRESS_CHARS)}\n\n<!-- PROGRESS.md truncated for prompt budget -->`;
}

function assertThreadProgressBudget(content: string): string {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_THREAD_PROGRESS_BYTES) {
    throw new Error(
      `thread progress markdown exceeds ${MAX_THREAD_PROGRESS_BYTES} bytes`,
    );
  }
  return content;
}

function client(deps: ThreadProgressStorageDeps): S3ClientType {
  return deps.s3Client ?? s3;
}

function bucket(deps: ThreadProgressStorageDeps): string {
  const value = deps.bucket ?? process.env.WORKSPACE_BUCKET ?? "";
  if (!value) throw new Error("WORKSPACE_BUCKET env is not configured");
  return value;
}

function assertSafeSegment(value: string, label: string) {
  if (!SAFE_SEGMENT_RE.test(value)) {
    throw new Error(`${label} must be a safe S3 path segment`);
  }
}

function isNoSuchKey(error: unknown): boolean {
  const err = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404;
}

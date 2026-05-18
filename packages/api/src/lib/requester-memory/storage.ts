import { createHash } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;
const DATE_PATH_RE = /^\d{4}-\d{2}-\d{2}\.md$/;
const MAX_MEMORY_FILE_BYTES = 256 * 1024;

const s3 = new S3Client({});

export type RequesterMemoryPathKind = "memory" | "source" | "internal";

export type ChangedRequesterMemoryFile = {
  path: string;
  key: string;
  beforeHash: string | null;
  afterHash: string;
  beforeBytes: number;
  afterBytes: number;
  snapshotKey: string | null;
  evidenceMessageIds?: string[];
  hindsightDocumentId?: string;
  hindsightStatus?: string;
};

export type RequesterMemoryFileSummary = {
  path: string;
  key: string;
  size?: number;
  lastModified?: Date;
};

export type WriteRequesterMemoryFileInput = {
  tenantId: string;
  userId: string;
  runId: string;
  path: string;
  content: string;
};

export type WriteRequesterMemoryFileResult = ChangedRequesterMemoryFile & {
  previousContent: string | null;
};

export function requesterMemoryKey(input: {
  tenantId: string;
  userId: string;
  path: string;
  kind?: RequesterMemoryPathKind;
}): string {
  assertSafeId(input.tenantId, "tenantId");
  assertSafeId(input.userId, "userId");
  const path = normalizeRequesterMemoryPath(input.path);
  if (input.kind === "internal") {
    assertInternalRequesterMemoryPath(path);
  } else if (input.kind === "source") {
    if (!isRequesterMemorySourcePath(path)) {
      throw new Error(`requester memory source path is not readable: ${path}`);
    }
  } else {
    assertPublicRequesterMemoryPath(path);
  }
  return `tenants/${input.tenantId}/users/${input.userId}/${path}`;
}

export function requesterMemorySnapshotKey(input: {
  tenantId: string;
  userId: string;
  runId: string;
  path: string;
}): string {
  assertSafeId(input.runId, "runId");
  const encodedPath = encodeURIComponent(
    normalizeRequesterMemoryPath(input.path),
  );
  return requesterMemoryKey({
    tenantId: input.tenantId,
    userId: input.userId,
    path: `memory/.snapshots/${input.runId}/${encodedPath}.md`,
    kind: "internal",
  });
}

export function idleLearningReportPath(runId: string): string {
  assertSafeId(runId, "runId");
  return `memory/reports/thread-idle/${runId}.md`;
}

export function dreamingReportPath(
  phase: "light" | "rem" | "deep",
  date: string,
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("dreaming report date must be YYYY-MM-DD");
  }
  return `memory/dreaming/${phase}/${date}.md`;
}

export function dreamingStatePath(name: string): string {
  if (
    !name.endsWith(".json") ||
    !SAFE_ID_RE.test(name.replace(/\.json$/, ""))
  ) {
    throw new Error("dreaming state name must be a safe .json filename");
  }
  return `memory/.dreams/${name}`;
}

export async function listRequesterMemoryFiles(input: {
  tenantId: string;
  userId: string;
  includeInternal?: boolean;
}): Promise<RequesterMemoryFileSummary[]> {
  assertSafeId(input.tenantId, "tenantId");
  assertSafeId(input.userId, "userId");
  const userPrefix = `tenants/${input.tenantId}/users/${input.userId}/`;
  const prefix = `${userPrefix}memory/`;
  const files: RequesterMemoryFileSummary[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: workspaceBucket(),
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const object of response.Contents ?? []) {
      if (!object.Key || object.Key.endsWith("/")) continue;
      const path = object.Key.slice(userPrefix.length);
      if (
        input.includeInternal ||
        path === "memory/DREAMS.md" ||
        isRequesterMemorySourcePath(path) ||
        isRequesterMemoryGeneratedPublicPath(path)
      ) {
        files.push({
          path,
          key: object.Key,
          size: object.Size,
          lastModified: object.LastModified,
        });
      }
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function readRequesterMemoryFile(input: {
  tenantId: string;
  userId: string;
  path: string;
}): Promise<string | null> {
  return readRequesterMemoryObject({ ...input, kind: "memory" });
}

export async function readRequesterMemorySourceFile(input: {
  tenantId: string;
  userId: string;
  path: string;
}): Promise<string | null> {
  const path = normalizeRequesterMemoryPath(input.path);
  if (!isRequesterMemorySourcePath(path)) {
    throw new Error(`requester memory source path is not readable: ${path}`);
  }
  return readRequesterMemoryObject({ ...input, path, kind: "source" });
}

export async function readRequesterMemoryInternalFile(input: {
  tenantId: string;
  userId: string;
  path: string;
}): Promise<string | null> {
  return readRequesterMemoryObject({ ...input, kind: "internal" });
}

async function readRequesterMemoryObject(input: {
  tenantId: string;
  userId: string;
  path: string;
  kind: RequesterMemoryPathKind;
}): Promise<string | null> {
  const key = requesterMemoryKey(input);
  try {
    const response = await s3.send(
      new GetObjectCommand({ Bucket: workspaceBucket(), Key: key }),
    );
    const content = (await response.Body?.transformToString("utf-8")) ?? "";
    if (Buffer.byteLength(content, "utf8") > MAX_MEMORY_FILE_BYTES) {
      throw new Error(
        `requester memory file exceeds ${MAX_MEMORY_FILE_BYTES} bytes`,
      );
    }
    return content;
  } catch (err) {
    if (isNoSuchKey(err)) return null;
    throw err;
  }
}

export async function writeRequesterMemoryFileWithSnapshot(
  input: WriteRequesterMemoryFileInput,
): Promise<WriteRequesterMemoryFileResult> {
  assertPublicRequesterMemoryPath(normalizeRequesterMemoryPath(input.path));
  assertContentBudget(input.content);
  const key = requesterMemoryKey(input);
  const previousContent = await readRequesterMemoryFile(input);
  const snapshotKey =
    previousContent === null
      ? null
      : requesterMemorySnapshotKey({
          tenantId: input.tenantId,
          userId: input.userId,
          runId: input.runId,
          path: input.path,
        });

  if (snapshotKey && previousContent !== null) {
    await putTextObject(snapshotKey, previousContent);
  }
  await putTextObject(key, input.content);

  return {
    path: normalizeRequesterMemoryPath(input.path),
    key,
    beforeHash: previousContent === null ? null : sha256(previousContent),
    afterHash: sha256(input.content),
    beforeBytes: previousContent
      ? Buffer.byteLength(previousContent, "utf8")
      : 0,
    afterBytes: Buffer.byteLength(input.content, "utf8"),
    snapshotKey,
    previousContent,
  };
}

export async function writeIdleLearningReport(input: {
  tenantId: string;
  userId: string;
  runId: string;
  markdown: string;
}): Promise<{ path: string; key: string; hash: string; bytes: number }> {
  assertContentBudget(input.markdown);
  const path = idleLearningReportPath(input.runId);
  const key = requesterMemoryKey({
    tenantId: input.tenantId,
    userId: input.userId,
    path,
    kind: "internal",
  });
  await putTextObject(key, input.markdown);
  return {
    path,
    key,
    hash: sha256(input.markdown),
    bytes: Buffer.byteLength(input.markdown, "utf8"),
  };
}

export async function writeRequesterMemoryInternalFile(input: {
  tenantId: string;
  userId: string;
  path: string;
  content: string;
}): Promise<{ path: string; key: string; hash: string; bytes: number }> {
  assertContentBudget(input.content);
  const path = normalizeRequesterMemoryPath(input.path);
  const key = requesterMemoryKey({
    tenantId: input.tenantId,
    userId: input.userId,
    path,
    kind: "internal",
  });
  await putTextObject(key, input.content);
  return {
    path,
    key,
    hash: sha256(input.content),
    bytes: Buffer.byteLength(input.content, "utf8"),
  };
}

export async function readIdleLearningReport(input: {
  tenantId: string;
  userId: string;
  runId: string;
}): Promise<string | null> {
  const key = requesterMemoryKey({
    tenantId: input.tenantId,
    userId: input.userId,
    path: idleLearningReportPath(input.runId),
    kind: "internal",
  });
  try {
    const response = await s3.send(
      new GetObjectCommand({ Bucket: workspaceBucket(), Key: key }),
    );
    return (await response.Body?.transformToString("utf-8")) ?? "";
  } catch (err) {
    if (isNoSuchKey(err)) return null;
    throw err;
  }
}

export async function restoreRequesterMemorySnapshot(input: {
  tenantId: string;
  userId: string;
  path: string;
  snapshotKey: string | null;
}): Promise<void> {
  const key = requesterMemoryKey(input);
  if (!input.snapshotKey) {
    await s3.send(
      new DeleteObjectCommand({ Bucket: workspaceBucket(), Key: key }),
    );
    return;
  }
  assertRequesterMemoryKeyPrefix(
    input.tenantId,
    input.userId,
    input.snapshotKey,
  );
  const response = await s3.send(
    new GetObjectCommand({ Bucket: workspaceBucket(), Key: input.snapshotKey }),
  );
  const content = (await response.Body?.transformToString("utf-8")) ?? "";
  await putTextObject(key, content);
}

export function normalizeRequesterMemoryPath(path: string): string {
  if (typeof path !== "string" || !path.trim()) {
    throw new Error("requester memory path is required");
  }
  if (path.startsWith("/") || path.startsWith("\\")) {
    throw new Error("requester memory path must be relative");
  }
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/");
  if (
    parts.some((part) => part.length === 0 || part === "." || part === "..") ||
    normalized.includes("//")
  ) {
    throw new Error("requester memory path contains unsupported traversal");
  }
  if (normalized.length > 512) {
    throw new Error("requester memory path is too long");
  }
  return normalized;
}

function assertPublicRequesterMemoryPath(path: string): void {
  const normalized = normalizeRequesterMemoryPath(path);
  if (normalized === "memory/MEMORY.md" || normalized === "memory/DREAMS.md") {
    return;
  }
  if (isRequesterMemoryGeneratedPublicPath(normalized)) return;
  const [root, collection, filename, extra] = normalized.split("/");
  if (
    root === "memory" &&
    (collection === "candidates" || collection === "working") &&
    filename &&
    !extra &&
    DATE_PATH_RE.test(filename)
  ) {
    return;
  }
  throw new Error(
    `requester memory path is not in the write allowlist: ${path}`,
  );
}

export function isRequesterMemorySourcePath(path: string): boolean {
  const normalized = normalizeRequesterMemoryPath(path);
  if (!normalized.startsWith("memory/") || !normalized.endsWith(".md")) {
    return false;
  }
  const parts = normalized.split("/");
  if (parts.some((part) => part.startsWith("."))) return false;
  if (parts[1] === "reports" || parts[1] === "dreaming") return false;
  if (normalized === "memory/DREAMS.md") return false;
  return true;
}

export function isRequesterMemoryGeneratedPublicPath(path: string): boolean {
  const normalized = normalizeRequesterMemoryPath(path);
  const [root, collection, phase, filename, extra] = normalized.split("/");
  return (
    root === "memory" &&
    collection === "dreaming" &&
    (phase === "light" || phase === "rem" || phase === "deep") &&
    !!filename &&
    !extra &&
    DATE_PATH_RE.test(filename)
  );
}

function assertInternalRequesterMemoryPath(path: string): void {
  const normalized = normalizeRequesterMemoryPath(path);
  const parts = normalized.split("/");
  if (
    parts.length === 3 &&
    parts[0] === "memory" &&
    parts[1] === ".dreams" &&
    SAFE_ID_RE.test(parts[2].replace(/\.json$/, "")) &&
    parts[2].endsWith(".json")
  ) {
    return;
  }
  if (
    parts.length === 4 &&
    parts[0] === "memory" &&
    parts[1] === "reports" &&
    parts[2] === "thread-idle" &&
    SAFE_ID_RE.test(parts[3].replace(/\.md$/, "")) &&
    parts[3].endsWith(".md")
  ) {
    return;
  }
  if (
    parts.length === 4 &&
    parts[0] === "memory" &&
    parts[1] === ".state" &&
    parts[2] === "thread-idle" &&
    SAFE_ID_RE.test(parts[3].replace(/\.json$/, "")) &&
    parts[3].endsWith(".json")
  ) {
    return;
  }
  if (
    parts.length === 4 &&
    parts[0] === "memory" &&
    parts[1] === ".snapshots" &&
    SAFE_ID_RE.test(parts[2]) &&
    parts[3].endsWith(".md")
  ) {
    return;
  }
  throw new Error(`requester memory internal path is not allowed: ${path}`);
}

function assertRequesterMemoryKeyPrefix(
  tenantId: string,
  userId: string,
  key: string,
): void {
  const prefix = `tenants/${tenantId}/users/${userId}/memory/.snapshots/`;
  if (!key.startsWith(prefix)) {
    throw new Error("snapshot key is outside requester memory prefix");
  }
}

function assertSafeId(value: string, field: string): void {
  if (!SAFE_ID_RE.test(value || "")) {
    throw new Error(`${field} contains unsupported characters`);
  }
}

function assertContentBudget(content: string): void {
  if (Buffer.byteLength(content, "utf8") > MAX_MEMORY_FILE_BYTES) {
    throw new Error(
      `requester memory content exceeds ${MAX_MEMORY_FILE_BYTES} bytes`,
    );
  }
}

async function putTextObject(key: string, content: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: workspaceBucket(),
      Key: key,
      Body: content,
      ContentType: "text/markdown; charset=utf-8",
    }),
  );
}

function workspaceBucket(): string {
  const bucket = process.env.WORKSPACE_BUCKET || "";
  if (!bucket) throw new Error("WORKSPACE_BUCKET env is not configured");
  return bucket;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function isNoSuchKey(err: unknown): boolean {
  const e = err as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    e?.name === "NoSuchKey" ||
    e?.name === "NotFound" ||
    e?.Code === "NoSuchKey" ||
    e?.$metadata?.httpStatusCode === 404
  );
}

import {
  GetObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from "@aws-sdk/client-s3";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  assertValidOkfBundleManifest,
  assertValidOkfCurrentManifest,
  type OkfBundleManifest,
  type OkfCurrentManifest,
} from "./bundle-contract.js";

export type OkfEfsRefreshS3Client = Pick<S3Client, "send">;

export interface RefreshOkfEfsCurrentViewArgs {
  s3: OkfEfsRefreshS3Client;
  bucket: string;
  efsRoot: string;
  tenantSlug: string;
  currentManifestKey?: string | null;
  dryRun?: boolean;
  runId?: string;
}

export interface OkfEfsRefreshFile {
  path: string;
  byteLength: number;
  checksumSha256: string;
}

export interface RefreshOkfEfsCurrentViewResult {
  tenantSlug: string;
  bundleId: string;
  bundleChecksumSha256: string;
  currentManifestKey: string;
  bundleKeyPrefix: string;
  currentPath: string;
  bundlePath: string;
  dryRun: boolean;
  files: OkfEfsRefreshFile[];
  bytesWritten: number;
}

interface BundleFile extends OkfEfsRefreshFile {
  body: Buffer;
}

const MANIFEST_PATH = ".thinkwork/manifest.json";

export async function discoverOkfCurrentTenantSlugs(args: {
  s3: OkfEfsRefreshS3Client;
  bucket: string;
}): Promise<string[]> {
  const keys = await listObjectKeys({
    s3: args.s3,
    bucket: args.bucket,
    prefix: "okf-current-manifests/",
  });
  return [
    ...new Set(
      keys
        .map(
          (key) =>
            key.match(/^okf-current-manifests\/([^/]+)\/current\.json$/)?.[1],
        )
        .filter((slug): slug is string => Boolean(slug)),
    ),
  ].sort();
}

export async function refreshOkfEfsCurrentView(
  args: RefreshOkfEfsCurrentViewArgs,
): Promise<RefreshOkfEfsCurrentViewResult> {
  const tenantSlug = safeSlug(args.tenantSlug);
  const currentManifestKey =
    args.currentManifestKey ?? okfCurrentManifestKeyForTenant(tenantSlug);
  const currentManifest = await readCurrentManifest({
    s3: args.s3,
    bucket: args.bucket,
    key: currentManifestKey,
  });
  if (safeSlug(currentManifest.tenantSlug) !== tenantSlug) {
    throw new Error(
      `current manifest tenant ${currentManifest.tenantSlug} does not match ${tenantSlug}`,
    );
  }

  const bundleKeyPrefix = okfBundleKeyPrefixForBundle({
    tenantSlug,
    bundleId: currentManifest.currentBundleId,
  });
  const bundleManifest = await readBundleManifest({
    s3: args.s3,
    bucket: args.bucket,
    bundleKeyPrefix,
  });
  assertBundleMatchesCurrent({ currentManifest, bundleManifest });

  const files = await readBundleFiles({
    s3: args.s3,
    bucket: args.bucket,
    bundleKeyPrefix,
    bundleManifest,
  });
  assertBundleFilesMatchManifest({ bundleManifest, files });

  const tenantRoot = path.join(args.efsRoot, "tenants", tenantSlug);
  const bundlePath = path.join(
    tenantRoot,
    "bundles",
    sanitizeS3Segment(bundleManifest.bundleId),
  );
  const currentPath = path.join(tenantRoot, "current");

  if (!args.dryRun) {
    await publishBundleToEfs({
      tenantRoot,
      bundlePath,
      currentPath,
      files,
      runId: args.runId ?? randomUUID(),
    });
  }

  return {
    tenantSlug,
    bundleId: bundleManifest.bundleId,
    bundleChecksumSha256: bundleManifest.checksumSha256,
    currentManifestKey,
    bundleKeyPrefix,
    currentPath,
    bundlePath,
    dryRun: args.dryRun === true,
    files: files.map(({ body: _body, ...file }) => file),
    bytesWritten: files.reduce((sum, file) => sum + file.byteLength, 0),
  };
}

export function okfCurrentManifestKeyForTenant(tenantSlug: string): string {
  return `okf-current-manifests/${safeSlug(tenantSlug)}/current.json`;
}

export function okfBundleKeyPrefixForBundle(args: {
  tenantSlug: string;
  bundleId: string;
}): string {
  return [
    "okf-bundles",
    safeSlug(args.tenantSlug),
    sanitizeS3Segment(args.bundleId),
  ].join("/");
}

async function readCurrentManifest(args: {
  s3: OkfEfsRefreshS3Client;
  bucket: string;
  key: string;
}): Promise<OkfCurrentManifest> {
  const body = await getObjectBody(args);
  const manifest = JSON.parse(body.toString("utf8")) as OkfCurrentManifest;
  return assertValidOkfCurrentManifest(manifest);
}

async function readBundleManifest(args: {
  s3: OkfEfsRefreshS3Client;
  bucket: string;
  bundleKeyPrefix: string;
}): Promise<OkfBundleManifest> {
  const body = await getObjectBody({
    s3: args.s3,
    bucket: args.bucket,
    key: `${args.bundleKeyPrefix}/${MANIFEST_PATH}`,
  });
  const manifest = JSON.parse(body.toString("utf8")) as OkfBundleManifest;
  return assertValidOkfBundleManifest(manifest);
}

function assertBundleMatchesCurrent(args: {
  currentManifest: OkfCurrentManifest;
  bundleManifest: OkfBundleManifest;
}): void {
  const { currentManifest, bundleManifest } = args;
  if (bundleManifest.tenantSlug !== currentManifest.tenantSlug) {
    throw new Error("OKF bundle tenantSlug does not match current manifest");
  }
  if (bundleManifest.bundleId !== currentManifest.currentBundleId) {
    throw new Error("OKF bundleId does not match current manifest");
  }
  if (bundleManifest.checksumSha256 !== currentManifest.bundle.checksumSha256) {
    throw new Error("OKF bundle checksum does not match current manifest");
  }
  if (bundleManifest.objectCount !== currentManifest.bundle.objectCount) {
    throw new Error("OKF bundle objectCount does not match current manifest");
  }
  if (bundleManifest.byteCount !== currentManifest.bundle.byteCount) {
    throw new Error("OKF bundle byteCount does not match current manifest");
  }
}

async function readBundleFiles(args: {
  s3: OkfEfsRefreshS3Client;
  bucket: string;
  bundleKeyPrefix: string;
  bundleManifest: OkfBundleManifest;
}): Promise<BundleFile[]> {
  const files: BundleFile[] = [];
  for (const object of args.bundleManifest.objects) {
    const body = await getObjectBody({
      s3: args.s3,
      bucket: args.bucket,
      key: `${args.bundleKeyPrefix}/${object.path}`,
    });
    const checksumSha256 = sha256Hex(body);
    if (checksumSha256 !== object.checksumSha256) {
      throw new Error(`OKF object checksum mismatch for ${object.path}`);
    }
    files.push({
      path: assertSafeBundlePath(object.path),
      body,
      byteLength: body.byteLength,
      checksumSha256,
    });
  }

  const manifestBody = await getObjectBody({
    s3: args.s3,
    bucket: args.bucket,
    key: `${args.bundleKeyPrefix}/${MANIFEST_PATH}`,
  });
  files.push({
    path: MANIFEST_PATH,
    body: manifestBody,
    byteLength: manifestBody.byteLength,
    checksumSha256: sha256Hex(manifestBody),
  });

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function assertBundleFilesMatchManifest(args: {
  bundleManifest: OkfBundleManifest;
  files: BundleFile[];
}): void {
  const manifestObjects = args.bundleManifest.objects;
  const bundleFiles = args.files.filter((file) => file.path !== MANIFEST_PATH);
  const byteCount = bundleFiles.reduce((sum, file) => sum + file.byteLength, 0);
  if (byteCount !== args.bundleManifest.byteCount) {
    throw new Error("OKF bundle byteCount does not match object bytes");
  }

  const checksumSha256 = sha256Hex(
    JSON.stringify(
      manifestObjects.map((object) => [object.path, object.checksumSha256]),
    ),
  );
  if (checksumSha256 !== args.bundleManifest.checksumSha256) {
    throw new Error("OKF bundle checksum does not match object list");
  }
}

async function publishBundleToEfs(args: {
  tenantRoot: string;
  bundlePath: string;
  currentPath: string;
  files: BundleFile[];
  runId: string;
}): Promise<void> {
  await mkdir(path.dirname(args.bundlePath), { recursive: true, mode: 0o755 });
  if (await pathExists(args.bundlePath)) {
    await assertExistingBundleMatches(args.bundlePath, args.files);
    await publishCurrentSymlink({
      tenantRoot: args.tenantRoot,
      bundlePath: args.bundlePath,
      currentPath: args.currentPath,
      runId: args.runId,
    });
    return;
  }

  const stagingRoot = path.join(
    args.tenantRoot,
    ".staging",
    `${path.basename(args.bundlePath)}-${safeRunId(args.runId)}`,
  );
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true, mode: 0o755 });

  for (const file of args.files) {
    const targetPath = resolveUnderRoot(stagingRoot, file.path);
    await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o755 });
    await writeFile(targetPath, file.body, { mode: 0o444 });
    await chmod(targetPath, 0o444);
  }
  await chmodDirectories(stagingRoot);

  try {
    await rename(stagingRoot, args.bundlePath);
  } catch (error) {
    if (!isDestinationExistsError(error)) throw error;
    await assertExistingBundleMatches(args.bundlePath, args.files);
    await rm(stagingRoot, { recursive: true, force: true });
  }
  await publishCurrentSymlink({
    tenantRoot: args.tenantRoot,
    bundlePath: args.bundlePath,
    currentPath: args.currentPath,
    runId: args.runId,
  });
}

async function publishCurrentSymlink(args: {
  tenantRoot: string;
  bundlePath: string;
  currentPath: string;
  runId: string;
}): Promise<void> {
  const nextPath = path.join(
    args.tenantRoot,
    `.current-next-${safeRunId(args.runId)}`,
  );
  await rm(nextPath, { recursive: true, force: true });
  await symlink(
    path.relative(args.tenantRoot, args.bundlePath),
    nextPath,
    "dir",
  );
  try {
    await rename(nextPath, args.currentPath);
  } catch (error) {
    if (!(await isDirectory(args.currentPath))) throw error;
    await rm(args.currentPath, { recursive: true, force: true });
    await rename(nextPath, args.currentPath);
  }
}

async function assertExistingBundleMatches(
  bundlePath: string,
  files: BundleFile[],
): Promise<void> {
  if (!(await existingBundleMatches(bundlePath, files))) {
    throw new Error(
      `existing OKF bundle path does not match validated bundle: ${bundlePath}`,
    );
  }
}

async function existingBundleMatches(
  bundlePath: string,
  files: BundleFile[],
): Promise<boolean> {
  for (const file of files) {
    try {
      const current = await readFile(resolveUnderRoot(bundlePath, file.path));
      if (
        current.byteLength !== file.byteLength ||
        sha256Hex(current) !== file.checksumSha256
      ) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

async function chmodDirectories(root: string): Promise<void> {
  await chmod(root, 0o755);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    await chmodDirectories(path.join(root, entry.name));
  }
}

async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    return (await lstat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function assertSafeBundlePath(relativePath: string): string {
  if (
    !relativePath ||
    relativePath.startsWith("/") ||
    relativePath.includes("\\") ||
    relativePath.includes("\0")
  ) {
    throw new Error(`unsafe OKF bundle path: ${relativePath}`);
  }
  for (const segment of relativePath.split("/")) {
    if (!segment || segment === "." || segment === "..") {
      throw new Error(`unsafe OKF bundle path: ${relativePath}`);
    }
    if (segment.startsWith(".") && segment !== ".thinkwork") {
      throw new Error(`hidden OKF bundle path is not allowed: ${relativePath}`);
    }
  }
  return relativePath;
}

function resolveUnderRoot(root: string, relativePath: string): string {
  const safePath = assertSafeBundlePath(relativePath);
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, safePath);
  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error(`unsafe OKF bundle path escapes root: ${relativePath}`);
  }
  return resolvedTarget;
}

async function getObjectBody(args: {
  s3: OkfEfsRefreshS3Client;
  bucket: string;
  key: string;
}): Promise<Buffer> {
  const output = await args.s3.send(
    new GetObjectCommand({ Bucket: args.bucket, Key: args.key }),
  );
  return bodyToBuffer((output as { Body?: unknown }).Body);
}

async function listObjectKeys(args: {
  s3: OkfEfsRefreshS3Client;
  bucket: string;
  prefix: string;
}): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const output = await args.s3.send(
      new ListObjectsV2Command({
        Bucket: args.bucket,
        Prefix: args.prefix,
        ContinuationToken: continuationToken,
      }),
    );
    const page = output as {
      Contents?: Array<{ Key?: string }>;
      IsTruncated?: boolean;
      NextContinuationToken?: string;
    };
    for (const object of page.Contents ?? []) {
      if (object.Key) keys.push(object.Key);
    }
    continuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return keys;
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (
    typeof body === "object" &&
    "transformToByteArray" in body &&
    typeof body.transformToByteArray === "function"
  ) {
    return Buffer.from(await body.transformToByteArray());
  }
  if (
    typeof body === "object" &&
    Symbol.asyncIterator in body &&
    typeof body[Symbol.asyncIterator] === "function"
  ) {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new Error("Unsupported S3 object body type");
}

function isDestinationExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "EEXIST" || error.code === "ENOTEMPTY")
  );
}

function safeSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return slug || "unknown";
}

function sanitizeS3Segment(segment: string): string {
  const sanitized = segment.replace(/[^a-zA-Z0-9._=-]+/g, "_").slice(0, 96);
  return sanitized || "unknown";
}

function safeRunId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._=-]+/g, "_").slice(0, 96) || "run";
}

function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

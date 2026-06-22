import JSZip from "jszip";
import { isCatalogArchiveSlug } from "../types/catalog-skill.js";
import { parseSkillMd, type SkillMdError } from "./skill-md-parser.js";
import { renderWiringMd } from "./wiring-md.js";

export const CATALOG_SKILL_ARCHIVE_LIMITS = {
  maxEntries: 500,
  maxTotalUncompressedBytes: 50 * 1024 * 1024,
  maxFileBytes: 10 * 1024 * 1024,
  maxCompressedFileBytes: 10 * 1024 * 1024,
  maxPathLength: 260,
} as const;

export type CatalogSkillArchiveErrorCode =
  | "invalid_zip"
  | "multiple_skills"
  | "missing_skill_md"
  | "invalid_skill_frontmatter"
  | "skill_name_mismatch"
  | "unsafe_path"
  | "size_limit_exceeded"
  | "invalid_slug";

export interface CatalogSkillArchiveError {
  code: CatalogSkillArchiveErrorCode;
  message: string;
  path?: string;
  details?: Record<string, unknown>;
}

export interface CatalogSkillArchiveFile {
  path: string;
  content: Buffer;
}

export type ParseCatalogSkillArchiveResult =
  | {
      ok: true;
      slug: string;
      files: CatalogSkillArchiveFile[];
      generatedWiring: boolean;
    }
  | { ok: false; errors: CatalogSkillArchiveError[] };

export interface RenderCatalogSkillArchiveInput {
  slug: string;
  files: CatalogSkillArchiveFile[];
}

export interface RenderCatalogSkillArchiveResult {
  filename: string;
  contentType: "application/zip";
  bytes: Buffer;
}

type LoadedArchiveFile = {
  path: string;
  content: Buffer;
  uncompressedSize: number;
};

type NormalizedSkillShapeResult =
  | {
      ok: true;
      sourceRoot: string;
      folderSlug: string | null;
      files: LoadedArchiveFile[];
    }
  | { ok: false; errors: CatalogSkillArchiveError[] };

const SKILL_MD = "SKILL.md";
const WIRING_MD = "WIRING.md";

export async function parseCatalogSkillArchive(
  bytes: Buffer | Uint8Array,
): Promise<ParseCatalogSkillArchiveResult> {
  const loaded = await loadZip(bytes);
  if (!loaded.ok) return loaded;

  const shape = normalizeSkillShape(loaded.files);
  if (!shape.ok) return shape;

  return validateNormalizedSkillShape(shape);
}

export function validateCatalogSkillFiles(
  files: CatalogSkillArchiveFile[],
): ParseCatalogSkillArchiveResult {
  const errors: CatalogSkillArchiveError[] = [];
  if (files.length > CATALOG_SKILL_ARCHIVE_LIMITS.maxEntries) {
    errors.push({
      code: "size_limit_exceeded",
      message: `Skill has ${files.length} files; max is ${CATALOG_SKILL_ARCHIVE_LIMITS.maxEntries}.`,
      details: {
        count: files.length,
        max: CATALOG_SKILL_ARCHIVE_LIMITS.maxEntries,
      },
    });
  }

  let totalBytes = 0;
  const loaded: LoadedArchiveFile[] = [];
  const seenPaths = new Set<string>();
  for (const file of files) {
    const cleanPath = normalizeArchivePath(file.path);
    const pathError = validateRelativeSkillPath(cleanPath, file.path);
    if (pathError) {
      errors.push(pathError);
      continue;
    }
    if (cleanPath.length > CATALOG_SKILL_ARCHIVE_LIMITS.maxPathLength) {
      errors.push({
        code: "unsafe_path",
        message:
          `Skill file path is ${cleanPath.length} chars; max is ` +
          `${CATALOG_SKILL_ARCHIVE_LIMITS.maxPathLength}.`,
        path: file.path,
      });
      continue;
    }
    if (cleanPath.includes("\0")) {
      errors.push({
        code: "unsafe_path",
        message: "Skill file path contains a NUL byte.",
        path: file.path,
      });
      continue;
    }
    if (seenPaths.has(cleanPath)) {
      errors.push({
        code: "unsafe_path",
        message: `Skill file path '${cleanPath}' appears more than once.`,
        path: file.path,
      });
      continue;
    }
    seenPaths.add(cleanPath);

    totalBytes += file.content.byteLength;
    if (
      file.content.byteLength > CATALOG_SKILL_ARCHIVE_LIMITS.maxFileBytes ||
      totalBytes > CATALOG_SKILL_ARCHIVE_LIMITS.maxTotalUncompressedBytes
    ) {
      errors.push({
        code: "size_limit_exceeded",
        message: `Skill file '${cleanPath}' exceeds skill archive size limits.`,
        path: cleanPath,
        details: {
          fileBytes: file.content.byteLength,
          maxFileBytes: CATALOG_SKILL_ARCHIVE_LIMITS.maxFileBytes,
          totalBytes,
          maxTotalBytes: CATALOG_SKILL_ARCHIVE_LIMITS.maxTotalUncompressedBytes,
        },
      });
    }

    loaded.push({
      path: cleanPath,
      content: file.content,
      uncompressedSize: file.content.byteLength,
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  const shape = normalizeSkillShape(loaded);
  if (!shape.ok) return shape;
  return validateNormalizedSkillShape(shape);
}

function validateNormalizedSkillShape(
  shape: Extract<NormalizedSkillShapeResult, { ok: true }>,
): ParseCatalogSkillArchiveResult {
  const skillFile = shape.files.find((file) => file.path === SKILL_MD);
  if (!skillFile) {
    return invalid("missing_skill_md", "Archive must contain SKILL.md.");
  }

  const parsed = parseSkillMd(
    skillFile.content.toString("utf8"),
    `${shape.sourceRoot}${SKILL_MD}`,
  );
  if (!parsed.valid) {
    return invalid(
      "invalid_skill_frontmatter",
      "SKILL.md frontmatter is invalid.",
      {
        errors: parsed.errors.map(serializeSkillMdError),
      },
      SKILL_MD,
    );
  }

  const slug = parsed.parsed.name;
  if (!isCatalogArchiveSlug(slug)) {
    return invalid(
      "invalid_slug",
      `Skill name '${slug}' is not a valid Agent Skills archive slug.`,
      { slug },
      SKILL_MD,
    );
  }
  if (shape.folderSlug && shape.folderSlug !== slug) {
    return invalid(
      "skill_name_mismatch",
      `Top-level folder '${shape.folderSlug}' must match SKILL.md name '${slug}'.`,
      { folder: shape.folderSlug, name: slug },
      SKILL_MD,
    );
  }

  const hasWiring = shape.files.some((file) => file.path === WIRING_MD);
  const generatedWiringContent = hasWiring ? null : defaultWiringMd(slug);
  const files = hasWiring
    ? shape.files
    : [
        ...shape.files,
        {
          path: WIRING_MD,
          content: Buffer.from(generatedWiringContent!, "utf8"),
          uncompressedSize: Buffer.byteLength(generatedWiringContent!, "utf8"),
        },
      ];

  return {
    ok: true,
    slug,
    generatedWiring: !hasWiring,
    files: files
      .map(({ path, content }) => ({ path, content }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export async function renderCatalogSkillArchive(
  input: RenderCatalogSkillArchiveInput,
): Promise<RenderCatalogSkillArchiveResult> {
  if (!isCatalogArchiveSlug(input.slug)) {
    throw new Error(`Invalid catalog skill slug '${input.slug}'.`);
  }

  const zip = new JSZip();
  for (const file of input.files
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))) {
    const cleanPath = normalizeArchivePath(file.path);
    const pathError = validateRelativeSkillPath(cleanPath, file.path);
    if (pathError) throw new Error(pathError.message);
    zip.file(`${input.slug}/${cleanPath}`, file.content);
  }

  return {
    filename: `${input.slug}.zip`,
    contentType: "application/zip",
    bytes: await zip.generateAsync({ type: "nodebuffer", platform: "UNIX" }),
  };
}

export function textFromCatalogArchiveFile(
  file: CatalogSkillArchiveFile,
): string {
  return file.content.toString("utf8");
}

async function loadZip(
  bytes: Buffer | Uint8Array,
): Promise<
  | { ok: true; files: LoadedArchiveFile[] }
  | { ok: false; errors: CatalogSkillArchiveError[] }
> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (error) {
    return invalid("invalid_zip", "Archive is not a readable ZIP file.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const allEntries = Object.values(zip.files);
  const fileEntries = allEntries.filter((entry) => !entry.dir);
  const errors: CatalogSkillArchiveError[] = [];

  if (allEntries.length > CATALOG_SKILL_ARCHIVE_LIMITS.maxEntries) {
    errors.push({
      code: "size_limit_exceeded",
      message: `Archive has ${allEntries.length} entries; max is ${CATALOG_SKILL_ARCHIVE_LIMITS.maxEntries}.`,
      details: {
        count: allEntries.length,
        max: CATALOG_SKILL_ARCHIVE_LIMITS.maxEntries,
      },
    });
  }

  let totalUncompressed = 0;
  for (const entry of allEntries) {
    const rawPath = unsafeOriginalName(entry);
    const pathError = validateRawZipPath(rawPath, entry.dir);
    if (pathError) errors.push(pathError);
    if (entry.dir) continue;

    const symlinkError = validateNotSymlink(entry);
    if (symlinkError) errors.push(symlinkError);

    const compressedSize = readCompressedSize(entry);
    const size = readUncompressedSize(entry);
    if (compressedSize === null || size === null) {
      errors.push({
        code: "invalid_zip",
        message: `Archive entry '${rawPath}' is missing ZIP size metadata.`,
        path: rawPath,
      });
      continue;
    }
    totalUncompressed += size;
    if (
      size > CATALOG_SKILL_ARCHIVE_LIMITS.maxFileBytes ||
      totalUncompressed >
        CATALOG_SKILL_ARCHIVE_LIMITS.maxTotalUncompressedBytes ||
      compressedSize > CATALOG_SKILL_ARCHIVE_LIMITS.maxCompressedFileBytes
    ) {
      errors.push({
        code: "size_limit_exceeded",
        message: `Archive entry '${rawPath}' exceeds skill archive size limits.`,
        path: rawPath,
        details: {
          fileBytes: size,
          maxFileBytes: CATALOG_SKILL_ARCHIVE_LIMITS.maxFileBytes,
          compressedBytes: compressedSize,
          maxCompressedFileBytes:
            CATALOG_SKILL_ARCHIVE_LIMITS.maxCompressedFileBytes,
          totalBytes: totalUncompressed,
          maxTotalBytes: CATALOG_SKILL_ARCHIVE_LIMITS.maxTotalUncompressedBytes,
        },
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const files: LoadedArchiveFile[] = [];
  let actualTotal = 0;
  for (const entry of fileEntries) {
    const path = normalizeArchivePath(entry.name);
    const content = await entry.async("nodebuffer");
    actualTotal += content.byteLength;
    if (
      content.byteLength > CATALOG_SKILL_ARCHIVE_LIMITS.maxFileBytes ||
      actualTotal > CATALOG_SKILL_ARCHIVE_LIMITS.maxTotalUncompressedBytes
    ) {
      return invalid(
        "size_limit_exceeded",
        `Archive entry '${path}' exceeds skill archive size limits.`,
        {
          fileBytes: content.byteLength,
          maxFileBytes: CATALOG_SKILL_ARCHIVE_LIMITS.maxFileBytes,
          totalBytes: actualTotal,
          maxTotalBytes: CATALOG_SKILL_ARCHIVE_LIMITS.maxTotalUncompressedBytes,
        },
        path,
      );
    }
    files.push({
      path,
      content,
      uncompressedSize: content.byteLength,
    });
  }

  return { ok: true, files };
}

function normalizeSkillShape(
  files: LoadedArchiveFile[],
): NormalizedSkillShapeResult {
  const nonMetadata = files.filter((file) => !isMacOsMetadataPath(file.path));
  if (nonMetadata.length !== files.length) {
    return invalid(
      "unsafe_path",
      "Archive contains unsupported macOS metadata entries.",
      {
        paths: files
          .filter((file) => isMacOsMetadataPath(file.path))
          .map((file) => file.path),
      },
    );
  }

  const skillMarkers = nonMetadata.filter(
    (file) => file.path === SKILL_MD || file.path.endsWith(`/${SKILL_MD}`),
  );
  if (skillMarkers.length === 0) {
    return invalid("missing_skill_md", "Archive must contain SKILL.md.");
  }
  if (skillMarkers.length > 1) {
    return invalid(
      "multiple_skills",
      "Archive must contain exactly one SKILL.md.",
      { paths: skillMarkers.map((file) => file.path) },
    );
  }

  const marker = skillMarkers[0]!;
  if (marker.path === SKILL_MD) {
    return {
      ok: true,
      sourceRoot: "",
      folderSlug: null,
      files: nonMetadata.map((file) => ({
        ...file,
        path: normalizeArchivePath(file.path),
      })),
    };
  }

  const [folderSlug] = marker.path.split("/");
  if (!folderSlug) {
    return invalid("missing_skill_md", "Archive must contain SKILL.md.");
  }

  const prefix = `${folderSlug}/`;
  const outside = nonMetadata.filter((file) => !file.path.startsWith(prefix));
  if (outside.length > 0) {
    return invalid(
      "multiple_skills",
      "Top-level-folder archives must contain files in exactly one folder.",
      { paths: outside.map((file) => file.path), folder: folderSlug },
    );
  }

  return {
    ok: true,
    sourceRoot: prefix,
    folderSlug,
    files: nonMetadata.map((file) => ({
      ...file,
      path: normalizeArchivePath(file.path.slice(prefix.length)),
    })),
  };
}

function defaultWiringMd(slug: string): string {
  return renderWiringMd([
    {
      id: "default",
      title: "Default",
      description:
        "Generated during Skill Library import for Agent Skills-compatible archives.",
      snippet: `- For tasks covered by the \`${slug}\` skill, read skills/${slug}/SKILL.md and follow it.\n`,
    },
  ]);
}

function validateRawZipPath(
  rawPath: string,
  isDirectory: boolean,
): CatalogSkillArchiveError | null {
  if (rawPath.length === 0) {
    return {
      code: "unsafe_path",
      message: "Archive entry has an empty path.",
      path: rawPath,
    };
  }
  if (rawPath.length > CATALOG_SKILL_ARCHIVE_LIMITS.maxPathLength) {
    return {
      code: "unsafe_path",
      message:
        `Archive entry path is ${rawPath.length} chars; max is ` +
        `${CATALOG_SKILL_ARCHIVE_LIMITS.maxPathLength}.`,
      path: rawPath,
    };
  }
  if (rawPath.includes("\0")) {
    return {
      code: "unsafe_path",
      message: "Archive entry path contains a NUL byte.",
      path: rawPath,
    };
  }
  if (rawPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(rawPath)) {
    return {
      code: "unsafe_path",
      message: "Archive entry path must be relative.",
      path: rawPath,
    };
  }
  const normalized = isDirectory ? rawPath.replace(/[\\/]+$/, "") : rawPath;
  const segments = normalized.split(/[\\/]+/);
  if (segments.some((segment) => segment === ".." || segment.length === 0)) {
    return {
      code: "unsafe_path",
      message: "Archive entry path contains unsafe segments.",
      path: rawPath,
      details: { segments },
    };
  }
  return null;
}

function validateRelativeSkillPath(
  cleanPath: string,
  rawPath: string,
): CatalogSkillArchiveError | null {
  if (
    !cleanPath ||
    cleanPath.startsWith("/") ||
    cleanPath
      .split("/")
      .some((segment) => segment.length === 0 || segment === "..")
  ) {
    return {
      code: "unsafe_path",
      message: `Invalid skill archive path '${rawPath}'.`,
      path: rawPath,
    };
  }
  return null;
}

function validateNotSymlink(
  entry: JSZip.JSZipObject,
): CatalogSkillArchiveError | null {
  const unixPermissions = (
    entry as unknown as { unixPermissions?: number | null }
  ).unixPermissions;
  if (typeof unixPermissions !== "number") return null;
  const fileType = unixPermissions & 0o170000;
  if (fileType !== 0o120000) return null;
  const path = unsafeOriginalName(entry);
  return {
    code: "unsafe_path",
    message: `Archive entry '${path}' is a symlink.`,
    path,
    details: { unixPermissions },
  };
}

function normalizeArchivePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function unsafeOriginalName(entry: JSZip.JSZipObject): string {
  return (
    (entry as unknown as { unsafeOriginalName?: string }).unsafeOriginalName ??
    entry.name
  );
}

function readUncompressedSize(entry: JSZip.JSZipObject): number | null {
  const internal = (
    entry as unknown as {
      _data?: { uncompressedSize?: number };
    }
  )._data;
  return isSafeZipSize(internal?.uncompressedSize)
    ? internal.uncompressedSize
    : null;
}

function readCompressedSize(entry: JSZip.JSZipObject): number | null {
  const internal = (
    entry as unknown as {
      _data?: { compressedSize?: number };
    }
  )._data;
  return isSafeZipSize(internal?.compressedSize)
    ? internal.compressedSize
    : null;
}

function isSafeZipSize(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isMacOsMetadataPath(path: string): boolean {
  return (
    path === ".DS_Store" ||
    path.endsWith("/.DS_Store") ||
    path === "__MACOSX" ||
    path.startsWith("__MACOSX/")
  );
}

function invalid(
  code: CatalogSkillArchiveErrorCode,
  message: string,
  details?: Record<string, unknown>,
  path?: string,
): { ok: false; errors: CatalogSkillArchiveError[] } {
  return { ok: false, errors: [{ code, message, details, path }] };
}

function serializeSkillMdError(error: SkillMdError): Record<string, unknown> {
  return {
    kind: error.kind,
    message: error.message,
    details: error.details,
  };
}

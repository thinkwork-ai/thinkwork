/**
 * Security invariant SI-4: plugin zip archives get vetted BEFORE any byte
 * hits S3 or the filesystem. The attack surface for plugin uploads is the
 * widest in the V1 plan — arbitrary tenant admins POSTing zip bytes — so
 * every known class of zip-bomb / path-traversal / symlink shenanigans
 * has to fail closed here.
 *
 * Rejection classes, mirrored 1:1 with the plan's SI-4 checks:
 *
 *   - ZipPathEscape         — entry path resolves outside the plugin root
 *                              after normalisation (`..` segments, absolute
 *                              paths, NUL injection).
 *   - ZipDecompressedTooLarge — summed uncompressed sizes > MAX_DECOMPRESSED_BYTES.
 *                              Checked BEFORE any entry is inflated so a
 *                              10KB zip bomb cannot allocate 500MB.
 *   - ZipTooManyEntries     — entry count > MAX_ENTRIES. Catches the
 *                              "million tiny files" denial-of-service.
 *   - ZipSymlinkNotAllowed  — entry external attributes encode symlink
 *                              (Unix mode & 0o170000 === 0o120000). A
 *                              symlink that passes through the plugin
 *                              installer could point into the host FS.
 *   - ZipMalformed          — the archive itself is corrupt. Not an
 *                              attack per se, but we don't proceed past
 *                              the point of failure.
 *
 * The module operates on an in-memory Buffer. The plan's upload handler
 * hands us the bytes the tenant admin posted; Lambda request bodies are
 * capped, so bounding by buffer size is the outer ring. Per-entry budgets
 * below are the inner rings.
 *
 * Notes on jszip:
 *   jszip's `loadAsync` parses the zip central directory and holds the
 *   compressed payload in memory but does NOT inflate entries until
 *   `async()` is called on each file. This lets us enumerate metadata
 *   (names, sizes, unix attributes), reject bad archives, and only then
 *   decompress the entries that passed.
 */

import JSZip from "jszip";

// The plan pins these in its SI-4 description; keep them as named constants
// so ops can tune without editing call sites.
export const MAX_DECOMPRESSED_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_ENTRIES = 500;
export const MAX_PATH_LENGTH = 260; // matches Windows MAX_PATH, catches wild paths early

// Unix `stat` mode bits encoded in the zip entry's external attributes
// (upper 16 bits). 0o170000 is the file-type mask; 0o120000 is symlink.
// External-attribute format — the upper 16 bits of the 32-bit field carry
// the Unix stat mode when the entry was created on a Unix-like system.
const UNIX_MODE_FILE_TYPE_MASK = 0o170000;
const UNIX_MODE_SYMLINK = 0o120000;

export type ZipSafetyErrorKind =
  | "ZipPathEscape"
  | "ZipDecompressedTooLarge"
  | "ZipTooManyEntries"
  | "ZipSymlinkNotAllowed"
  | "ZipPathTooLong"
  | "ZipMalformed";

export interface ZipSafetyError {
  kind: ZipSafetyErrorKind;
  message: string;
  details?: Record<string, unknown>;
}

export interface SafeZipEntry {
  path: string;
  /** UTF-8 text content. Binary entries aren't legal for plugin bundles. */
  text: string;
  uncompressedSize: number;
}

export type ZipSafetyResult =
  | { valid: true; entries: SafeZipEntry[] }
  | { valid: false; errors: ZipSafetyError[] };

/**
 * Inspect a zip buffer and return either a list of safe entries or the
 * reasons we refused it. Never throws on well-formed input; malformed
 * input yields a structured ZipMalformed error.
 */
export async function inspectZipBuffer(
  buffer: Buffer,
): Promise<ZipSafetyResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (e) {
    return {
      valid: false,
      errors: [
        {
          kind: "ZipMalformed",
          message: "failed to parse zip central directory",
          details: { cause: (e as Error).message },
        },
      ],
    };
  }

  const errors: ZipSafetyError[] = [];
  const files = Object.values(zip.files);

  // Check 1: entry count (catches the "million tiny files" DoS class).
  if (files.length > MAX_ENTRIES) {
    errors.push({
      kind: "ZipTooManyEntries",
      message: `zip has ${files.length} entries, max is ${MAX_ENTRIES}`,
      details: { count: files.length, max: MAX_ENTRIES },
    });
  }

  // Check 2: per-entry metadata. We walk every entry before inflating
  // anything so a bad entry anywhere in the archive aborts the whole
  // validation. Summed uncompressed size gates before decompression.
  let totalUncompressed = 0;
  const namesToInflate: string[] = [];
  for (const entry of files) {
    // Directory entries don't carry content — they're present in zip
    // archives to preserve empty dirs. Skip their content checks but
    // still enforce path-escape.
    if (entry.dir) {
      const pathErr = checkPathSafety(entry.name);
      if (pathErr) errors.push(pathErr);
      continue;
    }

    const pathErr = checkPathSafety(entry.name);
    if (pathErr) errors.push(pathErr);

    // Symlink detection via Unix external file attributes. Safe to
    // inspect even on Windows-created zips — the attribute is just
    // zero when absent, which is not a symlink.
    const unixPermissions = (
      entry as unknown as { unixPermissions?: number | null }
    ).unixPermissions;
    if (
      typeof unixPermissions === "number" &&
      (unixPermissions & UNIX_MODE_FILE_TYPE_MASK) === UNIX_MODE_SYMLINK
    ) {
      errors.push({
        kind: "ZipSymlinkNotAllowed",
        message: `zip entry '${entry.name}' is a symlink`,
        details: { path: entry.name, unixPermissions },
      });
      continue;
    }

    // Uncompressed size is reported in the central directory and
    // trusted ONLY for rejection — we never use the reported size for
    // allocation. A lying header would trip the actual-bytes check
    // below when we inflate.
    const size = readUncompressedSize(entry);
    totalUncompressed += size;
    if (totalUncompressed > MAX_DECOMPRESSED_BYTES) {
      errors.push({
        kind: "ZipDecompressedTooLarge",
        message:
          `summed uncompressed size exceeds ${MAX_DECOMPRESSED_BYTES} bytes ` +
          `(stopped at entry '${entry.name}')`,
        details: {
          current: totalUncompressed,
          max: MAX_DECOMPRESSED_BYTES,
          offending_entry: entry.name,
        },
      });
      // Stop inflating — the archive is already refused; no point
      // walking the rest.
      break;
    }
    namesToInflate.push(entry.name);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Check 3: actual inflation. We already gated on summed-uncompressed,
  // but jszip returns the real decompressed bytes here, so any liar
  // header that inflated past the reported size also trips our in-memory
  // bound (MAX_DECOMPRESSED_BYTES again, applied to the sum of `text.length`).
  let inflatedTotal = 0;
  const entries: SafeZipEntry[] = [];
  for (const name of namesToInflate) {
    const file = zip.files[name];
    if (!file || file.dir) continue;
    const text = await file.async("string");
    inflatedTotal += Buffer.byteLength(text, "utf8");
    if (inflatedTotal > MAX_DECOMPRESSED_BYTES) {
      return {
        valid: false,
        errors: [
          {
            kind: "ZipDecompressedTooLarge",
            message:
              `actual decompressed bytes exceeded ${MAX_DECOMPRESSED_BYTES} ` +
              `(central-directory header understated entry '${name}')`,
            details: {
              inflated_so_far: inflatedTotal,
              max: MAX_DECOMPRESSED_BYTES,
              offending_entry: name,
            },
          },
        ],
      };
    }
    entries.push({
      path: name,
      text,
      uncompressedSize: Buffer.byteLength(text, "utf8"),
    });
  }

  return { valid: true, entries };
}

/**
 * Path-safety check — rejects traversal, absolute paths, NUL injection,
 * and wildly long paths. The returned error (if any) includes details
 * the operator can paste into a bug report.
 */
function checkPathSafety(rawPath: string): ZipSafetyError | null {
  if (rawPath.length === 0) {
    return {
      kind: "ZipPathEscape",
      message: "zip entry has empty path",
      details: { path: rawPath },
    };
  }

  if (rawPath.length > MAX_PATH_LENGTH) {
    return {
      kind: "ZipPathTooLong",
      message: `zip entry path is ${rawPath.length} chars (max ${MAX_PATH_LENGTH})`,
      details: { path: rawPath, length: rawPath.length, max: MAX_PATH_LENGTH },
    };
  }

  // NUL injection — some extractors truncate at the NUL byte, so an
  // attacker can encode "harmless.txt\0../../etc/passwd" and have it
  // land wherever the truncation lands.
  if (rawPath.includes("\0")) {
    return {
      kind: "ZipPathEscape",
      message: `zip entry path contains NUL byte`,
      details: { path: rawPath },
    };
  }

  // Reject absolute paths outright — plugin bundles live under the
  // staged S3 prefix; absolute paths never make sense.
  if (rawPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(rawPath)) {
    return {
      kind: "ZipPathEscape",
      message: `zip entry has absolute path`,
      details: { path: rawPath },
    };
  }

  // Normalise and ensure no segment is '..' — covers both leading
  // 'a/../../etc/passwd' and mid-path escapes.
  const segments = rawPath.split(/[\\/]+/).filter((s) => s.length > 0);
  if (segments.some((s) => s === "..")) {
    return {
      kind: "ZipPathEscape",
      message: `zip entry path contains '..' segment`,
      details: { path: rawPath, segments },
    };
  }

  return null;
}

function readUncompressedSize(entry: JSZip.JSZipObject): number {
  // jszip exposes uncompressed size via a non-public-but-stable
  // attribute; fall back to 0 if the lib changes shape (belt-and-
  // suspenders — the actual-bytes check below still enforces the cap).
  const internal = (
    entry as unknown as {
      _data?: { uncompressedSize?: number };
    }
  )._data;
  if (internal && typeof internal.uncompressedSize === "number") {
    return internal.uncompressedSize;
  }
  return 0;
}

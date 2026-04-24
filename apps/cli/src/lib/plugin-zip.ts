/**
 * Local-side zip helper for `thinkwork skill push` (plan §U14).
 *
 * Reads a plugin directory, runs a minimal sanity check against the U9
 * validator's expected shape (plugin.json present + parseable + has a
 * `name`), and returns a zip buffer plus parsed metadata so the
 * caller can feed it straight into the presign → PUT → upload flow.
 *
 * The server-side U9 validator is still the source of truth — this
 * helper only catches the trivial local-side mistakes (typo in
 * filename, missing JSON) so the operator gets a fast error rather
 * than waiting for a round-trip. It does NOT attempt to replicate the
 * server's zip-safety checks.
 *
 * Layout expectations (per plan §U9/§U10):
 *   my-plugin/
 *     plugin.json         — required; at minimum {"name": "..."}
 *     skills/<slug>/SKILL.md  — any number of
 *     scripts/            — optional
 *     references/         — optional
 *
 * Symlinks and `..`-bearing paths are rejected at walk time. The U9
 * validator catches them server-side too; we short-circuit locally so
 * the operator sees the issue before uploading.
 */

import { createReadStream, promises as fsp, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";

import JSZip from "jszip";

export interface PluginMetadata {
  name: string;
  version?: string;
  description?: string;
}

export interface BuildPluginZipResult {
  buffer: Buffer;
  plugin: PluginMetadata;
  fileCount: number;
  zipFileName: string;
}

export class PluginZipError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | "missing-directory"
      | "missing-plugin-json"
      | "invalid-plugin-json"
      | "unsafe-entry"
      | "io",
  ) {
    super(message);
    this.name = "PluginZipError";
  }
}

/**
 * Build a zip of `pluginDir` plus return parsed plugin.json metadata.
 *
 * Throws `PluginZipError` on any local-side rejection so the caller can
 * print a friendly CLI message without sniffing strings.
 */
export async function buildPluginZip(
  pluginDir: string,
): Promise<BuildPluginZipResult> {
  const root = resolve(pluginDir);
  let stat: Awaited<ReturnType<typeof fsp.stat>>;
  try {
    stat = await fsp.stat(root);
  } catch {
    throw new PluginZipError(
      `Plugin directory not found: ${pluginDir}`,
      "missing-directory",
    );
  }
  if (!stat.isDirectory()) {
    throw new PluginZipError(
      `Plugin path must be a directory: ${pluginDir}`,
      "missing-directory",
    );
  }

  const manifestPath = join(root, "plugin.json");
  let manifestRaw: string;
  try {
    manifestRaw = await fsp.readFile(manifestPath, "utf8");
  } catch {
    throw new PluginZipError(
      `plugin.json is required at the root of the plugin folder (expected ${manifestPath}).`,
      "missing-plugin-json",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestRaw);
  } catch (err) {
    throw new PluginZipError(
      `plugin.json is not valid JSON: ${(err as Error).message}`,
      "invalid-plugin-json",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PluginZipError(
      `plugin.json must be a JSON object with a "name" field.`,
      "invalid-plugin-json",
    );
  }
  const manifest = parsed as Record<string, unknown>;
  if (typeof manifest.name !== "string" || manifest.name.trim() === "") {
    throw new PluginZipError(
      `plugin.json must declare a non-empty "name" string.`,
      "invalid-plugin-json",
    );
  }

  const zip = new JSZip();
  const entries = await walkDir(root, root);

  for (const entry of entries) {
    if (entry.isSymbolicLink) {
      throw new PluginZipError(
        `Refusing to zip symlink: ${entry.relPath} (would be rejected server-side).`,
        "unsafe-entry",
      );
    }
    if (hasParentSegment(entry.relPath)) {
      // Defense-in-depth. Node path.join + relative normally strips
      // `..`, but a file literally named `..something` or a funky
      // filesystem entry still shouldn't sneak past us.
      throw new PluginZipError(
        `Refusing to zip path with traversal segment: ${entry.relPath}`,
        "unsafe-entry",
      );
    }
    // Use forward slashes in the archive for cross-platform
    // compatibility — jszip accepts / as the separator on every OS.
    const archivePath = entry.relPath.split(sep).join("/");
    zip.file(archivePath, createReadStream(entry.absPath));
  }

  let buffer: Buffer;
  try {
    buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
  } catch (err) {
    throw new PluginZipError(
      `Failed to compress plugin: ${(err as Error).message}`,
      "io",
    );
  }

  const metadata: PluginMetadata = {
    name: manifest.name.trim(),
    version:
      typeof manifest.version === "string" && manifest.version.trim() !== ""
        ? manifest.version.trim()
        : undefined,
    description:
      typeof manifest.description === "string"
        ? manifest.description.trim() || undefined
        : undefined,
  };

  return {
    buffer,
    plugin: metadata,
    fileCount: entries.length,
    zipFileName: `${basename(root)}.zip`,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface WalkEntry {
  absPath: string;
  relPath: string;
  isSymbolicLink: boolean;
}

async function walkDir(
  rootDir: string,
  currentDir: string,
): Promise<WalkEntry[]> {
  const out: WalkEntry[] = [];
  const dirents = await fsp.readdir(currentDir, { withFileTypes: true });
  for (const ent of dirents) {
    const abs = join(currentDir, ent.name);
    const rel = relative(rootDir, abs);
    // Skip common junk — .git directories, OS metadata, build output.
    if (
      ent.name === ".git" ||
      ent.name === ".DS_Store" ||
      ent.name === "node_modules"
    ) {
      continue;
    }
    if (ent.isSymbolicLink()) {
      out.push({ absPath: abs, relPath: rel, isSymbolicLink: true });
      continue;
    }
    if (ent.isDirectory()) {
      out.push(...(await walkDir(rootDir, abs)));
      continue;
    }
    if (ent.isFile()) {
      // Defense: re-stat to make sure we didn't chase a file that
      // vanished between readdir + compression.
      try {
        statSync(abs);
      } catch {
        continue;
      }
      out.push({ absPath: abs, relPath: rel, isSymbolicLink: false });
    }
  }
  return out.sort((a, b) =>
    a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0,
  );
}

function hasParentSegment(relPath: string): boolean {
  const parts = relPath.split(sep);
  return parts.some((p) => p === "..");
}

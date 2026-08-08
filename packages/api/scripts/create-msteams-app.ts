#!/usr/bin/env -S tsx
/**
 * Build the Microsoft Teams app package (THINK-84 U6).
 *
 * Reads packages/api/teams-app-package/manifest.json, substitutes the
 * `${BOT_APP_ID}` / `${STAGE_SUFFIX}` / `${API_BASE_DOMAIN}` placeholders,
 * validates the result, and zips manifest.json + color.png + outline.png
 * into dist/msteams/thinkwork-teams-<stage>.zip (store-only zip — no
 * dependency on archiver or the system `zip` binary).
 *
 * Usage:
 *   npx tsx packages/api/scripts/create-msteams-app.ts \
 *     --stage dev \
 *     --bot-app-id 00000000-0000-0000-0000-000000000000 \
 *     --api-domain abc123.execute-api.us-east-1.amazonaws.com
 *
 * Flags fall back to env vars: STAGE, MSTEAMS_BOT_APP_ID, API_BASE_DOMAIN.
 * Optional: --out-dir <dir> (default: <cwd>/dist/msteams).
 *
 * Runbook: docs/reference/operations/msteams-install-runbook.md
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { crc32 } from "node:zlib";

export interface PackageInputs {
  stage: string;
  botAppId: string;
  apiBaseDomain: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PLACEHOLDER_RE = /\$\{[^}]*\}/;

/** Stage-aware display-name suffix: empty for prod, " (stage)" otherwise. */
export function stageSuffix(stage: string): string {
  return stage === "prod" ? "" : ` (${stage})`;
}

/** Substitute the package-time placeholders in the manifest template. */
export function substituteManifestTemplate(
  template: string,
  inputs: PackageInputs,
): string {
  return template
    .replaceAll("${BOT_APP_ID}", inputs.botAppId)
    .replaceAll("${STAGE_SUFFIX}", stageSuffix(inputs.stage))
    .replaceAll("${API_BASE_DOMAIN}", inputs.apiBaseDomain);
}

/** Parse width/height out of a PNG's IHDR chunk. Throws on non-PNG data. */
export function readPngDimensions(png: Buffer): {
  width: number;
  height: number;
} {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  if (png.length < 24 || !png.subarray(0, 8).equals(signature)) {
    throw new Error("not a PNG file (bad signature)");
  }
  if (png.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error("not a PNG file (missing IHDR)");
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * Validate the substituted manifest and icon bytes. Returns the list of
 * problems (empty = valid) so callers can report all failures at once.
 */
export function validateAppPackage(
  manifestJson: string,
  icons: { color: Buffer; outline: Buffer },
  inputs: PackageInputs,
): string[] {
  const problems: string[] = [];

  // No unsubstituted `${...}` placeholders may remain anywhere.
  const leak = manifestJson.match(PLACEHOLDER_RE);
  if (leak) {
    problems.push(`unsubstituted placeholder remains: ${leak[0]}`);
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(manifestJson) as Record<string, unknown>;
  } catch (err) {
    problems.push(`manifest is not valid JSON: ${String(err)}`);
    return problems;
  }

  // Required fields.
  const requiredPaths: Array<[string, unknown]> = [
    ["manifestVersion", manifest.manifestVersion],
    ["version", manifest.version],
    ["id", manifest.id],
    ["developer.name", (manifest.developer as Record<string, unknown>)?.name],
    [
      "developer.privacyUrl",
      (manifest.developer as Record<string, unknown>)?.privacyUrl,
    ],
    [
      "developer.termsOfUseUrl",
      (manifest.developer as Record<string, unknown>)?.termsOfUseUrl,
    ],
    ["name.short", (manifest.name as Record<string, unknown>)?.short],
    [
      "description.short",
      (manifest.description as Record<string, unknown>)?.short,
    ],
    [
      "description.full",
      (manifest.description as Record<string, unknown>)?.full,
    ],
    ["icons.color", (manifest.icons as Record<string, unknown>)?.color],
    ["icons.outline", (manifest.icons as Record<string, unknown>)?.outline],
  ];
  for (const [name, value] of requiredPaths) {
    if (typeof value !== "string" || value.length === 0) {
      problems.push(`missing required manifest field: ${name}`);
    }
  }

  // App id and bot id must be UUIDs.
  if (typeof manifest.id === "string" && !UUID_RE.test(manifest.id)) {
    problems.push(`manifest id is not a UUID: ${manifest.id}`);
  }
  const bots = manifest.bots as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(bots) || bots.length !== 1) {
    problems.push("manifest must declare exactly one bot");
  } else {
    const botId = bots[0].botId;
    if (typeof botId !== "string" || !UUID_RE.test(botId)) {
      problems.push(`bot id is not a UUID: ${String(botId)}`);
    }
  }

  // validDomains: exactly the API base domain, no wildcards, no schemes.
  const validDomains = manifest.validDomains as unknown;
  if (
    !Array.isArray(validDomains) ||
    validDomains.length !== 1 ||
    validDomains[0] !== inputs.apiBaseDomain
  ) {
    problems.push(
      `validDomains must be exactly ["${inputs.apiBaseDomain}"], got ${JSON.stringify(validDomains)}`,
    );
  }
  if (Array.isArray(validDomains)) {
    for (const domain of validDomains) {
      if (typeof domain !== "string" || /[*/\s]|:\/\//.test(domain)) {
        problems.push(
          `validDomains entry contains a wildcard, scheme, or path: ${String(domain)}`,
        );
      }
    }
  }

  // Icon dimensions (Teams requires 192x192 color, 32x32 outline).
  for (const [name, buf, expected] of [
    ["color.png", icons.color, 192],
    ["outline.png", icons.outline, 32],
  ] as const) {
    try {
      const { width, height } = readPngDimensions(buf);
      if (width !== expected || height !== expected) {
        problems.push(
          `${name} must be ${expected}x${expected}, got ${width}x${height}`,
        );
      }
    } catch (err) {
      problems.push(
        `${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return problems;
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

/**
 * Minimal store-only (no compression) zip writer. Teams app packages are
 * three tiny files, so compression is pointless; this avoids adding a
 * dependency. Fixed timestamp keeps output deterministic.
 */
export function buildStoreZip(entries: ZipEntry[]): Buffer {
  // 2026-01-01 00:00:00 in MS-DOS format.
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18); // compressed size
    local.writeUInt32LE(entry.data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    localParts.push(local, nameBuf, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // method: store
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    // extra/comment/disk/attrs all zero.
    central.writeUInt32LE(offset, 42); // local header offset
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + entry.data.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16); // central directory offset

  return Buffer.concat([...localParts, centralDir, eocd]);
}

/** List entry names from a zip's central directory (for tests/verification). */
export function listZipEntries(zip: Buffer): string[] {
  const eocdOffset = zip.length - 22;
  if (zip.readUInt32LE(eocdOffset) !== 0x06054b50) {
    throw new Error("bad zip: EOCD not found");
  }
  const count = zip.readUInt16LE(eocdOffset + 10);
  let pos = zip.readUInt32LE(eocdOffset + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(pos) !== 0x02014b50) {
      throw new Error("bad zip: central directory entry not found");
    }
    const nameLen = zip.readUInt16LE(pos + 28);
    const extraLen = zip.readUInt16LE(pos + 30);
    const commentLen = zip.readUInt16LE(pos + 32);
    names.push(zip.subarray(pos + 46, pos + 46 + nameLen).toString("utf8"));
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

const PACKAGE_DIR = fileURLToPath(
  new URL("../teams-app-package/", import.meta.url),
);

/**
 * Build the full app package from the checked-in template + icons.
 * Throws with all validation problems listed if the result is invalid.
 */
export function buildTeamsAppPackage(
  inputs: PackageInputs,
  packageDir: string = PACKAGE_DIR,
): Buffer {
  const template = readFileSync(path.join(packageDir, "manifest.json"), "utf8");
  const manifestJson = substituteManifestTemplate(template, inputs);
  const icons = {
    color: readFileSync(path.join(packageDir, "color.png")),
    outline: readFileSync(path.join(packageDir, "outline.png")),
  };
  const problems = validateAppPackage(manifestJson, icons, inputs);
  if (problems.length > 0) {
    throw new Error(
      `invalid Teams app package:\n  - ${problems.join("\n  - ")}`,
    );
  }
  return buildStoreZip([
    { name: "manifest.json", data: Buffer.from(manifestJson, "utf8") },
    { name: "color.png", data: icons.color },
    { name: "outline.png", data: icons.outline },
  ]);
}

interface CliArgs extends PackageInputs {
  outDir: string;
}

export function parseCliArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): CliArgs {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      flags.set(arg.slice(2, eq), arg.slice(eq + 1));
    } else {
      flags.set(arg.slice(2), argv[++i] ?? "");
    }
  }

  const stage = flags.get("stage") ?? env.STAGE ?? "";
  const botAppId = flags.get("bot-app-id") ?? env.MSTEAMS_BOT_APP_ID ?? "";
  const apiBaseDomain = flags.get("api-domain") ?? env.API_BASE_DOMAIN ?? "";
  const outDir =
    flags.get("out-dir") ?? path.resolve(process.cwd(), "dist/msteams");

  const missing: string[] = [];
  if (!stage) missing.push("--stage (or STAGE)");
  if (!botAppId) missing.push("--bot-app-id (or MSTEAMS_BOT_APP_ID)");
  if (!apiBaseDomain) missing.push("--api-domain (or API_BASE_DOMAIN)");
  if (missing.length > 0) {
    throw new Error(`missing required inputs: ${missing.join(", ")}`);
  }

  return { stage, botAppId, apiBaseDomain, outDir };
}

function main(): void {
  const args = parseCliArgs(process.argv.slice(2));
  const zip = buildTeamsAppPackage(args);
  mkdirSync(args.outDir, { recursive: true });
  const outPath = path.join(args.outDir, `thinkwork-teams-${args.stage}.zip`);
  writeFileSync(outPath, zip);
  console.log(
    `wrote ${outPath} (${zip.length} bytes: ${listZipEntries(zip).join(", ")})`,
  );
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

#!/usr/bin/env tsx
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  releaseManifestSha256,
  validateReleaseManifest,
} from "../../packages/release-manifest/src/index";

export async function computeReleaseManifestSha256(
  manifestPath: string,
): Promise<string> {
  const manifest = validateReleaseManifest(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  return releaseManifestSha256(manifest);
}

async function main(): Promise<void> {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    throw new Error("Usage: manifest-sha256.ts <manifest-path>");
  }

  console.log(await computeReleaseManifestSha256(manifestPath));
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}

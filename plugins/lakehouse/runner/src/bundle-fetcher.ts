import { createHash } from "node:crypto";
import type { LakeHouseBundleManifest } from "../../src/edge-integration";
import { validateBundleManifest } from "../../src/edge-integration";

export interface BundleObject {
  manifest: LakeHouseBundleManifest;
  files: Record<string, string>;
}

export interface FetchBundleInput {
  expectedDigest: string;
  fetchObject: () => Promise<BundleObject>;
}

export interface VerifiedBundle {
  manifest: LakeHouseBundleManifest;
  files: Record<string, string>;
  digest: string;
}

export async function fetchAndVerifyBundle(
  input: FetchBundleInput,
): Promise<VerifiedBundle> {
  const bundle = await input.fetchObject();
  const manifest = bundle.manifest;
  const validation = validateBundleManifest(manifest);

  if (!validation.ok) {
    throw new Error(
      `Bundle validation failed: ${validation.issues
        .map((issue) => `${issue.path} ${issue.message}`)
        .join("; ")}`,
    );
  }
  if (validation.digest !== input.expectedDigest) {
    throw new Error("Bundle digest mismatch");
  }
  if (manifest.signature.digest !== input.expectedDigest) {
    throw new Error("Bundle signature digest mismatch");
  }

  for (const file of manifest.meltanoProject.files) {
    const contents = bundle.files[file.path];
    if (contents === undefined) {
      throw new Error(`Bundle file missing: ${file.path}`);
    }
    const digest = createHash("sha256").update(contents).digest("hex");
    if (digest !== file.sha256) {
      throw new Error(`Bundle file digest mismatch: ${file.path}`);
    }
  }

  return {
    manifest,
    files: bundle.files,
    digest: validation.digest,
  };
}

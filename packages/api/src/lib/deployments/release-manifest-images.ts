import { createHash } from "node:crypto";
import type { ManagedAppKey } from "@thinkwork/deployment-runner/apps/registry";
import {
  validateReleaseManifest,
  type ThinkWorkReleaseManifest,
} from "@thinkwork/release-manifest";

export async function resolveManifestImagesForManagedApp(args: {
  appKey: ManagedAppKey;
  manifestDigest: string;
  releaseManifestUrl?: string | null;
  manifestImages: Record<string, string>;
}): Promise<Record<string, string>> {
  if (args.appKey !== "n8n") return args.manifestImages;

  const releaseManifestUrl = args.releaseManifestUrl?.trim();
  if (!releaseManifestUrl) return args.manifestImages;
  if (Object.keys(args.manifestImages).length > 0) {
    return args.manifestImages;
  }

  const { manifest, digest: actualDigest } =
    await loadReleaseManifest(releaseManifestUrl);
  if (actualDigest !== args.manifestDigest) {
    throw new Error(
      `Release manifest digest mismatch for ${args.appKey}: expected ${args.manifestDigest}, got ${actualDigest}.`,
    );
  }

  const app = manifest.managedApps.find(
    (candidate) => candidate.id === args.appKey,
  );
  const requiredImages = app?.requiredImages ?? [];
  if (requiredImages.length === 0) return args.manifestImages;

  const runtimeImages = new Map(
    manifest.runtimeImages.map((image) => [image.name, image.uri]),
  );
  const resolved = { ...args.manifestImages };
  for (const imageName of requiredImages) {
    if (resolved[imageName]) continue;
    const imageUri = runtimeImages.get(imageName);
    if (!imageUri) {
      throw new Error(
        `Release manifest for ${args.appKey} requires runtime image ${imageName}, but no matching runtimeImages entry exists.`,
      );
    }
    resolved[imageName] = imageUri;
  }
  return resolved;
}

async function loadReleaseManifest(
  releaseManifestUrl: string,
): Promise<{ digest: string; manifest: ThinkWorkReleaseManifest }> {
  const response = await fetch(releaseManifestUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch release manifest ${releaseManifestUrl}: HTTP ${response.status}.`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    digest: createHash("sha256").update(bytes).digest("hex"),
    manifest: validateReleaseManifest(JSON.parse(bytes.toString("utf8"))),
  };
}

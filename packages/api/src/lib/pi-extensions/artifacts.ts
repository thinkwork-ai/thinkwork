import { createHash } from "node:crypto";
import type { PiExtensionManifest } from "./manifest.js";

export interface PiExtensionArtifactDescriptor {
  schemaVersion: 1;
  kind: "github-source-snapshot";
  repositoryUrl: string;
  owner: string;
  repo: string;
  commitSha: string;
  sourceRef: string;
  manifestPath: string;
  manifestHash: string;
  runtimeTarget: string;
  entrypoint: string | null;
  tarballUrl: string;
}

export function sha256Hex(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function buildPiExtensionArtifactDescriptor(input: {
  repositoryUrl: string;
  owner: string;
  repo: string;
  commitSha: string;
  sourceRef: string;
  manifestPath: string;
  manifest: PiExtensionManifest;
}): PiExtensionArtifactDescriptor {
  return {
    schemaVersion: 1,
    kind: "github-source-snapshot",
    repositoryUrl: input.repositoryUrl,
    owner: input.owner,
    repo: input.repo,
    commitSha: input.commitSha,
    sourceRef: input.sourceRef,
    manifestPath: input.manifestPath,
    manifestHash: sha256Hex(canonicalJson(input.manifest)),
    runtimeTarget: input.manifest.runtimeTarget,
    entrypoint: input.manifest.entrypoint,
    tarballUrl: `https://api.github.com/repos/${input.owner}/${input.repo}/tarball/${input.commitSha}`,
  };
}

export function piExtensionArtifactUri(
  descriptor: PiExtensionArtifactDescriptor,
): string {
  return `github://${descriptor.owner}/${descriptor.repo}/${descriptor.commitSha}`;
}

export function piExtensionArtifactHash(
  descriptor: PiExtensionArtifactDescriptor,
): string {
  return sha256Hex(canonicalJson(descriptor));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, sortJson(child)]),
  );
}

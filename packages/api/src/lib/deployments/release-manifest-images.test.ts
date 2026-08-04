import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ThinkWorkReleaseManifest,
} from "@thinkwork/release-manifest";
import { resolveManifestImagesForManagedApp } from "./release-manifest-images.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveManifestImagesForManagedApp", () => {
  it("hydrates required n8n runtime images from the release manifest", async () => {
    const manifest = releaseManifest();
    const bytes = releaseManifestBytes(manifest);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes,
      })),
    );

    await expect(
      resolveManifestImagesForManagedApp({
        appKey: "n8n",
        manifestDigest: sha256Hex(bytes),
        releaseManifestUrl:
          "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.224/thinkwork-release.json",
        manifestImages: {},
      }),
    ).resolves.toEqual({
      "n8n-runtime":
        "487219502366.dkr.ecr.us-east-1.amazonaws.com/thinkwork-dev-agentcore:v0.1.0-canary.224-n8n-amd64@sha256:" +
        "1".repeat(64),
    });
  });

  it("rejects a manifest that does not match the selected digest", async () => {
    const manifest = releaseManifest();
    const bytes = releaseManifestBytes(manifest);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes,
      })),
    );

    await expect(
      resolveManifestImagesForManagedApp({
        appKey: "n8n",
        manifestDigest: "2".repeat(64),
        releaseManifestUrl:
          "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.224/thinkwork-release.json",
        manifestImages: {},
      }),
    ).rejects.toThrow(/Release manifest digest mismatch/);
  });

  it("preserves explicitly supplied images without fetching the manifest", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(
      resolveManifestImagesForManagedApp({
        appKey: "n8n",
        manifestDigest: "2".repeat(64),
        releaseManifestUrl:
          "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.224/thinkwork-release.json",
        manifestImages: {
          "n8n-runtime":
            "123456789012.dkr.ecr.us-east-1.amazonaws.com/custom/n8n@sha256:" +
            "4".repeat(64),
        },
      }),
    ).resolves.toEqual({
      "n8n-runtime":
        "123456789012.dkr.ecr.us-east-1.amazonaws.com/custom/n8n@sha256:" +
        "4".repeat(64),
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

function releaseManifestBytes(manifest: ThinkWorkReleaseManifest): Buffer {
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function releaseManifest(): ThinkWorkReleaseManifest {
  return {
    schemaVersion: 1,
    release: {
      version: "0.1.0-canary.224",
      gitSha: "abc123",
      createdAt: "2026-06-20T00:00:00.000Z",
    },
    compatibility: {
      minCliVersion: "0.0.0",
      minRunnerVersion: "0.0.0",
      profileSchemaVersion: 1,
    },
    components: {
      cli: { version: "0.1.0-canary.224" },
      terraform: {
        source: "thinkwork-ai/thinkwork/aws",
        version: "0.1.0-canary.224",
      },
      deploymentRunner: {
        version: "0.1.0-canary.224",
        image: null,
        script: {
          fileName: "thinkwork-runner.py",
          relativePath: "runner/thinkwork-runner.py",
          url: null,
          sha256: "3".repeat(64),
          sizeBytes: 42,
        },
      },
      customerOverlay: { schemaVersion: 1 },
    },
    artifacts: [],
    runtimeImages: [
      {
        name: "n8n-runtime",
        repository:
          "487219502366.dkr.ecr.us-east-1.amazonaws.com/thinkwork-dev-agentcore",
        tag: "v0.1.0-canary.224-n8n-amd64",
        digest: `sha256:${"1".repeat(64)}`,
        architecture: "amd64",
        uri:
          "487219502366.dkr.ecr.us-east-1.amazonaws.com/thinkwork-dev-agentcore:v0.1.0-canary.224-n8n-amd64@sha256:" +
          "1".repeat(64),
      },
    ],
    managedApps: [
      {
        id: "n8n",
        displayName: "n8n",
        requiredImages: ["n8n-runtime"],
      },
    ],
    signing: {
      acceptedKeyIds: [],
      revokedKeyIds: [],
    },
  };
}

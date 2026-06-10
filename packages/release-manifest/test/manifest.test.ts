import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  assertManifestCompatible,
  releaseManifestSha256,
  signReleaseManifest,
  validateReleaseManifest,
  verifyArtifactHash,
  verifyReleaseManifest,
  type ThinkWorkReleaseManifest,
} from "../src/index";

function keyPair() {
  const pair = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: pair.publicKey.export({
      format: "pem",
      type: "spki",
    }) as string,
    privateKeyPem: pair.privateKey.export({
      format: "pem",
      type: "pkcs8",
    }) as string,
  };
}

function manifest(overrides: Partial<ThinkWorkReleaseManifest> = {}) {
  return {
    schemaVersion: 1,
    release: {
      version: "1.2.3",
      gitSha: "abc123",
      createdAt: "2026-06-06T00:00:00.000Z",
    },
    compatibility: {
      minCliVersion: "1.2.0",
      minRunnerVersion: "1.2.0",
      profileSchemaVersion: 1,
    },
    components: {
      cli: { version: "1.2.3" },
      terraform: {
        source: "thinkwork-ai/thinkwork/aws",
        version: "1.2.3",
      },
      deploymentRunner: {
        version: "1.2.3",
        image:
          "ghcr.io/thinkwork-ai/thinkwork-deployment-runner:v1.2.3@sha256:1111111111111111111111111111111111111111111111111111111111111111",
      },
      customerOverlay: { schemaVersion: 1 },
    },
    artifacts: [
      {
        name: "graphql-http",
        type: "lambda",
        fileName: "graphql-http.zip",
        relativePath: "lambdas/graphql-http.zip",
        url: "https://example.test/graphql-http.zip",
        sha256:
          "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        sizeBytes: 5,
      },
    ],
    runtimeImages: [
      {
        name: "agentcore-pi-amd64",
        repository: "ghcr.io/thinkwork-ai/thinkwork-agentcore",
        tag: "v1.2.3-pi-amd64",
        digest:
          "sha256:2222222222222222222222222222222222222222222222222222222222222222",
        architecture: "amd64",
        uri: "ghcr.io/thinkwork-ai/thinkwork-agentcore:v1.2.3-pi-amd64@sha256:2222222222222222222222222222222222222222222222222222222222222222",
      },
    ],
    managedApps: [
      {
        id: "cognee",
        displayName: "Cognee",
        terraformModule: {
          source: "thinkwork-ai/thinkwork/aws//modules/app/cognee",
          version: "1.2.3",
        },
        requiredImages: ["agentcore-pi-amd64"],
        smokeContracts: [
          {
            id: "cognee-health",
            command: "scripts/smoke/cognee-managed-app-smoke.mjs",
            required: true,
          },
        ],
      },
      {
        id: "twenty",
        displayName: "Twenty CRM",
        terraformModule: {
          source: "thinkwork-ai/thinkwork/aws//modules/app/twenty",
          version: "1.2.3",
        },
        requiredArtifacts: [],
        smokeContracts: [
          {
            id: "twenty-health",
            command: "scripts/smoke/twenty-managed-app-smoke.mjs",
            required: true,
          },
        ],
      },
    ],
    signing: {
      acceptedKeyIds: ["release-2026-primary"],
      revokedKeyIds: [],
    },
    ...overrides,
  } satisfies ThinkWorkReleaseManifest;
}

describe("release manifest contract", () => {
  it("validates the v1 manifest shape with managed app descriptors", () => {
    const parsed = validateReleaseManifest(manifest());

    expect(parsed.release.version).toBe("1.2.3");
    expect(parsed.managedApps.map((app) => app.id)).toEqual([
      "cognee",
      "twenty",
    ]);
    expect(releaseManifestSha256(parsed)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("validates artifact bundles against known artifacts", () => {
    const parsed = validateReleaseManifest(
      manifest({
        artifactBundles: [
          {
            name: "platform",
            fileName: "platform-artifacts.tar.gz",
            relativePath: "platform-artifacts.tar.gz",
            url: "https://example.test/platform-artifacts.tar.gz",
            sha256:
              "3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7",
            sizeBytes: 4,
            contains: ["graphql-http"],
          },
        ],
        artifacts: [
          {
            ...manifest().artifacts[0]!,
            url: null,
          },
        ],
      }),
    );

    expect(parsed.artifactBundles?.[0]?.contains).toEqual(["graphql-http"]);
    expect(parsed.artifacts[0]?.url).toBeNull();
  });

  it("rejects artifact bundles that reference unknown artifacts", () => {
    expect(() =>
      validateReleaseManifest(
        manifest({
          artifactBundles: [
            {
              name: "platform",
              fileName: "platform-artifacts.tar.gz",
              relativePath: "platform-artifacts.tar.gz",
              url: "https://example.test/platform-artifacts.tar.gz",
              sha256:
                "3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7",
              sizeBytes: 4,
              contains: ["missing-artifact"],
            },
          ],
        }),
      ),
    ).toThrow(/unknown artifact missing-artifact/);
  });

  it("rejects managed app required images that are absent from runtimeImages", () => {
    expect(() =>
      validateReleaseManifest(
        manifest({
          managedApps: [
            {
              id: "twenty",
              displayName: "Twenty CRM",
              requiredImages: ["twenty"],
            },
          ],
        }),
      ),
    ).toThrow(/requiredImages references unknown runtime image twenty/);
  });

  it("rejects malformed component and smoke contract blocks", () => {
    const missingRunner = manifest() as unknown as Record<string, unknown>;
    delete (missingRunner.components as Record<string, unknown>)
      .deploymentRunner;
    expect(() => validateReleaseManifest(missingRunner)).toThrow(
      /components.deploymentRunner.version/,
    );

    expect(() =>
      validateReleaseManifest({
        ...manifest(),
        managedApps: [
          {
            id: "cognee",
            displayName: "Cognee",
            smokeContracts: [
              {
                id: "cognee-health",
                command: "scripts/smoke/cognee-managed-app-smoke.mjs",
              },
            ],
          },
        ],
      }),
    ).toThrow(/smokeContract.required/);
  });

  it("verifies detached signatures before trusting artifact metadata", () => {
    const keys = keyPair();
    const doc = manifest();
    const signature = signReleaseManifest({
      manifest: doc,
      keyId: "release-2026-primary",
      privateKeyPem: keys.privateKeyPem,
      signedAt: "2026-06-06T00:00:00.000Z",
      expiresAt: "2026-12-31T00:00:00.000Z",
    });

    const result = verifyReleaseManifest({
      manifest: doc,
      signature,
      trustedKeys: [
        {
          keyId: "release-2026-primary",
          publicKeyPem: keys.publicKeyPem,
        },
      ],
      now: "2026-06-07T00:00:00.000Z",
    });

    expect(result.manifestSha256).toBe(releaseManifestSha256(doc));
  });

  it("accepts a rotated trusted key and rejects a revoked key", () => {
    const oldKeys = keyPair();
    const nextKeys = keyPair();
    const doc = manifest({
      signing: {
        acceptedKeyIds: ["release-2026-primary", "release-2026-next"],
        revokedKeyIds: [],
      },
    });
    const nextSignature = signReleaseManifest({
      manifest: doc,
      keyId: "release-2026-next",
      privateKeyPem: nextKeys.privateKeyPem,
      signedAt: "2026-06-06T00:00:00.000Z",
      expiresAt: "2026-12-31T00:00:00.000Z",
    });

    expect(() =>
      verifyReleaseManifest({
        manifest: doc,
        signature: nextSignature,
        trustedKeys: [
          {
            keyId: "release-2026-primary",
            publicKeyPem: oldKeys.publicKeyPem,
          },
          {
            keyId: "release-2026-next",
            publicKeyPem: nextKeys.publicKeyPem,
          },
        ],
        now: "2026-06-07T00:00:00.000Z",
      }),
    ).not.toThrow();

    expect(() =>
      verifyReleaseManifest({
        manifest: manifest({
          signing: {
            acceptedKeyIds: ["release-2026-next"],
            revokedKeyIds: ["release-2026-next"],
          },
        }),
        signature: nextSignature,
        trustedKeys: [
          {
            keyId: "release-2026-next",
            publicKeyPem: nextKeys.publicKeyPem,
          },
        ],
        now: "2026-06-07T00:00:00.000Z",
      }),
    ).toThrow(/revoked/);
  });

  it("rejects expired signatures and artifact hash mismatches", () => {
    const keys = keyPair();
    const doc = manifest();
    const signature = signReleaseManifest({
      manifest: doc,
      keyId: "release-2026-primary",
      privateKeyPem: keys.privateKeyPem,
      signedAt: "2026-06-06T00:00:00.000Z",
      expiresAt: "2026-06-07T00:00:00.000Z",
    });

    expect(() =>
      verifyReleaseManifest({
        manifest: doc,
        signature,
        trustedKeys: [
          {
            keyId: "release-2026-primary",
            publicKeyPem: keys.publicKeyPem,
          },
        ],
        now: "2026-06-08T00:00:00.000Z",
      }),
    ).toThrow(/expired/);

    expect(() => verifyArtifactHash(doc.artifacts[0]!, "goodbye")).toThrow(
      /hash mismatch/,
    );
  });

  it("rejects clients and runners outside compatibility bounds", () => {
    expect(() =>
      assertManifestCompatible({
        manifest: manifest(),
        cliVersion: "1.1.9",
      }),
    ).toThrow(/CLI/);

    expect(() =>
      assertManifestCompatible({
        manifest: manifest(),
        cliVersion: "1.2.0",
        runnerVersion: "1.1.9",
      }),
    ).toThrow(/Runner/);
  });
});

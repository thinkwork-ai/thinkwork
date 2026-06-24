import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  signReleaseManifest,
  verifyReleaseManifest,
  type ReleaseManifestSignature,
  type ThinkWorkReleaseManifest,
  type TrustedReleaseKey,
} from "../../../packages/release-manifest/src/index";
import {
  buildReleaseManifest,
  parseArtifactBundleSpec,
  parseArtifactSpec,
  parseManagedAppSpec,
  parseRuntimeImageSpec,
} from "../build-release-manifest.ts";

const execFileAsync = promisify(execFile);

async function makeTempReleaseRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "thinkwork-release-"));
  await mkdir(path.join(root, "runner"), { recursive: true });
  await writeFile(path.join(root, "runner", "thinkwork-runner.py"), "runner");
  return root;
}

test("buildReleaseManifest emits stable artifact metadata", async () => {
  const root = await makeTempReleaseRoot();
  const lambdaDir = path.join(root, "lambdas");
  const staticDir = path.join(root, "static");
  await mkdir(lambdaDir, { recursive: true });
  await mkdir(staticDir, { recursive: true });
  await writeFile(path.join(lambdaDir, "graphql-http.zip"), "lambda-bytes");
  await writeFile(path.join(staticDir, "web.tar.gz"), "web-bytes");
  await writeFile(
    path.join(root, "twenty-thinkwork-app.tar.gz"),
    "twenty-app-bytes",
  );
  await writeFile(path.join(root, "platform-artifacts.tar.gz"), "bundle");

  const manifest = await buildReleaseManifest({
    version: "v1.2.3",
    gitSha: "abc123",
    artifactRoot: root,
    lambdaDir,
    baseUrl:
      "https://github.com/thinkwork-ai/thinkwork/releases/download/v1.2.3/",
    createdAt: "2026-05-18T00:00:00.000Z",
    artifactBundles: [
      {
        name: "platform",
        path: path.join(root, "platform-artifacts.tar.gz"),
      },
    ],
    artifacts: [
      {
        name: "twenty-thinkwork-app",
        type: "seed",
        path: path.join(root, "twenty-thinkwork-app.tar.gz"),
      },
      {
        name: "web",
        type: "static-site",
        path: path.join(staticDir, "web.tar.gz"),
      },
    ],
    runtimeImages: [
      {
        name: "agentcore-pi-arm64",
        repository: "ghcr.io/thinkwork-ai/thinkwork-agentcore",
        tag: "v1.2.3-pi-arm64",
        digest:
          "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        architecture: "arm64",
      },
      {
        name: "agentcore-pi-amd64",
        repository: "ghcr.io/thinkwork-ai/thinkwork-agentcore",
        tag: "v1.2.3-pi-amd64",
        digest:
          "sha256:2222222222222222222222222222222222222222222222222222222222222222",
        architecture: "amd64",
      },
      {
        name: "cognee",
        repository: "ghcr.io/thinkwork-ai/thinkwork-cognee",
        tag: "v1.2.3-cognee-amd64",
        digest:
          "sha256:3333333333333333333333333333333333333333333333333333333333333333",
        architecture: "amd64",
      },
      {
        name: "n8n-runtime",
        repository: "ghcr.io/thinkwork-ai/thinkwork-n8n",
        tag: "v1.2.3-n8n-amd64",
        digest:
          "sha256:7777777777777777777777777777777777777777777777777777777777777777",
        architecture: "amd64",
      },
      parseRuntimeImageSpec(
        "name=twenty,uri=twentycrm/twenty@sha256:5555555555555555555555555555555555555555555555555555555555555555,architecture=amd64",
      ),
    ],
  });

  assert.equal(manifest.release.version, "1.2.3");
  assert.deepEqual(manifest.compatibility, {
    minCliVersion: "1.2.3",
    minRunnerVersion: "1.2.3",
    profileSchemaVersion: 1,
  });
  assert.deepEqual(manifest.signing, {
    acceptedKeyIds: [],
    revokedKeyIds: [],
  });
  assert.equal(manifest.components.deploymentRunner.version, "1.2.3");
  assert.equal(manifest.components.deploymentRunner.image, null);
  assert.deepEqual(manifest.components.deploymentRunner.script, {
    fileName: "thinkwork-runner.py",
    relativePath: "runner/thinkwork-runner.py",
    url:
      "https://github.com/thinkwork-ai/thinkwork/releases/download/v1.2.3/" +
      "thinkwork-runner.py",
    sha256: "527aa9f431539da8e151d5434d1d5e611d973f601d8e970790882624554146b0",
    sizeBytes: 6,
  });
  assert.deepEqual(
    manifest.artifacts.map(
      (artifact) => `${artifact.type}:${artifact.name}:${artifact.fileName}`,
    ),
    [
      "lambda:graphql-http:graphql-http.zip",
      "seed:twenty-thinkwork-app:twenty-thinkwork-app.tar.gz",
      "static-site:web:web.tar.gz",
    ],
  );
  assert.equal(manifest.artifacts[0]?.url, null);
  assert.deepEqual(manifest.artifactBundles?.[0]?.contains, [
    "graphql-http",
    "twenty-thinkwork-app",
    "web",
  ]);
  assert.equal(
    manifest.artifactBundles?.[0]?.url,
    "https://github.com/thinkwork-ai/thinkwork/releases/download/v1.2.3/platform-artifacts.tar.gz",
  );
  assert.equal(manifest.artifacts[0]?.sha256.length, 64);
  assert.deepEqual(
    manifest.runtimeImages.map((image) => image.name),
    [
      "agentcore-pi-amd64",
      "agentcore-pi-arm64",
      "cognee",
      "n8n-runtime",
      "twenty",
    ],
  );
  assert.equal(
    manifest.runtimeImages.find((image) => image.name === "agentcore-pi-amd64")
      ?.uri,
    "ghcr.io/thinkwork-ai/thinkwork-agentcore:v1.2.3-pi-amd64@sha256:2222222222222222222222222222222222222222222222222222222222222222",
  );
  assert.equal(
    manifest.runtimeImages.find((image) => image.name === "twenty")?.uri,
    "twentycrm/twenty@sha256:5555555555555555555555555555555555555555555555555555555555555555",
  );
  assert.deepEqual(
    manifest.managedApps.map((app) => app.id),
    ["cognee", "n8n", "twenty"],
  );
  assert.deepEqual(
    Object.fromEntries(
      manifest.managedApps.map((app) => [app.id, app.requiredImages]),
    ),
    {
      cognee: ["cognee"],
      n8n: ["n8n-runtime"],
      twenty: ["twenty"],
    },
  );
  assert.deepEqual(
    manifest.managedApps.find((app) => app.id === "twenty")?.requiredArtifacts,
    ["twenty-thinkwork-app"],
  );
});

test("signing helpers can verify the generated manifest", async () => {
  const pair = generateKeyPairSync("ed25519");
  const trustedKey: TrustedReleaseKey = {
    keyId: "release-2026-primary",
    publicKeyPem: pair.publicKey.export({
      format: "pem",
      type: "spki",
    }) as string,
  };
  const privateKeyPem = pair.privateKey.export({
    format: "pem",
    type: "pkcs8",
  }) as string;
  const root = await makeTempReleaseRoot();
  const artifactPath = path.join(root, "twenty-thinkwork-app.tar.gz");
  await writeFile(artifactPath, "seed");

  const manifest = await buildReleaseManifest({
    version: "1.2.3",
    gitSha: "abc123",
    artifactRoot: root,
    artifacts: [
      { name: "twenty-thinkwork-app", type: "seed", path: artifactPath },
    ],
    acceptedKeyIds: [trustedKey.keyId],
    createdAt: "2026-06-06T00:00:00.000Z",
  });
  const signature: ReleaseManifestSignature = signReleaseManifest({
    manifest,
    keyId: trustedKey.keyId,
    privateKeyPem,
    signedAt: "2026-06-06T00:00:00.000Z",
    expiresAt: "2026-12-31T00:00:00.000Z",
  });

  assert.doesNotThrow(() =>
    verifyReleaseManifest({
      manifest,
      signature,
      trustedKeys: [trustedKey],
      now: "2026-06-07T00:00:00.000Z",
    }),
  );
});

test("buildReleaseManifest can keep artifact URLs when bundleArtifactUrls is requested", async () => {
  const root = await makeTempReleaseRoot();
  const lambdaDir = path.join(root, "lambdas");
  await mkdir(lambdaDir, { recursive: true });
  await writeFile(path.join(lambdaDir, "graphql-http.zip"), "lambda-bytes");
  const twentyAppPath = path.join(root, "twenty-thinkwork-app.tar.gz");
  await writeFile(twentyAppPath, "twenty-app-bytes");
  await writeFile(path.join(root, "platform-artifacts.tar.gz"), "bundle");

  const manifest = await buildReleaseManifest({
    version: "v1.2.3",
    gitSha: "abc123",
    artifactRoot: root,
    lambdaDir,
    baseUrl:
      "https://github.com/thinkwork-ai/thinkwork/releases/download/v1.2.3",
    artifactBundles: [
      {
        name: "platform",
        path: path.join(root, "platform-artifacts.tar.gz"),
      },
    ],
    artifacts: [
      {
        name: "twenty-thinkwork-app",
        type: "seed",
        path: twentyAppPath,
      },
    ],
    bundleArtifactUrls: true,
    createdAt: "2026-05-18T00:00:00.000Z",
  });

  assert.equal(
    manifest.artifacts.find((artifact) => artifact.name === "graphql-http")
      ?.url,
    "https://github.com/thinkwork-ai/thinkwork/releases/download/v1.2.3/graphql-http.zip",
  );
  assert.equal(
    manifest.artifactBundles?.[0]?.url,
    "https://github.com/thinkwork-ai/thinkwork/releases/download/v1.2.3/platform-artifacts.tar.gz",
  );
});

test("buildReleaseManifest accepts managed app and signing metadata overrides", async () => {
  const root = await makeTempReleaseRoot();
  const terraformArtifact = path.join(root, "thinkwork-module.tar.gz");
  await writeFile(terraformArtifact, "module");

  const manifest = await buildReleaseManifest({
    version: "v2.0.0",
    gitSha: "abc123",
    artifactRoot: root,
    artifacts: [
      {
        name: "thinkwork-module",
        type: "terraform",
        path: terraformArtifact,
      },
    ],
    minCliVersion: "1.9.0",
    minRunnerVersion: "1.8.0",
    profileSchemaVersion: 2,
    deploymentRunnerImage:
      "ghcr.io/thinkwork-ai/deployment-runner:v2@sha256:3333333333333333333333333333333333333333333333333333333333333333",
    managedApps: [
      {
        id: "twenty",
        displayName: "Twenty CRM",
        requiredArtifacts: ["thinkwork-module"],
      },
    ],
    acceptedKeyIds: ["release-2026-primary", "release-2026-next"],
    revokedKeyIds: ["release-2025-retired"],
  });

  assert.equal(manifest.compatibility.minCliVersion, "1.9.0");
  assert.equal(manifest.compatibility.profileSchemaVersion, 2);
  assert.equal(
    manifest.components.deploymentRunner.image,
    "ghcr.io/thinkwork-ai/deployment-runner:v2@sha256:3333333333333333333333333333333333333333333333333333333333333333",
  );
  assert.deepEqual(
    manifest.managedApps.map((app) => app.id),
    ["twenty"],
  );
  assert.deepEqual(manifest.signing.acceptedKeyIds, [
    "release-2026-primary",
    "release-2026-next",
  ]);
  assert.deepEqual(manifest.signing.revokedKeyIds, ["release-2025-retired"]);
});

test("CLI build script includes default managed apps when no overrides are passed", async () => {
  const root = await makeTempReleaseRoot();
  const artifactPath = path.join(root, "twenty-thinkwork-app.tar.gz");
  const outputPath = path.join(root, "thinkwork-release.json");
  await writeFile(artifactPath, "seed");

  await execFileAsync(path.resolve("node_modules/.bin/tsx"), [
    "scripts/release/build-release-manifest.ts",
    "--version",
    "v1.2.3",
    "--commit",
    "abc123",
    "--artifact-root",
    root,
    "--artifact",
    `name=twenty-thinkwork-app,type=seed,path=${artifactPath}`,
    "--output",
    outputPath,
    "--created-at",
    "2026-06-06T00:00:00.000Z",
  ]);

  const manifest = JSON.parse(
    await readFile(outputPath, "utf8"),
  ) as ThinkWorkReleaseManifest;
  assert.deepEqual(
    manifest.managedApps.map((app) => app.id),
    ["cognee", "n8n", "twenty"],
  );
  assert.deepEqual(
    manifest.managedApps
      .find((app) => app.id === "n8n")
      ?.smokeContracts?.map((contract) => contract.command),
    ["plugins/n8n/smoke/n8n-managed-app-smoke.mjs"],
  );
  assert.deepEqual(
    manifest.managedApps
      .find((app) => app.id === "twenty")
      ?.smokeContracts?.map((contract) => contract.command),
    ["plugins/twenty/smoke/twenty-managed-app-smoke.mjs"],
  );
  assert.deepEqual(
    manifest.managedApps.find((app) => app.id === "twenty")?.requiredArtifacts,
    ["twenty-thinkwork-app"],
  );
});

test("buildReleaseManifest fails when a required artifact is missing", async () => {
  const root = await makeTempReleaseRoot();

  await assert.rejects(
    () =>
      buildReleaseManifest({
        version: "1.2.3",
        gitSha: "abc123",
        artifactRoot: root,
        artifacts: [
          {
            name: "web",
            type: "static-site",
            path: path.join(root, "static", "web.tar.gz"),
          },
        ],
      }),
    /Required release artifact "web" is missing/,
  );
});

test("buildReleaseManifest requires staged deployment runner script metadata", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "thinkwork-release-"));
  const artifactPath = path.join(root, "twenty-thinkwork-app.tar.gz");
  await writeFile(artifactPath, "seed");

  await assert.rejects(
    () =>
      buildReleaseManifest({
        version: "1.2.3",
        gitSha: "abc123",
        artifactRoot: root,
        artifacts: [
          { name: "twenty-thinkwork-app", type: "seed", path: artifactPath },
        ],
      }),
    /Deployment runner script is missing/,
  );
});

test("buildReleaseManifest rejects duplicate logical artifact names", async () => {
  const root = await makeTempReleaseRoot();
  const artifactPath = path.join(root, "one.zip");
  await writeFile(artifactPath, "bytes");

  await assert.rejects(
    () =>
      buildReleaseManifest({
        version: "1.2.3",
        gitSha: "abc123",
        artifactRoot: root,
        artifacts: [
          { name: "graphql-http", type: "lambda", path: artifactPath },
          { name: "graphql-http", type: "static-site", path: artifactPath },
        ],
      }),
    /Duplicate release artifact logical name: graphql-http/,
  );
});

test("buildReleaseManifest rejects missing managed app runtime images", async () => {
  const root = await makeTempReleaseRoot();
  const artifactPath = path.join(root, "twenty-thinkwork-app.tar.gz");
  await writeFile(artifactPath, "seed");

  await assert.rejects(
    () =>
      buildReleaseManifest({
        version: "1.2.3",
        gitSha: "abc123",
        artifactRoot: root,
        artifacts: [
          { name: "twenty-thinkwork-app", type: "seed", path: artifactPath },
        ],
        runtimeImages: [
          {
            name: "agentcore-pi-amd64",
            repository: "ghcr.io/thinkwork-ai/thinkwork-agentcore",
            tag: "v1.2.3-pi-amd64",
            digest:
              "sha256:2222222222222222222222222222222222222222222222222222222222222222",
            architecture: "amd64",
          },
        ],
      }),
    /requiredImages references unknown runtime image cognee/,
  );
});

test("spec parsers reject incomplete artifact and image definitions", () => {
  assert.deepEqual(
    parseArtifactSpec("name=web,type=static-site,path=dist/release/web.tar.gz"),
    {
      name: "web",
      type: "static-site",
      path: "dist/release/web.tar.gz",
      required: true,
    },
  );
  assert.deepEqual(
    parseArtifactBundleSpec(
      "name=platform,path=dist/release/platform-artifacts.tar.gz,contains=web|graphql-http",
    ),
    {
      name: "platform",
      path: "dist/release/platform-artifacts.tar.gz",
      contains: ["web", "graphql-http"],
    },
  );

  assert.throws(
    () => parseArtifactSpec("name=web,path=dist/release/web.tar.gz"),
    /Invalid/,
  );
  assert.throws(
    () =>
      parseRuntimeImageSpec(
        "name=agentcore-pi,repository=ghcr.io/thinkwork-ai/thinkwork-agentcore,tag=v1",
      ),
    /architecture/,
  );
  assert.deepEqual(
    parseManagedAppSpec(
      "id=twenty,displayName=Twenty CRM,requiredArtifacts=twenty-module,smokeCommand=plugins/twenty/smoke/twenty-managed-app-smoke.mjs",
    ),
    {
      id: "twenty",
      displayName: "Twenty CRM",
      requiredArtifacts: ["twenty-module"],
      requiredImages: undefined,
      smokeContracts: [
        {
          id: "twenty-smoke",
          command: "plugins/twenty/smoke/twenty-managed-app-smoke.mjs",
          required: true,
        },
      ],
      terraformModule: undefined,
    },
  );
  assert.deepEqual(
    parseRuntimeImageSpec(
      "name=twenty,uri=twentycrm/twenty@sha256:5555555555555555555555555555555555555555555555555555555555555555,architecture=amd64",
    ),
    {
      name: "twenty",
      repository: "twentycrm/twenty",
      tag: "digest",
      digest:
        "sha256:5555555555555555555555555555555555555555555555555555555555555555",
      architecture: "amd64",
      uri: "twentycrm/twenty@sha256:5555555555555555555555555555555555555555555555555555555555555555",
    },
  );
});

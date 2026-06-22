import { mkdtemp, readFile, readlink, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createOkfEfsRefreshHandler } from "../../handlers/okf-efs-refresh.js";
import {
  buildOkfBundle,
  type OkfMaterializationSource,
} from "./materializer.js";
import {
  discoverOkfCurrentTenantSlugs,
  okfBundleKeyPrefixForBundle,
  okfCurrentManifestKeyForTenant,
  refreshOkfEfsCurrentView,
} from "./efs-refresh.js";

const GENERATED_AT = new Date("2026-06-22T17:05:00.000Z");
const BUCKET = "brain-artifacts-test";

function source(): OkfMaterializationSource {
  return {
    tenantId: "tenant-1",
    tenantSlug: "acme-co",
    pages: [
      {
        id: "page-entity",
        type: "entity",
        entitySubtype: "customer",
        slug: "Acme Corp",
        title: "Acme Corp",
        summary: "Strategic customer.",
        updatedAt: GENERATED_AT,
        sections: [
          {
            id: "section-1",
            slug: "overview",
            heading: "Overview",
            bodyMarkdown: "Acme overview.",
            position: 0,
            lastSourceAt: GENERATED_AT,
            sources: [
              { sourceKind: "memory_unit", sourceRef: "raw-source-id" },
            ],
          },
        ],
      },
    ],
  };
}

function bundleObjects() {
  const bundle = buildOkfBundle({
    source: source(),
    generatedAt: GENERATED_AT,
  });
  const objects = new Map<string, Buffer>();
  const prefix = okfBundleKeyPrefixForBundle({
    tenantSlug: bundle.tenantSlug,
    bundleId: bundle.bundleId,
  });
  for (const file of bundle.files) {
    objects.set(`${prefix}/${file.path}`, file.body);
  }
  objects.set(
    okfCurrentManifestKeyForTenant(bundle.tenantSlug),
    Buffer.from(JSON.stringify(bundle.currentManifest, null, 2), "utf8"),
  );
  return { bundle, objects, prefix };
}

function makeS3(objects: Map<string, Buffer>) {
  const send = vi.fn(async (command: unknown) => {
    const input = (command as { input: Record<string, unknown> }).input;
    const commandName = (command as { constructor: { name: string } })
      .constructor.name;
    if (commandName === "GetObjectCommand") {
      const key = String(input.Key);
      const body = objects.get(key);
      if (!body) throw new Error(`missing ${key}`);
      return { Body: body };
    }
    if (commandName === "ListObjectsV2Command") {
      const prefix = String(input.Prefix ?? "");
      return {
        Contents: [...objects.keys()]
          .filter((key) => key.startsWith(prefix))
          .sort()
          .map((Key) => ({ Key })),
        IsTruncated: false,
      };
    }
    throw new Error(`unexpected S3 command ${commandName}`);
  });
  return { send } as any;
}

describe("OKF EFS refresh", () => {
  it("discovers current manifests and publishes a staged bundle behind current", async () => {
    const { bundle, objects } = bundleObjects();
    const s3 = makeS3(objects);
    const efsRoot = await mkdtemp(path.join(os.tmpdir(), "okf-efs-"));

    await expect(
      discoverOkfCurrentTenantSlugs({ s3, bucket: BUCKET }),
    ).resolves.toEqual(["acme-co"]);

    const result = await refreshOkfEfsCurrentView({
      s3,
      bucket: BUCKET,
      efsRoot,
      tenantSlug: "acme-co",
      runId: "test-run",
    });

    expect(result.bundleId).toBe(bundle.bundleId);
    expect(result.files.map((file) => file.path)).toContain("index.md");
    const currentPath = path.join(efsRoot, "tenants/acme-co/current");
    await expect(readlink(currentPath)).resolves.toBe(
      `bundles/${bundle.bundleId.replace(/[^a-zA-Z0-9._=-]+/g, "_")}`,
    );
    await expect(
      readFile(path.join(currentPath, "index.md"), "utf8"),
    ).resolves.toContain("ThinkWork OKF Wiki Navigator");
    const page = await stat(
      path.join(currentPath, "entities/customer/acme-corp.md"),
    );
    expect(page.mode & 0o777).toBe(0o444);
  });

  it("validates S3 without mutating EFS during dry-run", async () => {
    const { objects } = bundleObjects();
    const s3 = makeS3(objects);
    const efsRoot = await mkdtemp(path.join(os.tmpdir(), "okf-efs-dry-"));

    const result = await refreshOkfEfsCurrentView({
      s3,
      bucket: BUCKET,
      efsRoot,
      tenantSlug: "acme-co",
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    await expect(stat(path.join(efsRoot, "tenants"))).rejects.toThrow();
  });

  it("reuses an already-published matching bundle during same-bundle retries", async () => {
    const { bundle, objects } = bundleObjects();
    const s3 = makeS3(objects);
    const efsRoot = await mkdtemp(path.join(os.tmpdir(), "okf-efs-retry-"));

    await refreshOkfEfsCurrentView({
      s3,
      bucket: BUCKET,
      efsRoot,
      tenantSlug: "acme-co",
      runId: "first",
    });
    const currentPath = path.join(efsRoot, "tenants/acme-co/current");
    const before = await readlink(currentPath);

    await refreshOkfEfsCurrentView({
      s3,
      bucket: BUCKET,
      efsRoot,
      tenantSlug: "acme-co",
      runId: "second",
    });

    await expect(readlink(currentPath)).resolves.toBe(before);
    await expect(
      readFile(path.join(currentPath, "index.md"), "utf8"),
    ).resolves.toContain("ThinkWork OKF Wiki Navigator");
    expect(before).toBe(
      `bundles/${bundle.bundleId.replace(/[^a-zA-Z0-9._=-]+/g, "_")}`,
    );
  });

  it("does not flip current when bundle validation fails", async () => {
    const { bundle, objects, prefix } = bundleObjects();
    const s3 = makeS3(objects);
    const efsRoot = await mkdtemp(path.join(os.tmpdir(), "okf-efs-fail-"));

    await refreshOkfEfsCurrentView({
      s3,
      bucket: BUCKET,
      efsRoot,
      tenantSlug: "acme-co",
      runId: "good",
    });
    const currentPath = path.join(efsRoot, "tenants/acme-co/current");
    const before = await readlink(currentPath);

    objects.set(`${prefix}/index.md`, Buffer.from("# corrupted", "utf8"));
    await expect(
      refreshOkfEfsCurrentView({
        s3,
        bucket: BUCKET,
        efsRoot,
        tenantSlug: "acme-co",
        runId: "bad",
      }),
    ).rejects.toThrow("OKF object checksum mismatch for index.md");
    await expect(readlink(currentPath)).resolves.toBe(before);
    await expect(
      readFile(path.join(currentPath, "index.md"), "utf8"),
    ).resolves.toContain("ThinkWork OKF Wiki Navigator");
    expect(before).toBe(
      `bundles/${bundle.bundleId.replace(/[^a-zA-Z0-9._=-]+/g, "_")}`,
    );
  });

  it("rejects manifest-level checksum drift even when object checksums match", async () => {
    const { bundle, objects, prefix } = bundleObjects();
    const s3 = makeS3(objects);
    const efsRoot = await mkdtemp(path.join(os.tmpdir(), "okf-efs-sum-"));
    const bundleManifest = {
      ...bundle.manifest,
      checksumSha256: "a".repeat(64),
    };
    const currentManifest = {
      ...bundle.currentManifest,
      bundle: {
        ...bundle.currentManifest.bundle,
        checksumSha256: bundleManifest.checksumSha256,
      },
    };
    objects.set(
      `${prefix}/.thinkwork/manifest.json`,
      Buffer.from(JSON.stringify(bundleManifest, null, 2), "utf8"),
    );
    objects.set(
      okfCurrentManifestKeyForTenant(bundle.tenantSlug),
      Buffer.from(JSON.stringify(currentManifest, null, 2), "utf8"),
    );

    await expect(
      refreshOkfEfsCurrentView({
        s3,
        bucket: BUCKET,
        efsRoot,
        tenantSlug: "acme-co",
      }),
    ).rejects.toThrow("OKF bundle checksum does not match object list");
    await expect(stat(path.join(efsRoot, "tenants"))).rejects.toThrow();
  });

  it.each([
    ["absolute path", "/tmp/escape.md"],
    ["parent segment", "entities/../escape.md"],
    ["backslash", "entities\\escape.md"],
    ["hidden directory", ".hidden/escape.md"],
  ])("rejects unsafe bundle object paths: %s", async (_label, unsafePath) => {
    const { bundle, objects, prefix } = bundleObjects();
    const s3 = makeS3(objects);
    const efsRoot = await mkdtemp(path.join(os.tmpdir(), "okf-efs-path-"));
    const manifest = {
      ...bundle.manifest,
      objects: bundle.manifest.objects.map((object, index) =>
        index === 0 ? { ...object, path: unsafePath } : object,
      ),
    };
    objects.set(
      `${prefix}/.thinkwork/manifest.json`,
      Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
    );

    await expect(
      refreshOkfEfsCurrentView({
        s3,
        bucket: BUCKET,
        efsRoot,
        tenantSlug: "acme-co",
      }),
    ).rejects.toThrow(/Invalid OKF bundle manifest|unsafe OKF bundle path/);
    await expect(stat(path.join(efsRoot, "tenants"))).rejects.toThrow();
  });
});

describe("OKF EFS refresh handler", () => {
  it("returns structured discovery errors", async () => {
    const previousBucket = process.env.BRAIN_ARTIFACTS_BUCKET;
    process.env.BRAIN_ARTIFACTS_BUCKET = BUCKET;
    try {
      const handler = createOkfEfsRefreshHandler({
        s3: {
          send: vi.fn(async () => {
            throw new Error("s3 list failed");
          }),
        },
      });

      await expect(handler({})).resolves.toMatchObject({
        ok: false,
        tenants_processed: 0,
        errors: [{ tenantSlug: "*", message: "s3 list failed" }],
      });
    } finally {
      if (previousBucket === undefined) {
        delete process.env.BRAIN_ARTIFACTS_BUCKET;
      } else {
        process.env.BRAIN_ARTIFACTS_BUCKET = previousBucket;
      }
    }
  });
});

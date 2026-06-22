import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  buildOkfBundle,
  type OkfMaterializationSource,
} from "./materializer.js";
import { publishOkfBundle } from "./publisher.js";

const GENERATED_AT = new Date("2026-06-22T16:00:00.000Z");

function source(): OkfMaterializationSource {
  return {
    tenantId: "tenant-1",
    tenantSlug: "acme-co",
    pages: [
      {
        id: "page-1",
        type: "entity",
        entitySubtype: "customer",
        slug: "acme",
        title: "Acme",
        updatedAt: GENERATED_AT,
        sections: [
          {
            id: "section-1",
            slug: "overview",
            heading: "Overview",
            bodyMarkdown: "Acme overview",
            position: 0,
            lastSourceAt: GENERATED_AT,
            sources: [
              { sourceKind: "memory_unit", sourceRef: "source-secret" },
            ],
          },
        ],
      },
    ],
  };
}

function makeS3() {
  const sends: unknown[] = [];
  const send = vi.fn(async (command: unknown) => {
    sends.push(command);
    return { VersionId: `v${sends.length}` };
  });
  return { s3: { send } as any, sends };
}

function makeDb() {
  const records: unknown[] = [];
  const onConflictDoUpdate = vi.fn(async () => undefined);
  const values = vi.fn((record: unknown) => {
    records.push(record);
    return { onConflictDoUpdate };
  });
  const insert = vi.fn(() => ({ values }));
  return { db: { insert } as any, records, insert };
}

function input(command: unknown): Record<string, unknown> {
  return (command as { input: Record<string, unknown> }).input;
}

describe("OKF publisher", () => {
  it("uploads bundle files before the current manifest and records artifact manifests", async () => {
    const bundle = buildOkfBundle({
      source: source(),
      generatedAt: GENERATED_AT,
    });
    const { s3, sends } = makeS3();
    const { db, records } = makeDb();

    const result = await publishOkfBundle({
      db,
      s3,
      bucket: "brain-artifacts-test",
      bundle,
    });

    expect(result.enabled).toBe(true);
    expect(input(sends.at(-1)).Key).toBe(
      "okf-current-manifests/acme-co/current.json",
    );
    expect(sends.slice(0, -1).map((send) => input(send).Key)).toContain(
      "okf-bundles/acme-co/okf-bundle_2026-06-22T16_00_00.000Z/.thinkwork/manifest.json",
    );
    expect(
      JSON.parse((input(sends.at(-1)).Body as Buffer).toString("utf8")),
    ).toEqual(bundle.currentManifest);
    const uploadedBundleManifest = sends.find((send) =>
      String(input(send).Key).endsWith("/.thinkwork/manifest.json"),
    );
    if (!uploadedBundleManifest) throw new Error("missing uploaded manifest");
    const uploadedBundleManifestBody = input(uploadedBundleManifest)
      .Body as Buffer;
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(
      expect.objectContaining({
        manifest_kind: "okf_bundle",
        source_kind: "okf",
        source_type: "okf_wiki_navigator",
        byte_length: uploadedBundleManifestBody.byteLength,
        checksum_sha256: sha256Hex(uploadedBundleManifestBody),
        object_count: bundle.files.length,
        metadata: expect.objectContaining({
          bundleChecksumSha256: bundle.manifest.checksumSha256,
          bundleByteCount: bundle.manifest.byteCount,
          bundleObjectCount: bundle.manifest.objectCount,
        }),
      }),
    );
    expect(records[1]).toEqual(
      expect.objectContaining({
        manifest_kind: "okf_current_manifest",
        source_kind: "okf",
        object_count: 1,
      }),
    );
  });

  it("does not write the current manifest when bundle validation fails", async () => {
    const bundle = buildOkfBundle({
      source: source(),
      generatedAt: GENERATED_AT,
    });
    const { s3, sends } = makeS3();
    bundle.files = bundle.files.filter(
      (file) => file.path !== ".thinkwork/manifest.json",
    );

    await expect(
      publishOkfBundle({
        s3,
        bucket: "brain-artifacts-test",
        bundle,
      }),
    ).rejects.toThrow("OKF bundle must include .thinkwork/manifest.json");
    expect(sends).toHaveLength(0);
  });

  it("is disabled when no bucket is configured", async () => {
    const bundle = buildOkfBundle({
      source: source(),
      generatedAt: GENERATED_AT,
    });
    const { s3, sends } = makeS3();

    await expect(
      publishOkfBundle({ s3, bucket: null, bundle }),
    ).resolves.toEqual({
      enabled: false,
      objectsWritten: 0,
      bytesUploaded: 0,
    });
    expect(sends).toHaveLength(0);
  });
});

function sha256Hex(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

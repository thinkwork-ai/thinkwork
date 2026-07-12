import { afterEach, describe, expect, it, vi } from "vitest";
import type { S3Client } from "@aws-sdk/client-s3";

import {
  clampSnapshotTtlDays,
  getEvidenceSnapshot,
  parseSnapshotRef,
  putEvidenceSnapshot,
  resolveSnapshotBucket,
  snapshotKeyFor,
} from "./snapshots.js";

const TENANT_ID = "0015953e-aa13-4cab-8398-2e70f73dda63";
const SOURCE_CONFIG_ID = "4dee701a-c17b-46fe-9f38-a333d4c3fad0";

function fakeS3(send: ReturnType<typeof vi.fn>): S3Client {
  return { send } as unknown as S3Client;
}

afterEach(() => {
  delete process.env.BRAIN_ARTIFACTS_BUCKET;
});

describe("snapshotKeyFor", () => {
  it("builds the evidence-snapshots key with encoded item id and version", () => {
    expect(
      snapshotKeyFor({
        tenantId: TENANT_ID,
        sourceConfigId: SOURCE_CONFIG_ID,
        sourceItemId: "company/1",
        sourceVersion: "2026-07-11T00:00:00.000Z",
      }),
    ).toBe(
      `evidence-snapshots/${TENANT_ID}/${SOURCE_CONFIG_ID}/company%2F1/2026-07-11T00%3A00%3A00.000Z.json`,
    );
  });
});

describe("clampSnapshotTtlDays", () => {
  it("defaults to 30 for non-numeric input", () => {
    expect(clampSnapshotTtlDays(undefined)).toBe(30);
    expect(clampSnapshotTtlDays("nope")).toBe(30);
  });

  it("clamps to [7, 90]", () => {
    expect(clampSnapshotTtlDays(1)).toBe(7);
    expect(clampSnapshotTtlDays(365)).toBe(90);
    expect(clampSnapshotTtlDays(45.9)).toBe(45);
  });
});

describe("parseSnapshotRef", () => {
  it("round-trips the ref emitted by putEvidenceSnapshot", async () => {
    const send = vi.fn().mockResolvedValue({});
    const { ref } = await putEvidenceSnapshot(fakeS3(send), {
      bucket: "my-bucket",
      key: "evidence-snapshots/a/b/c.json",
      snapshot: { name: "Acme" },
    });
    expect(ref).toBe("s3://my-bucket/evidence-snapshots/a/b/c.json");
    expect(parseSnapshotRef(ref)).toEqual({
      bucket: "my-bucket",
      key: "evidence-snapshots/a/b/c.json",
    });
  });

  it("returns null for malformed refs", () => {
    expect(parseSnapshotRef("http://x/y")).toBeNull();
    expect(parseSnapshotRef("s3://bucket-only")).toBeNull();
  });
});

describe("putEvidenceSnapshot", () => {
  it("PUTs JSON with application/json and returns a clamped expiry", async () => {
    const send = vi.fn().mockResolvedValue({});
    const before = Date.now();
    const { expiresAt } = await putEvidenceSnapshot(fakeS3(send), {
      bucket: "b",
      key: "k.json",
      snapshot: { a: 1 },
      ttlDays: 1000, // clamps to 90
    });
    expect(send).toHaveBeenCalledTimes(1);
    const input = send.mock.calls[0][0].input;
    expect(input).toMatchObject({
      Bucket: "b",
      Key: "k.json",
      Body: '{"a":1}',
      ContentType: "application/json",
    });
    const days = (expiresAt.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);
  });
});

describe("getEvidenceSnapshot", () => {
  it("fetches and parses the referenced object", async () => {
    const send = vi.fn().mockResolvedValue({
      Body: { transformToString: async () => '{"name":"Acme"}' },
    });
    await expect(
      getEvidenceSnapshot(fakeS3(send), { ref: "s3://b/k.json" }),
    ).resolves.toEqual({ name: "Acme" });
    expect(send.mock.calls[0][0].input).toMatchObject({
      Bucket: "b",
      Key: "k.json",
    });
  });

  it("returns null on NoSuchKey (lifecycle-expired snapshot)", async () => {
    const send = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("gone"), { name: "NoSuchKey" }),
      );
    await expect(
      getEvidenceSnapshot(fakeS3(send), { ref: "s3://b/k.json" }),
    ).resolves.toBeNull();
  });

  it("rethrows other errors and rejects malformed refs", async () => {
    const send = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("denied"), { name: "AccessDenied" }),
      );
    await expect(
      getEvidenceSnapshot(fakeS3(send), { ref: "s3://b/k.json" }),
    ).rejects.toThrow("denied");
    await expect(
      getEvidenceSnapshot(fakeS3(send), { ref: "not-a-ref" }),
    ).rejects.toThrow(/malformed snapshot ref/);
  });
});

describe("resolveSnapshotBucket", () => {
  it("throws a clear error when BRAIN_ARTIFACTS_BUCKET is unset", () => {
    delete process.env.BRAIN_ARTIFACTS_BUCKET;
    expect(() => resolveSnapshotBucket()).toThrow(/BRAIN_ARTIFACTS_BUCKET/);
  });

  it("returns the configured bucket", () => {
    process.env.BRAIN_ARTIFACTS_BUCKET = "thinkwork-dev-brain-artifacts";
    expect(resolveSnapshotBucket()).toBe("thinkwork-dev-brain-artifacts");
  });
});

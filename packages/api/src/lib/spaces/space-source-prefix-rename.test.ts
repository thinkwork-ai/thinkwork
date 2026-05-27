import { describe, expect, it, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

import {
  copySpaceSourcePrefix,
  deleteSpaceSourcePrefix,
} from "./space-source-prefix-rename.js";
import { spaceSourcePrefix } from "./template-migration.js";

const s3Mock = mockClient(S3Client);
const BUCKET = "workspace-bucket";
const TENANT = "acme";
const OLD_SPACE = "customer-onboarding";
const NEW_SPACE = "customer";

beforeEach(() => {
  s3Mock.reset();
});

describe("Space source prefix rename helpers", () => {
  it("copies old Space source objects into the new slug prefix", async () => {
    const oldPrefix = spaceSourcePrefix(TENANT, OLD_SPACE);
    const newPrefix = spaceSourcePrefix(TENANT, NEW_SPACE);

    s3Mock.on(ListObjectsV2Command, { Prefix: oldPrefix }).resolves({
      Contents: [
        { Key: oldPrefix + "AGENTS.md" },
        { Key: oldPrefix + "skills/research/SKILL.md" },
      ],
    });
    s3Mock.on(ListObjectsV2Command, { Prefix: newPrefix }).resolves({
      Contents: [],
    });
    s3Mock.on(CopyObjectCommand).resolves({});

    const result = await copySpaceSourcePrefix({
      tenantSlug: TENANT,
      oldSpaceSlug: OLD_SPACE,
      newSpaceSlug: NEW_SPACE,
      bucket: BUCKET,
    });

    expect(result).toMatchObject({
      copied: 2,
      copiedKeys: [
        `${newPrefix}AGENTS.md`,
        `${newPrefix}skills/research/SKILL.md`,
      ],
      total: 2,
    });
    expect(
      s3Mock.commandCalls(CopyObjectCommand).map((call) => call.args[0].input),
    ).toEqual([
      {
        Bucket: BUCKET,
        CopySource: `${BUCKET}/${oldPrefix}AGENTS.md`,
        Key: `${newPrefix}AGENTS.md`,
      },
      {
        Bucket: BUCKET,
        CopySource: `${BUCKET}/${oldPrefix}skills/research/SKILL.md`,
        Key: `${newPrefix}skills/research/SKILL.md`,
      },
    ]);
  });

  it("rejects a non-empty destination before copying", async () => {
    const oldPrefix = spaceSourcePrefix(TENANT, OLD_SPACE);
    const newPrefix = spaceSourcePrefix(TENANT, NEW_SPACE);

    s3Mock.on(ListObjectsV2Command, { Prefix: oldPrefix }).resolves({
      Contents: [{ Key: oldPrefix + "AGENTS.md" }],
    });
    s3Mock.on(ListObjectsV2Command, { Prefix: newPrefix }).resolves({
      Contents: [{ Key: newPrefix + "AGENTS.md" }],
    });

    await expect(
      copySpaceSourcePrefix({
        tenantSlug: TENANT,
        oldSpaceSlug: OLD_SPACE,
        newSpaceSlug: NEW_SPACE,
        bucket: BUCKET,
      }),
    ).rejects.toThrow("Target Space source prefix already contains objects");
    expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
  });

  it("deletes copied destination objects when a later copy fails", async () => {
    const oldPrefix = spaceSourcePrefix(TENANT, OLD_SPACE);
    const newPrefix = spaceSourcePrefix(TENANT, NEW_SPACE);

    s3Mock.on(ListObjectsV2Command, { Prefix: oldPrefix }).resolves({
      Contents: [
        { Key: oldPrefix + "AGENTS.md" },
        { Key: oldPrefix + "MEMORY.md" },
      ],
    });
    s3Mock.on(ListObjectsV2Command, { Prefix: newPrefix }).resolves({
      Contents: [],
    });
    s3Mock.on(CopyObjectCommand).callsFake((input) => {
      if (input.Key === newPrefix + "MEMORY.md") {
        throw new Error("copy failed");
      }
      return {};
    });
    s3Mock.on(DeleteObjectsCommand).resolves({});

    await expect(
      copySpaceSourcePrefix({
        tenantSlug: TENANT,
        oldSpaceSlug: OLD_SPACE,
        newSpaceSlug: NEW_SPACE,
        bucket: BUCKET,
      }),
    ).rejects.toThrow("copy failed");

    expect(s3Mock.commandCalls(DeleteObjectsCommand)[0].args[0].input).toEqual({
      Bucket: BUCKET,
      Delete: {
        Objects: [{ Key: newPrefix + "AGENTS.md" }],
        Quiet: true,
      },
    });
  });

  it("returns zero when the source and destination prefixes are empty", async () => {
    const oldPrefix = spaceSourcePrefix(TENANT, OLD_SPACE);
    const newPrefix = spaceSourcePrefix(TENANT, NEW_SPACE);

    s3Mock.on(ListObjectsV2Command, { Prefix: oldPrefix }).resolves({
      Contents: [],
    });
    s3Mock.on(ListObjectsV2Command, { Prefix: newPrefix }).resolves({
      Contents: [],
    });

    const result = await copySpaceSourcePrefix({
      tenantSlug: TENANT,
      oldSpaceSlug: OLD_SPACE,
      newSpaceSlug: NEW_SPACE,
      bucket: BUCKET,
    });

    expect(result).toMatchObject({ copied: 0, total: 0 });
    expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
  });

  it("reports per-object delete failures without throwing", async () => {
    const oldPrefix = spaceSourcePrefix(TENANT, OLD_SPACE);

    s3Mock.on(ListObjectsV2Command, { Prefix: oldPrefix }).resolves({
      Contents: [
        { Key: oldPrefix + "AGENTS.md" },
        { Key: oldPrefix + "MEMORY.md" },
      ],
    });
    s3Mock.on(DeleteObjectsCommand).resolves({
      Errors: [{ Key: oldPrefix + "MEMORY.md", Code: "AccessDenied" }],
    });

    const result = await deleteSpaceSourcePrefix({
      tenantSlug: TENANT,
      oldSpaceSlug: OLD_SPACE,
      bucket: BUCKET,
    });

    expect(result).toEqual({
      deleted: 1,
      failures: [oldPrefix + "MEMORY.md"],
      oldPrefix,
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  CatalogUninstallError,
  uninstallCatalogSkill,
} from "./catalog-uninstall.js";

const s3Mock = mockClient(S3Client);

beforeEach(() => {
  s3Mock.reset();
});

afterEach(() => {
  s3Mock.reset();
});

function uninstallOptions() {
  return {
    s3: new S3Client({}),
    bucket: "test-bucket",
    targetPrefix: "tenants/acme/agents/marco/",
    slug: "finance-audit-xls",
  };
}

function mockInstalledSkill(): void {
  s3Mock
    .on(ListObjectsV2Command, {
      Prefix: "tenants/acme/agents/marco/skills/finance-audit-xls/",
    })
    .resolves({
      Contents: [
        {
          Key: "tenants/acme/agents/marco/skills/finance-audit-xls/.catalog-ref.json",
        },
        {
          Key: "tenants/acme/agents/marco/skills/finance-audit-xls/SKILL.md",
        },
        {
          Key: "tenants/acme/agents/marco/skills/finance-audit-xls/WIRING.md",
        },
      ],
    });
  s3Mock.on(DeleteObjectCommand).resolves({});
}

describe("uninstallCatalogSkill", () => {
  it("deletes the installed folder and leaves CONTEXT.md untouched (U5)", async () => {
    mockInstalledSkill();

    const result = await uninstallCatalogSkill(uninstallOptions());

    expect(result).toEqual({
      ok: true,
      deleted_paths: [
        "skills/finance-audit-xls/.catalog-ref.json",
        "skills/finance-audit-xls/SKILL.md",
        "skills/finance-audit-xls/WIRING.md",
      ],
    });
    expect(
      s3Mock
        .commandCalls(DeleteObjectCommand)
        .map((call) => call.args[0].input.Key),
    ).toEqual([
      "tenants/acme/agents/marco/skills/finance-audit-xls/.catalog-ref.json",
      "tenants/acme/agents/marco/skills/finance-audit-xls/SKILL.md",
      "tenants/acme/agents/marco/skills/finance-audit-xls/WIRING.md",
    ]);
    // Composer plan U5 (R8): uninstall never reads or writes CONTEXT.md —
    // the rendered Routing section recomputes from the remaining folders.
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it("no-ops (empty deleted_paths) when the skill folder does not exist", async () => {
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/skills/finance-audit-xls/",
      })
      .resolves({ Contents: [] });

    const result = await uninstallCatalogSkill(uninstallOptions());

    expect(result).toEqual({ ok: true, deleted_paths: [] });
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it("rejects invalid slugs before touching S3", async () => {
    await expect(
      uninstallCatalogSkill({ ...uninstallOptions(), slug: "../bad" }),
    ).rejects.toMatchObject({
      status: 400,
      code: "invalid_slug",
    } satisfies Partial<CatalogUninstallError>);
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);
  });
});

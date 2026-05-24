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

function body(content: string) {
  return {
    Body: {
      transformToString: async (_enc?: string) => content,
    } as unknown as never,
  };
}

function noSuchKey() {
  const err = new Error("NoSuchKey");
  err.name = "NoSuchKey";
  return err;
}

function catalogRef(
  snippet = "| Stage 3 gate | . | skills/finance-audit-xls/SKILL.md |\n",
) {
  return JSON.stringify({
    slug: "finance-audit-xls",
    source_sha256: "a".repeat(64),
    installed_at: "2026-05-24T16:00:00.000Z",
    wiring_choice: "stage-3-gate",
    snippet,
  });
}

function uninstallOptions() {
  return {
    s3: new S3Client({}),
    bucket: "test-bucket",
    targetPrefix: "tenants/acme/agents/marco/workspace/",
    slug: "finance-audit-xls",
  };
}

function mockInstalledSkill(): void {
  s3Mock
    .on(ListObjectsV2Command, {
      Prefix: "tenants/acme/agents/marco/workspace/skills/finance-audit-xls/",
    })
    .resolves({
      Contents: [
        {
          Key: "tenants/acme/agents/marco/workspace/skills/finance-audit-xls/.catalog-ref.json",
        },
        {
          Key: "tenants/acme/agents/marco/workspace/skills/finance-audit-xls/SKILL.md",
        },
        {
          Key: "tenants/acme/agents/marco/workspace/skills/finance-audit-xls/WIRING.md",
        },
      ],
    });
  s3Mock
    .on(GetObjectCommand, {
      Key: "tenants/acme/agents/marco/workspace/skills/finance-audit-xls/.catalog-ref.json",
    })
    .resolves(body(catalogRef()));
  s3Mock.on(DeleteObjectCommand).resolves({});
}

describe("uninstallCatalogSkill", () => {
  it("strips the stored snippet and deletes the installed folder", async () => {
    mockInstalledSkill();
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/marco/workspace/CONTEXT.md",
      })
      .resolves(
        body(`# Context

| Stage 3 gate | . | skills/finance-audit-xls/SKILL.md |

## Next
`),
      );
    s3Mock.on(PutObjectCommand).resolves({});

    const result = await uninstallCatalogSkill(uninstallOptions());

    expect(result).toEqual({
      ok: true,
      deleted_paths: [
        "skills/finance-audit-xls/.catalog-ref.json",
        "skills/finance-audit-xls/SKILL.md",
        "skills/finance-audit-xls/WIRING.md",
      ],
      context_md_strip: "removed",
      context_md_changed_path: "CONTEXT.md",
    });
    const contextPut = s3Mock.commandCalls(PutObjectCommand)[0]?.args[0].input;
    expect(contextPut).toMatchObject({
      Key: "tenants/acme/agents/marco/workspace/CONTEXT.md",
    });
    expect(String(contextPut?.Body)).toBe(`# Context

## Next
`);
    expect(
      s3Mock
        .commandCalls(DeleteObjectCommand)
        .map((call) => call.args[0].input.Key),
    ).toEqual([
      "tenants/acme/agents/marco/workspace/skills/finance-audit-xls/.catalog-ref.json",
      "tenants/acme/agents/marco/workspace/skills/finance-audit-xls/SKILL.md",
      "tenants/acme/agents/marco/workspace/skills/finance-audit-xls/WIRING.md",
    ]);
  });

  it("deletes the folder without touching CONTEXT.md when the catalog ref is absent", async () => {
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/skills/finance-audit-xls/",
      })
      .resolves({
        Contents: [
          {
            Key: "tenants/acme/agents/marco/workspace/skills/finance-audit-xls/SKILL.md",
          },
        ],
      });
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/marco/workspace/skills/finance-audit-xls/.catalog-ref.json",
      })
      .rejects(noSuchKey());
    s3Mock.on(DeleteObjectCommand).resolves({});

    const result = await uninstallCatalogSkill(uninstallOptions());

    expect(result).toEqual({
      ok: true,
      deleted_paths: ["skills/finance-audit-xls/SKILL.md"],
      context_md_strip: "catalog_ref_missing",
    });
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it("deletes the folder and reports when CONTEXT.md no longer has the snippet", async () => {
    mockInstalledSkill();
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/marco/workspace/CONTEXT.md",
      })
      .resolves(body("# Context\n"));

    const result = await uninstallCatalogSkill(uninstallOptions());

    expect(result.context_md_strip).toBe("snippet_not_found");
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(3);
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

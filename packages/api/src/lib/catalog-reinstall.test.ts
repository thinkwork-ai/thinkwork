import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { computeCatalogSkillSha } from "./catalog-skill-sha.js";
import {
  CatalogReinstallError,
  reinstallCatalogSkill,
} from "./catalog-reinstall.js";

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

function reinstallOptions() {
  return {
    s3: new S3Client({}),
    bucket: "test-bucket",
    tenantSlug: "acme",
    targetPrefix: "tenants/acme/agents/marco/",
    slug: "finance-audit-xls",
  };
}

function catalogSha(skillContent = "# Finance Audit v2\n") {
  return computeCatalogSkillSha([
    { relativePath: "SKILL.md", content: skillContent },
    { relativePath: "WIRING.md", content: "## Wiring\n" },
  ]);
}

function catalogRef(sourceSha256 = "a".repeat(64)) {
  return JSON.stringify({
    slug: "finance-audit-xls",
    source_sha256: sourceSha256,
    installed_at: "2026-05-24T16:00:00.000Z",
    wiring_choice: "stage-3-gate",
    snippet: "| Stage 3 gate | . | skills/finance-audit-xls/SKILL.md |\n",
  });
}

function mockInstalledSkill(sourceSha256 = "a".repeat(64)): void {
  s3Mock
    .on(GetObjectCommand, {
      Key: "tenants/acme/agents/marco/skills/finance-audit-xls/.catalog-ref.json",
    })
    .resolves(body(catalogRef(sourceSha256)));
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
          Key: "tenants/acme/agents/marco/skills/finance-audit-xls/old.txt",
        },
      ],
    });
  s3Mock
    .on(GetObjectCommand, {
      Key: "tenants/acme/agents/marco/skills/finance-audit-xls/SKILL.md",
    })
    .resolves(body("# Locally edited\n"));
  s3Mock
    .on(GetObjectCommand, {
      Key: "tenants/acme/agents/marco/skills/finance-audit-xls/old.txt",
    })
    .resolves(body("old extra file\n"));
}

function mockCatalogSkill(skillContent = "# Finance Audit v2\n"): void {
  s3Mock
    .on(ListObjectsV2Command, {
      Prefix: "tenants/acme/skill-catalog/finance-audit-xls/",
    })
    .resolves({
      Contents: [
        { Key: "tenants/acme/skill-catalog/finance-audit-xls/SKILL.md" },
        { Key: "tenants/acme/skill-catalog/finance-audit-xls/WIRING.md" },
      ],
    });
  s3Mock
    .on(GetObjectCommand, {
      Key: "tenants/acme/skill-catalog/finance-audit-xls/SKILL.md",
    })
    .resolves(body(skillContent));
  s3Mock
    .on(GetObjectCommand, {
      Key: "tenants/acme/skill-catalog/finance-audit-xls/WIRING.md",
    })
    .resolves(body("## Wiring\n"));
}

describe("reinstallCatalogSkill", () => {
  it("refreshes stale installed files and preserves the stored CONTEXT.md snippet", async () => {
    mockInstalledSkill("a".repeat(64));
    mockCatalogSkill();
    s3Mock.on(DeleteObjectCommand).resolves({});
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(PutObjectCommand).resolves({});

    const result = await reinstallCatalogSkill(reinstallOptions());

    expect(result).toMatchObject({
      ok: true,
      reinstalled_paths: [
        "skills/finance-audit-xls/.catalog-ref.json",
        "skills/finance-audit-xls/SKILL.md",
        "skills/finance-audit-xls/WIRING.md",
      ],
      source_sha256: catalogSha(),
    });
    expect(result.noop).toBeUndefined();
    expect(
      s3Mock
        .commandCalls(DeleteObjectCommand)
        .map((call) => call.args[0].input.Key),
    ).toEqual([
      "tenants/acme/agents/marco/skills/finance-audit-xls/SKILL.md",
      "tenants/acme/agents/marco/skills/finance-audit-xls/old.txt",
    ]);
    expect(
      s3Mock.commandCalls(CopyObjectCommand).map((call) => call.args[0].input),
    ).toEqual([
      expect.objectContaining({
        CopySource:
          "test-bucket/tenants/acme/skill-catalog/finance-audit-xls/SKILL.md",
        Key: "tenants/acme/agents/marco/skills/finance-audit-xls/SKILL.md",
      }),
      expect.objectContaining({
        CopySource:
          "test-bucket/tenants/acme/skill-catalog/finance-audit-xls/WIRING.md",
        Key: "tenants/acme/agents/marco/skills/finance-audit-xls/WIRING.md",
      }),
    ]);

    const refPut = s3Mock
      .commandCalls(PutObjectCommand)
      .find((call) =>
        String(call.args[0].input.Key).endsWith(".catalog-ref.json"),
      );
    expect(JSON.parse(String(refPut?.args[0].input.Body))).toEqual({
      slug: "finance-audit-xls",
      source_sha256: catalogSha(),
      installed_at: "2026-05-24T16:00:00.000Z",
      wiring_choice: "stage-3-gate",
      snippet: "| Stage 3 gate | . | skills/finance-audit-xls/SKILL.md |\n",
    });
    expect(
      s3Mock
        .commandCalls(PutObjectCommand)
        .some((call) => String(call.args[0].input.Key).endsWith("CONTEXT.md")),
    ).toBe(false);
  });

  it("returns noop when the installed ref already matches the catalog sha", async () => {
    const currentSha = catalogSha();
    mockInstalledSkill(currentSha);
    mockCatalogSkill();

    const result = await reinstallCatalogSkill(reinstallOptions());

    expect(result).toEqual({
      ok: true,
      noop: true,
      reinstalled_paths: [],
      source_sha256: currentSha,
      eval_cases: [],
    });
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it("surfaces a deleted catalog skill without changing installed files", async () => {
    mockInstalledSkill();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/skill-catalog/finance-audit-xls/",
      })
      .resolves({ Contents: [] });

    await expect(
      reinstallCatalogSkill(reinstallOptions()),
    ).rejects.toMatchObject({
      status: 404,
      code: "catalog_skill_not_found",
    } satisfies Partial<CatalogReinstallError>);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
  });

  it("rejects reinstall when the installed catalog ref is missing", async () => {
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/marco/skills/finance-audit-xls/.catalog-ref.json",
      })
      .rejects(noSuchKey());

    await expect(
      reinstallCatalogSkill(reinstallOptions()),
    ).rejects.toMatchObject({
      status: 404,
      code: "not_installed",
    } satisfies Partial<CatalogReinstallError>);
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);
  });

  it("rolls back old files and the catalog ref when refresh fails", async () => {
    mockInstalledSkill();
    mockCatalogSkill();
    s3Mock.on(DeleteObjectCommand).resolves({});
    s3Mock.on(CopyObjectCommand).callsFake((input) => {
      if (String(input.Key).endsWith("/WIRING.md")) {
        throw new Error("copy failed");
      }
      return {};
    });
    s3Mock.on(PutObjectCommand).resolves({});

    await expect(
      reinstallCatalogSkill(reinstallOptions()),
    ).rejects.toMatchObject({
      status: 500,
      code: "reinstall_failed",
      message: expect.stringContaining("copy failed"),
    } satisfies Partial<CatalogReinstallError>);

    const restoredKeys = s3Mock
      .commandCalls(PutObjectCommand)
      .map((call) => call.args[0].input.Key);
    expect(restoredKeys).toEqual([
      "tenants/acme/agents/marco/skills/finance-audit-xls/SKILL.md",
      "tenants/acme/agents/marco/skills/finance-audit-xls/old.txt",
      "tenants/acme/agents/marco/skills/finance-audit-xls/.catalog-ref.json",
    ]);
  });
});

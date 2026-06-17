import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  CatalogInstallError,
  extractBundledEvalCases,
  installCatalogSkill,
} from "./catalog-install.js";

const s3Mock = mockClient(S3Client);

describe("extractBundledEvalCases", () => {
  it("selects evals/*.json (basename) and ignores other files / nested dirs", () => {
    expect(
      extractBundledEvalCases([
        { relativePath: "SKILL.md", content: "# s" },
        { relativePath: "evals/refuses-pii.json", content: "{}" },
        { relativePath: "evals/asks-confirmation.json", content: "{}" },
        { relativePath: "evals/notes.txt", content: "x" },
        { relativePath: "evals/nested/deep.json", content: "{}" },
        { relativePath: "references/guide.md", content: "g" },
      ]),
    ).toEqual([
      { fileName: "refuses-pii.json", content: "{}" },
      { fileName: "asks-confirmation.json", content: "{}" },
    ]);
  });

  it("returns [] when no evals dir is bundled (unrated skill)", () => {
    expect(
      extractBundledEvalCases([{ relativePath: "SKILL.md", content: "# s" }]),
    ).toEqual([]);
  });
});

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

function mockCatalogSkill(): void {
  s3Mock
    .on(ListObjectsV2Command, {
      Prefix: "tenants/acme/skill-catalog/finance-audit-xls/",
    })
    .resolves({
      Contents: [
        { Key: "tenants/acme/skill-catalog/finance-audit-xls/SKILL.md" },
        { Key: "tenants/acme/skill-catalog/finance-audit-xls/WIRING.md" },
        {
          Key: "tenants/acme/skill-catalog/finance-audit-xls/scripts/audit.py",
        },
      ],
    });
  s3Mock
    .on(GetObjectCommand, {
      Key: "tenants/acme/skill-catalog/finance-audit-xls/SKILL.md",
    })
    .resolves(body("# Finance Audit\n"));
  s3Mock
    .on(GetObjectCommand, {
      Key: "tenants/acme/skill-catalog/finance-audit-xls/WIRING.md",
    })
    .resolves(
      body(`# Wiring suggestions

## Stage 3 Gate
Use this for stage-three reviews.

\`\`\`context-md
| Stage 3 gate | . | skills/finance-audit-xls/SKILL.md |
\`\`\`
`),
    );
  s3Mock
    .on(GetObjectCommand, {
      Key: "tenants/acme/skill-catalog/finance-audit-xls/scripts/audit.py",
    })
    .resolves(body("print('audit')\n"));
}

function installOptions() {
  return {
    s3: new S3Client({}),
    bucket: "test-bucket",
    tenantSlug: "acme",
    targetPrefix: "tenants/acme/agents/marco/",
    slug: "finance-audit-xls",
    wiringChoice: "stage-3-gate",
    now: new Date("2026-05-24T16:00:00.000Z"),
  };
}

describe("installCatalogSkill", () => {
  it("copies catalog files, writes a catalog ref, and appends CONTEXT.md", async () => {
    mockCatalogSkill();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/skills/finance-audit-xls/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/marco/CONTEXT.md",
      })
      .resolves(body("# Context\n"));
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(PutObjectCommand).resolves({});

    const result = await installCatalogSkill(installOptions());

    expect(result).toMatchObject({
      ok: true,
      context_md_changed_path: "CONTEXT.md",
      installed_paths: [
        "skills/finance-audit-xls/.catalog-ref.json",
        "skills/finance-audit-xls/SKILL.md",
        "skills/finance-audit-xls/WIRING.md",
        "skills/finance-audit-xls/scripts/audit.py",
      ],
    });
    expect(result.source_sha256).toMatch(/^[0-9a-f]{64}$/);
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
      expect.objectContaining({
        CopySource:
          "test-bucket/tenants/acme/skill-catalog/finance-audit-xls/scripts/audit.py",
        Key: "tenants/acme/agents/marco/skills/finance-audit-xls/scripts/audit.py",
      }),
    ]);

    const puts = s3Mock.commandCalls(PutObjectCommand);
    const refPut = puts.find((call) =>
      String(call.args[0].input.Key).endsWith(".catalog-ref.json"),
    );
    const contextPut = puts.find(
      (call) =>
        call.args[0].input.Key === "tenants/acme/agents/marco/CONTEXT.md",
    );
    expect(JSON.parse(String(refPut?.args[0].input.Body))).toMatchObject({
      slug: "finance-audit-xls",
      installed_at: "2026-05-24T16:00:00.000Z",
      wiring_choice: "stage-3-gate",
      snippet: "| Stage 3 gate | . | skills/finance-audit-xls/SKILL.md |\n",
    });
    expect(String(contextPut?.args[0].input.Body)).toBe(`# Context

| Stage 3 gate | . | skills/finance-audit-xls/SKILL.md |
`);
  });

  it("rejects re-install when the skill folder already exists", async () => {
    mockCatalogSkill();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/skills/finance-audit-xls/",
      })
      .resolves({
        Contents: [
          {
            Key: "tenants/acme/agents/marco/skills/finance-audit-xls/SKILL.md",
          },
        ],
      });

    await expect(installCatalogSkill(installOptions())).rejects.toMatchObject({
      status: 409,
      code: "already_installed",
    } satisfies Partial<CatalogInstallError>);
    expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
  });

  it("rejects an unknown wiring choice before writing", async () => {
    mockCatalogSkill();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/skills/finance-audit-xls/",
      })
      .resolves({ Contents: [] });

    await expect(
      installCatalogSkill({ ...installOptions(), wiringChoice: "always-on" }),
    ).rejects.toMatchObject({
      status: 400,
      code: "wiring_choice_not_found",
    } satisfies Partial<CatalogInstallError>);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it("creates CONTEXT.md when it is missing", async () => {
    mockCatalogSkill();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/skills/finance-audit-xls/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/marco/CONTEXT.md",
      })
      .rejects(noSuchKey());
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(PutObjectCommand).resolves({});

    const result = await installCatalogSkill(installOptions());

    expect(result.context_md_changed_path).toBe("CONTEXT.md");
    const contextPut = s3Mock
      .commandCalls(PutObjectCommand)
      .find(
        (call) =>
          call.args[0].input.Key === "tenants/acme/agents/marco/CONTEXT.md",
      );
    expect(String(contextPut?.args[0].input.Body)).toBe(
      "| Stage 3 gate | . | skills/finance-audit-xls/SKILL.md |\n",
    );
  });

  it("rolls back copied files when a later write fails", async () => {
    mockCatalogSkill();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/skills/finance-audit-xls/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/marco/CONTEXT.md",
      })
      .resolves(body("# Context\n"));
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock
      .on(PutObjectCommand, {
        Key: "tenants/acme/agents/marco/skills/finance-audit-xls/.catalog-ref.json",
      })
      .rejects(new Error("put failed"));
    s3Mock.on(DeleteObjectCommand).resolves({});

    await expect(installCatalogSkill(installOptions())).rejects.toMatchObject({
      status: 500,
      code: "install_failed",
      message: expect.stringContaining("put failed"),
    } satisfies Partial<CatalogInstallError>);
    expect(
      s3Mock
        .commandCalls(DeleteObjectCommand)
        .map((call) => call.args[0].input),
    ).toEqual([
      expect.objectContaining({
        Key: "tenants/acme/agents/marco/skills/finance-audit-xls/SKILL.md",
      }),
      expect.objectContaining({
        Key: "tenants/acme/agents/marco/skills/finance-audit-xls/WIRING.md",
      }),
      expect.objectContaining({
        Key: "tenants/acme/agents/marco/skills/finance-audit-xls/scripts/audit.py",
      }),
      expect.objectContaining({
        Key: "tenants/acme/agents/marco/skills/finance-audit-xls/.catalog-ref.json",
      }),
    ]);
  });

  it("rolls back only copied files when a mid-copy failure happens", async () => {
    mockCatalogSkill();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/skills/finance-audit-xls/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/marco/CONTEXT.md",
      })
      .resolves(body("# Context\n"));
    s3Mock.on(CopyObjectCommand).callsFake((input) => {
      if (String(input.Key).endsWith("/WIRING.md")) {
        throw new Error("copy failed");
      }
      return {};
    });
    s3Mock.on(DeleteObjectCommand).resolves({});

    await expect(installCatalogSkill(installOptions())).rejects.toMatchObject({
      status: 500,
      code: "install_failed",
      message: expect.stringContaining("copy failed"),
    } satisfies Partial<CatalogInstallError>);
    expect(
      s3Mock
        .commandCalls(DeleteObjectCommand)
        .map((call) => call.args[0].input),
    ).toEqual([
      expect.objectContaining({
        Key: "tenants/acme/agents/marco/skills/finance-audit-xls/SKILL.md",
      }),
    ]);
    expect(
      s3Mock
        .commandCalls(PutObjectCommand)
        .some(
          (call) =>
            call.args[0].input.Key === "tenants/acme/agents/marco/CONTEXT.md",
        ),
    ).toBe(false);
  });

  it("does not try to restore CONTEXT.md when its final write fails", async () => {
    mockCatalogSkill();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/skills/finance-audit-xls/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/marco/CONTEXT.md",
      })
      .rejects(noSuchKey());
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(PutObjectCommand).callsFake((input) => {
      if (input.Key === "tenants/acme/agents/marco/CONTEXT.md") {
        throw new Error("context put failed");
      }
      return {};
    });
    s3Mock.on(DeleteObjectCommand).resolves({});

    await expect(installCatalogSkill(installOptions())).rejects.toMatchObject({
      status: 500,
      code: "install_failed",
      message: expect.stringContaining("context put failed"),
    } satisfies Partial<CatalogInstallError>);
    expect(
      s3Mock
        .commandCalls(DeleteObjectCommand)
        .map((call) => call.args[0].input),
    ).not.toContainEqual(
      expect.objectContaining({
        Key: "tenants/acme/agents/marco/CONTEXT.md",
      }),
    );
  });
});

import {
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  renderPlaceholderWiring,
  seedTenantSkillCatalog,
} from "./catalog-seed.js";

const s3Mock = mockClient(S3Client);
let catalogRoot: string;

beforeEach(async () => {
  s3Mock.reset();
  catalogRoot = await mkdtemp(join(tmpdir(), "thinkwork-catalog-seed-"));
});

afterEach(async () => {
  await rm(catalogRoot, { recursive: true, force: true });
});

async function writeSkill(
  slug: string,
  files: Record<string, string>,
): Promise<void> {
  const dir = join(catalogRoot, slug);
  await mkdir(dir, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(dir, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf8");
  }
}

describe("seedTenantSkillCatalog", () => {
  it("imports missing skills and writes placeholder WIRING.md when absent", async () => {
    await writeSkill("finance-audit-xls", {
      "SKILL.md": "# Finance Audit XLS\n",
      "scripts/run.py": "print('ok')\n",
    });
    await writeSkill("sales-prep", {
      "SKILL.md": "# Sales Prep\n",
      "WIRING.md": "# Custom wiring\n",
    });
    await writeSkill("web-search", {
      "SKILL.md": "# Web Search\n",
    });
    await mkdir(join(catalogRoot, "scripts"), { recursive: true });
    await writeFile(join(catalogRoot, "scripts/helper.ts"), "ignored\n", "utf8");

    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: "tenants/acme/skill-catalog/sales-prep/SKILL.md" },
      ],
    });
    s3Mock.on(PutObjectCommand).resolves({});

    const result = await seedTenantSkillCatalog({
      s3: new S3Client({}),
      bucket: "test-bucket",
      tenantSlug: "acme",
      catalogRoot,
    });

    expect(result).toEqual({
      ok: true,
      imported_slugs: ["finance-audit-xls"],
      skipped_slugs: ["sales-prep", "web-search"],
    });

    const putKeys = s3Mock
      .commandCalls(PutObjectCommand)
      .map((call) => call.args[0].input.Key);
    expect(putKeys).toEqual(
      expect.arrayContaining([
        "tenants/acme/skill-catalog/finance-audit-xls/SKILL.md",
        "tenants/acme/skill-catalog/finance-audit-xls/scripts/run.py",
        "tenants/acme/skill-catalog/finance-audit-xls/WIRING.md",
      ]),
    );
    expect(putKeys).toHaveLength(3);
    const wiringPut = s3Mock
      .commandCalls(PutObjectCommand)
      .find((call) =>
        call.args[0].input.Key?.endsWith(
          "finance-audit-xls/WIRING.md",
        ),
      );
    expect(wiringPut?.args[0].input.Body?.toString()).toBe(
      renderPlaceholderWiring("finance-audit-xls"),
    );
  });

  it("imports source WIRING.md verbatim when present", async () => {
    await writeSkill("sales-prep", {
      "SKILL.md": "# Sales Prep\n",
      "WIRING.md": "# Custom wiring\n",
    });
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
    s3Mock.on(PutObjectCommand).resolves({});

    const result = await seedTenantSkillCatalog({
      s3: new S3Client({}),
      bucket: "test-bucket",
      tenantSlug: "acme",
      catalogRoot,
    });

    expect(result.imported_slugs).toEqual(["sales-prep"]);
    const wiringPut = s3Mock
      .commandCalls(PutObjectCommand)
      .find((call) => call.args[0].input.Key?.endsWith("/WIRING.md"));
    expect(wiringPut?.args[0].input.Body?.toString()).toBe("# Custom wiring\n");
  });

  it("is idempotent when all source skills already exist", async () => {
    await writeSkill("finance-audit-xls", {
      "SKILL.md": "# Finance Audit XLS\n",
    });
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: "tenants/acme/skill-catalog/finance-audit-xls/SKILL.md" },
      ],
    });

    const result = await seedTenantSkillCatalog({
      s3: new S3Client({}),
      bucket: "test-bucket",
      tenantSlug: "acme",
      catalogRoot,
    });

    expect(result).toEqual({
      ok: true,
      imported_slugs: [],
      skipped_slugs: ["finance-audit-xls"],
    });
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });
});

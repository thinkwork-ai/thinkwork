import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillDraftPublishStorage } from "./publish-catalog.js";

const mocks = vi.hoisted(() => ({
  reindexCatalogSkill: vi.fn(),
  runSkillSpectorForFiles: vi.fn(),
}));

const originalWorkspaceBucket = process.env.WORKSPACE_BUCKET;

vi.mock("../catalog-index.js", () => ({
  reindexCatalogSkill: mocks.reindexCatalogSkill,
}));

vi.mock("../skill-trust/skillspector.js", () => ({
  runSkillSpectorForFiles: mocks.runSkillSpectorForFiles,
}));

let mod: typeof import("./publish-catalog.js");

beforeEach(async () => {
  vi.resetModules();
  process.env.WORKSPACE_BUCKET = "workspace-bucket";
  mocks.reindexCatalogSkill.mockReset().mockResolvedValue({
    slug: "draft-helper",
    action: "upserted",
  });
  mocks.runSkillSpectorForFiles.mockReset().mockResolvedValue({
    scanner: {
      status: "completed",
      version: "2.2.3",
      riskScore: 0,
      riskSeverity: "LOW",
      recommendation: "SAFE",
    },
    findings: [],
  });
  mod = await import("./publish-catalog.js");
});

afterEach(() => {
  if (originalWorkspaceBucket === undefined) {
    delete process.env.WORKSPACE_BUCKET;
  } else {
    process.env.WORKSPACE_BUCKET = originalWorkspaceBucket;
  }
});

function skillMd(name = "draft-helper") {
  return Buffer.from(
    `---
name: ${name}
description: Helps draft reusable skills.
---

# Draft helper
`,
  );
}

function storage(
  seed: Record<string, string | Buffer>,
): SkillDraftPublishStorage & {
  objects: Map<string, Buffer>;
} {
  const objects = new Map(
    Object.entries(seed).map(([key, value]) => [
      key,
      Buffer.isBuffer(value) ? value : Buffer.from(value),
    ]),
  );
  return {
    objects,
    async list(prefix) {
      return [...objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length))
        .sort();
    },
    async read(key) {
      const object = objects.get(key);
      if (!object) throw new Error(`missing ${key}`);
      return object;
    },
    async write(key, content, _contentType, options) {
      if (options?.ifNoneMatch === "*" && objects.has(key)) {
        throw new Error(`precondition failed for ${key}`);
      }
      objects.set(key, content);
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

function draft(status = "submitted") {
  return {
    id: "draft-1",
    slug: "draft-helper",
    status,
    draft_s3_prefix: "tenants/acme/skill-drafts/draft-1/",
    current_content_hash: "sha256:a",
  };
}

describe("publishSkillDraftToCatalog", () => {
  it("publishes a trust-ready submitted draft into the tenant catalog", async () => {
    const fakeStorage = storage({
      "tenants/acme/skill-drafts/draft-1/SKILL.md": skillMd(),
    });

    const result = await mod.publishSkillDraftToCatalog({
      tenantId: "tenant-1",
      tenantSlug: "acme",
      draft: draft(),
      storage: fakeStorage,
      now: new Date("2026-06-22T00:00:00Z"),
    });

    expect(result).toMatchObject({
      slug: "draft-helper",
      replaced: false,
      generatedWiring: true,
      trustReport: {
        status: "passed",
        scanner: { status: "completed", version: "2.2.3" },
      },
    });
    expect(
      fakeStorage.objects.has(
        "tenants/acme/skill-catalog/draft-helper/SKILL.md",
      ),
    ).toBe(true);
    expect(
      fakeStorage.objects.has(
        "tenants/acme/skill-catalog/draft-helper/WIRING.md",
      ),
    ).toBe(true);
    expect(mocks.reindexCatalogSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        tenantSlug: "acme",
        slug: "draft-helper",
      }),
    );
  });

  it("blocks publish until SkillSpector is configured and completes", async () => {
    mocks.runSkillSpectorForFiles.mockResolvedValueOnce({
      scanner: { status: "not_configured" },
      findings: [],
    });
    const fakeStorage = storage({
      "tenants/acme/skill-drafts/draft-1/SKILL.md": skillMd(),
    });

    await expect(
      mod.publishSkillDraftToCatalog({
        tenantId: "tenant-1",
        tenantSlug: "acme",
        draft: draft(),
        storage: fakeStorage,
      }),
    ).rejects.toMatchObject({ code: "skillspector_required", status: 409 });
  });

  it("blocks critical or high SkillSpector findings", async () => {
    mocks.runSkillSpectorForFiles.mockResolvedValueOnce({
      scanner: { status: "completed", riskScore: 90 },
      findings: [
        {
          id: "TT3",
          severity: "high",
          category: "Data Flow",
          message: "Credentials flow to a network sink.",
        },
      ],
    });
    const fakeStorage = storage({
      "tenants/acme/skill-drafts/draft-1/SKILL.md": skillMd(),
    });

    await expect(
      mod.publishSkillDraftToCatalog({
        tenantId: "tenant-1",
        tenantSlug: "acme",
        draft: draft(),
        storage: fakeStorage,
      }),
    ).rejects.toMatchObject({ code: "trust_blocked", status: 409 });
  });

  it("requires explicit confirmation before replacing an existing catalog skill", async () => {
    const fakeStorage = storage({
      "tenants/acme/skill-drafts/draft-1/SKILL.md": skillMd(),
      "tenants/acme/skill-catalog/draft-helper/SKILL.md": skillMd(),
    });

    await expect(
      mod.publishSkillDraftToCatalog({
        tenantId: "tenant-1",
        tenantSlug: "acme",
        draft: draft(),
        storage: fakeStorage,
      }),
    ).rejects.toMatchObject({ code: "skill_exists", status: 409 });

    await expect(
      mod.publishSkillDraftToCatalog({
        tenantId: "tenant-1",
        tenantSlug: "acme",
        draft: draft(),
        storage: fakeStorage,
        confirmReplace: true,
      }),
    ).resolves.toMatchObject({ replaced: true });
  });
});

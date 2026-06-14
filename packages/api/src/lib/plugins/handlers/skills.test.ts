/**
 * Skills component handler tests (plan 2026-06-12-001 U5).
 *
 * Everything is injected: a recording S3 fake, a chain-mock db for the
 * tenant-slug read, and fakes for catalog-install/uninstall, the index
 * refresh, the manifest regen, and the platform-agent resolver.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { SkillsComponent } from "@thinkwork/plugin-catalog";
import { CatalogInstallError } from "../../catalog-install.js";
import {
  PLUGIN_SKILL_WIRING_CHOICE,
  pluginSkillWiringMd,
  provisionPluginSkillsComponent,
  teardownPluginSkillsComponent,
  type SkillsHandlerDeps,
} from "./skills.js";

const component: SkillsComponent = {
  type: "skills",
  key: "skills",
  skills: [
    {
      slug: "lastmile--crm-basics",
      skillMd: "---\nname: lastmile--crm-basics\n---\n# CRM basics\n",
      supportingFiles: [{ path: "references/guide.md", content: "# guide" }],
    },
  ],
};

interface FakeS3 {
  send: ReturnType<typeof vi.fn>;
  puts: { key: string; body: string }[];
  deletes: string[];
  listed: string[];
}

function fakeS3(listKeys: string[] = []): FakeS3 {
  const puts: { key: string; body: string }[] = [];
  const deletes: string[] = [];
  const listed: string[] = [];
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof PutObjectCommand) {
      puts.push({
        key: command.input.Key!,
        body: String(command.input.Body),
      });
      return {};
    }
    if (command instanceof ListObjectsV2Command) {
      listed.push(command.input.Prefix!);
      return {
        Contents: listKeys
          .filter((key) => key.startsWith(command.input.Prefix!))
          .map((key) => ({ Key: key })),
        IsTruncated: false,
      };
    }
    if (command instanceof DeleteObjectCommand) {
      deletes.push(command.input.Key!);
      return {};
    }
    return {};
  });
  return { send, puts, deletes, listed };
}

function fakeDb(tenantSlug = "acme") {
  const chain: any = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(async () => [{ slug: tenantSlug }]),
  };
  return { select: vi.fn(() => chain) } as never;
}

type FakeSkillsDeps = SkillsHandlerDeps & {
  install: ReturnType<typeof vi.fn>;
  uninstall: ReturnType<typeof vi.fn>;
  reindex: ReturnType<typeof vi.fn>;
  regenerate: ReturnType<typeof vi.fn>;
};

function deps(
  s3: FakeS3,
  overrides: Partial<SkillsHandlerDeps> = {},
): FakeSkillsDeps {
  return {
    db: fakeDb(),
    s3: s3 as never,
    bucket: "workspace-bucket",
    install: vi.fn(async () => ({
      ok: true as const,
      installed_paths: [],
      context_md_changed_path: "CONTEXT.md" as const,
      source_sha256: "a".repeat(64),
    })),
    uninstall: vi.fn(async () => ({
      ok: true as const,
      deleted_paths: [],
      context_md_strip: "removed" as const,
    })),
    reindex: vi.fn(async () => ({ slug: "x", action: "upserted" as const })),
    regenerate: vi.fn(async () => undefined),
    resolvePlatformAgent: vi.fn(async () => ({ slug: "agent-1" }) as never),
    // Default to no-op spies so tests never hit the real eval seeder/AWS.
    seedSkillEvalDataset: vi.fn(async () => ({
      action: "seeded" as const,
      datasetSlug: "skill-x",
      addedCaseIds: [],
      updatedCaseIds: [],
      removedCaseIds: [],
      skipped: [],
      bundledCaseCount: 0,
    })),
    archiveSkillEvalDataset: vi.fn(async () => ({
      action: "archived" as const,
    })),
    ...overrides,
  } as FakeSkillsDeps;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("provisionPluginSkillsComponent", () => {
  it("seeds SKILL.md + supporting files + generated WIRING.md, installs with the default wiring, returns the handler ref", async () => {
    const s3 = fakeS3();
    const d = deps(s3);

    const ref = await provisionPluginSkillsComponent({
      tenantId: "tenant-1",
      component,
      deps: d,
    });

    const seededKeys = s3.puts.map((put) => put.key);
    expect(seededKeys).toEqual([
      "tenants/acme/skill-catalog/lastmile--crm-basics/SKILL.md",
      "tenants/acme/skill-catalog/lastmile--crm-basics/references/guide.md",
      "tenants/acme/skill-catalog/lastmile--crm-basics/WIRING.md",
    ]);
    // Generated WIRING.md carries the single default suggestion.
    expect(s3.puts[2]!.body).toContain("```context-md");
    expect(s3.puts[2]!.body).toContain("## Default");

    expect(d.install).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: "workspace-bucket",
        tenantSlug: "acme",
        targetPrefix: "tenants/acme/agents/agent-1/",
        slug: "lastmile--crm-basics",
        wiringChoice: PLUGIN_SKILL_WIRING_CHOICE,
      }),
    );
    expect(d.reindex).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        tenantSlug: "acme",
        slug: "lastmile--crm-basics",
      }),
    );
    expect(d.regenerate).toHaveBeenCalledWith(
      "workspace-bucket",
      "acme",
      "agent-1",
    );

    expect(ref).toEqual({
      seededCatalogPrefixes: [
        "tenants/acme/skill-catalog/lastmile--crm-basics/",
      ],
      workspaceFolders: ["skills/lastmile--crm-basics/"],
      agentSlug: "agent-1",
    });
  });

  it("treats a 409 already_installed as success (idempotent re-run / repair)", async () => {
    const s3 = fakeS3();
    const d = deps(s3, {
      install: vi.fn(async () => {
        throw new CatalogInstallError(
          409,
          "already_installed",
          "already there",
        );
      }),
    });

    const ref = await provisionPluginSkillsComponent({
      tenantId: "tenant-1",
      component,
      deps: d,
    });
    expect(ref.workspaceFolders).toEqual(["skills/lastmile--crm-basics/"]);
    // Seed still overwrote the catalog source.
    expect(s3.puts.length).toBeGreaterThan(0);
  });

  it("propagates non-409 install failures (component lands failed + retryable)", async () => {
    const s3 = fakeS3();
    const d = deps(s3, {
      install: vi.fn(async () => {
        throw new CatalogInstallError(
          400,
          "context_md_missing",
          "CONTEXT.md is required",
        );
      }),
    });
    await expect(
      provisionPluginSkillsComponent({
        tenantId: "tenant-1",
        component,
        deps: d,
      }),
    ).rejects.toThrow("CONTEXT.md is required");
  });

  it("does not generate WIRING.md when the bundle ships one", async () => {
    const s3 = fakeS3();
    const d = deps(s3);
    await provisionPluginSkillsComponent({
      tenantId: "tenant-1",
      component: {
        ...component,
        skills: [
          {
            slug: "lastmile--crm-basics",
            skillMd: "# s",
            supportingFiles: [{ path: "WIRING.md", content: "# custom" }],
          },
        ],
      },
      deps: d,
    });
    const wiringPuts = s3.puts.filter((put) => put.key.endsWith("WIRING.md"));
    expect(wiringPuts).toHaveLength(1);
    expect(wiringPuts[0]!.body).toBe("# custom");
  });

  it("syncs bundled evals/*.json into the per-skill eval dataset (U2 plugin path)", async () => {
    const s3 = fakeS3();
    const d = deps(s3);
    await provisionPluginSkillsComponent({
      tenantId: "tenant-1",
      component: {
        ...component,
        skills: [
          {
            slug: "lastmile--crm-basics",
            skillMd: "# s",
            supportingFiles: [
              { path: "references/guide.md", content: "# guide" },
              {
                path: "evals/refuses-pii.json",
                content: JSON.stringify({ query: "q", rubric: "must refuse" }),
              },
            ],
          },
        ],
      },
      deps: d,
    });

    expect(d.seedSkillEvalDataset).toHaveBeenCalledWith(
      "tenant-1",
      "lastmile--crm-basics",
      [
        {
          fileName: "refuses-pii.json",
          content: JSON.stringify({ query: "q", rubric: "must refuse" }),
        },
      ],
    );
  });

  it("does not call the eval seeder for a skill bundling no cases (unrated)", async () => {
    const s3 = fakeS3();
    const d = deps(s3);
    await provisionPluginSkillsComponent({
      tenantId: "tenant-1",
      component,
      deps: d,
    });
    expect(d.seedSkillEvalDataset).not.toHaveBeenCalled();
  });
});

describe("teardownPluginSkillsComponent", () => {
  it("uninstalls the workspace copy, deletes the seeded prefix, drops the index row, regenerates the manifest", async () => {
    const s3 = fakeS3([
      "tenants/acme/skill-catalog/lastmile--crm-basics/SKILL.md",
      "tenants/acme/skill-catalog/lastmile--crm-basics/WIRING.md",
    ]);
    const d = deps(s3);

    await teardownPluginSkillsComponent({
      tenantId: "tenant-1",
      component,
      handlerRef: {
        seededCatalogPrefixes: [
          "tenants/acme/skill-catalog/lastmile--crm-basics/",
        ],
        workspaceFolders: ["skills/lastmile--crm-basics/"],
        agentSlug: "agent-1",
      },
      deps: d,
    });

    expect(d.uninstall).toHaveBeenCalledWith(
      expect.objectContaining({
        targetPrefix: "tenants/acme/agents/agent-1/",
        slug: "lastmile--crm-basics",
      }),
    );
    expect(s3.deletes.sort()).toEqual([
      "tenants/acme/skill-catalog/lastmile--crm-basics/SKILL.md",
      "tenants/acme/skill-catalog/lastmile--crm-basics/WIRING.md",
    ]);
    expect(d.reindex).toHaveBeenCalled();
    expect(d.regenerate).toHaveBeenCalledWith(
      "workspace-bucket",
      "acme",
      "agent-1",
    );
  });

  it("falls back to the manifest component slugs when handler_ref was never recorded", async () => {
    const s3 = fakeS3();
    const d = deps(s3);
    await teardownPluginSkillsComponent({
      tenantId: "tenant-1",
      component,
      handlerRef: {},
      deps: d,
    });
    expect(d.uninstall).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "lastmile--crm-basics" }),
    );
  });

  it("archives the per-skill eval dataset on teardown (U2)", async () => {
    const s3 = fakeS3();
    const d = deps(s3);
    await teardownPluginSkillsComponent({
      tenantId: "tenant-1",
      component,
      handlerRef: {
        workspaceFolders: ["skills/lastmile--crm-basics/"],
        agentSlug: "agent-1",
      },
      deps: d,
    });
    expect(d.archiveSkillEvalDataset).toHaveBeenCalledWith(
      "tenant-1",
      "lastmile--crm-basics",
    );
  });
});

describe("pluginSkillWiringMd", () => {
  it("renders a parseable WIRING.md with the default suggestion id", () => {
    const wiring = pluginSkillWiringMd({
      slug: "lastmile--crm-basics",
      skillMd: "# s",
    });
    expect(wiring).toContain("## Default");
    expect(wiring).toContain("skills/lastmile--crm-basics/SKILL.md");
  });
});

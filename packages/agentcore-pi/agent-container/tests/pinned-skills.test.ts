import { describe, expect, it, vi } from "vitest";
import {
  loadPinnedSkills,
  mergeWorkspaceSkills,
  parsePinnedSkillRefs,
} from "../src/runtime/pinned-skills.js";
import type { WorkspaceSkill } from "../src/runtime/workspace-skills.js";

const skill = (
  slug: string,
  content = `---\nname: ${slug}\n---\n`,
): WorkspaceSkill => ({
  slug,
  name: slug,
  description: "",
  skillPath: `/workspace/skills/${slug}/SKILL.md`,
  content,
});

describe("parsePinnedSkillRefs", () => {
  it("accepts well-formed refs whose s3Key matches the slug's catalog folder", () => {
    expect(
      parsePinnedSkillRefs([
        {
          skillId: "crm-dashboard",
          s3Key: "tenants/acme/skill-catalog/crm-dashboard",
        },
      ]),
    ).toEqual([
      {
        skillId: "crm-dashboard",
        s3Key: "tenants/acme/skill-catalog/crm-dashboard",
      },
    ]);
  });

  it("returns [] for a non-array payload", () => {
    expect(parsePinnedSkillRefs(undefined)).toEqual([]);
    expect(parsePinnedSkillRefs(null)).toEqual([]);
    expect(parsePinnedSkillRefs("nope")).toEqual([]);
  });

  it("drops refs whose s3Key does not end at the slug's own catalog folder", () => {
    expect(
      parsePinnedSkillRefs([
        // key points at a different skill's folder — forged/mismatched
        { skillId: "crm-dashboard", s3Key: "tenants/acme/skill-catalog/other" },
        // traversal-style slug
        {
          skillId: "../secrets",
          s3Key: "tenants/acme/skill-catalog/../secrets",
        },
      ]),
    ).toEqual([]);
  });

  it("drops entries missing skillId or s3Key", () => {
    expect(
      parsePinnedSkillRefs([
        { skillId: "x" },
        { s3Key: "tenants/a/skill-catalog/x" },
        {},
      ]),
    ).toEqual([]);
  });

  it("dedupes repeated slugs", () => {
    const refs = parsePinnedSkillRefs([
      { skillId: "a", s3Key: "tenants/t/skill-catalog/a" },
      { skillId: "a", s3Key: "tenants/t/skill-catalog/a" },
    ]);
    expect(refs).toHaveLength(1);
  });
});

describe("loadPinnedSkills", () => {
  const s3With = (impl: (key: string) => Promise<string>) => ({
    send: vi.fn(async (cmd: { input: { Key: string } }) => ({
      Body: { transformToString: async () => impl(cmd.input.Key) },
    })),
  });

  it("fetches SKILL.md per ref and builds a WorkspaceSkill", async () => {
    const s3 = s3With(async (key) => {
      expect(key).toBe("tenants/acme/skill-catalog/crm-dashboard/SKILL.md");
      return "---\ndisplay_name: CRM Dashboard\ndescription: Pull CRM data\n---\nbody";
    });
    const res = await loadPinnedSkills({
      refs: [
        {
          skillId: "crm-dashboard",
          s3Key: "tenants/acme/skill-catalog/crm-dashboard",
        },
      ],
      bucket: "wk",
      s3: s3 as never,
    });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      slug: "crm-dashboard",
      name: "CRM Dashboard",
      description: "Pull CRM data",
    });
    expect(res[0].content).toContain("body");
  });

  it("skips a ref whose fetch throws, logging, without failing the batch", async () => {
    const log = vi.fn();
    const s3 = {
      send: vi.fn(async (cmd: { input: { Key: string } }) => {
        if (cmd.input.Key.includes("missing")) throw new Error("NoSuchKey");
        return {
          Body: { transformToString: async () => "---\nname: ok\n---\n" },
        };
      }),
    };
    const res = await loadPinnedSkills({
      refs: [
        { skillId: "missing", s3Key: "tenants/t/skill-catalog/missing" },
        { skillId: "ok", s3Key: "tenants/t/skill-catalog/ok" },
      ],
      bucket: "wk",
      s3: s3 as never,
      log,
    });
    expect(res.map((s) => s.slug)).toEqual(["ok"]);
    expect(log).toHaveBeenCalledWith(
      "pinned_skill_fetch_failed",
      expect.objectContaining({ skillId: "missing" }),
    );
  });

  it("skips a ref whose SKILL.md is empty", async () => {
    const log = vi.fn();
    const s3 = s3With(async () => "   ");
    const res = await loadPinnedSkills({
      refs: [{ skillId: "blank", s3Key: "tenants/t/skill-catalog/blank" }],
      bucket: "wk",
      s3: s3 as never,
      log,
    });
    expect(res).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      "pinned_skill_empty",
      expect.objectContaining({ skillId: "blank" }),
    );
  });
});

describe("mergeWorkspaceSkills", () => {
  it("adds uninstalled pins and emphasizes them (R5 additive, R7 ephemeral)", () => {
    const discovered = [skill("email"), skill("calendar")];
    const pinned = [skill("invoice-parser")];
    const { skills, emphasizedSlugs } = mergeWorkspaceSkills(
      discovered,
      pinned,
    );
    expect(skills.map((s) => s.slug)).toEqual([
      "calendar",
      "email",
      "invoice-parser",
    ]);
    expect([...emphasizedSlugs]).toEqual(["invoice-parser"]);
  });

  it("keeps the installed copy on slug collision but still emphasizes the pin", () => {
    const discovered = [skill("crm-dashboard", "INSTALLED")];
    const pinned = [skill("crm-dashboard", "CATALOG")];
    const { skills, emphasizedSlugs } = mergeWorkspaceSkills(
      discovered,
      pinned,
    );
    expect(skills).toHaveLength(1);
    expect(skills[0].content).toBe("INSTALLED");
    expect([...emphasizedSlugs]).toEqual(["crm-dashboard"]);
  });
});

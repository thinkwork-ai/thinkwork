import { describe, expect, it } from "vitest";
import {
  MAX_PINNED_SKILLS,
  buildPinnedSkillConfigs,
  filterBlockedSkills,
  parsePinnedSkillSlugs,
  resolveDispatchPinnedSkills,
} from "./message-pinned-skills.js";

const catalogS3Key = (tenantSlug: string, slug: string) =>
  `tenants/${tenantSlug}/skill-catalog/${slug}`;

describe("parsePinnedSkillSlugs", () => {
  it("parses { slug } entries from jsonb metadata", () => {
    expect(
      parsePinnedSkillSlugs({ skills: [{ slug: "crm-dashboard" }] }),
    ).toEqual(["crm-dashboard"]);
  });

  it("parses bare-string entries", () => {
    expect(parsePinnedSkillSlugs({ skills: ["crm-dashboard"] })).toEqual([
      "crm-dashboard",
    ]);
  });

  it("tolerates stringified-JSON metadata (text column)", () => {
    expect(
      parsePinnedSkillSlugs(JSON.stringify({ skills: [{ slug: "x" }] })),
    ).toEqual(["x"]);
  });

  it("dedupes repeated slugs preserving first-seen order", () => {
    expect(
      parsePinnedSkillSlugs({ skills: ["a", "b", "a", { slug: "b" }, "c"] }),
    ).toEqual(["a", "b", "c"]);
  });

  it("preserves slug case (s3Key is built from the exact slug)", () => {
    expect(parsePinnedSkillSlugs({ skills: ["CRM-Dashboard"] })).toEqual([
      "CRM-Dashboard",
    ]);
  });

  it("rejects malformed slugs (path traversal, spaces, empty)", () => {
    expect(
      parsePinnedSkillSlugs({
        skills: ["../etc", "has space", "", "  ", "ok-skill"],
      }),
    ).toEqual(["ok-skill"]);
  });

  it("caps at MAX_PINNED_SKILLS", () => {
    const many = Array.from(
      { length: MAX_PINNED_SKILLS + 5 },
      (_, i) => `s${i}`,
    );
    expect(parsePinnedSkillSlugs({ skills: many })).toHaveLength(
      MAX_PINNED_SKILLS,
    );
  });

  it("returns [] for absent/empty/non-array skills", () => {
    expect(parsePinnedSkillSlugs(null)).toEqual([]);
    expect(parsePinnedSkillSlugs({})).toEqual([]);
    expect(parsePinnedSkillSlugs({ skills: "nope" })).toEqual([]);
    expect(parsePinnedSkillSlugs({ attachments: [] })).toEqual([]);
  });
});

describe("filterBlockedSkills (KD4)", () => {
  it("drops slugs present in blocked_tools", () => {
    expect(
      filterBlockedSkills(["a", "danger", "b"], ["danger", "other"]),
    ).toEqual(["a", "b"]);
  });

  it("returns slugs unchanged when nothing is blocked", () => {
    expect(filterBlockedSkills(["a", "b"], [])).toEqual(["a", "b"]);
    expect(filterBlockedSkills(["a", "b"], null)).toEqual(["a", "b"]);
    expect(filterBlockedSkills(["a", "b"], undefined)).toEqual(["a", "b"]);
  });
});

describe("buildPinnedSkillConfigs (U3)", () => {
  it("maps each slug to its tenant catalog s3Key", () => {
    expect(
      buildPinnedSkillConfigs({
        slugs: ["crm-dashboard"],
        tenantSlug: "acme",
        catalogS3Key,
      }),
    ).toEqual([
      {
        skillId: "crm-dashboard",
        s3Key: "tenants/acme/skill-catalog/crm-dashboard",
      },
    ]);
  });

  it("returns [] for empty slugs (payload field omitted upstream)", () => {
    expect(
      buildPinnedSkillConfigs({ slugs: [], tenantSlug: "acme", catalogS3Key }),
    ).toEqual([]);
  });

  it("returns [] when the tenant slug is missing", () => {
    expect(
      buildPinnedSkillConfigs({
        slugs: ["crm-dashboard"],
        tenantSlug: "",
        catalogS3Key,
      }),
    ).toEqual([]);
  });

  it("dedupes repeated slugs", () => {
    const res = buildPinnedSkillConfigs({
      slugs: ["a", "a", "b"],
      tenantSlug: "acme",
      catalogS3Key,
    });
    expect(res.map((c) => c.skillId)).toEqual(["a", "b"]);
  });

  it("drops configs the policy disallows (KD4 — pin cannot override blocklist)", () => {
    const res = buildPinnedSkillConfigs({
      slugs: ["crm-dashboard", "danger-skill"],
      tenantSlug: "acme",
      catalogS3Key,
      isAllowed: (c) => c.skillId !== "danger-skill",
    });
    expect(res.map((c) => c.skillId)).toEqual(["crm-dashboard"]);
  });
});

describe("resolveDispatchPinnedSkills", () => {
  const dbReturning = (metadata: unknown) => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ metadata }]),
        }),
      }),
    }),
  });

  it("reads metadata.skills for the message", async () => {
    const db = dbReturning({ skills: [{ slug: "crm-dashboard" }] });
    const res = await resolveDispatchPinnedSkills({
      db,
      tenantId: "t1",
      threadId: "th1",
      messageId: "m1",
    });
    expect(res).toEqual(["crm-dashboard"]);
  });

  it("returns [] when the message has no pins", async () => {
    const db = dbReturning({ attachments: [] });
    const res = await resolveDispatchPinnedSkills({
      db,
      tenantId: "t1",
      threadId: "th1",
      messageId: "m1",
    });
    expect(res).toEqual([]);
  });

  it("returns [] when the message row is missing", async () => {
    const db = {
      select: () => ({
        from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
      }),
    };
    const res = await resolveDispatchPinnedSkills({
      db,
      tenantId: "t1",
      threadId: "th1",
      messageId: "m1",
    });
    expect(res).toEqual([]);
  });
});

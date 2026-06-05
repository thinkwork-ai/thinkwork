import { describe, expect, it } from "vitest";
import {
  MAX_PINNED_SKILLS,
  filterBlockedSkills,
  parsePinnedSkillSlugs,
  resolveDispatchPinnedSkills,
} from "./message-pinned-skills.js";

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

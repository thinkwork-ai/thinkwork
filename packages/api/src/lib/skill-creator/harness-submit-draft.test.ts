import { describe, expect, it, vi } from "vitest";
import {
  prepareHarnessSkillDraft,
  submitHarnessSkillDraft,
} from "./harness-submit-draft.js";

const VALID_SKILL = [
  "---",
  "name: account-brief",
  "display_name: Account Brief",
  "description: Creates a concise account brief from governed sources.",
  "---",
  "",
  "# Account Brief",
  "",
  "Use governed sources and cite material claims.",
  "",
].join("\n");

describe("prepareHarnessSkillDraft", () => {
  it("validates the normal Agent Skills contract and generates wiring", () => {
    const prepared = prepareHarnessSkillDraft({
      skill_markdown: VALID_SKILL,
      supporting_files: [
        { path: "references/fields.md", content: "# Fields\n\n- account" },
      ],
    });

    expect(prepared).toMatchObject({
      slug: "account-brief",
      title: "Account Brief",
      displayName: "Account Brief",
      summary: "Creates a concise account brief from governed sources.",
      currentContentHash: expect.stringMatching(/^sha256:/),
    });
    expect(prepared.files.map((file) => file.path)).toEqual([
      "references/fields.md",
      "SKILL.md",
      "WIRING.md",
    ]);
  });

  it("rejects traversal and duplicate SKILL.md paths", () => {
    expect(() =>
      prepareHarnessSkillDraft({
        skill_markdown: VALID_SKILL,
        supporting_files: [{ path: "../secret.md", content: "no" }],
      }),
    ).toThrow(/invalid skill draft/i);
    expect(() =>
      prepareHarnessSkillDraft({
        skill_markdown: VALID_SKILL,
        supporting_files: [{ path: "SKILL.md", content: "replace" }],
      }),
    ).toThrow(/must not replace SKILL\.md/);
  });
});

describe("submitHarnessSkillDraft", () => {
  it("persists exact-user draft files and emits one idempotent registration", async () => {
    const writes: string[] = [];
    const insertDraft = vi.fn(async () => undefined);
    const persistence = {
      storage: {
        list: async () => [],
        read: async () => Buffer.alloc(0),
        write: async (key: string) => {
          writes.push(key);
        },
      },
      findExisting: vi.fn(async () => null),
      loadTenantSlug: vi.fn(async () => "acme"),
      insertDraft,
      newId: () => "11111111-1111-4111-8111-111111111111",
    };

    const result = await submitHarnessSkillDraft({
      tenantId: "tenant-1",
      requesterUserId: "user-1",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      raw: { skill_markdown: VALID_SKILL },
      persistence,
      now: new Date("2026-07-18T20:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "submitted",
      draftId: "11111111-1111-4111-8111-111111111111",
      slug: "account-brief",
      fileCount: 2,
    });
    expect(writes).toEqual([
      "tenants/acme/skill-drafts/11111111-1111-4111-8111-111111111111/SKILL.md",
      "tenants/acme/skill-drafts/11111111-1111-4111-8111-111111111111/WIRING.md",
    ]);
    expect(insertDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        requesterUserId: "user-1",
        threadId: "thread-1",
        threadTurnId: "turn-1",
      }),
    );
  });

  it("returns the canonical prior registration without writing again", async () => {
    const existing = {
      status: "submitted" as const,
      draftId: "draft-1",
      slug: "account-brief",
      fileCount: 2,
      currentContentHash: "sha256:existing",
    };
    const write = vi.fn(async () => undefined);
    const result = await submitHarnessSkillDraft({
      tenantId: "tenant-1",
      requesterUserId: "user-1",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      raw: { skill_markdown: VALID_SKILL },
      persistence: {
        storage: {
          list: async () => [],
          read: async () => Buffer.alloc(0),
          write,
        },
        findExisting: async () => existing,
        loadTenantSlug: async () => "unused",
        insertDraft: async () => undefined,
        newId: () => "unused",
      },
    });

    expect(result).toEqual(existing);
    expect(write).not.toHaveBeenCalled();
  });
});

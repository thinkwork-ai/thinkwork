import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  inserts: [] as Array<{ table: unknown; value: unknown }>,
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => mocks.selectResults.shift() ?? [],
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: async (value: unknown) => {
        mocks.inserts.push({ table, value });
      },
    }),
  }),
}));

vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: () => "workspace-bucket",
}));

import {
  autoSubmitSkillCreatorDraft,
  changedSkillMdFiles,
  type SkillCreatorDraftStorage,
} from "./auto-submit-draft.js";
import type { ReconcileReport } from "../chat-finalize/reconcile.js";

beforeEach(() => {
  mocks.selectResults = [];
  mocks.inserts = [];
});

describe("changedSkillMdFiles", () => {
  it("extracts written agent skill folders from reconcile reports", () => {
    const report: ReconcileReport = {
      status: "complete",
      files: [
        {
          path: "skills/codex-e2e/SKILL.md",
          op: "create",
          owner: "agent",
          status: "written",
          sourceKey: "tenants/acme/agents/default/skills/codex-e2e/SKILL.md",
          etag: "etag-1",
        },
        {
          path: "skills/codex-e2e/README.md",
          op: "create",
          owner: "agent",
          status: "written",
          sourceKey: "tenants/acme/agents/default/skills/codex-e2e/README.md",
          etag: "etag-2",
        },
      ],
    };

    expect(changedSkillMdFiles(report)).toEqual([
      {
        slug: "codex-e2e",
        path: "skills/codex-e2e/SKILL.md",
        sourceKey: "tenants/acme/agents/default/skills/codex-e2e/SKILL.md",
        sourcePrefix: "tenants/acme/agents/default/skills/codex-e2e/",
      },
    ]);
  });
});

describe("autoSubmitSkillCreatorDraft", () => {
  it("creates a submitted draft from a valid /skill-creator skill folder", async () => {
    const sourcePrefix = "tenants/acme/agents/default/skills/codex-e2e/";
    const objects = new Map<string, Buffer>([
      [
        `${sourcePrefix}SKILL.md`,
        Buffer.from(
          [
            "---",
            "name: codex-e2e",
            "display_name: Codex E2E",
            "description: Responds with a fixed E2E marker when invoked.",
            "---",
            "",
            "# Codex E2E",
            "",
            "Respond exactly with E2E_SKILL_INVOKED_20260622.",
            "",
          ].join("\n"),
          "utf8",
        ),
      ],
    ]);
    const writes: Array<{ key: string; contentType: string }> = [];
    const storage: SkillCreatorDraftStorage = {
      list: async (prefix) =>
        [...objects.keys()].filter((key) => key.startsWith(prefix)),
      read: async (key) => objects.get(key) ?? Buffer.alloc(0),
      write: async (key, _content, contentType) => {
        writes.push({ key, contentType });
      },
    };
    mocks.selectResults = [[], [{ slug: "acme" }]];

    const result = await autoSubmitSkillCreatorDraft({
      tenantId: "tenant-1",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      requesterUserId: "user-1",
      userMessage: "/skill-creator create codex-e2e and submit for review",
      skillCreatorCommand: {
        type: "skill_creator",
        source: "slash_command",
        command: "/skill-creator",
      },
      reconcileReport: {
        status: "complete",
        files: [
          {
            path: "skills/codex-e2e/SKILL.md",
            op: "create",
            owner: "agent",
            status: "written",
            sourceKey: `${sourcePrefix}SKILL.md`,
            etag: "etag-1",
          },
        ],
      },
      storage,
      now: new Date("2026-06-22T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "submitted",
      slug: "codex-e2e",
      fileCount: 2,
      currentContentHash: expect.stringMatching(/^sha256:/),
    });
    expect(writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: expect.stringMatching(
            /^tenants\/acme\/skill-drafts\/.+\/SKILL\.md$/,
          ),
          contentType: "text/markdown; charset=utf-8",
        }),
        expect.objectContaining({
          key: expect.stringMatching(
            /^tenants\/acme\/skill-drafts\/.+\/WIRING\.md$/,
          ),
          contentType: "text/markdown; charset=utf-8",
        }),
      ]),
    );
    expect(mocks.inserts[0]?.value).toMatchObject({
      tenant_id: "tenant-1",
      requested_by_user_id: "user-1",
      source_thread_id: "thread-1",
      slug: "codex-e2e",
      title: "Codex E2E",
      display_name: "Codex E2E",
      status: "submitted",
      submitted_at: new Date("2026-06-22T00:00:00.000Z"),
      metadata: {
        skillCreator: {
          source: "chat_finalize",
          threadTurnId: "turn-1",
          sourcePath: "skills/codex-e2e/SKILL.md",
          sourcePrefix,
        },
      },
    });
    expect(mocks.inserts.slice(1).map((insert) => insert.value)).toEqual([
      expect.objectContaining({ event_type: "created" }),
      expect.objectContaining({ event_type: "submitted" }),
    ]);
  });

  it("skips interview-only /skill-creator turns until the user asks to submit", async () => {
    const result = await autoSubmitSkillCreatorDraft({
      tenantId: "tenant-1",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      requesterUserId: "user-1",
      userMessage: "/skill-creator help me design a skill",
      skillCreatorCommand: {
        type: "skill_creator",
        source: "slash_command",
        command: "/skill-creator",
      },
      reconcileReport: {
        status: "complete",
        files: [],
      },
      storage: {
        list: async () => [],
        read: async () => Buffer.alloc(0),
        write: async () => undefined,
      },
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "missing_submit_intent",
    });
    expect(mocks.inserts).toEqual([]);
  });
});

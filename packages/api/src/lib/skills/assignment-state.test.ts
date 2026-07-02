/**
 * Workspace assignment-state file tests (capability-mapping plan U9,
 * KTD-8). The store contract: merge-patch writes beside
 * `.catalog-ref.json`, fail-soft reads, and never-throw writes (the DB
 * row stays authoritative until U10).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, mockGetConfig } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  mockGetConfig: vi.fn(),
}));

vi.mock("@thinkwork/runtime-config", () => ({ getConfig: mockGetConfig }));

vi.mock("@aws-sdk/client-s3", () => {
  class GetObjectCommand {
    constructor(public input: { Bucket: string; Key: string }) {}
  }
  class PutObjectCommand {
    constructor(public input: { Bucket: string; Key: string; Body: string }) {}
  }
  class S3Client {
    async send(command: { input: { Key: string; Body?: string } }) {
      if (command instanceof PutObjectCommand) {
        if (command.input.Key.includes("write-fails")) {
          throw new Error("s3 down");
        }
        store.set(command.input.Key, command.input.Body!);
        return {};
      }
      const body = store.get(command.input.Key);
      if (body === undefined) {
        const err = new Error("no such key");
        (err as { name: string }).name = "NoSuchKey";
        throw err;
      }
      return { Body: { transformToString: async () => body } };
    }
  }
  return { S3Client, GetObjectCommand, PutObjectCommand };
});

vi.mock("../../graphql/utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    }),
  },
  eq: vi.fn(),
  and: vi.fn(),
  agents: {},
  tenants: {},
}));

import {
  assignmentStateKey,
  patchSkillAssignmentState,
  readSkillAssignmentState,
  readSkillAssignmentStates,
} from "./assignment-state.js";

const PREFIX = "tenants/acme/agents/ada/";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  mockGetConfig.mockReturnValue("workspace-bucket");
});

describe("assignment-state file store", () => {
  it("writes beside the skill folder and reads back", async () => {
    const ok = await patchSkillAssignmentState({
      agentId: "agent-1",
      slug: "google-email",
      targetPrefix: PREFIX,
      patch: {
        configMerge: { connectionId: "conn-1", tokenEnvVar: "GMAIL" },
        enabled: true,
      },
    });
    expect(ok).toBe(true);
    expect(store.has(assignmentStateKey(PREFIX, "google-email"))).toBe(true);
    const state = await readSkillAssignmentState(PREFIX, "google-email");
    expect(state).toMatchObject({
      slug: "google-email",
      enabled: true,
      config: { connectionId: "conn-1", tokenEnvVar: "GMAIL" },
    });
    expect(state?.updated_at).toBeTruthy();
  });

  it("merge-patches config over the existing file (agent_skills merge semantics)", async () => {
    await patchSkillAssignmentState({
      agentId: "agent-1",
      slug: "google-email",
      targetPrefix: PREFIX,
      patch: { configMerge: { connectionId: "conn-1" } },
    });
    await patchSkillAssignmentState({
      agentId: "agent-1",
      slug: "google-email",
      targetPrefix: PREFIX,
      patch: { configMerge: { secretRef: "arn:secret" } },
    });
    const state = await readSkillAssignmentState(PREFIX, "google-email");
    expect(state?.config).toEqual({
      connectionId: "conn-1",
      secretRef: "arn:secret",
    });
  });

  it("replace mode drops prior state (snapshot restore semantics)", async () => {
    await patchSkillAssignmentState({
      agentId: "agent-1",
      slug: "s",
      targetPrefix: PREFIX,
      patch: { configMerge: { old: true } },
    });
    await patchSkillAssignmentState({
      agentId: "agent-1",
      slug: "s",
      targetPrefix: PREFIX,
      patch: {
        replace: true,
        permissions: { operations: ["createAgent"] },
        enabled: false,
      },
    });
    const state = await readSkillAssignmentState(PREFIX, "s");
    expect(state?.config).toBeUndefined();
    expect(state?.permissions).toEqual({ operations: ["createAgent"] });
    expect(state?.enabled).toBe(false);
  });

  it("never throws on write failure — logs and returns false", async () => {
    const ok = await patchSkillAssignmentState({
      agentId: "agent-1",
      slug: "write-fails",
      targetPrefix: PREFIX,
      patch: { enabled: false },
    });
    expect(ok).toBe(false);
  });

  it("reads fail soft: absent file → null; batch read omits absentees", async () => {
    expect(await readSkillAssignmentState(PREFIX, "missing")).toBeNull();
    await patchSkillAssignmentState({
      agentId: "agent-1",
      slug: "present",
      targetPrefix: PREFIX,
      patch: { enabled: true },
    });
    const states = await readSkillAssignmentStates(PREFIX, [
      "present",
      "missing",
    ]);
    expect([...states.keys()]).toEqual(["present"]);
  });

  it("no-ops (false) when WORKSPACE_BUCKET is unconfigured", async () => {
    mockGetConfig.mockReturnValue("");
    expect(
      await patchSkillAssignmentState({
        agentId: "agent-1",
        slug: "s",
        targetPrefix: PREFIX,
        patch: { enabled: true },
      }),
    ).toBe(false);
    expect(await readSkillAssignmentState(PREFIX, "s")).toBeNull();
  });
});

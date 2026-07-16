import { describe, it, expect } from "vitest";
import {
  resolveRunAsTargetMembership,
  resolveRunAsAuthzInputs,
  type RunAsFactReaders,
} from "./run-as-facts.js";

/** Fake readers with per-call recording so we can assert lazy reads. */
function fakeReaders(
  overrides: Partial<RunAsFactReaders> & {
    operators?: Set<string>;
    members?: Set<string>;
    spaceMode?: Record<string, "public" | "private">;
    spaceMembers?: Set<string>;
  } = {},
): { readers: RunAsFactReaders; calls: string[] } {
  const calls: string[] = [];
  const readers: RunAsFactReaders = {
    async isTenantOperator(tenantId, userId) {
      calls.push(`op:${tenantId}:${userId}`);
      return overrides.operators?.has(userId) ?? false;
    },
    async isActiveTenantMember(tenantId, userId) {
      calls.push(`member:${tenantId}:${userId}`);
      return overrides.members?.has(userId) ?? false;
    },
    async spaceAccessMode(spaceId) {
      calls.push(`space:${spaceId}`);
      return overrides.spaceMode?.[spaceId] ?? "public";
    },
    async isSpaceMember(spaceId, userId) {
      calls.push(`spaceMember:${spaceId}:${userId}`);
      return overrides.spaceMembers?.has(`${spaceId}:${userId}`) ?? false;
    },
  };
  return { readers, calls };
}

describe("resolveRunAsTargetMembership", () => {
  it("no space → membership only, no space reads", async () => {
    const { readers, calls } = fakeReaders({ members: new Set(["u1"]) });
    const t = await resolveRunAsTargetMembership(readers, {
      tenantId: "t1",
      runAsUserId: "u1",
      spaceId: null,
    });
    expect(t).toEqual({
      isActiveTenantMember: true,
      runInSpaceIsPrivate: false,
      isRunInSpaceMember: false,
    });
    expect(calls.some((c) => c.startsWith("space:"))).toBe(false);
  });

  it("public space → private=false and the membership read is skipped", async () => {
    const { readers, calls } = fakeReaders({
      members: new Set(["u1"]),
      spaceMode: { s1: "public" },
    });
    const t = await resolveRunAsTargetMembership(readers, {
      tenantId: "t1",
      runAsUserId: "u1",
      spaceId: "s1",
    });
    expect(t.runInSpaceIsPrivate).toBe(false);
    expect(t.isRunInSpaceMember).toBe(false);
    expect(calls.some((c) => c.startsWith("spaceMember:"))).toBe(false);
  });

  it("private space → resolves space membership", async () => {
    const { readers } = fakeReaders({
      members: new Set(["u1"]),
      spaceMode: { s1: "private" },
      spaceMembers: new Set(["s1:u1"]),
    });
    const t = await resolveRunAsTargetMembership(readers, {
      tenantId: "t1",
      runAsUserId: "u1",
      spaceId: "s1",
    });
    expect(t).toEqual({
      isActiveTenantMember: true,
      runInSpaceIsPrivate: true,
      isRunInSpaceMember: true,
    });
  });
});

describe("resolveRunAsAuthzInputs", () => {
  it("null run-as → actor only, no target reads", async () => {
    const { readers, calls } = fakeReaders({ operators: new Set(["actor"]) });
    const r = await resolveRunAsAuthzInputs(readers, {
      tenantId: "t1",
      actorUserId: "actor",
      runAsUserId: null,
      spaceId: "s1",
    });
    expect(r.actor).toEqual({ userId: "actor", isTenantOperator: true });
    expect(r.target).toBeUndefined();
    expect(calls.some((c) => c.startsWith("member:"))).toBe(false);
  });

  it("non-null run-as → actor operator-ness + target facts", async () => {
    const { readers } = fakeReaders({
      operators: new Set(["actor"]),
      members: new Set(["target"]),
      spaceMode: { s1: "private" },
      spaceMembers: new Set(["s1:target"]),
    });
    const r = await resolveRunAsAuthzInputs(readers, {
      tenantId: "t1",
      actorUserId: "actor",
      runAsUserId: "target",
      spaceId: "s1",
    });
    expect(r.actor.isTenantOperator).toBe(true);
    expect(r.target).toEqual({
      isActiveTenantMember: true,
      runInSpaceIsPrivate: true,
      isRunInSpaceMember: true,
    });
  });
});

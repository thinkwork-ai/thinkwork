import { describe, expect, it } from "vitest";
import {
  assertSpaceAccessAllowed,
  spaceTriggerServiceIdentity,
  type SpaceMembershipRepository,
} from "./space-membership-check.js";

class FakeMembershipRepository implements SpaceMembershipRepository {
  constructor(private readonly memberUserIds: string[]) {}

  async isSpaceMember(input: { userId: string }): Promise<boolean> {
    return this.memberUserIds.includes(input.userId);
  }
}

const BASE_INPUT = {
  tenantId: "tenant-1",
  spaceId: "space-1",
  spaceSlug: "finance",
};

describe("assertSpaceAccessAllowed", () => {
  it("allows public Spaces without a membership lookup", async () => {
    await expect(
      assertSpaceAccessAllowed(
        { ...BASE_INPUT, accessMode: "public", invokingUserId: null },
        new FakeMembershipRepository([]),
      ),
    ).resolves.toBeUndefined();
  });

  it("allows private Spaces for a member user", async () => {
    await expect(
      assertSpaceAccessAllowed(
        { ...BASE_INPUT, accessMode: "private", invokingUserId: "user-1" },
        new FakeMembershipRepository(["user-1"]),
      ),
    ).resolves.toBeUndefined();
  });

  it("denies private Spaces for a non-member user", async () => {
    await expect(
      assertSpaceAccessAllowed(
        { ...BASE_INPUT, accessMode: "private", invokingUserId: "user-2" },
        new FakeMembershipRepository(["user-1"]),
      ),
    ).rejects.toMatchObject({ code: "SpaceAccessDenied" });
  });

  it("denies private Spaces when no actor identity is present", async () => {
    await expect(
      assertSpaceAccessAllowed(
        { ...BASE_INPUT, accessMode: "private", invokingUserId: null },
        new FakeMembershipRepository(["user-1"]),
      ),
    ).rejects.toMatchObject({ code: "SpaceAccessDenied" });
  });

  it("allows private Spaces for the matching Space trigger service identity", async () => {
    await expect(
      assertSpaceAccessAllowed(
        {
          ...BASE_INPUT,
          accessMode: "private",
          invokingUserId: null,
          invokingServiceIdentity: spaceTriggerServiceIdentity(BASE_INPUT),
        },
        new FakeMembershipRepository([]),
      ),
    ).resolves.toBeUndefined();
  });

  it("denies private Spaces for service identities scoped to another Space", async () => {
    await expect(
      assertSpaceAccessAllowed(
        {
          ...BASE_INPUT,
          accessMode: "private",
          invokingUserId: null,
          invokingServiceIdentity: spaceTriggerServiceIdentity({
            tenantId: "tenant-1",
            spaceId: "space-2",
          }),
        },
        new FakeMembershipRepository([]),
      ),
    ).rejects.toMatchObject({ code: "SpaceAccessDenied" });
  });
});

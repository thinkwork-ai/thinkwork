import { describe, expect, it } from "vitest";
import {
  assertSpaceAccessAllowed,
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

  it("allows private Spaces for an authorized service identity", async () => {
    await expect(
      assertSpaceAccessAllowed(
        {
          ...BASE_INPUT,
          accessMode: "private",
          invokingUserId: null,
          invokingServiceIdentity: "service-user-1",
        },
        new FakeMembershipRepository(["service-user-1"]),
      ),
    ).resolves.toBeUndefined();
  });
});

import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { spaceMembers } from "@thinkwork/database-pg/schema";
import { WorkspaceRenderError } from "./types.js";

export interface SpaceMembershipRepository {
  isSpaceMember(input: {
    tenantId: string;
    spaceId: string;
    userId: string;
  }): Promise<boolean>;
}

export interface SpaceAccessCheckInput {
  tenantId: string;
  spaceId: string;
  spaceSlug: string;
  accessMode: string;
  invokingUserId?: string | null;
  invokingServiceIdentity?: string | null;
}

export class SpaceAccessDeniedError extends WorkspaceRenderError {
  constructor(spaceSlug: string) {
    super(
      "SpaceAccessDenied",
      `Access to private Space '${spaceSlug}' is denied for this invocation.`,
    );
    this.name = "SpaceAccessDeniedError";
  }
}

export class DrizzleSpaceMembershipRepository implements SpaceMembershipRepository {
  private readonly db = getDb();

  async isSpaceMember(input: {
    tenantId: string;
    spaceId: string;
    userId: string;
  }): Promise<boolean> {
    const [member] = await this.db
      .select({ id: spaceMembers.id })
      .from(spaceMembers)
      .where(
        and(
          eq(spaceMembers.tenant_id, input.tenantId),
          eq(spaceMembers.space_id, input.spaceId),
          eq(spaceMembers.user_id, input.userId),
        ),
      );
    return Boolean(member);
  }
}

export async function assertSpaceAccessAllowed(
  input: SpaceAccessCheckInput,
  repository: SpaceMembershipRepository = new DrizzleSpaceMembershipRepository(),
): Promise<void> {
  if (input.accessMode !== "private") return;

  const actorId = input.invokingUserId ?? input.invokingServiceIdentity ?? null;
  if (!actorId) throw new SpaceAccessDeniedError(input.spaceSlug);

  if (
    !(await repository.isSpaceMember({
      tenantId: input.tenantId,
      spaceId: input.spaceId,
      userId: actorId,
    }))
  ) {
    throw new SpaceAccessDeniedError(input.spaceSlug);
  }
}

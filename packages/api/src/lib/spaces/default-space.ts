import { and, db, eq, spaceMembers, spaces } from "../../graphql/utils.js";

export const DEFAULT_THREADS_SPACE_SLUG = "general";

export interface DefaultThreadSpace {
  id: string;
  tenant_id: string;
  status: string;
}

export async function ensureDefaultThreadSpace(input: {
  tenantId: string;
  userId?: string | null;
}): Promise<DefaultThreadSpace> {
  const [space] = await db
    .insert(spaces)
    .values({
      tenant_id: input.tenantId,
      slug: DEFAULT_THREADS_SPACE_SLUG,
      name: "General",
      description:
        "Default Space for conversations that are not part of a configured workflow.",
      prompt:
        "Use this Space for general collaboration, ad hoc questions, and Threads that do not belong to a specialized workflow.",
      status: "active",
      kind: "custom",
      template_key: "general",
      config: {
        workflow: "general",
        version: 1,
        source: "api_default",
      },
    })
    .onConflictDoUpdate({
      target: [spaces.tenant_id, spaces.slug],
      set: {
        status: "active",
        updated_at: new Date(),
      },
    })
    .returning({
      id: spaces.id,
      tenant_id: spaces.tenant_id,
      status: spaces.status,
    });

  if (!space) {
    const [existing] = await db
      .select({
        id: spaces.id,
        tenant_id: spaces.tenant_id,
        status: spaces.status,
      })
      .from(spaces)
      .where(
        and(
          eq(spaces.tenant_id, input.tenantId),
          eq(spaces.slug, DEFAULT_THREADS_SPACE_SLUG),
        ),
      );
    if (!existing) throw new Error("Default Space could not be resolved");
    return existing;
  }

  if (input.userId) {
    await db
      .insert(spaceMembers)
      .values({
        tenant_id: input.tenantId,
        space_id: space.id,
        user_id: input.userId,
        role: "member",
        notification_preference: "subscribed",
      })
      .onConflictDoNothing();
  }

  return space;
}

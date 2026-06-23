import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  spaceMembers,
  spaces,
  tenants,
  threads,
  threadParticipants,
} from "../../graphql/utils.js";
import { workspaceFolderName } from "@thinkwork/database-pg/utils/workspace-folder-name";
import {
  AUTOMATION_BUILDER_SPACE_SLUG,
  AUTOMATION_BUILDER_SPACE_TEMPLATE_KEY,
} from "./automation-builder-constants.js";

export { AUTOMATION_BUILDER_SPACE_SLUG, AUTOMATION_BUILDER_SPACE_TEMPLATE_KEY };

export interface AutomationBuilderSpace {
  id: string;
  tenant_id: string;
  status: string;
}

export interface AutomationBuilderThread {
  threadId: string;
  identifier: string;
  number: number;
  spaceId: string;
}

export async function ensureAutomationBuilderSpace(input: {
  tenantId: string;
}): Promise<AutomationBuilderSpace> {
  const values = automationBuilderSpaceValues(input.tenantId);
  const [space] = await db
    .insert(spaces)
    .values(values)
    .onConflictDoUpdate({
      target: [spaces.tenant_id, spaces.slug],
      set: {
        status: "active",
        access_mode: "private",
        template_key: AUTOMATION_BUILDER_SPACE_TEMPLATE_KEY,
        config: values.config,
        updated_at: new Date(),
      },
    })
    .returning({
      id: spaces.id,
      tenant_id: spaces.tenant_id,
      status: spaces.status,
    });

  if (space) {
    await removeBuilderSpaceMembers({
      tenantId: input.tenantId,
      spaceId: space.id,
    });
    return space;
  }

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
        eq(spaces.slug, AUTOMATION_BUILDER_SPACE_SLUG),
      ),
    )
    .limit(1);
  if (!existing) {
    throw new Error("Automation Builder Space could not be resolved");
  }
  await removeBuilderSpaceMembers({
    tenantId: input.tenantId,
    spaceId: existing.id,
  });
  return existing;
}

export async function createAutomationBuilderThread(input: {
  tenantId: string;
  userId: string;
  title?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<AutomationBuilderThread> {
  const builderSpace = await ensureAutomationBuilderSpace({
    tenantId: input.tenantId,
  });
  const [tenant] = await db
    .update(tenants)
    .set({ issue_counter: sql`${tenants.issue_counter} + 1` })
    .where(eq(tenants.id, input.tenantId))
    .returning({ next_number: sql<number>`${tenants.issue_counter}` });
  if (!tenant) throw new Error("Tenant not found");

  const number = tenant.next_number;
  const identifier = `AUTO-BUILD-${number}`;
  const title = input.title?.trim() || "Automation setup";
  const existingThreads = await db
    .select({
      id: threads.id,
      workspaceFolderName: threads.workspace_folder_name,
    })
    .from(threads)
    .where(eq(threads.tenant_id, input.tenantId));

  const [thread] = await db
    .insert(threads)
    .values({
      tenant_id: input.tenantId,
      space_id: builderSpace.id,
      user_id: input.userId,
      number,
      identifier,
      title,
      workspace_folder_name: workspaceFolderName(
        title,
        existingThreads.map((row) => row.workspaceFolderName ?? row.id),
        "thread",
      ),
      status: "in_progress",
      channel: "chat",
      metadata: {
        ...input.metadata,
        systemHidden: true,
        visibility: "system_hidden",
        purpose: "automation_builder",
        creationMode: "chat",
        builderSessionId: randomUUID(),
      },
      created_by_type: "user",
      created_by_id: input.userId,
    })
    .returning({ id: threads.id });

  await db
    .insert(threadParticipants)
    .values({
      tenant_id: input.tenantId,
      thread_id: thread.id,
      space_id: builderSpace.id,
      participant_type: "user",
      user_id: input.userId,
      role: "requester",
      source: "automation_builder",
      notification_preference: "subscribed",
    })
    .onConflictDoNothing();

  return { threadId: thread.id, identifier, number, spaceId: builderSpace.id };
}

function automationBuilderSpaceValues(tenantId: string) {
  return {
    tenant_id: tenantId,
    slug: AUTOMATION_BUILDER_SPACE_SLUG,
    workspace_folder_name: AUTOMATION_BUILDER_SPACE_SLUG,
    name: "Automation Builder",
    description:
      "System-managed Space for guided Automation setup conversations.",
    prompt:
      "Use this private system Space for Automation setup conversations only.",
    status: "active",
    kind: "custom",
    access_mode: "private",
    icon: "bot",
    category: "system",
    template_key: AUTOMATION_BUILDER_SPACE_TEMPLATE_KEY,
    config: {
      visibility: "system_hidden",
      purpose: "automation_builder",
      workflow: "automation_builder",
      version: 1,
      source: "automation_builder_thread_helper",
    },
  };
}

async function removeBuilderSpaceMembers(input: {
  tenantId: string;
  spaceId: string;
}) {
  await db
    .delete(spaceMembers)
    .where(
      and(
        eq(spaceMembers.tenant_id, input.tenantId),
        eq(spaceMembers.space_id, input.spaceId),
      ),
    );
}

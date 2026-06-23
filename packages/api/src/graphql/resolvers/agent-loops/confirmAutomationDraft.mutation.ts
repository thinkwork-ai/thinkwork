import type { GraphQLContext } from "../../context.js";
import {
  and,
  db,
  eq,
  messages,
  threadParticipants,
  threads,
} from "../../utils.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { parseAwsJsonObject, requireAgentLoopAdmin } from "./types.js";
import { saveAgentLoop } from "./saveAgentLoop.mutation.js";

type SaveAgentLoopInput = Parameters<typeof saveAgentLoop>[1]["input"];

type ConfirmAutomationDraftInput = {
  builderThreadId: string;
  input: SaveAgentLoopInput;
};

export async function confirmAutomationDraft(
  _parent: unknown,
  args: { input: ConfirmAutomationDraftInput },
  ctx: GraphQLContext,
): Promise<unknown> {
  const tenantId = args.input.input.tenantId;
  await requireAgentLoopAdmin(ctx, tenantId, "confirm_automation_draft");
  const userId = await resolveCallerUserId(ctx);
  if (!userId) {
    throw new Error("Requester user identity required");
  }
  const builderThread = await loadBuilderThread({
    tenantId,
    threadId: args.input.builderThreadId,
    userId,
  });

  const sourceMetadata = {
    ...parseAwsJsonObject(args.input.input.sourceMetadata),
    createdFrom: "settings.automations.chat",
    creationMode: "chat",
    builderThreadId: builderThread.id,
    designerSkill: "automation-loop-designer",
  };
  const saved = (await saveAgentLoop(
    _parent,
    {
      input: {
        ...args.input.input,
        sourceMetadata,
      },
    },
    ctx,
  )) as { id?: string };

  const metadata = {
    ...jsonRecord(builderThread.metadata),
    agentLoopId: saved.id ?? null,
    draftConfirmedAt: new Date().toISOString(),
  };
  await db
    .update(threads)
    .set({ metadata, updated_at: new Date() })
    .where(eq(threads.id, builderThread.id));

  await db.insert(messages).values({
    tenant_id: tenantId,
    thread_id: builderThread.id,
    role: "assistant",
    content: "Automation draft confirmed and saved.",
    sender_type: "system",
    metadata: {
      purpose: "automation_builder",
      messageKind: "draft_confirmed",
      agentLoopId: saved.id ?? null,
    },
  });

  return saved;
}

async function loadBuilderThread(input: {
  tenantId: string;
  threadId: string;
  userId: string;
}) {
  const [thread] = await db
    .select({
      id: threads.id,
      tenant_id: threads.tenant_id,
      metadata: threads.metadata,
    })
    .from(threads)
    .where(
      and(
        eq(threads.tenant_id, input.tenantId),
        eq(threads.id, input.threadId),
      ),
    )
    .limit(1);
  if (!thread) throw new Error("Automation builder thread not found");
  const metadata = jsonRecord(thread.metadata);
  if (metadata.purpose !== "automation_builder") {
    throw new Error("Thread is not an Automation builder thread");
  }
  const [participant] = await db
    .select({ id: threadParticipants.id })
    .from(threadParticipants)
    .where(
      and(
        eq(threadParticipants.tenant_id, input.tenantId),
        eq(threadParticipants.thread_id, input.threadId),
        eq(threadParticipants.user_id, input.userId),
      ),
    )
    .limit(1);
  if (!participant) {
    throw new Error("Automation builder thread access required");
  }
  return thread;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

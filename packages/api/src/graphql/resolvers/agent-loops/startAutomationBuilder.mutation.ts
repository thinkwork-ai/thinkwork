import type { GraphQLContext } from "../../context.js";
import {
  and,
  db,
  eq,
  messages,
  threadParticipants,
  threads,
  threadToCamel,
} from "../../utils.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import {
  buildAutomationBuilderDraft,
  buildAutomationBuilderOpeningMessage,
} from "../../../lib/agent-loops/automation-builder.js";
import {
  createAutomationBuilderThread,
  ensureAutomationBuilderSpace,
} from "../../../lib/agent-loops/automation-builder-threads.js";
import { requireAgentLoopAdmin } from "./types.js";

type StartAutomationBuilderInput = {
  tenantId: string;
  builderThreadId?: string | null;
  title?: string | null;
  prompt?: string | null;
};

export async function startAutomationBuilder(
  _parent: unknown,
  args: { input: StartAutomationBuilderInput },
  ctx: GraphQLContext,
): Promise<unknown> {
  const input = args.input;
  await requireAgentLoopAdmin(ctx, input.tenantId, "start_automation_builder");
  const userId = await resolveCallerUserId(ctx);
  if (!userId) {
    throw new Error("Requester user identity required");
  }

  const prompt = stringValue(input.prompt);
  const title = stringValue(input.title) || titleFromPrompt(prompt);
  const builder = input.builderThreadId
    ? {
        ...(await assertBuilderThread({
          tenantId: input.tenantId,
          threadId: input.builderThreadId,
          userId,
        })),
        threadCreated: false,
      }
    : {
        ...(await createAutomationBuilderThread({
          tenantId: input.tenantId,
          userId,
          title: title || "Automation setup",
          metadata: {
            prompt,
            designerSkill: "automation-loop-designer",
          },
        })),
        threadCreated: true,
      };

  if (builder.threadCreated) {
    await seedBuilderThread({
      tenantId: input.tenantId,
      threadId: builder.threadId,
      prompt,
    });
  }

  const thread = await loadBuilderThread({
    tenantId: input.tenantId,
    threadId: builder.threadId,
  });
  const setupPrompt = buildAutomationBuilderOpeningMessage({ prompt });
  const draft = buildAutomationBuilderDraft({
    builderThreadId: builder.threadId,
    prompt,
    title,
  });

  return {
    thread: threadToCamel(thread),
    threadCreated: builder.threadCreated,
    setupPrompt,
    draft,
  };
}

async function seedBuilderThread(input: {
  tenantId: string;
  threadId: string;
  prompt: string;
}) {
  const setupPrompt = buildAutomationBuilderOpeningMessage({
    prompt: input.prompt,
  });
  await db.insert(messages).values({
    tenant_id: input.tenantId,
    thread_id: input.threadId,
    role: "assistant",
    content: setupPrompt,
    sender_type: "system",
    metadata: {
      purpose: "automation_builder",
      designerSkill: "automation-loop-designer",
      messageKind: "builder_opening",
    },
  });
  await db
    .update(threads)
    .set({
      last_response_preview: setupPrompt.slice(0, 240),
      updated_at: new Date(),
    })
    .where(eq(threads.id, input.threadId));
}

async function assertBuilderThread(input: {
  tenantId: string;
  threadId: string;
  userId: string;
}) {
  const [thread] = await db
    .select({
      id: threads.id,
      tenant_id: threads.tenant_id,
      space_id: threads.space_id,
      metadata: threads.metadata,
    })
    .from(threads)
    .where(eq(threads.id, input.threadId))
    .limit(1);
  if (!thread || thread.tenant_id !== input.tenantId) {
    throw new Error("Automation builder thread not found");
  }
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
  await ensureAutomationBuilderSpace({ tenantId: input.tenantId });
  return {
    threadId: thread.id,
    spaceId: thread.space_id,
  };
}

async function loadBuilderThread(input: {
  tenantId: string;
  threadId: string;
}) {
  const [thread] = await db
    .select()
    .from(threads)
    .where(
      and(
        eq(threads.tenant_id, input.tenantId),
        eq(threads.id, input.threadId),
      ),
    )
    .limit(1);
  if (!thread)
    throw new Error("Automation builder thread not found after start");
  return thread;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function titleFromPrompt(prompt: string): string {
  if (!prompt) return "";
  return (
    prompt
      .split(/\r?\n/)[0]
      ?.split(/\s+/)
      .filter(Boolean)
      .slice(0, 8)
      .join(" ")
      .replace(/[.?!,:;]+$/g, "") ?? ""
  );
}

function stringValue(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

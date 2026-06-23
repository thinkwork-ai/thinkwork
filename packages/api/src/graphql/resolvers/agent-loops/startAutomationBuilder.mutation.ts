import { randomUUID } from "node:crypto";
import type { GraphQLContext } from "../../context.js";
import {
  and,
  db,
  eq,
  messages,
  threadTurns,
  threadParticipants,
  threads,
  threadToCamel,
} from "../../utils.js";
import { pendingUserQuestions } from "@thinkwork/database-pg/schema";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import {
  buildAutomationBuilderDraft,
  buildAutomationBuilderIntroMessage,
  buildAutomationBuilderOpeningMessage,
  buildAutomationBuilderQuestions,
} from "../../../lib/agent-loops/automation-builder.js";
import {
  renderQuestionMarkdown,
  userQuestionPart,
  validateQuestionBatch,
  type UserQuestionInput,
} from "../../../lib/user-questions/question-message.js";
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
  const intro = buildAutomationBuilderIntroMessage({ prompt: input.prompt });
  const questions = buildAutomationBuilderQuestions();
  assertBuilderQuestions(questions);
  const questionId = randomUUID();

  await db.transaction(async (tx) => {
    const [turn] = await tx
      .insert(threadTurns)
      .values({
        tenant_id: input.tenantId,
        thread_id: input.threadId,
        invocation_source: "automation_builder",
        trigger_detail: "builder_opening_question",
        status: "succeeded",
        runtime_type: "automation_builder",
        started_at: new Date(),
        finished_at: new Date(),
        result_json: {
          purpose: "automation_builder",
          messageKind: "builder_opening",
        },
      })
      .returning({ id: threadTurns.id });

    const [message] = await tx
      .insert(messages)
      .values({
        tenant_id: input.tenantId,
        thread_id: input.threadId,
        role: "assistant",
        content: setupPrompt,
        parts: [
          {
            type: "text",
            id: "automation-builder-intro",
            text: intro,
          },
          userQuestionPart(questionId, questions),
        ],
        sender_type: "system",
        metadata: {
          purpose: "automation_builder",
          designerSkill: "automation-loop-designer",
          messageKind: "builder_opening",
        },
      })
      .returning({ id: messages.id });

    await tx.insert(pendingUserQuestions).values({
      id: questionId,
      tenant_id: input.tenantId,
      thread_id: input.threadId,
      message_id: message.id,
      thread_turn_id: turn.id,
      status: "pending",
      questions,
      delegation_context: {
        purpose: "automation_builder",
        designerSkill: "automation-loop-designer",
      },
    });
  });

  await db
    .update(threads)
    .set({
      last_response_preview: intro.slice(0, 240),
      updated_at: new Date(),
    })
    .where(eq(threads.id, input.threadId));
}

function assertBuilderQuestions(questions: UserQuestionInput[]) {
  const validationError = validateQuestionBatch(questions, null);
  if (validationError) {
    throw new Error(`Invalid Automation builder questions: ${validationError}`);
  }
  if (!renderQuestionMarkdown(questions)) {
    throw new Error("Automation builder questions did not render");
  }
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

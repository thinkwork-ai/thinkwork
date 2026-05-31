import { randomUUID } from "node:crypto";
import type { GraphQLContext } from "../../context.js";
import { GraphQLError } from "graphql";
import {
  db,
  and,
  eq,
  sql,
  agents,
  tenants,
  threads,
  messages,
  messageMentions,
  spaces,
  threadTurns,
  threadTurnEvents,
  threadParticipants,
  threadToCamel,
} from "../../utils.js";
import { notifyThreadUpdate } from "../../notify.js";
import {
  notifyNewMessage,
  notifyThreadTurnUpdate,
} from "../../../lib/chat-finalize/notify.js";
import { requireTenantMember } from "../core/authz.js";
import { resolveCallerFromAuth } from "../core/resolve-auth-user.js";
import { ensureDefaultThreadSpace } from "../../../lib/spaces/default-space.js";
import { dispatchAgentMentions } from "../../../lib/mentions/dispatch-agent-mentions.js";
import { dispatchDefaultAgentTurn } from "../../../lib/mentions/default-agent-routing.js";
import { parseMessageMentions } from "../../../lib/mentions/parse-message-mentions.js";
import {
  insertMentionParticipants,
  toThreadParticipantInsert,
} from "../../../lib/mentions/thread-participant-mentions.js";
import { loadThreadMentionTargets } from "../../../lib/mentions/thread-mention-targets.js";
import { canPostToSpace } from "../spaces/shared.js";
import {
  PlatformAgentNotFoundError,
  resolveTenantPlatformAgent,
} from "../../../lib/agents/tenant-platform-agent.js";
import {
  CUSTOMER_ONBOARDING_TEMPLATE_KEY,
  CustomerOnboardingWorkflowError,
  startCustomerOnboardingWorkflow,
} from "../../../lib/spaces/customer-onboarding-workflow.js";
import {
  MOBILE_PI_INVOCATION_SOURCE,
  MOBILE_PI_RUNTIME_TYPE,
} from "../../../lib/mobile-turns/lifecycle.js";

function parseJsonArray(value: unknown): Record<string, unknown>[] {
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return [];
  }
  return Array.isArray(parsed)
    ? parsed.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

export const createThread = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const i = args.input;

  // Tenant gate. Cognito callers must belong to the target tenant — without
  // this, an authenticated user holding a JWT for tenant A could supply
  // i.tenantId = tenant B and create threads in B's namespace. Closes the
  // F5 P0 from #959 review. apikey callers are pre-authorized service
  // identities (agentcore runtime, schedulers); they are validated by the
  // shared API secret and may legitimately create threads across tenants.
  if (ctx.auth.authType === "cognito") {
    await requireTenantMember(ctx, i.tenantId);
  }

  const createdByType = i.createdByType ?? "user";
  const createdById =
    createdByType === "user"
      ? ((await resolveCallerFromAuth(ctx.auth)).userId ?? i.createdById)
      : i.createdById;
  if (createdByType === "user" && !createdById) {
    throw new GraphQLError("Requester user identity required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  let threadSpace: {
    id: string;
    tenant_id: string;
    name?: string;
    status: string;
    kind?: string;
    template_key?: string | null;
    config?: unknown;
  };
  if (!i.spaceId) {
    threadSpace = await ensureDefaultThreadSpace({
      tenantId: i.tenantId,
      userId: createdByType === "user" ? createdById : null,
    });
  } else {
    const [spaceRow] = await db
      .select({
        id: spaces.id,
        tenant_id: spaces.tenant_id,
        name: spaces.name,
        status: spaces.status,
        kind: spaces.kind,
        template_key: spaces.template_key,
        config: spaces.config,
      })
      .from(spaces)
      .where(eq(spaces.id, i.spaceId));
    if (
      !spaceRow ||
      spaceRow.tenant_id !== i.tenantId ||
      spaceRow.status !== "active"
    ) {
      throw new GraphQLError("Space not found", {
        extensions: { code: "NOT_FOUND" },
      });
    }
    threadSpace = spaceRow;
  }
  if (
    ctx.auth.authType === "cognito" &&
    !(await canPostToSpace(ctx, i.tenantId, threadSpace.id))
  ) {
    throw new GraphQLError("Space access required", {
      extensions: { code: "FORBIDDEN" },
    });
  }

  if (isCustomerOnboardingSpace(threadSpace)) {
    return createCustomerOnboardingThreadFromSpaceTrigger({
      input: i,
      space: threadSpace,
      createdByType,
      createdById,
    });
  }

  const threadAgentId =
    i.agentId ?? (await resolveDefaultThreadAgentId(i.tenantId));

  // PRD-09 §9.4.4: Agent-created thread validation
  if (createdByType === "agent" && createdById) {
    const [creatorAgent] = await db
      .select({ tenant_id: agents.tenant_id })
      .from(agents)
      .where(eq(agents.id, createdById));
    if (!creatorAgent || creatorAgent.tenant_id !== i.tenantId) {
      throw new Error("Agent can only create threads in its own tenant");
    }
  }

  const channel = (i.channel?.toLowerCase() ?? "manual") as string;
  const CHANNEL_PREFIX: Record<string, string> = {
    schedule: "AUTO",
    email: "EMAIL",
    chat: "CHAT",
    manual: "TICK",
    webhook: "HOOK",
    api: "API",
  };
  const prefix = CHANNEL_PREFIX[channel] || "TICK";
  const initialStatus =
    channel === "chat" || channel === "schedule" ? "in_progress" : "backlog";

  // Atomic: counter bump + thread insert + optional first user message or
  // mobile Pi turn seed. Keeps hosts from needing a two-round-trip
  // create-then-send and prevents orphan threads if the message insert fails.
  const mobileTurnClientId =
    typeof i.mobileTurnClientId === "string" && i.mobileTurnClientId.trim()
      ? i.mobileTurnClientId.trim()
      : null;
  const mobileTurnUserText =
    typeof i.mobileTurnUserText === "string" && i.mobileTurnUserText.trim()
      ? i.mobileTurnUserText.trim()
      : null;
  const shouldSeedMobileTurn = Boolean(
    mobileTurnClientId && mobileTurnUserText,
  );
  if (shouldSeedMobileTurn && !threadAgentId) {
    throw new GraphQLError("agentId is required for mobile Pi turns", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  const openingMessageCreatedAt =
    i.firstMessage || shouldSeedMobileTurn ? new Date() : null;
  const { row, firstMessageId, mobileTurn } = await db.transaction(async (tx) => {
    const [tenant] = await tx
      .update(tenants)
      .set({
        issue_counter: sql`${tenants.issue_counter} + 1`,
      })
      .where(eq(tenants.id, i.tenantId))
      .returning({
        next_number: sql<number>`${tenants.issue_counter}`,
      });
    if (!tenant) throw new Error("Tenant not found");
    const nextNumber = tenant.next_number;
    const identifier = `${prefix}-${nextNumber}`;

    // Mirror sendMessage's auto-title logic so the atomic path matches the
    // two-step flow when callers leave title as "Untitled conversation".
    let effectiveTitle = i.title;
    if (i.firstMessage && i.title === "Untitled conversation") {
      const raw = i.firstMessage.trim();
      effectiveTitle =
        raw.length <= 80 ? raw : raw.substring(0, 80).replace(/\s+\S*$/, "...");
    }

    const [threadRow] = await tx
      .insert(threads)
      .values({
        tenant_id: i.tenantId,
        agent_id: threadAgentId ?? undefined,
        space_id: threadSpace.id,
        user_id: createdByType === "user" ? createdById : undefined,
        number: nextNumber,
        identifier,
        title: effectiveTitle,
        status: initialStatus,
        channel,
        assignee_type: i.assigneeType,
        assignee_id: i.assigneeId,
        billing_code: i.billingCode,
        created_by_type: createdByType,
        created_by_id: createdById,
        labels: i.labels ? JSON.parse(i.labels) : undefined,
        metadata: i.metadata ? JSON.parse(i.metadata) : undefined,
        due_at: i.dueAt ? new Date(i.dueAt) : undefined,
        created_at: openingMessageCreatedAt ?? undefined,
        updated_at: openingMessageCreatedAt ?? undefined,
      })
      .returning();

    const participantRows: (typeof threadParticipants.$inferInsert)[] = [];
    if (createdByType === "user" && createdById) {
      participantRows.push({
        tenant_id: i.tenantId,
        thread_id: threadRow.id,
        space_id: threadSpace.id,
        participant_type: "user",
        user_id: createdById,
        role: "requester",
        source: "thread_creator",
        last_read_at: openingMessageCreatedAt ?? undefined,
      });
    }

    if (participantRows.length > 0) {
      await tx.insert(threadParticipants).values(participantRows);
    }

    let firstMsgId: string | null = null;
    if (i.firstMessage) {
      const [msgRow] = await tx
        .insert(messages)
        .values({
          thread_id: threadRow.id,
          tenant_id: i.tenantId,
          role: "user",
          content: i.firstMessage,
          sender_type: createdByType,
          sender_id: createdById,
          created_at: openingMessageCreatedAt ?? undefined,
        })
        .returning({ id: messages.id });
      firstMsgId = msgRow?.id ?? null;
    }

    let seededMobileTurn: {
      threadTurnId: string;
      userMessageId: string | null;
    } | null = null;
    if (shouldSeedMobileTurn) {
      const [countRow] = await tx
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(threadTurns)
        .where(eq(threadTurns.thread_id, threadRow.id));
      const turnNumber = Number(countRow?.count ?? 0) + 1;
      const startedIso = (openingMessageCreatedAt ?? new Date()).toISOString();
      const attachments = parseJsonArray(i.mobileTurnAttachments);
      const metadata = parseJsonObject(i.mobileTurnMetadata);
      const baseSnapshot = {
        mobile_turn: {
          client_turn_id: mobileTurnClientId,
          handoff_eligible: true,
          ownership: "mobile",
          runtime_type: MOBILE_PI_RUNTIME_TYPE,
          started_at: startedIso,
          last_heartbeat_at: startedIso,
          baseline_checkpoint_seq: 0,
          latest_checkpoint_seq: 0,
          user_message_id: null,
          requester: {
            id: createdById,
          },
          thread: {
            id: threadRow.id,
            agent_id: threadAgentId,
            space_id: threadSpace.id,
          },
          attachments,
          metadata,
        },
      };

      const [turn] = await tx
        .insert(threadTurns)
        .values({
          tenant_id: i.tenantId,
          agent_id: threadAgentId ?? undefined,
          thread_id: threadRow.id,
          invocation_source: MOBILE_PI_INVOCATION_SOURCE,
          runtime_type: MOBILE_PI_RUNTIME_TYPE,
          status: "running",
          started_at: openingMessageCreatedAt ?? undefined,
          last_activity_at: openingMessageCreatedAt ?? undefined,
          turn_number: turnNumber,
          external_run_id: mobileTurnClientId,
          context_snapshot: baseSnapshot,
        })
        .returning({ id: threadTurns.id });
      if (!turn?.id) throw new Error("Failed to seed mobile turn");

      const [msgRow] = await tx
        .insert(messages)
        .values({
          thread_id: threadRow.id,
          tenant_id: i.tenantId,
          role: "user",
          content: mobileTurnUserText!,
          sender_type: "user",
          sender_id: createdById,
          created_at: openingMessageCreatedAt ?? undefined,
          metadata: {
            mobile_turn: {
              client_turn_id: mobileTurnClientId,
              thread_turn_id: turn.id,
            },
            attachments,
          },
        })
        .returning({ id: messages.id });

      const snapshot = {
        ...baseSnapshot,
        mobile_turn: {
          ...baseSnapshot.mobile_turn,
          user_message_id: msgRow?.id ?? null,
          checkpoint_0: {
            kind: "baseline",
            safe: true,
            seq: 0,
            user_text: mobileTurnUserText,
            attachments,
            created_at: startedIso,
          },
        },
      };

      await tx
        .update(threadTurns)
        .set({
          wakeup_request_id: turn.id,
          context_snapshot: snapshot,
        })
        .where(eq(threadTurns.id, turn.id));

      await tx.insert(threadTurnEvents).values({
        tenant_id: i.tenantId,
        run_id: turn.id,
        agent_id: threadAgentId ?? undefined,
        seq: 0,
        event_type: "mobile_pi_checkpoint",
        stream: "activity",
        level: "info",
        color: "blue",
        message: "mobile Pi turn started",
        payload: snapshot.mobile_turn.checkpoint_0,
      });

      seededMobileTurn = {
        threadTurnId: turn.id,
        userMessageId: msgRow?.id ?? null,
      };
    }

    return {
      row: threadRow,
      firstMessageId: firstMsgId,
      mobileTurn: seededMobileTurn,
    };
  });

  // Side effects after commit (non-transactional — Lambda invoke + SNS notify).
  notifyThreadUpdate({
    threadId: row.id,
    tenantId: row.tenant_id,
    status: row.status,
    title: row.title,
  }).catch(() => {});

  if (mobileTurn?.userMessageId && mobileTurnUserText) {
    notifyNewMessage({
      messageId: mobileTurn.userMessageId,
      threadId: row.id,
      tenantId: row.tenant_id,
      role: "user",
      content: mobileTurnUserText,
      senderType: "user",
      senderId: createdById,
    }).catch(() => {});
  }
  if (mobileTurn?.threadTurnId && threadAgentId) {
    notifyThreadTurnUpdate({
      runId: mobileTurn.threadTurnId,
      tenantId: row.tenant_id,
      threadId: row.id,
      agentId: threadAgentId,
      status: "running",
      triggerName: "Mobile Pi",
    }).catch(() => {});
  }

  const parsedOpeningMentions =
    firstMessageId && i.firstMessage
      ? await persistOpeningMessageMentions({
          tenantId: row.tenant_id,
          threadId: row.id,
          spaceId: row.space_id,
          messageId: firstMessageId,
          content: i.firstMessage,
        })
      : [];

  const hasOpeningAgentMentions = parsedOpeningMentions.some(
    (mention) => mention.targetType === "agent",
  );
  if (hasOpeningAgentMentions && firstMessageId) {
    try {
      await dispatchAgentMentions({
        tenantId: row.tenant_id,
        threadId: row.id,
        spaceId: row.space_id,
        messageId: firstMessageId,
        content: i.firstMessage,
        mentions: parsedOpeningMentions,
        sender: { type: createdByType, id: createdById },
      });
    } catch (err) {
      console.warn("[createThread] agent mention dispatch failed:", err);
    }
  }

  if (
    firstMessageId &&
    i.firstMessage &&
    createdByType === "user" &&
    parsedOpeningMentions.length === 0
  ) {
    try {
      await dispatchDefaultAgentTurn({
        tenantId: row.tenant_id,
        threadId: row.id,
        spaceId: row.space_id,
        messageId: firstMessageId,
        content: i.firstMessage,
        sender: { type: createdByType, id: createdById },
      });
    } catch (err) {
      console.warn("[createThread] default agent dispatch failed:", err);
    }
  }

  return threadToCamel(row);
};

async function resolveDefaultThreadAgentId(tenantId: string) {
  try {
    return (await resolveTenantPlatformAgent(tenantId)).id;
  } catch (error) {
    if (error instanceof PlatformAgentNotFoundError) return null;
    throw error;
  }
}

async function createCustomerOnboardingThreadFromSpaceTrigger(input: {
  input: any;
  space: {
    id: string;
    name?: string;
    kind?: string;
    template_key?: string | null;
    config?: unknown;
  };
  createdByType: "user" | "agent" | "system";
  createdById: string | null | undefined;
}) {
  try {
    const result = await startCustomerOnboardingWorkflow({
      tenantId: input.input.tenantId,
      spaceId: input.space.id,
      source: "manual",
      opportunity: buildCustomerOnboardingOpportunityFromThreadCreate(
        input.input,
      ),
      startedBy: {
        type: input.createdByType === "user" ? "user" : "system",
        id: input.createdByType === "user" ? input.createdById : null,
      },
    });
    const [threadRow] = await db
      .select()
      .from(threads)
      .where(eq(threads.id, result.thread.id));
    return threadRow ? threadToCamel(threadRow) : result.thread;
  } catch (error) {
    if (error instanceof CustomerOnboardingWorkflowError) {
      throw new GraphQLError(error.message, {
        extensions: { code: error.code, http: { status: error.status } },
      });
    }
    throw error;
  }
}

function buildCustomerOnboardingOpportunityFromThreadCreate(
  input: any,
): Record<string, unknown> {
  const metadata = parseJsonObject(input.metadata);
  const fromMetadata =
    optionalObjectRecord(metadata.customerOnboarding) ??
    optionalObjectRecord(metadata.opportunity) ??
    metadata;
  const firstMessage = stringValue(input.firstMessage);
  const title = stringValue(input.title);
  const customerName =
    stringValue(fromMetadata.customerName) ??
    stringValue(fromMetadata.companyName) ??
    stringValue(fromMetadata.customer) ??
    inferCustomerNameFromThreadText(title, firstMessage) ??
    "New customer";

  return {
    ...fromMetadata,
    event: stringValue(fromMetadata.event) ?? "thread_created",
    opportunityId:
      stringValue(fromMetadata.opportunityId) ??
      stringValue(fromMetadata.id) ??
      `thread:${randomUUID()}`,
    customerName,
    companyName: stringValue(fromMetadata.companyName) ?? customerName,
    notes: [stringValue(fromMetadata.notes), firstMessage]
      .filter(Boolean)
      .join("\n\n"),
  };
}

function inferCustomerNameFromThreadText(
  title: string | null,
  firstMessage: string | null,
): string | null {
  const source =
    title && title !== "Untitled conversation" ? title : firstMessage;
  if (!source) return null;
  const inferred = source
    .replace(/\bonboard(?:ing)?\b/gi, "")
    .replace(/\bcustomer\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.?!,:;-]+$/g, "")
    .slice(0, 80);
  return inferred || null;
}

function isCustomerOnboardingSpace(space: {
  kind?: string;
  template_key?: string | null;
  config?: unknown;
}) {
  const config = objectRecord(space.config);
  return (
    normalizeKey(space.kind) === CUSTOMER_ONBOARDING_TEMPLATE_KEY ||
    normalizeKey(space.template_key) === CUSTOMER_ONBOARDING_TEMPLATE_KEY ||
    normalizeKey(config.workflow) === CUSTOMER_ONBOARDING_TEMPLATE_KEY
  );
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return objectRecord(parsed);
  } catch {
    return {};
  }
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeKey(value: unknown): string | null {
  return stringValue(value)?.toLowerCase() ?? null;
}

async function persistOpeningMessageMentions(input: {
  tenantId: string;
  threadId: string;
  spaceId: string | null;
  messageId: string;
  content: string;
}) {
  const mentionTargets = await loadThreadMentionTargets({
    tenantId: input.tenantId,
    threadId: input.threadId,
  });
  const parsedMentions = parseMessageMentions({
    content: input.content,
    targets: mentionTargets,
  });
  if (parsedMentions.length === 0) return parsedMentions;

  await db.transaction(async (tx) => {
    await tx
      .insert(messageMentions)
      .values(
        parsedMentions.map((mention) => ({
          tenant_id: input.tenantId,
          thread_id: input.threadId,
          message_id: input.messageId,
          target_type: mention.targetType,
          target_id: mention.targetId,
          display_name: mention.displayName,
          raw_text: mention.rawText,
          start_offset: mention.startOffset,
          end_offset: mention.endOffset,
        })),
      )
      .onConflictDoNothing();

    await insertMentionParticipants(
      {
        tenantId: input.tenantId,
        threadId: input.threadId,
        spaceId: input.spaceId,
        mentions: parsedMentions,
        targets: mentionTargets,
      },
      {
        async insertParticipants(rows) {
          await tx
            .insert(threadParticipants)
            .values(rows.map(toThreadParticipantInsert))
            .onConflictDoNothing();
        },
      },
    );
  });

  return parsedMentions;
}

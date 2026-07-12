import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@thinkwork/database-pg";
import {
  artifacts,
  messages,
  slackThreads,
  slackWorkspaces,
  threadTurns,
} from "@thinkwork/database-pg/schema";
import { getConfig } from "@thinkwork/runtime-config";
import { randomUUID as nodeRandomUUID } from "node:crypto";
import { getOrCreateArtifactShare } from "../artifacts/share-links.js";
import { signShareToken } from "../artifacts/share-tokens.js";
import { toSlackMrkdwn } from "./format-reply.js";
import {
  postSlackThreadMessage,
  updateSlackThreadMessage,
} from "./provider.js";
import { getSlackBotToken } from "./workspace-store.js";

const db = getDb();
const CLAIM_STALE_AFTER_MS = 5 * 60 * 1000;
const triggeringMessages = alias(messages, "slack_triggering_messages");

export interface SendThreadReplySlackInput {
  tenantId: string;
  threadId: string;
  assistantMessageId: string;
}

export interface RetryThreadReplySlackInput {
  tenantId: string;
  threadId: string;
  threadTurnId: string;
}

export type SendThreadReplySlackResult =
  | {
      delivered: true;
      assistantMessageId: string;
      providerMessageTs: string;
    }
  | {
      delivered: false;
      retryable: boolean;
      reason: SlackReplySkipReason | SlackReplyFailureReason;
      error?: string;
    };

export type SlackReplySkipReason =
  | "assistant_message_missing"
  | "empty_body"
  | "not_slack_origin"
  | "already_delivered"
  | "delivery_in_progress";

export type SlackReplyFailureReason =
  | "missing_thread_mapping"
  | "workspace_unavailable"
  | "token_unavailable"
  | "provider_rejected"
  | "invalid_provider_response"
  | "transport_error";

interface SlackReplyContext {
  assistantMessageId: string;
  body: string;
  assistantMetadata: unknown;
  triggeringUserMetadata: unknown;
  /**
   * ThinkWork user id of the triggering (user-role) message's sender. Used as
   * the share createdBy fallback when an artifact has no created_by_user_id.
   */
  requesterUserId: string | null;
}

export interface SlackTurnArtifact {
  id: string;
  title: string;
  createdByUserId: string | null;
}

type SlackReplyTarget =
  | { status: "ready"; botTokenSecretPath: string }
  | { status: "missing_thread_mapping" }
  | { status: "workspace_unavailable" };

interface SlackDeliveryState {
  version: 1;
  status: "sending" | "succeeded" | "failed";
  turnId: string | null;
  clientMessageId: string;
  claimId: string;
  attemptCount: number;
  claimedAt: string;
  deliveredAt?: string;
  providerMessageTs?: string;
  failedAt?: string;
  error?: string;
}

export interface SlackThreadReplyStore {
  loadContext(
    input: SendThreadReplySlackInput,
  ): Promise<SlackReplyContext | null>;
  loadTarget(input: {
    tenantId: string;
    threadId: string;
    slackTeamId: string;
    channelId: string;
    rootThreadTs: string | null;
  }): Promise<SlackReplyTarget>;
  claimDelivery(input: {
    tenantId: string;
    assistantMessageId: string;
    turnId: string | null;
    clientMessageId: string;
    claimId: string;
    now: Date;
  }): Promise<{ claimed: true } | { claimed: false; status: string | null }>;
  markDelivered(input: {
    tenantId: string;
    assistantMessageId: string;
    claimId: string;
    providerMessageTs: string;
    deliveredAt: Date;
  }): Promise<boolean>;
  markFailed(input: {
    tenantId: string;
    assistantMessageId: string;
    claimId: string;
    error: string;
    failedAt: Date;
  }): Promise<boolean>;
  findAssistantMessageForTurn(
    input: RetryThreadReplySlackInput,
  ): Promise<string | null>;
  loadTurnArtifacts(input: {
    tenantId: string;
    assistantMessageId: string;
  }): Promise<SlackTurnArtifact[]>;
}

export interface SlackThreadReplyDeps {
  store?: SlackThreadReplyStore;
  getBotToken?: typeof getSlackBotToken;
  postMessage?: typeof postSlackThreadMessage;
  updateMessage?: typeof updateSlackThreadMessage;
  now?: () => Date;
  randomUUID?: () => string;
  /** Markdown → Slack mrkdwn conversion for the reply body. */
  formatBody?: (markdown: string) => string;
  /** Get-or-create the public share row for a turn artifact (test seam). */
  getShare?: typeof getOrCreateArtifactShare;
  /** Sign a share id into its URL token (test seam). */
  signToken?: typeof signShareToken;
  /** Resolve the public share URL base, or null when unconfigured. */
  shareBase?: () => string | null;
}

/**
 * Project one persisted assistant message back to this turn's immutable
 * Slack-originated triggering message on its mapped ThinkWork thread.
 *
 * The assistant message metadata is the durable delivery ledger. An atomic
 * claim prevents concurrent finalize callbacks from posting twice, while the
 * assistant-message UUID is also sent as Slack's `client_msg_id` so a retry
 * after an ambiguous transport failure remains provider-idempotent.
 */
export async function sendThreadReplySlack(
  input: SendThreadReplySlackInput,
  deps: SlackThreadReplyDeps = {},
): Promise<SendThreadReplySlackResult> {
  const store = deps.store ?? createDrizzleSlackThreadReplyStore();
  const now = deps.now ?? (() => new Date());
  const getBotToken = deps.getBotToken ?? getSlackBotToken;
  const postMessage = deps.postMessage ?? postSlackThreadMessage;
  const updateMessage = deps.updateMessage ?? updateSlackThreadMessage;
  // Use node:crypto's randomUUID, not `crypto.randomUUID` — the latter, when
  // detached from the global `crypto` receiver and called, throws
  // ERR_INVALID_THIS ("Value of 'this' must be of type Crypto") on the
  // deployed Node runtime. (Unit tests inject deps.randomUUID, so this only
  // surfaced once real Slack delivery ran in production — THINK-84 U4.)
  const randomUUID = deps.randomUUID ?? nodeRandomUUID;
  const formatBody = deps.formatBody ?? toSlackMrkdwn;
  const getShare = deps.getShare ?? getOrCreateArtifactShare;
  const signToken = deps.signToken ?? signShareToken;
  const shareBase = deps.shareBase ?? defaultShareBase;

  const context = await store.loadContext(input);
  if (!context) {
    return skip("assistant_message_missing");
  }
  const body = context.body.trim();
  if (!body) return skip("empty_body");

  const origin = slackOriginFromMetadata(context.triggeringUserMetadata);
  if (!origin) return skip("not_slack_origin");

  // Convert the GitHub-flavored markdown body to Slack mrkdwn, then append a
  // public share link per artifact this turn produced. Link building is
  // best-effort: any failure yields no links and never blocks delivery.
  const formatted = formatBody(body);
  const links = await buildArtifactLinks({
    store,
    getShare,
    signToken,
    shareBase,
    tenantId: input.tenantId,
    assistantMessageId: input.assistantMessageId,
    requesterUserId: context.requesterUserId,
  });
  const finalText = links.length
    ? `${formatted}\n\n${links.join("\n")}`
    : formatted;

  const claimId = randomUUID();
  const claimed = await store.claimDelivery({
    tenantId: input.tenantId,
    assistantMessageId: input.assistantMessageId,
    turnId: sourceTurnIdFromMetadata(context.assistantMetadata),
    clientMessageId: input.assistantMessageId,
    claimId,
    now: now(),
  });
  if (!claimed.claimed) {
    if (claimed.status === "succeeded") return skip("already_delivered");
    return {
      delivered: false,
      retryable: true,
      reason: "delivery_in_progress",
    };
  }

  const target = await store.loadTarget({
    tenantId: input.tenantId,
    threadId: input.threadId,
    slackTeamId: origin.slackTeamId,
    channelId: origin.channelId,
    rootThreadTs: origin.rootThreadTs,
  });
  if (target.status !== "ready") {
    const message =
      target.status === "missing_thread_mapping"
        ? "Slack thread mapping is missing"
        : "Slack workspace is unavailable";
    await store.markFailed({
      tenantId: input.tenantId,
      assistantMessageId: input.assistantMessageId,
      claimId,
      error: message,
      failedAt: now(),
    });
    return failure(target.status, message);
  }

  let token: string;
  try {
    token = await getBotToken(target.botTokenSecretPath);
  } catch (error) {
    const message = errorMessage(error);
    await store.markFailed({
      tenantId: input.tenantId,
      assistantMessageId: input.assistantMessageId,
      claimId,
      error: message,
      failedAt: now(),
    });
    return failure("token_unavailable", message);
  }

  const postFresh = () =>
    postMessage({
      token,
      channel: origin.channelId,
      text: finalText,
      threadTs: origin.threadTs,
      clientMessageId: input.assistantMessageId,
    });

  try {
    // When the ingress ack was posted, update it in place so the "working on
    // it…" placeholder becomes the real answer (no leftover message). A
    // deleted or edited ack (message_not_found / cant_update_message, or any
    // other ok:false) falls back to a fresh threaded post so delivery still
    // happens; the ack's own ts is the delivered ts on the update path.
    let posted: Awaited<ReturnType<typeof postMessage>>;
    let providerMessageTs: string | undefined;
    if (origin.ackTs) {
      const updated = await updateMessage({
        token,
        channel: origin.channelId,
        ts: origin.ackTs,
        text: finalText,
      });
      if (updated.ok) {
        posted = updated;
        providerMessageTs = origin.ackTs;
      } else {
        posted = await postFresh();
        providerMessageTs = posted.ts;
      }
    } else {
      posted = await postFresh();
      providerMessageTs = posted.ts;
    }
    if (!posted.ok) {
      const message = posted.error || "Slack rejected the message";
      await store.markFailed({
        tenantId: input.tenantId,
        assistantMessageId: input.assistantMessageId,
        claimId,
        error: message,
        failedAt: now(),
      });
      return failure("provider_rejected", message);
    }
    if (!validSlackMessageTs(providerMessageTs)) {
      const message = "Slack returned an invalid message timestamp";
      await store.markFailed({
        tenantId: input.tenantId,
        assistantMessageId: input.assistantMessageId,
        claimId,
        error: message,
        failedAt: now(),
      });
      return failure("invalid_provider_response", message);
    }

    const persisted = await store.markDelivered({
      tenantId: input.tenantId,
      assistantMessageId: input.assistantMessageId,
      claimId,
      providerMessageTs,
      deliveredAt: now(),
    });
    if (!persisted) {
      throw new Error("Slack delivery claim changed before success persisted");
    }
    console.log(
      `[slack-thread-reply] delivered assistant=${input.assistantMessageId} thread=${input.threadId} slackTs=${providerMessageTs}`,
    );
    return {
      delivered: true,
      assistantMessageId: input.assistantMessageId,
      providerMessageTs,
    };
  } catch (error) {
    const message = errorMessage(error);
    await store.markFailed({
      tenantId: input.tenantId,
      assistantMessageId: input.assistantMessageId,
      claimId,
      error: message,
      failedAt: now(),
    });
    return failure("transport_error", message);
  }
}

/** Retry only the assistant message produced by this finalized turn. */
export async function retryThreadReplySlackForTurn(
  input: RetryThreadReplySlackInput,
  deps: SlackThreadReplyDeps = {},
): Promise<SendThreadReplySlackResult> {
  const store = deps.store ?? createDrizzleSlackThreadReplyStore();
  const assistantMessageId = await store.findAssistantMessageForTurn(input);
  if (!assistantMessageId) return skip("assistant_message_missing");
  return sendThreadReplySlack(
    {
      tenantId: input.tenantId,
      threadId: input.threadId,
      assistantMessageId,
    },
    { ...deps, store },
  );
}

function createDrizzleSlackThreadReplyStore(
  dbClient: any = db,
): SlackThreadReplyStore {
  return {
    async loadContext(input) {
      const [assistant] = await dbClient
        .select({
          id: messages.id,
          body: messages.content,
          metadata: messages.metadata,
          triggeringUserMetadata: triggeringMessages.metadata,
          requesterUserId: triggeringMessages.sender_id,
        })
        .from(messages)
        .leftJoin(
          threadTurns,
          and(
            sql`${threadTurns.id}::text = ${messages.metadata} ->> 'sourceTurnId'`,
            eq(threadTurns.tenant_id, input.tenantId),
            eq(threadTurns.thread_id, input.threadId),
          ),
        )
        .leftJoin(
          triggeringMessages,
          and(
            eq(triggeringMessages.id, threadTurns.triggering_message_id),
            eq(triggeringMessages.tenant_id, input.tenantId),
            eq(triggeringMessages.thread_id, input.threadId),
            eq(triggeringMessages.role, "user"),
          ),
        )
        .where(
          and(
            eq(messages.id, input.assistantMessageId),
            eq(messages.tenant_id, input.tenantId),
            eq(messages.thread_id, input.threadId),
            eq(messages.role, "assistant"),
          ),
        )
        .limit(1);
      if (!assistant) return null;

      return {
        assistantMessageId: assistant.id,
        body: assistant.body ?? "",
        assistantMetadata: assistant.metadata ?? null,
        triggeringUserMetadata: assistant.triggeringUserMetadata ?? null,
        requesterUserId: assistant.requesterUserId ?? null,
      };
    },
    async loadTarget(input) {
      const [mapping] = await dbClient
        .select({ id: slackThreads.id })
        .from(slackThreads)
        .where(
          and(
            eq(slackThreads.tenant_id, input.tenantId),
            eq(slackThreads.thread_id, input.threadId),
            eq(slackThreads.slack_team_id, input.slackTeamId),
            eq(slackThreads.channel_id, input.channelId),
            input.rootThreadTs
              ? eq(slackThreads.root_thread_ts, input.rootThreadTs)
              : isNull(slackThreads.root_thread_ts),
          ),
        )
        .limit(1);
      if (!mapping) return { status: "missing_thread_mapping" };

      const [workspace] = await dbClient
        .select({ botTokenSecretPath: slackWorkspaces.bot_token_secret_path })
        .from(slackWorkspaces)
        .where(
          and(
            eq(slackWorkspaces.tenant_id, input.tenantId),
            eq(slackWorkspaces.slack_team_id, input.slackTeamId),
            eq(slackWorkspaces.status, "active"),
          ),
        )
        .limit(1);
      return workspace
        ? {
            status: "ready",
            botTokenSecretPath: workspace.botTokenSecretPath,
          }
        : { status: "workspace_unavailable" };
    },
    async claimDelivery(input) {
      const [current] = await dbClient
        .select({ metadata: messages.metadata })
        .from(messages)
        .where(
          and(
            eq(messages.id, input.assistantMessageId),
            eq(messages.tenant_id, input.tenantId),
          ),
        )
        .limit(1);
      const existing = slackDeliveryFromMetadata(current?.metadata);
      const attemptCount = (existing?.attemptCount ?? 0) + 1;
      const delivery: SlackDeliveryState = {
        version: 1,
        status: "sending",
        turnId: input.turnId,
        clientMessageId: input.clientMessageId,
        claimId: input.claimId,
        attemptCount,
        claimedAt: input.now.toISOString(),
      };
      const staleBefore = new Date(
        input.now.getTime() - CLAIM_STALE_AFTER_MS,
      ).toISOString();
      const [claimed] = await dbClient
        .update(messages)
        .set({
          metadata: sql`jsonb_set(coalesce(${
            messages.metadata
          }, '{}'::jsonb), '{slackDelivery}', ${JSON.stringify(
            delivery,
          )}::jsonb, true)`,
        })
        .where(
          and(
            eq(messages.id, input.assistantMessageId),
            eq(messages.tenant_id, input.tenantId),
            eq(messages.role, "assistant"),
            sql`(
              coalesce(${messages.metadata} #>> '{slackDelivery,status}', 'pending') in ('pending', 'failed')
              or (
                ${messages.metadata} #>> '{slackDelivery,status}' = 'sending'
                and coalesce(${messages.metadata} #>> '{slackDelivery,claimedAt}', '') < ${staleBefore}
              )
            )`,
          ),
        )
        .returning({ id: messages.id });
      if (claimed) return { claimed: true };

      const [unchanged] = await dbClient
        .select({ metadata: messages.metadata })
        .from(messages)
        .where(
          and(
            eq(messages.id, input.assistantMessageId),
            eq(messages.tenant_id, input.tenantId),
          ),
        )
        .limit(1);
      return {
        claimed: false,
        status: slackDeliveryFromMetadata(unchanged?.metadata)?.status ?? null,
      };
    },
    async markDelivered(input) {
      return mutateClaimedDelivery(dbClient, input, (current) => ({
        ...current,
        status: "succeeded",
        deliveredAt: input.deliveredAt.toISOString(),
        providerMessageTs: input.providerMessageTs,
        error: undefined,
        failedAt: undefined,
      }));
    },
    async markFailed(input) {
      return mutateClaimedDelivery(dbClient, input, (current) => ({
        ...current,
        status: "failed",
        failedAt: input.failedAt.toISOString(),
        error: input.error.slice(0, 500),
      }));
    },
    async findAssistantMessageForTurn(input) {
      const [row] = await dbClient
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.tenant_id, input.tenantId),
            eq(messages.thread_id, input.threadId),
            eq(messages.role, "assistant"),
            sql`${messages.metadata} ->> 'sourceTurnId' = ${input.threadTurnId}`,
          ),
        )
        .orderBy(desc(messages.created_at), desc(messages.id))
        .limit(1);
      return row?.id ?? null;
    },
    async loadTurnArtifacts(input) {
      const rows = await dbClient
        .select({
          id: artifacts.id,
          title: artifacts.title,
          createdByUserId: artifacts.created_by_user_id,
        })
        .from(artifacts)
        .where(
          and(
            eq(artifacts.tenant_id, input.tenantId),
            eq(artifacts.source_message_id, input.assistantMessageId),
          ),
        )
        .orderBy(artifacts.created_at);
      return rows.map(
        (row: {
          id: string;
          title: string | null;
          createdByUserId: string | null;
        }) => ({
          id: row.id,
          title: row.title ?? "Untitled",
          createdByUserId: row.createdByUserId ?? null,
        }),
      );
    },
  };
}

async function mutateClaimedDelivery(
  dbClient: any,
  input: {
    tenantId: string;
    assistantMessageId: string;
    claimId: string;
  },
  mutate: (current: SlackDeliveryState) => SlackDeliveryState,
): Promise<boolean> {
  const [row] = await dbClient
    .select({ metadata: messages.metadata })
    .from(messages)
    .where(
      and(
        eq(messages.id, input.assistantMessageId),
        eq(messages.tenant_id, input.tenantId),
      ),
    )
    .limit(1);
  const current = slackDeliveryFromMetadata(row?.metadata);
  if (!current || current.claimId !== input.claimId) return false;
  const next = mutate(current);
  const updated = await dbClient
    .update(messages)
    .set({
      metadata: sql`jsonb_set(coalesce(${
        messages.metadata
      }, '{}'::jsonb), '{slackDelivery}', ${JSON.stringify(
        next,
      )}::jsonb, true)`,
    })
    .where(
      and(
        eq(messages.id, input.assistantMessageId),
        eq(messages.tenant_id, input.tenantId),
        sql`${messages.metadata} #>> '{slackDelivery,claimId}' = ${input.claimId}`,
      ),
    )
    .returning({ id: messages.id });
  return updated.length > 0;
}

/** Public share URL base, or null when THINKWORK_API_URL is unresolved. */
function defaultShareBase(): string | null {
  const base = (getConfig("THINKWORK_API_URL") ?? "").replace(/\/$/, "");
  return base || null;
}

/**
 * Build the `📄 <url|title>` Slack mrkdwn lines for this turn's artifacts.
 *
 * Best-effort: any failure (unresolved base, share-mint error, missing
 * createdBy) drops that link (or all links) and never throws, so a broken
 * share path can never block the reply delivery itself.
 */
async function buildArtifactLinks(args: {
  store: SlackThreadReplyStore;
  getShare: typeof getOrCreateArtifactShare;
  signToken: typeof signShareToken;
  shareBase: () => string | null;
  tenantId: string;
  assistantMessageId: string;
  requesterUserId: string | null;
}): Promise<string[]> {
  try {
    const base = args.shareBase();
    if (!base) {
      console.log(
        "[slack-thread-reply] skipping artifact links: share base unresolved",
      );
      return [];
    }
    const artifactRows = await args.store.loadTurnArtifacts({
      tenantId: args.tenantId,
      assistantMessageId: args.assistantMessageId,
    });
    if (artifactRows.length === 0) return [];

    const links: string[] = [];
    for (const artifact of artifactRows) {
      const createdBy = artifact.createdByUserId ?? args.requesterUserId;
      if (!createdBy) continue; // no valid users.id to attribute the share to
      try {
        const { shareId } = await args.getShare(db, {
          tenantId: args.tenantId,
          artifactId: artifact.id,
          createdBy,
          artifactTitle: artifact.title,
          source: "lambda",
        });
        const url = `${base}/share/${args.signToken(shareId)}`;
        links.push(`📄 <${url}|${escapeSlackLinkText(artifact.title)}>`);
      } catch (error) {
        console.log(
          `[slack-thread-reply] artifact share link failed artifact=${
            artifact.id
          }: ${errorMessage(error)}`,
        );
      }
    }
    return links;
  } catch (error) {
    console.log(
      `[slack-thread-reply] artifact link building failed: ${errorMessage(
        error,
      )}`,
    );
    return [];
  }
}

/** Escape the three Slack mrkdwn control chars in link label text. */
function escapeSlackLinkText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function slackOriginFromMetadata(metadata: unknown): {
  slackTeamId: string;
  channelId: string;
  threadTs: string;
  rootThreadTs: string | null;
  ackTs: string | null;
} | null {
  const record = asRecord(metadata);
  if (record?.source !== "slack") return null;
  const slack = asRecord(record.slack);
  if (!slack) return null;
  const sourceMessage = asRecord(slack.sourceMessage);
  const slackTeamId = stringValue(slack.slackTeamId);
  const channelId = stringValue(slack.channelId);
  const declaredRootThreadTs =
    stringValue(slack.threadTs) || stringValue(slack.rootThreadTs) || null;
  const sourceMessageTs = stringValue(sourceMessage?.ts);
  const threadTs = declaredRootThreadTs || sourceMessageTs;
  const rootThreadTs =
    stringValue(slack.triggerSurface) === "message_im" ? null : threadTs;
  // The events ingress stamps the acknowledgement message ts here after a
  // successful ack post; the finalizer updates that message in place.
  const ackTsRaw = stringValue(slack.ackTs);
  const ackTs = validSlackMessageTs(ackTsRaw) ? ackTsRaw : null;
  if (!slackTeamId || !channelId || !validSlackMessageTs(threadTs)) return null;
  return {
    slackTeamId,
    channelId,
    threadTs,
    rootThreadTs,
    ackTs,
  };
}

function sourceTurnIdFromMetadata(metadata: unknown): string | null {
  return stringValue(asRecord(metadata)?.sourceTurnId) || null;
}

function slackDeliveryFromMetadata(
  metadata: unknown,
): SlackDeliveryState | null {
  const delivery = asRecord(asRecord(metadata)?.slackDelivery);
  if (!delivery) return null;
  const status = delivery.status;
  if (status !== "sending" && status !== "succeeded" && status !== "failed") {
    return null;
  }
  return delivery as unknown as SlackDeliveryState;
}

function validSlackMessageTs(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+$/.test(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function skip(reason: SlackReplySkipReason): SendThreadReplySlackResult {
  return { delivered: false, retryable: false, reason };
}

function failure(
  reason: SlackReplyFailureReason,
  error: string,
): SendThreadReplySlackResult {
  return {
    delivered: false,
    retryable: true,
    reason,
    error,
  };
}

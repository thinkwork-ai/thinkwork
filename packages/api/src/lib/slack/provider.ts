/**
 * Provider-owned Slack transport boundary.
 *
 * This is the only module allowed to import `@chat-adapter/slack` subpaths.
 * Every export translates provider results into ThinkWork-owned plain values
 * immediately; Chat SDK types must not cross into handler, envelope, thread,
 * identity, dispatch, or finalization modules, and no Chat SDK object is
 * persisted.
 */
import {
  parseSlackWebhookBody,
  verifySlackSignature,
  SlackWebhookParseError,
  SlackWebhookVerificationError,
  type SlackWebhookPayload,
} from "@chat-adapter/slack/webhook";
import {
  callSlackApi,
  fetchSlackThreadReplies,
  postSlackMessage,
  SlackApiError,
} from "@chat-adapter/slack/api";
import {
  optionalSlackString as optionalString,
  requiredSlackString as requiredString,
  slackFileRefs,
  type SlackThreadContextMessage,
} from "./envelope.js";

export type SlackSignatureVerificationResult =
  | { ok: true }
  | { ok: false; status: 401; message: string };

export interface SlackSignatureVerificationInput {
  headers: Record<string, string>;
  rawBody: Buffer;
  signingSecret: string;
  nowMs?: () => number;
}

/**
 * Verify the Slack `v0` request signature and 5-minute replay window through
 * the pinned provider primitive, mapped onto ThinkWork's existing
 * allow/401 result contract.
 */
export async function verifySlackWebhookSignature({
  headers,
  rawBody,
  signingSecret,
  nowMs = Date.now,
}: SlackSignatureVerificationInput): Promise<SlackSignatureVerificationResult> {
  try {
    await verifySlackSignature(rawBody.toString("utf8"), headers, {
      signingSecret,
      now: nowMs,
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof SlackWebhookVerificationError) {
      return { ok: false, status: 401, message: error.message };
    }
    throw error;
  }
}

/**
 * ThinkWork-owned copy of the provider's native reply/continuation
 * coordinates. Plain data only — safe to thread through envelopes and
 * thread mapping.
 */
export interface SlackReplyCoordinates {
  channelId: string;
  threadTs: string;
  teamId: string | null;
  enterpriseId: string | null;
}

export type SlackWebhookClassification =
  | { kind: "url_verification"; challenge: string }
  | {
      kind: "event";
      eventId: string | null;
      teamId: string | null;
      replyTo: SlackReplyCoordinates;
      /** Raw Slack event body (plain JSON) for ThinkWork envelope building. */
      event: Record<string, unknown>;
    }
  | {
      kind: "unsupported";
      teamId: string | null;
      reason: string;
      /**
       * How the body was encoded. The events handler only trusts a team id
       * from JSON envelopes; form-encoded payloads (slash commands,
       * interactions, bare forms) were never valid events ingress.
       */
      encoding: "json" | "form";
    }
  | { kind: "malformed" };

/**
 * Parse a verified Slack webhook body through the provider primitive and
 * translate the result into ThinkWork-owned classification data.
 *
 * Event-callback payloads always surface as `kind: "event"` with the raw
 * inner event attached, so ThinkWork's own event classification (bot
 * filtering, subtype rules, mention promotion) stays authoritative.
 */
export function classifySlackWebhook(input: {
  rawBodyText: string;
  headers?: Record<string, string>;
}): SlackWebhookClassification {
  let payload: SlackWebhookPayload;
  try {
    payload = parseSlackWebhookBody(input.rawBodyText, {
      headers: input.headers,
    });
  } catch (error) {
    if (error instanceof SlackWebhookParseError) return { kind: "malformed" };
    throw error;
  }

  switch (payload.kind) {
    case "url_verification":
      return { kind: "url_verification", challenge: payload.challenge };
    case "app_mention":
    case "direct_message": {
      const event = asRecord(payload.raw) ?? {};
      return {
        kind: "event",
        eventId: payload.eventId ?? null,
        teamId: payload.teamId ?? optionalString(event.team),
        replyTo: {
          channelId: payload.continuation.channelId,
          threadTs: payload.continuation.threadTs,
          teamId: payload.continuation.teamId ?? null,
          enterpriseId: payload.continuation.enterpriseId ?? null,
        },
        event,
      };
    }
    default:
      return classifyRemainder(payload, isFormEncoded(input));
  }
}

/**
 * Mirror of the provider package's body-encoding heuristic so unsupported
 * payloads can be attributed to JSON vs form ingress.
 */
function isFormEncoded(input: {
  rawBodyText: string;
  headers?: Record<string, string>;
}): boolean {
  const contentType = findHeader(input.headers, "content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) return true;
  if (contentType.includes("application/json")) return false;
  const trimmed = input.rawBodyText.trimStart();
  return !trimmed.startsWith("{") && input.rawBodyText.includes("=");
}

function findHeader(
  headers: Record<string, string> | undefined,
  name: string,
): string | null {
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === name) return value;
  }
  return null;
}

/**
 * The provider package only types `app_mention` and IM `message` events.
 * Other event-callback deliveries (channel `message` subtypes such as
 * `file_share`, `reaction_added`, …) come back as `unsupported`; ThinkWork's
 * dispatcher decides what to do with them, so re-expose the raw event.
 */
function classifyRemainder(
  payload: Exclude<
    SlackWebhookPayload,
    { kind: "url_verification" | "app_mention" | "direct_message" }
  >,
  formEncoded: boolean,
): SlackWebhookClassification {
  if (payload.kind !== "unsupported") {
    // Slash commands and interaction payloads only arrive form-encoded.
    return {
      kind: "unsupported",
      teamId: payload.teamId ?? null,
      reason: payload.kind,
      encoding: "form",
    };
  }
  const envelope = asRecord(payload.raw);
  const teamId = optionalString(envelope?.team_id);
  const event = asRecord(envelope?.event);
  if (envelope?.type === "event_callback" && event) {
    const ts = optionalString(event.ts) ?? "";
    return {
      kind: "event",
      eventId: optionalString(envelope.event_id),
      teamId: teamId ?? optionalString(event.team),
      replyTo: {
        channelId: optionalString(event.channel) ?? "",
        threadTs: optionalString(event.thread_ts) ?? ts,
        teamId,
        enterpriseId: optionalString(envelope.enterprise_id),
      },
      event,
    };
  }
  if (envelope?.type === "url_verification") {
    // The package requires a string challenge; the legacy handler answered
    // a missing challenge with an empty 200 body. Preserve that contract.
    return { kind: "url_verification", challenge: "" };
  }
  return {
    kind: "unsupported",
    teamId,
    reason: payload.type,
    encoding: formEncoded ? "form" : "json",
  };
}

export interface SlackApiCallInput {
  token: string;
  /** Test seam; defaults to global fetch. */
  fetchFn?: typeof fetch;
}

export interface SlackPostMessageResult {
  ok: boolean;
  ts?: string;
  error?: string;
}

/**
 * Post a (threaded) channel message. Slack-level `ok: false` responses are
 * normalized into `{ ok: false, error }`; HTTP and transport failures throw,
 * matching the previous hand-written client's semantics.
 */
export async function postSlackThreadMessage(
  input: SlackApiCallInput & {
    channel: string;
    text: string;
    threadTs?: string | null;
  },
): Promise<SlackPostMessageResult> {
  try {
    const posted = await postSlackMessage({
      token: input.token,
      channel: input.channel,
      text: input.text,
      threadTs: input.threadTs || undefined,
      fetch: input.fetchFn,
    });
    return { ok: true, ts: posted.id || undefined };
  } catch (error) {
    const apiFailure = asSlackApiFailure(error);
    if (apiFailure) return apiFailure;
    throw error;
  }
}

/**
 * Fetch bounded thread context via `conversations.replies` and translate the
 * rows into ThinkWork's thread-context shape. Slack-level and transport
 * failures throw; callers already degrade to an empty context.
 */
export async function fetchSlackThreadContext(
  input: SlackApiCallInput & {
    channel: string;
    threadTs: string;
    limit?: number;
  },
): Promise<SlackThreadContextMessage[]> {
  const result = await fetchSlackThreadReplies({
    token: input.token,
    channel: input.channel,
    ts: input.threadTs,
    limit: input.limit ?? 50,
    fetch: input.fetchFn,
  });
  return result.messages
    .map((message) => asRecord(message))
    .filter((message): message is Record<string, unknown> => message !== null)
    .map((message) => ({
      user: optionalString(message.user),
      botId: optionalString(message.bot_id),
      ts: requiredString(message.ts),
      text: optionalString(message.text) ?? "",
      files: slackFileRefs(message.files),
    }));
}

/**
 * Publish an App Home view. Slack-level `ok: false` is intentionally
 * ignored (legacy behavior for the best-effort link prompt); HTTP and
 * transport failures throw.
 */
export async function publishSlackHomeView(
  input: SlackApiCallInput & {
    userId: string;
    view: Record<string, unknown>;
  },
): Promise<void> {
  await callSlackApi(
    "views.publish",
    { user_id: input.userId, view: input.view },
    { token: input.token, contentType: "json", fetch: input.fetchFn },
  );
}

function asSlackApiFailure(error: unknown): SlackPostMessageResult | null {
  if (
    error instanceof SlackApiError &&
    error.status === undefined &&
    error.response
  ) {
    return {
      ok: false,
      error: optionalString(error.response.error) ?? error.message,
    };
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

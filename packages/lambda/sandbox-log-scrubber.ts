/**
 * sandbox-log-scrubber — CloudWatch subscription-filter backstop that
 * pattern-redacts sandbox log events before they land in the long-term
 * tier (Unit 12 of the AgentCore Code Sandbox plan).
 *
 * This is the **secondary** R13 layer. The primary layer is the base-image
 * sitecustomize.py stdio wrapper (Unit 4). This backstop catches bytes
 * that bypass Python stdio — subprocess env dumps, os.write at fd level,
 * C-extension direct writes, multiprocessing-worker output — *when those
 * bytes contain a known-shape OAuth token prefix*. It does not have access
 * to the session-scoped token values, so it cannot catch arbitrary leaks.
 *
 * Pattern set (conservative — false positives cost readability; misses cost
 * security, so prefer additions over deletions):
 *   - Authorization: Bearer <opaque run>
 *   - JWT-shaped three-dotted base64 (<32 char min per part)
 *   - gho_…  GitHub OAuth / PAT
 *   - ghp_…  GitHub fine-grained PAT
 *   - gho_ / ghu_ / ghs_ / ghr_  — all start "gh" followed by letter + _
 *   - xoxb- / xoxa- / xoxp- / xoxe-  — Slack bot / app / user / export
 *   - ya29.…  Google OAuth short-lived access token prefix
 *
 * The handler decodes the CloudWatch subscription-filter envelope (base64 +
 * gzip over UTF-8 JSON), applies the pattern scrubber to every `message`,
 * and writes scrubbed events to the configured output CloudWatch group via
 * PutLogEvents. Failures (including scrubber bugs) are logged but not
 * thrown — the source group retains the original events, so a scrubber
 * outage delays S3 tier, it doesn't lose data.
 */

import { gunzipSync } from "node:zlib";
import {
  CloudWatchLogsClient,
  CreateLogStreamCommand,
  DescribeLogStreamsCommand,
  PutLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";

// ---------------------------------------------------------------------------
// Pattern set
// ---------------------------------------------------------------------------

// `Authorization: Bearer <opaque-run>` — `<opaque-run>` stops at whitespace
// or end of string. Handles quoted and unquoted header shapes.
const AUTH_BEARER = /Authorization:\s*Bearer\s+([^\s"'<>]+)/gi;

// JWT — three base64url-segments separated by dots. Each segment must be at
// least 16 chars to avoid matching "a.b.c" false positives.
const JWT = /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g;

// Known OAuth token prefixes — add a prefix here before relying on its
// redaction in production. The opaque-character class is intentionally
// narrow (no whitespace, no quotes, no angle brackets) so we redact the
// token value but not adjacent sentence text.
const PREFIXED_TOKEN =
  /(?:gh[oprsu]_[A-Za-z0-9]{20,}|xox[abep]-[A-Za-z0-9-]{10,}|ya29\.[A-Za-z0-9_-]{20,})/g;

const REDACTED = "<redacted>";

export function scrubMessage(message: string): string {
  let out = message;
  out = out.replace(AUTH_BEARER, `Authorization: Bearer ${REDACTED}`);
  out = out.replace(JWT, REDACTED);
  out = out.replace(PREFIXED_TOKEN, REDACTED);
  return out;
}

// ---------------------------------------------------------------------------
// CloudWatch subscription-filter envelope
// ---------------------------------------------------------------------------

// The shape AWS delivers to subscription-filter Lambdas; see
// https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/SubscriptionFilters.html
// We don't consume `subscriptionFilters`, `logGroup`, or `logStream` —
// they're captured in diagnostic logs when a PutLogEvents fails.
interface DecodedPayload {
  messageType: string;
  owner: string;
  logGroup: string;
  logStream: string;
  subscriptionFilters: string[];
  logEvents: { id: string; timestamp: number; message: string }[];
}

interface SubscriptionEvent {
  awslogs: { data: string };
}

export function decodeAwsLogsPayload(
  awslogs: SubscriptionEvent["awslogs"],
): DecodedPayload {
  const compressed = Buffer.from(awslogs.data, "base64");
  const inflated = gunzipSync(compressed);
  return JSON.parse(inflated.toString("utf8")) as DecodedPayload;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const OUTPUT_LOG_GROUP = process.env.OUTPUT_LOG_GROUP;

const cwl = new CloudWatchLogsClient({});

export const handler = async (event: SubscriptionEvent): Promise<void> => {
  if (!OUTPUT_LOG_GROUP) {
    console.error(
      "[sandbox-log-scrubber] OUTPUT_LOG_GROUP not set; dropping batch",
    );
    return;
  }

  let payload: DecodedPayload;
  try {
    payload = decodeAwsLogsPayload(event.awslogs);
  } catch (err) {
    console.error("[sandbox-log-scrubber] decode failed:", err);
    return;
  }

  if (payload.messageType !== "DATA_MESSAGE") {
    // CONTROL_MESSAGE is a routine heartbeat — nothing to scrub.
    return;
  }

  const scrubbed = payload.logEvents.map((e) => ({
    id: e.id,
    timestamp: e.timestamp,
    message: scrubMessage(e.message),
  }));

  // Stream per source stream so CloudWatch Insights queries can still slice
  // by original stream. Prefix keeps stage separation visible.
  const streamName = `scrubbed/${payload.logGroup.replace(/[^A-Za-z0-9_-]/g, "_")}/${payload.logStream}`;
  try {
    await ensureStream(OUTPUT_LOG_GROUP, streamName);
    await cwl.send(
      new PutLogEventsCommand({
        logGroupName: OUTPUT_LOG_GROUP,
        logStreamName: streamName,
        logEvents: scrubbed.map((e) => ({
          timestamp: e.timestamp,
          message: e.message,
        })),
      }),
    );
  } catch (err) {
    // Source group retains the originals; a write failure delays S3 tier
    // but never loses data.
    console.error(
      `[sandbox-log-scrubber] PutLogEvents to ${OUTPUT_LOG_GROUP}/${streamName} failed:`,
      err,
    );
  }
};

async function ensureStream(group: string, stream: string): Promise<void> {
  const existing = await cwl.send(
    new DescribeLogStreamsCommand({
      logGroupName: group,
      logStreamNamePrefix: stream,
      limit: 1,
    }),
  );
  if (existing.logStreams?.some((s) => s.logStreamName === stream)) {
    return;
  }
  try {
    await cwl.send(
      new CreateLogStreamCommand({
        logGroupName: group,
        logStreamName: stream,
      }),
    );
  } catch (err: any) {
    if (err?.name !== "ResourceAlreadyExistsException") {
      throw err;
    }
  }
}

import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  classifySlackWebhook,
  fetchSlackThreadContext,
  postSlackThreadMessage,
  publishSlackHomeView,
  verifySlackWebhookSignature,
} from "./provider.js";

const NOW_SECONDS = 1_800_000_000;
const NOW_MS = NOW_SECONDS * 1000;
const SIGNING_SECRET = "slack-signing-secret";

function sign(timestamp: string, rawBody: Buffer): string {
  return `v0=${createHmac("sha256", SIGNING_SECRET)
    .update(`v0:${timestamp}:`)
    .update(rawBody)
    .digest("hex")}`;
}

function signedHeaders(rawBody: Buffer, timestamp = String(NOW_SECONDS)) {
  return {
    "content-type": "application/json",
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature": sign(timestamp, rawBody),
  };
}

function appMentionEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    type: "event_callback",
    team_id: "T123",
    event_id: "Ev123",
    event: {
      type: "app_mention",
      user: "U123",
      channel: "C123",
      channel_type: "channel",
      text: "<@B123> research this vendor",
      ts: "1710000001.000000",
      ...overrides,
    },
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("verifySlackWebhookSignature", () => {
  it("accepts a correctly signed request inside the replay window", async () => {
    const rawBody = Buffer.from(JSON.stringify(appMentionEnvelope()));

    await expect(
      verifySlackWebhookSignature({
        headers: signedHeaders(rawBody),
        rawBody,
        signingSecret: SIGNING_SECRET,
        nowMs: () => NOW_MS,
      }),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects a tampered body with 401", async () => {
    const rawBody = Buffer.from(JSON.stringify(appMentionEnvelope()));
    const headers = signedHeaders(rawBody);

    const result = await verifySlackWebhookSignature({
      headers,
      rawBody: Buffer.from(
        JSON.stringify(appMentionEnvelope({ text: "tampered" })),
      ),
      signingSecret: SIGNING_SECRET,
      nowMs: () => NOW_MS,
    });

    expect(result).toEqual({
      ok: false,
      status: 401,
      message: "Slack signature is invalid",
    });
  });

  it("rejects a stale timestamp outside the five-minute window with 401", async () => {
    const rawBody = Buffer.from("{}");
    const staleTimestamp = String(NOW_SECONDS - 6 * 60);

    const result = await verifySlackWebhookSignature({
      headers: signedHeaders(rawBody, staleTimestamp),
      rawBody,
      signingSecret: SIGNING_SECRET,
      nowMs: () => NOW_MS,
    });

    expect(result).toEqual({
      ok: false,
      status: 401,
      message: "Slack request timestamp is outside the replay window",
    });
  });

  it("rejects a correctly signed fractional timestamp with the U1 message", async () => {
    const rawBody = Buffer.from("{}");
    const fractionalTimestamp = `${NOW_SECONDS}.5`;

    const result = await verifySlackWebhookSignature({
      // Signature is valid for the fractional timestamp; the timestamp
      // contract itself must reject it before HMAC verification.
      headers: signedHeaders(rawBody, fractionalTimestamp),
      rawBody,
      signingSecret: SIGNING_SECRET,
      nowMs: () => NOW_MS,
    });

    expect(result).toEqual({
      ok: false,
      status: 401,
      message: "Slack timestamp is invalid",
    });
  });

  it("rejects missing signature headers and malformed signature formats", async () => {
    const rawBody = Buffer.from("{}");

    await expect(
      verifySlackWebhookSignature({
        headers: {},
        rawBody,
        signingSecret: SIGNING_SECRET,
        nowMs: () => NOW_MS,
      }),
    ).resolves.toEqual({
      ok: false,
      status: 401,
      message: "Slack signature is required",
    });

    await expect(
      verifySlackWebhookSignature({
        headers: {
          "x-slack-request-timestamp": String(NOW_SECONDS),
          "x-slack-signature": "v1=deadbeef",
        },
        rawBody,
        signingSecret: SIGNING_SECRET,
        nowMs: () => NOW_MS,
      }),
    ).resolves.toMatchObject({ ok: false, status: 401 });
  });
});

describe("classifySlackWebhook", () => {
  it("classifies an app_mention with ThinkWork-owned reply coordinates", () => {
    const envelope = appMentionEnvelope({ thread_ts: "1709999999.000000" });

    const classification = classifySlackWebhook({
      rawBodyText: JSON.stringify(envelope),
      headers: { "content-type": "application/json" },
    });

    expect(classification).toMatchObject({
      kind: "event",
      eventId: "Ev123",
      teamId: "T123",
    });
    if (classification.kind !== "event") throw new Error("expected event");
    expect(classification.replyTo).toEqual({
      channelId: "C123",
      threadTs: "1709999999.000000",
      teamId: "T123",
      enterpriseId: null,
    });
    expect(classification.event).toMatchObject({
      type: "app_mention",
      user: "U123",
      text: "<@B123> research this vendor",
      ts: "1710000001.000000",
    });
  });

  it("returns plain-object continuation metadata, never a provider instance", () => {
    const classification = classifySlackWebhook({
      rawBodyText: JSON.stringify(appMentionEnvelope()),
    });

    if (classification.kind !== "event") throw new Error("expected event");
    expect(Object.getPrototypeOf(classification.replyTo)).toBe(
      Object.prototype,
    );
    expect(JSON.parse(JSON.stringify(classification.replyTo))).toEqual(
      classification.replyTo,
    );
    // Root-message mention: continuation threads onto the message itself.
    expect(classification.replyTo.threadTs).toBe("1710000001.000000");
  });

  it("classifies a direct message as an event with the DM channel", () => {
    const classification = classifySlackWebhook({
      rawBodyText: JSON.stringify({
        type: "event_callback",
        team_id: "T123",
        event_id: "EvDM",
        event: {
          type: "message",
          channel_type: "im",
          user: "U123",
          channel: "D123",
          text: "hello",
          ts: "1710000003.000000",
        },
      }),
    });

    expect(classification).toMatchObject({
      kind: "event",
      eventId: "EvDM",
      teamId: "T123",
    });
    if (classification.kind !== "event") throw new Error("expected event");
    expect(classification.replyTo.channelId).toBe("D123");
    expect(classification.event).toMatchObject({ channel_type: "im" });
  });

  it("re-exposes channel message subtypes the provider types as unsupported", () => {
    const classification = classifySlackWebhook({
      rawBodyText: JSON.stringify(
        appMentionEnvelope({
          type: "message",
          subtype: "file_share",
          channel_type: "channel",
        }),
      ),
    });

    expect(classification).toMatchObject({
      kind: "event",
      eventId: "Ev123",
      teamId: "T123",
    });
    if (classification.kind !== "event") throw new Error("expected event");
    expect(classification.event).toMatchObject({ subtype: "file_share" });
    expect(classification.replyTo).toEqual({
      channelId: "C123",
      threadTs: "1710000001.000000",
      teamId: "T123",
      enterpriseId: null,
    });
  });

  it("classifies url_verification with its challenge", () => {
    expect(
      classifySlackWebhook({
        rawBodyText: JSON.stringify({
          type: "url_verification",
          challenge: "challenge-1",
        }),
      }),
    ).toEqual({ kind: "url_verification", challenge: "challenge-1" });
  });

  it("keeps the workspace id for unsupported non-event payloads", () => {
    expect(
      classifySlackWebhook({
        rawBodyText: JSON.stringify({
          type: "tokens_revoked",
          team_id: "T123",
        }),
      }),
    ).toEqual({
      kind: "unsupported",
      encoding: "json",
      teamId: "T123",
      reason: "tokens_revoked",
    });
  });

  it("classifies slash-command form bodies as unsupported for events ingress", () => {
    const classification = classifySlackWebhook({
      rawBodyText: "team_id=T123&command=%2Fthinkwork&text=hello",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });

    expect(classification).toMatchObject({
      kind: "unsupported",
      reason: "slash_command",
      encoding: "form",
    });
  });

  it("marks bare form bodies as form-encoded so events ingress rejects them", () => {
    const classification = classifySlackWebhook({
      rawBodyText: "team_id=T123&text=hello",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });

    expect(classification).toMatchObject({
      kind: "unsupported",
      encoding: "form",
    });

    // Same heuristic without a content-type header.
    expect(
      classifySlackWebhook({ rawBodyText: "team_id=T123&text=hello" }),
    ).toMatchObject({ kind: "unsupported", encoding: "form" });
  });

  it("answers url_verification without a string challenge with an empty challenge", () => {
    expect(
      classifySlackWebhook({
        rawBodyText: JSON.stringify({ type: "url_verification" }),
      }),
    ).toEqual({ kind: "url_verification", challenge: "" });
  });

  it("classifies malformed JSON bodies as malformed", () => {
    expect(classifySlackWebhook({ rawBodyText: "{not json" })).toEqual({
      kind: "malformed",
    });
    expect(
      classifySlackWebhook({
        rawBodyText: "definitely-not-json",
        headers: { "content-type": "application/json" },
      }),
    ).toEqual({ kind: "malformed" });
  });
});

describe("postSlackThreadMessage", () => {
  it("posts through the provider primitive and returns the message ts", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ ok: true, ts: "1710000002.000000", channel: "C123" }),
    );

    const result = await postSlackThreadMessage({
      token: "xoxb-token",
      channel: "C123",
      text: "ThinkWork is working on it…",
      threadTs: "1710000001.000000",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result).toEqual({ ok: true, ts: "1710000002.000000" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      URL,
      { headers: Record<string, string>; body: string },
    ];
    expect(String(url)).toBe("https://slack.com/api/chat.postMessage");
    expect(init.headers.authorization).toBe("Bearer xoxb-token");
    const body = new URLSearchParams(init.body);
    expect(body.get("channel")).toBe("C123");
    expect(body.get("thread_ts")).toBe("1710000001.000000");
  });

  it("normalizes ok:false responses into a failed post result", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ ok: false, error: "channel_not_found" }),
    );

    await expect(
      postSlackThreadMessage({
        token: "xoxb-token",
        channel: "C404",
        text: "hi",
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).resolves.toEqual({ ok: false, error: "channel_not_found" });
  });

  it("throws on HTTP failures, malformed responses, and transport errors", async () => {
    const httpFailure = vi.fn(async () => jsonResponse({ ok: false }, 500));
    await expect(
      postSlackThreadMessage({
        token: "t",
        channel: "C",
        text: "x",
        fetchFn: httpFailure as unknown as typeof fetch,
      }),
    ).rejects.toThrow("HTTP 500");

    const malformed = vi.fn(
      async () => new Response("not json", { status: 200 }),
    );
    await expect(
      postSlackThreadMessage({
        token: "t",
        channel: "C",
        text: "x",
        fetchFn: malformed as unknown as typeof fetch,
      }),
    ).rejects.toThrow();

    const transport = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    await expect(
      postSlackThreadMessage({
        token: "t",
        channel: "C",
        text: "x",
        fetchFn: transport as unknown as typeof fetch,
      }),
    ).rejects.toThrow("socket hang up");
  });
});

describe("fetchSlackThreadContext", () => {
  it("maps conversations.replies rows into thread-context messages", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        ok: true,
        messages: [
          {
            user: "U123",
            ts: "1710000000.000000",
            text: "Earlier",
            files: [
              {
                id: "F123",
                name: "brief.pdf",
                mimetype: "application/pdf",
                url_private: "https://files.slack.com/files-pri/F123",
              },
            ],
          },
          { bot_id: "B999", ts: "1710000000.500000", text: "bot reply" },
        ],
      }),
    );

    const messages = await fetchSlackThreadContext({
      token: "xoxb-token",
      channel: "C123",
      threadTs: "1710000000.000000",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(messages).toEqual([
      {
        user: "U123",
        botId: null,
        ts: "1710000000.000000",
        text: "Earlier",
        files: [
          {
            id: "F123",
            name: "brief.pdf",
            mimetype: "application/pdf",
            urlPrivate: "https://files.slack.com/files-pri/F123",
            urlPrivateDownload: null,
            permalink: null,
            sizeBytes: null,
          },
        ],
      },
      {
        user: null,
        botId: "B999",
        ts: "1710000000.500000",
        text: "bot reply",
        files: [],
      },
    ]);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      URL,
      { body: string },
    ];
    expect(String(url)).toBe("https://slack.com/api/conversations.replies");
    expect(new URLSearchParams(init.body).get("limit")).toBe("50");
  });

  it("throws when Slack rejects the thread lookup", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ ok: false, error: "thread_not_found" }),
    );

    await expect(
      fetchSlackThreadContext({
        token: "xoxb-token",
        channel: "C123",
        threadTs: "1710000000.000000",
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrow("thread_not_found");
  });
});

describe("publishSlackHomeView", () => {
  it("publishes the view as JSON and tolerates Slack-level rejection", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ ok: false, error: "not_allowed" }),
    );

    await expect(
      publishSlackHomeView({
        token: "xoxb-token",
        userId: "U123",
        view: { type: "home", blocks: [] },
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).resolves.toBeUndefined();

    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      URL,
      { headers: Record<string, string>; body: string },
    ];
    expect(String(url)).toBe("https://slack.com/api/views.publish");
    expect(init.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(init.body)).toEqual({
      user_id: "U123",
      view: { type: "home", blocks: [] },
    });
  });

  it("throws on HTTP failure so callers surface transport errors", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ ok: false }, 503));

    await expect(
      publishSlackHomeView({
        token: "xoxb-token",
        userId: "U123",
        view: { type: "home" },
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrow("HTTP 503");
  });
});

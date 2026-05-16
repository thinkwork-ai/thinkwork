import { describe, expect, it } from "vitest";
import {
  buildSlackThreadTurnInput,
  slackFileRefs,
  summarizeSlackThreadContext,
} from "./envelope.js";

describe("Slack event envelope helpers", () => {
  it("extracts supported Slack file references", () => {
    expect(
      slackFileRefs([
        {
          id: "F123",
          name: "brief.pdf",
          mimetype: "application/pdf",
          url_private: "https://files.slack.com/files-pri/F123",
        },
        { name: "missing-id.txt" },
      ]),
    ).toEqual([
      {
        id: "F123",
        name: "brief.pdf",
        mimetype: "application/pdf",
        urlPrivate: "https://files.slack.com/files-pri/F123",
      },
    ]);
  });

  it("caps Slack thread context by message count and text budget", () => {
    const messages = Array.from({ length: 60 }, (_, index) => ({
      user: `U${index}`,
      botId: null,
      ts: String(index),
      text: "x".repeat(100),
    }));

    const summary = summarizeSlackThreadContext(messages, 50, 250);

    expect(summary).toHaveLength(3);
    expect(summary[0]?.user).toBe("U10");
    expect(summary.map((message) => message.text).join("")).toHaveLength(250);
  });

  it("builds a Slack thread turn input with thread_ts fallback to event ts", () => {
    expect(
      buildSlackThreadTurnInput({
        channelType: "im",
        slackTeamId: "T123",
        slackUserId: "U123",
        channelId: "D123",
        eventId: "Ev123",
        actorId: "user-1",
        event: {
          type: "message",
          user: "U123",
          channel: "D123",
          text: "hello",
          ts: "1710000001.000000",
        },
      }),
    ).toMatchObject({
      source: "slack",
      channelType: "im",
      threadTs: "1710000001.000000",
      messageTs: "1710000001.000000",
      responseUrl: null,
      placeholderTs: null,
      actorId: "user-1",
    });
  });
});

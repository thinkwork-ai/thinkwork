import { describe, expect, it } from "vitest";
import {
  buildSlackMessageActionInput,
  buildSlackSlashCommandInput,
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
          url_private_download: "https://files.slack.com/files-pri/F123/download",
          size: "42",
        },
        { name: "missing-id.txt" },
      ]),
    ).toEqual([
      {
        id: "F123",
        name: "brief.pdf",
        mimetype: "application/pdf",
        urlPrivate: "https://files.slack.com/files-pri/F123",
        urlPrivateDownload: "https://files.slack.com/files-pri/F123/download",
        permalink: null,
        sizeBytes: 42,
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

  it("builds a slash command input with response_url metadata", () => {
    expect(
      buildSlackSlashCommandInput({
        slackTeamId: "T123",
        slackUserId: "U123",
        channelId: "C123",
        text: "summarize Q3",
        responseUrl: "https://hooks.slack.com/commands/response",
        triggerId: "trigger-1",
        actorId: "user-1",
      }),
    ).toMatchObject({
      source: "slack",
      channelType: "slash",
      eventId: "slash:trigger-1",
      responseUrl: "https://hooks.slack.com/commands/response",
      sourceMessage: { text: "summarize Q3" },
      actorId: "user-1",
    });
  });

  it("builds a message-action input with modal and file metadata", () => {
    expect(
      buildSlackMessageActionInput({
        slackTeamId: "T123",
        slackUserId: "U123",
        channelId: "C123",
        triggerId: "trigger-1",
        responseUrl: "https://hooks.slack.com/actions/response",
        modalViewId: "V123",
        actorId: "user-1",
        message: {
          user: "U456",
          text: "review this",
          ts: "1710000001.000000",
          thread_ts: "1710000000.000000",
          files: [{ id: "F123", name: "brief.pdf" }],
        },
      }),
    ).toMatchObject({
      source: "slack",
      channelType: "message_action",
      eventId: "message_action:trigger-1",
      threadTs: "1710000000.000000",
      messageTs: "1710000001.000000",
      responseUrl: "https://hooks.slack.com/actions/response",
      modalViewId: "V123",
      sourceMessage: { text: "review this", user: "U456" },
      fileRefs: [{ id: "F123", name: "brief.pdf" }],
      actorId: "user-1",
    });
  });
});

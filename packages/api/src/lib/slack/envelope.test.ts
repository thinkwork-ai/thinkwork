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

  it("keeps file references when Slack thread text exceeds the summary budget", () => {
    const summary = summarizeSlackThreadContext(
      [
        {
          user: "U123",
          botId: null,
          ts: "1",
          text: "x".repeat(100),
        },
        {
          user: "U123",
          botId: null,
          ts: "2",
          text: "file was uploaded here",
          files: [
            {
              id: "F123",
              name: "financials.xlsx",
              mimetype: null,
              urlPrivate: null,
              urlPrivateDownload: null,
              permalink: null,
              sizeBytes: null,
            },
          ],
        },
      ],
      50,
      10,
    );

    expect(summary).toHaveLength(2);
    expect(summary[1]).toMatchObject({
      text: "",
      files: [expect.objectContaining({ id: "F123" })],
    });
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

  it("carries Slack thread-context files into the turn file refs", () => {
    const input = buildSlackThreadTurnInput({
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
        text: "Can you review this file?",
        ts: "1710000002.000000",
        thread_ts: "1710000000.000000",
      },
      threadContext: [
        {
          user: "U123",
          botId: null,
          ts: "1710000001.000000",
          text: "summarize this file",
          files: [
            {
              id: "FTHREAD",
              name: "agentic-etl-architecture-v5.md",
              mimetype: "text/plain",
              urlPrivate: "https://files.slack.com/files-pri/FTHREAD",
              urlPrivateDownload:
                "https://files.slack.com/files-pri/FTHREAD/download",
              permalink: null,
              sizeBytes: 28622,
            },
          ],
        },
      ],
    });

    expect(input.sourceMessage.files).toEqual([]);
    expect(input.fileRefs).toEqual([
      expect.objectContaining({
        id: "FTHREAD",
        name: "agentic-etl-architecture-v5.md",
      }),
    ]);
    expect(input.slack.fileRefs).toEqual(input.fileRefs);
  });

  it("deduplicates current-message and thread-context files by Slack file id", () => {
    const input = buildSlackThreadTurnInput({
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
        text: "summarize this file",
        ts: "1710000001.000000",
        files: [{ id: "F123", name: "current.md" }],
      },
      threadContext: [
        {
          user: "U123",
          botId: null,
          ts: "1710000001.000000",
          text: "summarize this file",
          files: [
            {
              id: "F123",
              name: "from-context.md",
              mimetype: null,
              urlPrivate: null,
              urlPrivateDownload: null,
              permalink: null,
              sizeBytes: null,
            },
          ],
        },
      ],
    });

    expect(input.fileRefs).toEqual([
      expect.objectContaining({ id: "F123", name: "current.md" }),
    ]);
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

import { describe, expect, it } from "vitest";
import { describeSendMessageError } from "./send-message-error";

describe("describeSendMessageError", () => {
  it("surfaces the server's GraphQL error text with the files-uploaded context", () => {
    expect(
      describeSendMessageError(
        {
          graphQLErrors: [
            { message: "Mention target is not available in this Thread" },
          ],
          message:
            "[GraphQL] Mention target is not available in this Thread",
        },
        { filesUploaded: true, firstMessage: true },
      ),
    ).toBe(
      "Files uploaded, but the first message did not send: Mention target is not available in this Thread",
    );
  });

  it("falls back to the combined message with the urql origin prefix stripped", () => {
    expect(
      describeSendMessageError(
        { message: "[Network] Failed to fetch" },
        { filesUploaded: false },
      ),
    ).toBe("Failed to fetch");
  });

  it("keeps the generic retry copy when no server message exists", () => {
    expect(
      describeSendMessageError(undefined, { filesUploaded: true }),
    ).toBe(
      "Files uploaded, but the message did not send. Try sending the message again.",
    );
    expect(describeSendMessageError({}, { filesUploaded: false })).toBe(
      "Failed to send the message",
    );
  });

  it("uses the first-message noun when asked", () => {
    expect(
      describeSendMessageError({}, { filesUploaded: false, firstMessage: true }),
    ).toBe("Failed to send the first message");
  });
});

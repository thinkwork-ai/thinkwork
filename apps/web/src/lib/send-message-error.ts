/**
 * Human-readable message for a failed sendMessage mutation.
 *
 * The server's GraphQL error text (e.g. "Mention target is not available in
 * this Thread") must reach the user — a generic wrapper hid the real cause
 * during THINK-136 acceptance and made a validation error look like an
 * upload flake. `filesUploaded` prepends context that the attachments are
 * already stored, so the user knows only the message needs resending.
 */
export function describeSendMessageError(
  error:
    | {
        graphQLErrors?: ReadonlyArray<{ message?: string }>;
        message?: string;
      }
    | null
    | undefined,
  options: { filesUploaded: boolean; firstMessage?: boolean },
): string {
  const serverMessage =
    error?.graphQLErrors?.[0]?.message?.trim() ||
    // urql's CombinedError.message prefixes the first error with its origin.
    error?.message?.replace(/^\[(GraphQL|Network)\]\s*/, "").trim() ||
    "";
  const noun = options.firstMessage ? "the first message" : "the message";
  if (options.filesUploaded) {
    return serverMessage
      ? `Files uploaded, but ${noun} did not send: ${serverMessage}`
      : `Files uploaded, but ${noun} did not send. Try sending the message again.`;
  }
  return serverMessage || `Failed to send ${noun}`;
}

/**
 * Outbound raw-MIME construction for agent-sent email.
 *
 * Extracted from the inline builder in handlers/email-send.ts so the
 * first-send-approval resend path can produce byte-identical structure —
 * the approval path previously rebuilt the email as structured text and
 * silently dropped everything the raw message carried.
 *
 * Shape: with no attachments the message stays `multipart/alternative`
 * (text + html), exactly as before. With attachments it becomes
 * `multipart/mixed` wrapping that same alternative part followed by one
 * base64 part per attachment. Only SES accepts rawMessage today; the
 * resend/sendgrid adapters reject it before this builder matters.
 */

export interface OutboundMimeAttachment {
  name: string;
  contentType: string;
  bytes: Buffer;
}

export interface OutboundMimeInput {
  from: string;
  to: string[];
  replyTo?: string;
  subject: string;
  messageId: string;
  /** Extra headers appended verbatim, e.g. X-Thinkwork-Reply-Token. */
  extraHeaders?: string[];
  inReplyTo?: string;
  text: string;
  html?: string;
  attachments?: OutboundMimeAttachment[];
  /** Injectable for deterministic tests. */
  boundarySeed?: string;
}

/** SES SendRawEmail hard limit is 10 MB post-encoding; base64 inflates
 * ~4/3, so cap the raw attachment payload well under that. */
export const MAX_EMAIL_ATTACHMENT_TOTAL_BYTES = 7 * 1024 * 1024;
export const MAX_EMAIL_ATTACHMENT_COUNT = 5;

function sanitizeMimeFilename(name: string): string {
  // Quoted-string context: strip CR/LF and quotes to keep the header intact.
  return name.replace(/[\r\n"\\]/g, "_").slice(0, 200) || "attachment";
}

function chunkBase64(bytes: Buffer): string {
  const encoded = bytes.toString("base64");
  const lines: string[] = [];
  for (let i = 0; i < encoded.length; i += 76) {
    lines.push(encoded.slice(i, i + 76));
  }
  return lines.join("\r\n");
}

export function buildOutboundMime(input: OutboundMimeInput): string {
  const seed =
    input.boundarySeed ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const altBoundary = `thinkwork-alt-${seed}`;
  const mixedBoundary = `thinkwork-mix-${seed}`;
  const attachments = input.attachments ?? [];

  const headers = [
    `From: ${input.from}`,
    `To: ${input.to.join(", ")}`,
    ...(input.replyTo ? [`Reply-To: ${input.replyTo}`] : []),
    `Subject: ${input.subject}`,
    `Message-ID: ${input.messageId}`,
    `MIME-Version: 1.0`,
    ...(input.extraHeaders ?? []),
  ];
  if (input.inReplyTo) {
    const replyId = input.inReplyTo.includes("<")
      ? input.inReplyTo
      : `<${input.inReplyTo}>`;
    headers.push(`In-Reply-To: ${replyId}`);
    headers.push(`References: ${replyId}`);
  }

  const alternativeLines = [
    `--${altBoundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    "",
    input.text,
    ...(input.html
      ? [
          `--${altBoundary}`,
          `Content-Type: text/html; charset=UTF-8`,
          `Content-Transfer-Encoding: 8bit`,
          "",
          input.html,
        ]
      : []),
    `--${altBoundary}--`,
  ];

  if (attachments.length === 0) {
    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      "",
      ...alternativeLines,
      "",
    ].join("\r\n");
  }

  const attachmentLines = attachments.flatMap((attachment) => {
    const filename = sanitizeMimeFilename(attachment.name);
    return [
      `--${mixedBoundary}`,
      `Content-Type: ${attachment.contentType}; name="${filename}"`,
      `Content-Disposition: attachment; filename="${filename}"`,
      `Content-Transfer-Encoding: base64`,
      "",
      chunkBase64(attachment.bytes),
    ];
  });

  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    "",
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    ...alternativeLines,
    ...attachmentLines,
    `--${mixedBoundary}--`,
    "",
  ].join("\r\n");
}

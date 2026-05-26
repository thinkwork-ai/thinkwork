export interface ThreadAttachmentSummary {
  id: string;
  name?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  createdAt?: string | null;
  uploadedBy?: string | null;
}

export interface MessageAttachmentDisplay extends ThreadAttachmentSummary {
  label: string;
}

export function resolveMessageAttachments(input: {
  metadata: unknown;
  threadAttachments?: ThreadAttachmentSummary[] | null;
}): MessageAttachmentDisplay[] {
  const references = parseAttachmentReferences(input.metadata);
  if (references.length === 0) return [];

  const byId = new Map(
    (input.threadAttachments ?? []).map((attachment) => [
      attachment.id,
      attachment,
    ]),
  );
  const seen = new Set<string>();
  const resolved: MessageAttachmentDisplay[] = [];
  for (const attachmentId of references) {
    if (seen.has(attachmentId)) continue;
    seen.add(attachmentId);
    const attachment = byId.get(attachmentId);
    if (!attachment) continue;
    resolved.push({
      ...attachment,
      label: attachment.name?.trim() || "Attachment",
    });
  }
  return resolved;
}

export function parseAttachmentReferences(metadata: unknown): string[] {
  const root = parseRecord(metadata);
  const attachments = Array.isArray(root.attachments)
    ? root.attachments
    : [];
  const refs: string[] = [];
  for (const entry of attachments) {
    const record = parseRecord(entry);
    const attachmentId = stringValue(record.attachmentId);
    if (attachmentId) refs.push(attachmentId);
  }
  return refs;
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return parseRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

import { gqlQuery } from "../../lib/gql-client.js";
import { isJsonMode, printJson, printKeyValue, printTable } from "../../lib/output.js";
import { printError } from "../../ui.js";
import { InboxItemDoc } from "./gql.js";
import { resolveInboxContext, fmtIso, type InboxCliOptions } from "./helpers.js";

export async function runInboxGet(id: string, opts: InboxCliOptions): Promise<void> {
  const ctx = await resolveInboxContext(opts);
  const data = await gqlQuery(ctx.client, InboxItemDoc, { id });

  const item = data.inboxItem;
  if (!item) {
    printError(`Inbox item ${id} not found in tenant "${ctx.tenantSlug}".`);
    process.exit(1);
  }

  if (isJsonMode()) {
    printJson(item);
    return;
  }

  printKeyValue([
    ["ID", item.id],
    ["Type", item.type],
    ["Status", item.status],
    ["Title", item.title ?? undefined],
    ["Description", item.description ?? undefined],
    ["Requester", item.requesterId ?? undefined],
    ["Recipient", item.recipientId ?? undefined],
    ["Entity", item.entityType && item.entityId ? `${item.entityType}:${item.entityId}` : undefined],
    ["Revision", String(item.revision)],
    ["Review notes", item.reviewNotes ?? undefined],
    ["Decided by", item.decidedBy ?? undefined],
    ["Decided at", fmtIso(item.decidedAt)],
    ["Expires at", fmtIso(item.expiresAt)],
    ["Created", fmtIso(item.createdAt)],
    ["Updated", fmtIso(item.updatedAt)],
  ]);

  if (item.comments && item.comments.length > 0) {
    console.log("");
    console.log("  Comments:");
    const rows = item.comments.map((c) => ({
      when: fmtIso(c.createdAt),
      author: c.authorType && c.authorId
        ? `${c.authorType}:${c.authorId.slice(0, 8)}`
        : c.authorType ?? "—",
      content: c.content.length > 80 ? `${c.content.slice(0, 77)}…` : c.content,
    }));
    printTable(rows, [
      { key: "when", header: "WHEN" },
      { key: "author", header: "AUTHOR" },
      { key: "content", header: "CONTENT" },
    ]);
  }

  if (item.linkedThreads && item.linkedThreads.length > 0) {
    console.log("");
    console.log("  Linked threads:");
    const rows = item.linkedThreads.map((t) => ({
      num: t.number != null ? `#${t.number}` : "—",
      id: t.id,
      title: t.title.length > 60 ? `${t.title.slice(0, 57)}…` : t.title,
      status: t.status,
    }));
    printTable(rows, [
      { key: "num", header: "NUM" },
      { key: "id", header: "ID" },
      { key: "title", header: "TITLE" },
      { key: "status", header: "STATUS" },
    ]);
  }
}

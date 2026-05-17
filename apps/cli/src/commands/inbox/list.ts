import { gqlQuery } from "../../lib/gql-client.js";
import { InboxItemStatus } from "../../gql/graphql.js";
import { isJsonMode, printJson, printTable } from "../../lib/output.js";
import { printError } from "../../ui.js";
import { InboxItemsDoc } from "./gql.js";
import {
  resolveInboxContext,
  fmtAge,
  fmtRequester,
  type InboxCliOptions,
} from "./helpers.js";

interface ListOptions extends InboxCliOptions {
  status?: string;
  entityType?: string;
  entityId?: string;
  mine?: boolean;
}

const STATUS_BY_NAME: Record<string, InboxItemStatus> = {
  PENDING: InboxItemStatus.Pending,
  APPROVED: InboxItemStatus.Approved,
  REJECTED: InboxItemStatus.Rejected,
  REVISION_REQUESTED: InboxItemStatus.RevisionRequested,
  EXPIRED: InboxItemStatus.Expired,
  CANCELLED: InboxItemStatus.Cancelled,
};

function parseStatus(s: string): InboxItemStatus | null {
  return STATUS_BY_NAME[s] ?? null;
}

export async function runInboxList(opts: ListOptions): Promise<void> {
  const ctx = await resolveInboxContext(opts);

  const statusRaw = opts.status ?? "PENDING";
  const status = parseStatus(statusRaw);
  if (!status) {
    printError(
      `Invalid --status "${statusRaw}". Expected one of: ${Object.keys(STATUS_BY_NAME).join(", ")}.`,
    );
    process.exit(1);
  }

  let recipientId: string | undefined;
  if (opts.mine) {
    if (!ctx.principalId) {
      printError(
        "--mine requires a Cognito session (api-key sessions have no user identity). Run `thinkwork login --stage <s>`.",
      );
      process.exit(1);
    }
    recipientId = ctx.principalId;
  }

  const data = await gqlQuery(ctx.client, InboxItemsDoc, {
    tenantId: ctx.tenantId,
    status,
    entityType: opts.entityType ?? null,
    entityId: opts.entityId ?? null,
    recipientId: recipientId ?? null,
  });

  const items = data.inboxItems ?? [];

  if (isJsonMode()) {
    printJson({ items });
    return;
  }

  const rows = items.map((item) => ({
    id: item.id,
    type: item.type,
    status: item.status,
    title: (item.title ?? "—").length > 40 ? `${(item.title ?? "").slice(0, 37)}…` : (item.title ?? "—"),
    requester: fmtRequester(item.requesterType, item.requesterId),
    age: fmtAge(item.createdAt),
  }));

  printTable(rows, [
    { key: "id", header: "ID" },
    { key: "type", header: "TYPE" },
    { key: "status", header: "STATUS" },
    { key: "title", header: "TITLE" },
    { key: "requester", header: "REQUESTER" },
    { key: "age", header: "AGE" },
  ]);
}

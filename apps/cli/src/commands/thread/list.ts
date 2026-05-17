import { gqlQuery } from "../../lib/gql-client.js";
import { isJsonMode, printJson, printTable } from "../../lib/output.js";
import { ThreadsDoc } from "./gql.js";
import {
  resolveThreadContext,
  resolveAssigneeFilter,
  fmtAssignee,
  fmtIso,
  type ThreadCliOptions,
} from "./helpers.js";

interface ListOptions extends ThreadCliOptions {
  assignee?: string;
  agent?: string;
  search?: string;
  limit?: string;
  archived?: boolean;
}

export async function runThreadList(opts: ListOptions): Promise<void> {
  const ctx = await resolveThreadContext(opts);
  const assigneeId = resolveAssigneeFilter(opts.assignee, ctx.principalId);
  const limit = Number.parseInt(opts.limit ?? "50", 10);

  const data = await gqlQuery(ctx.client, ThreadsDoc, {
    tenantId: ctx.tenantId,
    status: null,
    channel: null,
    agentId: opts.agent ?? null,
    assigneeId: assigneeId ?? null,
    search: opts.search ?? null,
    limit,
  });

  const items = data.threads ?? [];
  const filtered = opts.archived
    ? items
    : items.filter((t) => t.archivedAt == null);

  if (isJsonMode()) {
    printJson({ items: filtered });
    return;
  }

  const rows = filtered.map((t) => ({
    num: t.number != null ? `#${t.number}` : "—",
    id: t.id,
    status: t.status,
    title: t.title.length > 60 ? `${t.title.slice(0, 57)}…` : t.title,
    assignee: fmtAssignee(t.assigneeType, t.assigneeId),
    activity: fmtIso(t.lastActivityAt ?? t.createdAt),
  }));

  printTable(rows, [
    { key: "num", header: "NUM" },
    { key: "id", header: "ID" },
    { key: "status", header: "STATUS" },
    { key: "title", header: "TITLE" },
    { key: "assignee", header: "ASSIGNEE" },
    { key: "activity", header: "LAST ACTIVITY" },
  ]);
}

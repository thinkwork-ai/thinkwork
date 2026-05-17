import { gqlQuery } from "../../lib/gql-client.js";
import { isJsonMode, printJson, printKeyValue } from "../../lib/output.js";
import { printError } from "../../ui.js";
import { ThreadByIdDoc, ThreadByNumberDoc } from "./gql.js";
import {
  resolveThreadContext,
  parseIdOrNumber,
  fmtAssignee,
  fmtIso,
  type ThreadCliOptions,
} from "./helpers.js";

export async function runThreadGet(
  idOrNumber: string,
  opts: ThreadCliOptions,
): Promise<void> {
  const ctx = await resolveThreadContext(opts);
  const parsed = parseIdOrNumber(idOrNumber);

  const thread =
    parsed.kind === "id"
      ? (await gqlQuery(ctx.client, ThreadByIdDoc, { id: parsed.id })).thread ?? null
      : (
          await gqlQuery(ctx.client, ThreadByNumberDoc, {
            tenantId: ctx.tenantId,
            number: parsed.number,
          })
        ).threadByNumber ?? null;

  if (!thread) {
    printError(`Thread "${idOrNumber}" not found in tenant "${ctx.tenantSlug}".`);
    process.exit(1);
  }

  if (isJsonMode()) {
    printJson(thread);
    return;
  }

  printKeyValue([
    ["ID", thread.id],
    ["Number", `#${thread.number}`],
    ["Identifier", thread.identifier ?? undefined],
    ["Title", thread.title],
    ["Status", thread.status],
    ["Channel", thread.channel],
    ["Assignee", fmtAssignee(thread.assigneeType, thread.assigneeId)],
    ["Agent", thread.agentId ?? undefined],
    ["Reporter", thread.reporterId ?? undefined],
    ["Billing code", thread.billingCode ?? undefined],
    ["Due", fmtIso(thread.dueAt)],
    ["Started", fmtIso(thread.startedAt)],
    ["Completed", fmtIso(thread.completedAt)],
    ["Archived", fmtIso(thread.archivedAt)],
    ["Last activity", fmtIso(thread.lastActivityAt)],
    ["Created", fmtIso(thread.createdAt)],
    ["Updated", fmtIso(thread.updatedAt)],
  ]);

  if (thread.lastResponsePreview) {
    console.log("");
    console.log("  Last response preview:");
    console.log(`  ${thread.lastResponsePreview}`);
  }
}

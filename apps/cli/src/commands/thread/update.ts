import { gqlMutate } from "../../lib/gql-client.js";
import { isJsonMode, printJson } from "../../lib/output.js";
import { printError, printSuccess } from "../../ui.js";
import { UpdateThreadDoc } from "./gql.js";
import { resolveThreadContext, type ThreadCliOptions } from "./helpers.js";

interface UpdateOptions extends ThreadCliOptions {
  title?: string;
  assignee?: string;
  due?: string;
}

export async function runThreadUpdate(
  id: string,
  opts: UpdateOptions,
): Promise<void> {
  const ctx = await resolveThreadContext(opts);

  const input: Record<string, unknown> = {};
  if (opts.title !== undefined) input.title = opts.title;
  if (opts.assignee !== undefined) input.assigneeId = opts.assignee;
  if (opts.due !== undefined) input.dueAt = opts.due;

  if (Object.keys(input).length === 0) {
    printError("Nothing to update. Pass at least one of --title, --assignee, --due.");
    process.exit(1);
  }

  const data = await gqlMutate(ctx.client, UpdateThreadDoc, { id, input });
  const updated = data.updateThread;

  if (isJsonMode()) {
    printJson(updated);
    return;
  }
  printSuccess(
    `Updated thread ${updated.id} (#${updated.number}) — ${updated.title}`,
  );
}

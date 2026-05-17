import { readFile } from "node:fs/promises";
import { input } from "@inquirer/prompts";
import { gqlMutate } from "../../lib/gql-client.js";
import { isInteractive, promptOrExit, requireTty } from "../../lib/interactive.js";
import { isJsonMode, printJson } from "../../lib/output.js";
import { printError, printSuccess } from "../../ui.js";
import { AddInboxItemCommentDoc } from "./gql.js";
import { resolveInboxContext, type InboxCliOptions } from "./helpers.js";

interface CommentOptions extends InboxCliOptions {
  file?: string;
}

export async function runInboxComment(
  inboxItemId: string,
  content: string | undefined,
  opts: CommentOptions,
): Promise<void> {
  const ctx = await resolveInboxContext(opts);

  let resolved = content;
  if (!resolved && opts.file) {
    resolved = await readFile(opts.file, "utf-8");
  }
  if (!resolved) {
    if (!isInteractive()) {
      printError(
        "Comment content required. Pass it as an arg, use --file, or run in a TTY.",
      );
      process.exit(1);
    }
    requireTty("Comment content");
    resolved = await promptOrExit(() => input({ message: "Comment:" }));
  }

  const data = await gqlMutate(ctx.client, AddInboxItemCommentDoc, {
    input: {
      inboxItemId,
      content: resolved,
      authorType: ctx.principalId ? "user" : null,
      authorId: ctx.principalId,
    },
  });
  const c = data.addInboxItemComment;

  if (isJsonMode()) {
    printJson(c);
    return;
  }
  printSuccess(`Posted comment on inbox item ${inboxItemId} (comment ${c.id})`);
}

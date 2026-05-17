import { readFile } from "node:fs/promises";
import { input } from "@inquirer/prompts";
import { gqlMutate } from "../../lib/gql-client.js";
import { MessageRole } from "../../gql/graphql.js";
import { isInteractive, promptOrExit, requireTty } from "../../lib/interactive.js";
import { isJsonMode, printJson } from "../../lib/output.js";
import { printError, printSuccess } from "../../ui.js";
import { SendMessageDoc } from "./gql.js";
import { resolveThreadContext, type ThreadCliOptions } from "./helpers.js";

interface CommentOptions extends ThreadCliOptions {
  file?: string;
}

export async function runThreadComment(
  threadId: string,
  content: string | undefined,
  opts: CommentOptions,
): Promise<void> {
  const ctx = await resolveThreadContext(opts);

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

  // `thread comment` maps to a USER message on the thread. The schema has no
  // separate "operator comment" entity; comments and messages share a row in
  // the same conversation list (admin + mobile distinguish visually).
  const data = await gqlMutate(ctx.client, SendMessageDoc, {
    input: {
      threadId,
      role: MessageRole.User,
      content: resolved,
      senderType: ctx.principalId ? "user" : null,
      senderId: ctx.principalId,
    },
  });
  const msg = data.sendMessage;

  if (isJsonMode()) {
    printJson(msg);
    return;
  }
  printSuccess(`Posted comment on ${threadId} (message ${msg.id})`);
}

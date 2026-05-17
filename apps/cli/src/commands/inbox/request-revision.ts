import { input } from "@inquirer/prompts";
import { gqlMutate } from "../../lib/gql-client.js";
import { isInteractive, promptOrExit, requireTty } from "../../lib/interactive.js";
import { isJsonMode, printJson } from "../../lib/output.js";
import { printError, printSuccess } from "../../ui.js";
import { RequestRevisionDoc } from "./gql.js";
import { resolveInboxContext, type InboxCliOptions } from "./helpers.js";

interface RequestRevisionOptions extends InboxCliOptions {
  notes?: string;
}

export async function runInboxRequestRevision(
  id: string,
  opts: RequestRevisionOptions,
): Promise<void> {
  const ctx = await resolveInboxContext(opts);

  let resolvedNotes = opts.notes;
  if (!resolvedNotes) {
    if (!isInteractive()) {
      printError(
        "--notes is required (the API mandates a non-null reason). Pass it as a flag.",
      );
      process.exit(1);
    }
    requireTty("Revision notes");
    resolvedNotes = await promptOrExit(() =>
      input({ message: "What needs to change?" }),
    );
  }

  const data = await gqlMutate(ctx.client, RequestRevisionDoc, {
    id,
    input: { reviewNotes: resolvedNotes! },
  });
  const item = data.requestRevision;

  if (isJsonMode()) {
    printJson(item);
    return;
  }
  printSuccess(
    `Revision requested on inbox item ${item.id} (revision #${item.revision})`,
  );
}

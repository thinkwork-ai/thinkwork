import { input } from "@inquirer/prompts";
import { gqlMutate, gqlQuery } from "../../lib/gql-client.js";
import { isInteractive, promptOrExit, requireTty } from "../../lib/interactive.js";
import { isJsonMode, printJson } from "../../lib/output.js";
import { printError, printSuccess } from "../../ui.js";
import {
  AssignThreadLabelDoc,
  CreateThreadDoc,
  ThreadLabelsForResolveDoc,
} from "./gql.js";
import { resolveThreadContext, type ThreadCliOptions } from "./helpers.js";

interface CreateOptions extends ThreadCliOptions {
  assignee?: string;
  due?: string;
  label?: string[];
}

export async function runThreadCreate(
  title: string | undefined,
  opts: CreateOptions,
): Promise<void> {
  const ctx = await resolveThreadContext(opts);
  const interactive = isInteractive();

  let resolvedTitle = title;
  if (!resolvedTitle) {
    if (!interactive) {
      printError("Title is required in non-interactive mode. Pass it as the first argument.");
      process.exit(1);
    }
    requireTty("Thread title");
    resolvedTitle = await promptOrExit(() =>
      input({ message: "Thread title:" }),
    );
  }

  let resolvedAssignee = opts.assignee;
  if (!resolvedAssignee && interactive) {
    requireTty("Assignee");
    const ans = await promptOrExit(() =>
      input({
        message: "Assignee (user or agent ID, blank to skip):",
        default: "",
      }),
    );
    if (ans.trim() !== "") resolvedAssignee = ans.trim();
  }

  // Resolve label names → IDs up front so the create call carries them
  // as metadata and the post-create assign calls can attach them.
  const labelIds: string[] = [];
  if (opts.label && opts.label.length > 0) {
    const data = await gqlQuery(ctx.client, ThreadLabelsForResolveDoc, {
      tenantId: ctx.tenantId,
    });
    const byName = new Map(
      (data.threadLabels ?? []).map((l) => [l.name.toLowerCase(), l.id]),
    );
    for (const name of opts.label) {
      const id = byName.get(name.toLowerCase());
      if (!id) {
        printError(
          `Label "${name}" not found in tenant. Create it first via \`thinkwork label create ${name}\`.`,
        );
        process.exit(1);
      }
      labelIds.push(id);
    }
  }

  const created = await gqlMutate(ctx.client, CreateThreadDoc, {
    input: {
      tenantId: ctx.tenantId,
      title: resolvedTitle!,
      assigneeId: resolvedAssignee ?? null,
      dueAt: opts.due ?? null,
    },
  });
  const thread = created.createThread;

  for (const labelId of labelIds) {
    await gqlMutate(ctx.client, AssignThreadLabelDoc, {
      threadId: thread.id,
      labelId,
    });
  }

  if (isJsonMode()) {
    printJson({ thread, labelIds });
    return;
  }
  printSuccess(`Created thread ${thread.id} (#${thread.number}) — ${thread.title}`);
  if (labelIds.length > 0) {
    console.log(`  Labels attached: ${labelIds.join(", ")}`);
  }
}

import { confirm } from "@inquirer/prompts";
import { gqlMutate, gqlQuery } from "../../lib/gql-client.js";
import { isInteractive, promptOrExit, requireTty } from "../../lib/interactive.js";
import { isJsonMode, logStderr, printJson, printTable } from "../../lib/output.js";
import { printError, printSuccess } from "../../ui.js";
import { AgentVersionsDoc, RollbackAgentVersionDoc } from "./gql.js";
import { resolveAgentContext, fmtIso, type AgentCliOptions } from "./helpers.js";

interface ListOptions extends AgentCliOptions {
  limit?: string;
}

export async function runAgentVersionList(
  agentId: string,
  opts: ListOptions,
): Promise<void> {
  const ctx = await resolveAgentContext(opts);
  const limit = opts.limit ? Number.parseInt(opts.limit, 10) : 20;
  const data = await gqlQuery(ctx.client, AgentVersionsDoc, { agentId, limit });
  const items = data.agentVersions ?? [];
  if (isJsonMode()) {
    printJson({ items });
    return;
  }
  printTable(
    items.map((v) => ({
      id: v.id,
      n: `v${v.versionNumber}`,
      author: v.createdBy ?? "—",
      created: fmtIso(v.createdAt),
    })),
    [
      { key: "id", header: "VERSION ID" },
      { key: "n", header: "N" },
      { key: "author", header: "AUTHOR" },
      { key: "created", header: "CREATED" },
    ],
  );
}

interface RollbackOptions extends AgentCliOptions {
  yes?: boolean;
}

export async function runAgentVersionRollback(
  agentId: string,
  versionId: string,
  opts: RollbackOptions,
): Promise<void> {
  const ctx = await resolveAgentContext(opts);
  if (!opts.yes) {
    if (!isInteractive()) {
      printError("Refusing to rollback without --yes in a non-interactive session.");
      process.exit(1);
    }
    requireTty("Confirmation");
    const go = await promptOrExit(() =>
      confirm({
        message: `Rollback agent ${agentId} to version ${versionId}? A new version pointing at the old config is created.`,
        default: false,
      }),
    );
    if (!go) {
      logStderr("Cancelled.");
      process.exit(0);
    }
  }
  const data = await gqlMutate(ctx.client, RollbackAgentVersionDoc, {
    agentId,
    versionId,
  });
  if (isJsonMode()) {
    printJson(data.rollbackAgentVersion);
    return;
  }
  printSuccess(
    `Rolled back agent ${data.rollbackAgentVersion.id} to version ${versionId} (now v${data.rollbackAgentVersion.version}).`,
  );
}

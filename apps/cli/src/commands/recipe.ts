/**
 * `thinkwork recipe ...` — saved MCP tool invocations.
 */

import { Command } from "commander";
import { confirm, input } from "@inquirer/prompts";
import { graphql } from "../gql/index.js";
import { loadStageSession } from "../cli-config.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { getGqlClient, gqlMutate, gqlQuery } from "../lib/gql-client.js";
import { isInteractive, promptOrExit, requireTty } from "../lib/interactive.js";
import { isJsonMode, logStderr, printJson, printKeyValue, printTable } from "../lib/output.js";
import { printError, printMissingApiSessionError, printSuccess } from "../ui.js";

const RecipesDoc = graphql(`
  query CliRecipes($tenantId: ID!, $threadId: ID, $agentId: ID, $limit: Int, $cursor: String) {
    recipes(tenantId: $tenantId, threadId: $threadId, agentId: $agentId, limit: $limit, cursor: $cursor) {
      id
      title
      server
      tool
      genuiType
      agentId
      threadId
      lastRefreshed
      createdAt
    }
  }
`);

const RecipeDoc = graphql(`
  query CliRecipe($id: ID!) {
    recipe(id: $id) {
      id
      title
      summary
      server
      tool
      params
      genuiType
      templates
      cachedResult
      lastRefreshed
      lastError
      agentId
      threadId
      sourceMessageId
      createdAt
      updatedAt
    }
  }
`);

const CreateRecipeDoc = graphql(`
  mutation CliCreateRecipe($input: CreateRecipeInput!) {
    createRecipe(input: $input) {
      id
      title
      server
      tool
    }
  }
`);

const UpdateRecipeDoc = graphql(`
  mutation CliUpdateRecipe($id: ID!, $input: UpdateRecipeInput!) {
    updateRecipe(id: $id, input: $input) {
      id
      title
    }
  }
`);

const DeleteRecipeDoc = graphql(`
  mutation CliDeleteRecipe($id: ID!) {
    deleteRecipe(id: $id)
  }
`);

const RecipeTenantBySlugDoc = graphql(`
  query CliRecipeTenantBySlug($slug: String!) {
    tenantBySlug(slug: $slug) {
      id
    }
  }
`);

interface RecipeCliOptions {
  stage?: string;
  region?: string;
  tenant?: string;
}

async function resolveRecipeContext(opts: RecipeCliOptions) {
  const region = opts.region ?? "us-east-1";
  const stage = await resolveStage({ flag: opts.stage, region });
  const session = loadStageSession(stage);
  const { client, tenantSlug: ctxSlug } = await getGqlClient({ stage, region });
  const flagOrEnv = opts.tenant ?? process.env.THINKWORK_TENANT;
  if (flagOrEnv) {
    if (session?.tenantSlug === flagOrEnv && session.tenantId) {
      return { stage, region, client, tenantId: session.tenantId };
    }
    const data = await gqlQuery(client, RecipeTenantBySlugDoc, { slug: flagOrEnv });
    if (!data.tenantBySlug) {
      printError(`Tenant "${flagOrEnv}" not found.`);
      process.exit(1);
    }
    return { stage, region, client, tenantId: data.tenantBySlug.id };
  }
  if (session?.tenantId) return { stage, region, client, tenantId: session.tenantId };
  if (ctxSlug) {
    const data = await gqlQuery(client, RecipeTenantBySlugDoc, { slug: ctxSlug });
    if (data.tenantBySlug) return { stage, region, client, tenantId: data.tenantBySlug.id };
  }
  printMissingApiSessionError(stage, session !== null);
  process.exit(1);
}

interface ListOptions extends RecipeCliOptions {
  thread?: string;
  agent?: string;
  limit?: string;
}

async function runRecipeList(opts: ListOptions): Promise<void> {
  const ctx = await resolveRecipeContext(opts);
  const data = await gqlQuery(ctx.client, RecipesDoc, {
    tenantId: ctx.tenantId,
    threadId: opts.thread ?? null,
    agentId: opts.agent ?? null,
    limit: opts.limit ? Number.parseInt(opts.limit, 10) : 25,
    cursor: null,
  });
  const items = data.recipes ?? [];
  if (isJsonMode()) {
    printJson({ items });
    return;
  }
  printTable(
    items.map((r) => ({
      id: r.id,
      title: r.title,
      tool: `${r.server}/${r.tool}`,
      kind: r.genuiType,
    })),
    [
      { key: "id", header: "RECIPE ID" },
      { key: "title", header: "TITLE" },
      { key: "tool", header: "TOOL" },
      { key: "kind", header: "KIND" },
    ],
  );
}

async function runRecipeGet(id: string, opts: RecipeCliOptions): Promise<void> {
  const ctx = await resolveRecipeContext(opts);
  const data = await gqlQuery(ctx.client, RecipeDoc, { id });
  const r = data.recipe;
  if (!r) {
    printError(`Recipe ${id} not found.`);
    process.exit(1);
  }
  if (isJsonMode()) {
    printJson(r);
    return;
  }
  printKeyValue([
    ["ID", r.id],
    ["Title", r.title],
    ["Summary", r.summary ?? undefined],
    ["Server", r.server],
    ["Tool", r.tool],
    ["GenUI type", r.genuiType],
    ["Agent", r.agentId ?? undefined],
    ["Thread", r.threadId ?? undefined],
    ["Last refreshed", r.lastRefreshed ?? undefined],
    ["Last error", r.lastError ?? undefined],
  ]);
}

interface CreateOptions extends RecipeCliOptions {
  tool?: string;
  params?: string;
  scope?: string;
  thread?: string;
  agent?: string;
}

async function runRecipeCreate(name: string | undefined, opts: CreateOptions): Promise<void> {
  const ctx = await resolveRecipeContext(opts);
  let title = name;
  if (!title) {
    if (!isInteractive()) {
      printError("Recipe name required in non-interactive mode.");
      process.exit(1);
    }
    requireTty("Recipe name");
    title = await promptOrExit(() => input({ message: "Recipe title:" }));
  }
  if (!opts.tool) {
    printError("--tool <server/tool> is required.");
    process.exit(1);
  }
  const parts = opts.tool.split("/");
  if (parts.length !== 2) {
    printError("--tool must be \"server/tool\" (e.g. github/list_pulls).");
    process.exit(1);
  }
  const [server, tool] = parts;
  let params: unknown = {};
  if (opts.params) {
    try {
      params = JSON.parse(opts.params);
    } catch (err) {
      printError(`--params is not valid JSON: ${(err as Error).message}`);
      process.exit(1);
    }
  }
  const data = await gqlMutate(ctx.client, CreateRecipeDoc, {
    input: {
      tenantId: ctx.tenantId,
      title: title!,
      server,
      tool,
      params,
      genuiType: "default",
      agentId: opts.agent ?? null,
      threadId: opts.thread ?? null,
    },
  });
  if (isJsonMode()) {
    printJson(data.createRecipe);
    return;
  }
  printSuccess(`Created recipe ${data.createRecipe.id} — ${data.createRecipe.title}.`);
}

interface UpdateOptions extends RecipeCliOptions {
  title?: string;
  summary?: string;
  params?: string;
}

async function runRecipeUpdate(id: string, opts: UpdateOptions): Promise<void> {
  const ctx = await resolveRecipeContext(opts);
  const input: Record<string, unknown> = {};
  if (opts.title !== undefined) input.title = opts.title;
  if (opts.summary !== undefined) input.summary = opts.summary;
  if (opts.params !== undefined) {
    try {
      input.params = JSON.parse(opts.params);
    } catch (err) {
      printError(`--params is not valid JSON: ${(err as Error).message}`);
      process.exit(1);
    }
  }
  if (Object.keys(input).length === 0) {
    printError("Nothing to update.");
    process.exit(1);
  }
  const data = await gqlMutate(ctx.client, UpdateRecipeDoc, { id, input });
  if (isJsonMode()) {
    printJson(data.updateRecipe);
    return;
  }
  printSuccess(`Updated recipe ${data.updateRecipe.id}.`);
}

interface DeleteOptions extends RecipeCliOptions {
  yes?: boolean;
}

async function runRecipeDelete(id: string, opts: DeleteOptions): Promise<void> {
  const ctx = await resolveRecipeContext(opts);
  if (!opts.yes) {
    if (!isInteractive()) {
      printError("Refusing to delete without --yes.");
      process.exit(1);
    }
    requireTty("Confirmation");
    const go = await promptOrExit(() => confirm({ message: `Delete recipe ${id}?`, default: false }));
    if (!go) {
      logStderr("Cancelled.");
      process.exit(0);
    }
  }
  const data = await gqlMutate(ctx.client, DeleteRecipeDoc, { id });
  if (isJsonMode()) {
    printJson({ id, deleted: data.deleteRecipe });
    return;
  }
  if (data.deleteRecipe) printSuccess(`Deleted recipe ${id}.`);
  else printError(`Server reported not-deleted for ${id}.`);
}

export function registerRecipeCommand(program: Command): void {
  const recipe = program
    .command("recipe")
    .alias("recipes")
    .description("Manage saved MCP tool invocations (parameterized one-click actions).");

  recipe
    .command("list")
    .alias("ls")
    .description("List recipes in the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--thread <id>", "Filter by thread scope")
    .option("--agent <id>", "Filter by agent scope")
    .option("--limit <n>", "Max rows", "25")
    .action(runRecipeList);

  recipe
    .command("get <id>")
    .description("Fetch one recipe.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runRecipeGet);

  recipe
    .command("create [name]")
    .description("Create a new recipe.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--tool <server/tool>", "MCP server + tool (e.g. github/list_pulls)")
    .option("--params <json>", "Recipe params as JSON")
    .option("--scope <s>", "tenant | agent | thread (informational)")
    .option("--thread <id>", "Scope to a thread")
    .option("--agent <id>", "Scope to an agent")
    .action(runRecipeCreate);

  recipe
    .command("update <id>")
    .description("Update a recipe's title, summary, or params.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--title <t>")
    .option("--summary <s>")
    .option("--params <json>")
    .action(runRecipeUpdate);

  recipe
    .command("delete <id>")
    .description("Delete a recipe.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(runRecipeDelete);
}

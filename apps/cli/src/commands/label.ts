/**
 * `thinkwork label ...` — thread labels (tenant-wide tags).
 *
 * Implementations inline (only 4 subcommands).
 */

import { Command } from "commander";
import { confirm, input } from "@inquirer/prompts";
import { graphql } from "../gql/index.js";
import { loadStageSession } from "../cli-config.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { getGqlClient, gqlMutate, gqlQuery } from "../lib/gql-client.js";
import { isInteractive, promptOrExit, requireTty } from "../lib/interactive.js";
import { isJsonMode, logStderr, printJson, printTable } from "../lib/output.js";
import { printError, printMissingApiSessionError, printSuccess } from "../ui.js";

const ThreadLabelsDoc = graphql(`
  query CliLabelList($tenantId: ID!) {
    threadLabels(tenantId: $tenantId) {
      id
      name
      color
      description
      createdAt
    }
  }
`);

const CreateThreadLabelDoc = graphql(`
  mutation CliLabelCreate($input: CreateThreadLabelInput!) {
    createThreadLabel(input: $input) {
      id
      name
      color
      description
    }
  }
`);

const UpdateThreadLabelDoc = graphql(`
  mutation CliLabelUpdate($id: ID!, $input: UpdateThreadLabelInput!) {
    updateThreadLabel(id: $id, input: $input) {
      id
      name
      color
      description
    }
  }
`);

const DeleteThreadLabelDoc = graphql(`
  mutation CliLabelDelete($id: ID!) {
    deleteThreadLabel(id: $id)
  }
`);

const LabelTenantBySlugDoc = graphql(`
  query CliLabelTenantBySlug($slug: String!) {
    tenantBySlug(slug: $slug) {
      id
      slug
      name
    }
  }
`);

interface LabelCliOptions {
  stage?: string;
  region?: string;
  tenant?: string;
}

interface CreateOptions extends LabelCliOptions {
  color?: string;
  description?: string;
}

interface UpdateOptions extends LabelCliOptions {
  name?: string;
  color?: string;
  description?: string;
}

interface DeleteOptions extends LabelCliOptions {
  yes?: boolean;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function validateColor(raw: string): string {
  if (!HEX_COLOR_RE.test(raw)) {
    printError(
      `Invalid color "${raw}". Expected hex like #10b981 (6 chars after #).`,
    );
    process.exit(1);
  }
  return raw;
}

async function resolveLabelContext(opts: LabelCliOptions) {
  const region = opts.region ?? "us-east-1";
  const stage = await resolveStage({ flag: opts.stage, region });
  const session = loadStageSession(stage);
  const { client, tenantSlug: ctxTenantSlug } = await getGqlClient({ stage, region });

  const flagOrEnv = opts.tenant ?? process.env.THINKWORK_TENANT;

  if (flagOrEnv) {
    if (session?.tenantSlug === flagOrEnv && session.tenantId) {
      return { stage, region, client, tenantId: session.tenantId, tenantSlug: flagOrEnv };
    }
    const data = await gqlQuery(client, LabelTenantBySlugDoc, { slug: flagOrEnv });
    if (!data.tenantBySlug) {
      printError(`Tenant "${flagOrEnv}" not found.`);
      process.exit(1);
    }
    return {
      stage,
      region,
      client,
      tenantId: data.tenantBySlug.id,
      tenantSlug: data.tenantBySlug.slug,
    };
  }

  if (session?.tenantId && session.tenantSlug) {
    return {
      stage,
      region,
      client,
      tenantId: session.tenantId,
      tenantSlug: session.tenantSlug,
    };
  }

  if (ctxTenantSlug) {
    const data = await gqlQuery(client, LabelTenantBySlugDoc, { slug: ctxTenantSlug });
    if (data.tenantBySlug) {
      return {
        stage,
        region,
        client,
        tenantId: data.tenantBySlug.id,
        tenantSlug: data.tenantBySlug.slug,
      };
    }
  }

  printMissingApiSessionError(stage, session !== null);
  process.exit(1);
}

async function runLabelList(opts: LabelCliOptions): Promise<void> {
  const ctx = await resolveLabelContext(opts);
  const data = await gqlQuery(ctx.client, ThreadLabelsDoc, { tenantId: ctx.tenantId });
  const items = data.threadLabels ?? [];

  if (isJsonMode()) {
    printJson({ items });
    return;
  }

  const rows = items.map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color ?? "—",
    description: l.description ?? "—",
  }));

  printTable(rows, [
    { key: "id", header: "ID" },
    { key: "name", header: "NAME" },
    { key: "color", header: "COLOR" },
    { key: "description", header: "DESCRIPTION" },
  ]);
}

async function runLabelCreate(
  name: string | undefined,
  opts: CreateOptions,
): Promise<void> {
  const ctx = await resolveLabelContext(opts);
  const interactive = isInteractive();

  let resolvedName = name;
  if (!resolvedName) {
    if (!interactive) {
      printError("Label name is required in non-interactive mode.");
      process.exit(1);
    }
    requireTty("Label name");
    resolvedName = await promptOrExit(() => input({ message: "Label name:" }));
  }

  let resolvedColor = opts.color;
  if (!resolvedColor && interactive) {
    requireTty("Label color");
    const ans = await promptOrExit(() =>
      input({ message: "Color (hex, blank to skip):", default: "" }),
    );
    if (ans.trim() !== "") resolvedColor = ans.trim();
  }
  if (resolvedColor) validateColor(resolvedColor);

  const data = await gqlMutate(ctx.client, CreateThreadLabelDoc, {
    input: {
      tenantId: ctx.tenantId,
      name: resolvedName!,
      color: resolvedColor ?? null,
      description: opts.description ?? null,
    },
  });
  const label = data.createThreadLabel;

  if (isJsonMode()) {
    printJson(label);
    return;
  }
  printSuccess(`Created label ${label.id} — ${label.name}`);
}

async function runLabelUpdate(id: string, opts: UpdateOptions): Promise<void> {
  const ctx = await resolveLabelContext(opts);

  const input: Record<string, unknown> = {};
  if (opts.name !== undefined) input.name = opts.name;
  if (opts.color !== undefined) input.color = validateColor(opts.color);
  if (opts.description !== undefined) input.description = opts.description;

  if (Object.keys(input).length === 0) {
    printError("Nothing to update. Pass at least one of --name, --color, --description.");
    process.exit(1);
  }

  const data = await gqlMutate(ctx.client, UpdateThreadLabelDoc, { id, input });
  const updated = data.updateThreadLabel;

  if (isJsonMode()) {
    printJson(updated);
    return;
  }
  printSuccess(`Updated label ${updated.id} — ${updated.name}`);
}

async function runLabelDelete(id: string, opts: DeleteOptions): Promise<void> {
  const ctx = await resolveLabelContext(opts);

  if (!opts.yes) {
    if (!isInteractive()) {
      printError("Refusing to delete without --yes in a non-interactive session.");
      process.exit(1);
    }
    requireTty("Confirmation");
    const go = await promptOrExit(() =>
      confirm({
        message: `Delete label ${id}? Any thread assignments will be removed.`,
        default: false,
      }),
    );
    if (!go) {
      logStderr("Cancelled.");
      process.exit(0);
    }
  }

  const data = await gqlMutate(ctx.client, DeleteThreadLabelDoc, { id });
  if (isJsonMode()) {
    printJson({ id, deleted: data.deleteThreadLabel });
    return;
  }
  if (data.deleteThreadLabel) printSuccess(`Deleted label ${id}.`);
  else printError(`Server reported not-deleted for ${id}.`);
}

export function registerLabelCommand(program: Command): void {
  const label = program
    .command("label")
    .alias("labels")
    .description("Manage tenant-wide thread labels (tags).");

  label
    .command("list")
    .alias("ls")
    .description("List all labels in the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runLabelList);

  label
    .command("create [name]")
    .description("Create a new label. Prompts for missing fields in TTY.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--color <hex>", "Label color as a hex string (e.g. #10b981)")
    .option("--description <text>", "What the label is for")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork label create ops --color "#10b981"
  $ thinkwork label create                     # interactive
`,
    )
    .action(runLabelCreate);

  label
    .command("update <id>")
    .description("Rename or recolor an existing label.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--name <n>")
    .option("--color <hex>")
    .option("--description <text>")
    .action(runLabelUpdate);

  label
    .command("delete <id>")
    .description("Delete a label. Any thread assignments are removed.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(runLabelDelete);
}

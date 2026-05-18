/**
 * `thinkwork template ...` — agent templates and template-linked agents.
 *
 * Implementations inline. diff and --from-agent compose client-side.
 * --system-prompt-file is currently a no-op warning — prompt content lives
 * in the template's linked workspace files and needs richer admin UI flow.
 */

import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { confirm, input } from "@inquirer/prompts";
import { graphql } from "../gql/index.js";
import { loadStageSession } from "../cli-config.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { getGqlClient, gqlMutate, gqlQuery } from "../lib/gql-client.js";
import { isInteractive, promptOrExit, requireTty } from "../lib/interactive.js";
import { isJsonMode, logStderr, printJson, printKeyValue, printTable } from "../lib/output.js";
import { printError, printMissingApiSessionError, printSuccess, printWarning } from "../ui.js";

const AgentTemplatesDoc = graphql(`
  query CliAgentTemplates($tenantId: ID!) {
    agentTemplates(tenantId: $tenantId) {
      id
      name
      slug
      category
      runtime
      templateKind
      model
      isPublished
      createdAt
    }
  }
`);

const AgentTemplateDoc = graphql(`
  query CliAgentTemplate($id: ID!) {
    agentTemplate(id: $id) {
      id
      tenantId
      name
      slug
      description
      category
      icon
      runtime
      templateKind
      model
      guardrailId
      isPublished
      createdAt
      updatedAt
    }
  }
`);

const CreateAgentTemplateDoc = graphql(`
  mutation CliCreateAgentTemplate($input: CreateAgentTemplateInput!) {
    createAgentTemplate(input: $input) {
      id
      name
      slug
      isPublished
    }
  }
`);

const UpdateAgentTemplateDoc = graphql(`
  mutation CliUpdateAgentTemplate($id: ID!, $input: UpdateAgentTemplateInput!) {
    updateAgentTemplate(id: $id, input: $input) {
      id
      name
      slug
      model
      description
    }
  }
`);

const DeleteAgentTemplateDoc = graphql(`
  mutation CliDeleteAgentTemplate($id: ID!) {
    deleteAgentTemplate(id: $id)
  }
`);

const SyncTemplateToAgentDoc = graphql(`
  mutation CliSyncTemplateToAgent($templateId: ID!, $agentId: ID!) {
    syncTemplateToAgent(templateId: $templateId, agentId: $agentId) {
      id
      name
      status
    }
  }
`);

const SyncTemplateToAllAgentsDoc = graphql(`
  mutation CliSyncTemplateToAllAgents($templateId: ID!) {
    syncTemplateToAllAgents(templateId: $templateId) {
      agentsSynced
      agentsFailed
      errors
    }
  }
`);

const AgentForCloneDoc = graphql(`
  query CliAgentForClone($id: ID!) {
    agent(id: $id) {
      id
      name
      role
      systemPrompt
      runtime
      agentTemplate {
        id
        model
      }
    }
  }
`);

const TemplateTenantBySlugDoc = graphql(`
  query CliTemplateTenantBySlug($slug: String!) {
    tenantBySlug(slug: $slug) {
      id
    }
  }
`);

interface TplCliOptions {
  stage?: string;
  region?: string;
  tenant?: string;
}

async function resolveTplContext(opts: TplCliOptions) {
  const region = opts.region ?? "us-east-1";
  const stage = await resolveStage({ flag: opts.stage, region });
  const session = loadStageSession(stage);
  const { client, tenantSlug: ctxTenantSlug } = await getGqlClient({ stage, region });

  const flagOrEnv = opts.tenant ?? process.env.THINKWORK_TENANT;
  if (flagOrEnv) {
    if (session?.tenantSlug === flagOrEnv && session.tenantId) {
      return { stage, region, client, tenantId: session.tenantId };
    }
    const data = await gqlQuery(client, TemplateTenantBySlugDoc, { slug: flagOrEnv });
    if (!data.tenantBySlug) {
      printError(`Tenant "${flagOrEnv}" not found.`);
      process.exit(1);
    }
    return { stage, region, client, tenantId: data.tenantBySlug.id };
  }
  if (session?.tenantId) {
    return { stage, region, client, tenantId: session.tenantId };
  }
  if (ctxTenantSlug) {
    const data = await gqlQuery(client, TemplateTenantBySlugDoc, { slug: ctxTenantSlug });
    if (data.tenantBySlug) {
      return { stage, region, client, tenantId: data.tenantBySlug.id };
    }
  }
  printMissingApiSessionError(stage, session !== null);
  process.exit(1);
}

function fmtIso(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function nameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || `tpl-${Date.now()}`;
}

async function runTemplateList(opts: TplCliOptions): Promise<void> {
  const ctx = await resolveTplContext(opts);
  const data = await gqlQuery(ctx.client, AgentTemplatesDoc, { tenantId: ctx.tenantId });
  const items = data.agentTemplates ?? [];
  if (isJsonMode()) {
    printJson({ items });
    return;
  }
  printTable(
    items.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      runtime: t.runtime,
      kind: t.templateKind,
      model: t.model ?? "—",
      published: t.isPublished ? "yes" : "no",
    })),
    [
      { key: "id", header: "ID" },
      { key: "name", header: "NAME" },
      { key: "slug", header: "SLUG" },
      { key: "runtime", header: "RUNTIME" },
      { key: "kind", header: "KIND" },
      { key: "model", header: "MODEL" },
      { key: "published", header: "PUB" },
    ],
  );
}

async function runTemplateGet(id: string, opts: TplCliOptions): Promise<void> {
  const ctx = await resolveTplContext(opts);
  const data = await gqlQuery(ctx.client, AgentTemplateDoc, { id });
  const t = data.agentTemplate;
  if (!t) {
    printError(`Template ${id} not found.`);
    process.exit(1);
  }
  if (isJsonMode()) {
    printJson(t);
    return;
  }
  printKeyValue([
    ["ID", t.id],
    ["Name", t.name],
    ["Slug", t.slug],
    ["Description", t.description ?? undefined],
    ["Category", t.category ?? undefined],
    ["Icon", t.icon ?? undefined],
    ["Runtime", t.runtime],
    ["Kind", t.templateKind],
    ["Model", t.model ?? undefined],
    ["Guardrail ID", t.guardrailId ?? undefined],
    ["Published", t.isPublished ? "yes" : "no"],
    ["Created", fmtIso(t.createdAt)],
    ["Updated", fmtIso(t.updatedAt)],
  ]);
}

interface CreateOptions extends TplCliOptions {
  fromAgent?: string;
  systemPromptFile?: string;
  model?: string;
  description?: string;
}

async function runTemplateCreate(
  name: string | undefined,
  opts: CreateOptions,
): Promise<void> {
  const ctx = await resolveTplContext(opts);
  const interactive = isInteractive();

  if (opts.systemPromptFile) {
    printWarning(
      "--system-prompt-file is not yet wired in the CLI — template prompts live in linked workspace files. Edit them via the admin UI after create.",
    );
  }

  // Optionally clone fields from an existing agent. Agent has no direct
  // description field; we pull description from the linked template (if any).
  let cloned: { name?: string | null; description?: string | null; model?: string | null } = {};
  if (opts.fromAgent) {
    const a = await gqlQuery(ctx.client, AgentForCloneDoc, { id: opts.fromAgent });
    if (!a.agent) {
      printError(`Source agent ${opts.fromAgent} not found.`);
      process.exit(1);
    }
    cloned = {
      name: a.agent.name,
      description: a.agent.role ?? null,
      model: a.agent.agentTemplate?.model ?? null,
    };
  }

  let resolvedName = name ?? cloned.name ?? undefined;
  if (!resolvedName) {
    if (!interactive) {
      printError("Template name required in non-interactive mode (pass [name] or use --from-agent).");
      process.exit(1);
    }
    requireTty("Template name");
    resolvedName = await promptOrExit(() => input({ message: "Template name:" }));
  }

  const createInput = {
    tenantId: ctx.tenantId,
    name: resolvedName!,
    slug: nameToSlug(resolvedName!),
    description: opts.description ?? cloned.description ?? null,
    model: opts.model ?? cloned.model ?? null,
  };

  const data = await gqlMutate(ctx.client, CreateAgentTemplateDoc, {
    input: createInput,
  });
  if (isJsonMode()) {
    printJson(data.createAgentTemplate);
    return;
  }
  printSuccess(
    `Created template ${data.createAgentTemplate.id} — ${data.createAgentTemplate.name} (slug: ${data.createAgentTemplate.slug})`,
  );
}

interface UpdateOptions extends TplCliOptions {
  name?: string;
  systemPromptFile?: string;
  model?: string;
  description?: string;
}

async function runTemplateUpdate(id: string, opts: UpdateOptions): Promise<void> {
  const ctx = await resolveTplContext(opts);
  if (opts.systemPromptFile) {
    printWarning(
      "--system-prompt-file is not yet wired in the CLI — edit prompt files via the admin UI.",
    );
  }
  const input: Record<string, unknown> = {};
  if (opts.name !== undefined) input.name = opts.name;
  if (opts.model !== undefined) input.model = opts.model;
  if (opts.description !== undefined) input.description = opts.description;
  if (Object.keys(input).length === 0) {
    printError("Nothing to update. Pass at least one of --name, --model, --description.");
    process.exit(1);
  }
  const data = await gqlMutate(ctx.client, UpdateAgentTemplateDoc, { id, input });
  if (isJsonMode()) {
    printJson(data.updateAgentTemplate);
    return;
  }
  printSuccess(`Updated template ${data.updateAgentTemplate.id}.`);
}

interface DeleteOptions extends TplCliOptions {
  yes?: boolean;
}

async function runTemplateDelete(id: string, opts: DeleteOptions): Promise<void> {
  const ctx = await resolveTplContext(opts);
  if (!opts.yes) {
    if (!isInteractive()) {
      printError("Refusing to delete without --yes in a non-interactive session.");
      process.exit(1);
    }
    requireTty("Confirmation");
    const go = await promptOrExit(() =>
      confirm({ message: `Delete template ${id}?`, default: false }),
    );
    if (!go) {
      logStderr("Cancelled.");
      process.exit(0);
    }
  }
  const data = await gqlMutate(ctx.client, DeleteAgentTemplateDoc, { id });
  if (isJsonMode()) {
    printJson({ id, deleted: data.deleteAgentTemplate });
    return;
  }
  if (data.deleteAgentTemplate) printSuccess(`Deleted template ${id}.`);
  else printError(`Server reported not-deleted for ${id}.`);
}

async function runTemplateDiff(
  templateId: string,
  agentId: string,
  opts: TplCliOptions,
): Promise<void> {
  const ctx = await resolveTplContext(opts);
  const [tpl, agt] = await Promise.all([
    gqlQuery(ctx.client, AgentTemplateDoc, { id: templateId }),
    gqlQuery(ctx.client, AgentForCloneDoc, { id: agentId }),
  ]);
  if (!tpl.agentTemplate) {
    printError(`Template ${templateId} not found.`);
    process.exit(1);
  }
  if (!agt.agent) {
    printError(`Agent ${agentId} not found.`);
    process.exit(1);
  }
  const t = tpl.agentTemplate;
  const a = agt.agent;

  if (isJsonMode()) {
    printJson({ template: t, agent: a });
    return;
  }

  // Side-by-side compare on top-level fields the CLI tracks. Agent has no
  // direct description; closest comparable is role. Model lives on the
  // agent's linked template.
  console.log("");
  console.log(`  Comparing template ${t.id} ↔ agent ${a.id}`);
  console.log("");
  printTable(
    [
      { field: "name", template: t.name, agent: a.name ?? "—" },
      { field: "description / role", template: t.description ?? "—", agent: a.role ?? "—" },
      { field: "runtime", template: t.runtime, agent: a.runtime ?? "—" },
      { field: "model", template: t.model ?? "—", agent: a.agentTemplate?.model ?? "—" },
    ],
    [
      { key: "field", header: "FIELD" },
      { key: "template", header: "TEMPLATE" },
      { key: "agent", header: "AGENT" },
    ],
  );
  console.log("");
  console.log(
    "  (CLI diff covers top-level fields only — config / skills / KB / workspace files compare via the admin UI.)",
  );
}

interface SyncAgentOptions extends TplCliOptions {
  yes?: boolean;
}

async function runTemplateSyncAgent(
  templateId: string,
  agentId: string,
  opts: SyncAgentOptions,
): Promise<void> {
  const ctx = await resolveTplContext(opts);
  if (!opts.yes && isInteractive()) {
    requireTty("Confirmation");
    const go = await promptOrExit(() =>
      confirm({
        message: `Sync template ${templateId} → agent ${agentId}? This overwrites agent config.`,
        default: false,
      }),
    );
    if (!go) {
      logStderr("Cancelled.");
      process.exit(0);
    }
  } else if (!opts.yes && !isInteractive()) {
    printError("Refusing to sync without --yes in a non-interactive session.");
    process.exit(1);
  }
  const data = await gqlMutate(ctx.client, SyncTemplateToAgentDoc, { templateId, agentId });
  if (isJsonMode()) {
    printJson(data.syncTemplateToAgent);
    return;
  }
  printSuccess(
    `Synced template ${templateId} → agent ${agentId} (${data.syncTemplateToAgent.name}, status: ${data.syncTemplateToAgent.status}).`,
  );
}

async function runTemplateSyncAll(templateId: string, opts: SyncAgentOptions): Promise<void> {
  const ctx = await resolveTplContext(opts);
  if (!opts.yes) {
    if (!isInteractive()) {
      printError("Refusing to sync-all without --yes in a non-interactive session.");
      process.exit(1);
    }
    requireTty("Confirmation");
    const go = await promptOrExit(() =>
      confirm({
        message: `Sync template ${templateId} to EVERY linked agent? This overwrites their config.`,
        default: false,
      }),
    );
    if (!go) {
      logStderr("Cancelled.");
      process.exit(0);
    }
  }
  const data = await gqlMutate(ctx.client, SyncTemplateToAllAgentsDoc, { templateId });
  if (isJsonMode()) {
    printJson(data.syncTemplateToAllAgents);
    return;
  }
  const s = data.syncTemplateToAllAgents;
  printSuccess(`Sync complete — synced: ${s.agentsSynced}, failed: ${s.agentsFailed}.`);
  if (s.errors && s.errors.length > 0) {
    console.log("");
    for (const err of s.errors) console.log(`  • ${err}`);
  }
}

export function registerTemplateCommand(program: Command): void {
  const tpl = program
    .command("template")
    .alias("templates")
    .description("Manage agent templates — reusable configs you spawn agents from.");

  tpl
    .command("list")
    .alias("ls")
    .description("List templates in the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runTemplateList);

  tpl
    .command("get <id>")
    .description("Fetch one template with its linked agents.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runTemplateGet);

  tpl
    .command("create [name]")
    .description("Create a new template from a set of config defaults.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--from-agent <id>", "Clone config from an existing agent")
    .option("--system-prompt-file <path>", "Prompt markdown path (currently no-op; use admin UI)")
    .option("--model <id>", "Default model")
    .option("--description <text>", "What this template is for")
    .addHelpText(
      "after",
      `
Examples:
  # Capture an existing agent's config as a template
  $ thinkwork template create "Ops Analyst" --from-agent agt-ops-1

  # Fresh template
  $ thinkwork template create --model claude-sonnet-4-6 --description "Ops handler"
`,
    )
    .action(runTemplateCreate);

  tpl
    .command("update <id>")
    .description("Update a template. Linked agents are NOT auto-synced — use `template sync-*`.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--name <n>")
    .option("--system-prompt-file <path>", "Prompt markdown path (currently no-op; use admin UI)")
    .option("--model <id>")
    .option("--description <text>")
    .action(runTemplateUpdate);

  tpl
    .command("delete <id>")
    .description("Delete a template. Linked agents are unaffected; they just stop being in sync.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(runTemplateDelete);

  tpl
    .command("diff <templateId> <agentId>")
    .description("Show what would change if we synced <agentId> to <templateId>.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runTemplateDiff);

  tpl
    .command("sync-agent <templateId> <agentId>")
    .description("Apply template changes to one linked agent.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(runTemplateSyncAgent);

  tpl
    .command("sync-all <templateId>")
    .description("Apply template changes to every linked agent. Requires confirmation.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .addHelpText(
      "after",
      `
Examples:
  # Preview first
  $ thinkwork template diff tpl-ops agt-ops-1

  # Apply to one agent
  $ thinkwork template sync-agent tpl-ops agt-ops-1

  # Apply to every linked agent
  $ thinkwork template sync-all tpl-ops
`,
    )
    .action(runTemplateSyncAll);
}

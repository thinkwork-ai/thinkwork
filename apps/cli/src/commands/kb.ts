/**
 * `thinkwork kb ...` — knowledge bases (Bedrock-backed RAG stores) and
 * agent attachments.
 *
 * attach/detach use setAgentKnowledgeBases (bulk replace) as a
 * read-modify-write since the API doesn't expose per-attachment ops.
 */

import { Command } from "commander";
import { confirm, input } from "@inquirer/prompts";
import { graphql } from "../gql/index.js";
import { loadStageSession } from "../cli-config.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { getGqlClient, gqlMutate, gqlQuery } from "../lib/gql-client.js";
import { isInteractive, promptOrExit, requireTty } from "../lib/interactive.js";
import { isJsonMode, logStderr, printJson, printKeyValue, printTable } from "../lib/output.js";
import { printError, printMissingApiSessionError, printSuccess, printWarning } from "../ui.js";

const KnowledgeBasesDoc = graphql(`
  query CliKnowledgeBases($tenantId: ID!) {
    knowledgeBases(tenantId: $tenantId) {
      id
      name
      slug
      embeddingModel
      status
      documentCount
      lastSyncAt
      lastSyncStatus
    }
  }
`);

const KnowledgeBaseDoc = graphql(`
  query CliKnowledgeBase($id: ID!) {
    knowledgeBase(id: $id) {
      id
      name
      slug
      description
      embeddingModel
      chunkingStrategy
      chunkSizeTokens
      chunkOverlapPercent
      status
      awsKbId
      documentCount
      lastSyncAt
      lastSyncStatus
      errorMessage
      createdAt
      updatedAt
    }
  }
`);

const CreateKBDoc = graphql(`
  mutation CliCreateKB($input: CreateKnowledgeBaseInput!) {
    createKnowledgeBase(input: $input) {
      id
      name
      slug
      status
    }
  }
`);

const UpdateKBDoc = graphql(`
  mutation CliUpdateKB($id: ID!, $input: UpdateKnowledgeBaseInput!) {
    updateKnowledgeBase(id: $id, input: $input) {
      id
      name
      description
    }
  }
`);

const DeleteKBDoc = graphql(`
  mutation CliDeleteKB($id: ID!) {
    deleteKnowledgeBase(id: $id)
  }
`);

const SyncKBDoc = graphql(`
  mutation CliSyncKB($id: ID!) {
    syncKnowledgeBase(id: $id) {
      id
      status
      lastSyncStatus
      lastSyncAt
    }
  }
`);

const AgentKBsDoc = graphql(`
  query CliAgentKBs($agentId: ID!) {
    agent(id: $agentId) {
      id
      knowledgeBases {
        knowledgeBaseId
        enabled
        searchConfig
      }
    }
  }
`);

const SetAgentKBsDoc = graphql(`
  mutation CliSetAgentKBs(
    $agentId: ID!
    $knowledgeBases: [AgentKnowledgeBaseInput!]!
  ) {
    setAgentKnowledgeBases(agentId: $agentId, knowledgeBases: $knowledgeBases) {
      id
      knowledgeBaseId
      enabled
    }
  }
`);

const KBTenantBySlugDoc = graphql(`
  query CliKBTenantBySlug($slug: String!) {
    tenantBySlug(slug: $slug) {
      id
    }
  }
`);

interface KbCliOptions {
  stage?: string;
  region?: string;
  tenant?: string;
}

async function resolveKbContext(opts: KbCliOptions) {
  const region = opts.region ?? "us-east-1";
  const stage = await resolveStage({ flag: opts.stage, region });
  const session = loadStageSession(stage);
  const { client, tenantSlug: ctxTenantSlug } = await getGqlClient({ stage, region });

  const flagOrEnv = opts.tenant ?? process.env.THINKWORK_TENANT;
  if (flagOrEnv) {
    if (session?.tenantSlug === flagOrEnv && session.tenantId) {
      return { stage, region, client, tenantId: session.tenantId };
    }
    const data = await gqlQuery(client, KBTenantBySlugDoc, { slug: flagOrEnv });
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
    const data = await gqlQuery(client, KBTenantBySlugDoc, { slug: ctxTenantSlug });
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

async function runKbList(opts: KbCliOptions): Promise<void> {
  const ctx = await resolveKbContext(opts);
  const data = await gqlQuery(ctx.client, KnowledgeBasesDoc, { tenantId: ctx.tenantId });
  const items = data.knowledgeBases ?? [];
  if (isJsonMode()) {
    printJson({ items });
    return;
  }
  printTable(
    items.map((kb) => ({
      id: kb.id,
      name: kb.name,
      docs: kb.documentCount != null ? String(kb.documentCount) : "—",
      status: kb.status,
      lastSync: fmtIso(kb.lastSyncAt),
      syncStatus: kb.lastSyncStatus ?? "—",
    })),
    [
      { key: "id", header: "ID" },
      { key: "name", header: "NAME" },
      { key: "docs", header: "DOCS" },
      { key: "status", header: "STATUS" },
      { key: "lastSync", header: "LAST SYNC" },
      { key: "syncStatus", header: "SYNC" },
    ],
  );
}

async function runKbGet(id: string, opts: KbCliOptions): Promise<void> {
  const ctx = await resolveKbContext(opts);
  const data = await gqlQuery(ctx.client, KnowledgeBaseDoc, { id });
  const kb = data.knowledgeBase;
  if (!kb) {
    printError(`Knowledge base ${id} not found.`);
    process.exit(1);
  }
  if (isJsonMode()) {
    printJson(kb);
    return;
  }
  printKeyValue([
    ["ID", kb.id],
    ["Name", kb.name],
    ["Slug", kb.slug],
    ["Description", kb.description ?? undefined],
    ["Embedding model", kb.embeddingModel],
    ["Chunking", kb.chunkingStrategy],
    ["Chunk size (tokens)", kb.chunkSizeTokens ?? undefined],
    ["Chunk overlap (%)", kb.chunkOverlapPercent ?? undefined],
    ["Status", kb.status],
    ["AWS KB ID", kb.awsKbId ?? undefined],
    ["Documents", kb.documentCount ?? undefined],
    ["Last sync", fmtIso(kb.lastSyncAt)],
    ["Last sync status", kb.lastSyncStatus ?? undefined],
    ["Error", kb.errorMessage ?? undefined],
    ["Created", fmtIso(kb.createdAt)],
    ["Updated", fmtIso(kb.updatedAt)],
  ]);
}

interface CreateOptions extends KbCliOptions {
  s3Uri?: string;
  description?: string;
  embeddingModel?: string;
}

async function runKbCreate(
  name: string | undefined,
  opts: CreateOptions,
): Promise<void> {
  const ctx = await resolveKbContext(opts);
  let resolvedName = name;
  if (!resolvedName) {
    if (!isInteractive()) {
      printError("Knowledge base name required in non-interactive mode.");
      process.exit(1);
    }
    requireTty("KB name");
    resolvedName = await promptOrExit(() => input({ message: "Knowledge base name:" }));
  }

  if (opts.s3Uri) {
    printWarning(
      "--s3-uri is currently ignored by the CLI; configure the S3 source in the admin UI after create.",
    );
  }

  const data = await gqlMutate(ctx.client, CreateKBDoc, {
    input: {
      tenantId: ctx.tenantId,
      name: resolvedName!,
      description: opts.description ?? null,
      embeddingModel: opts.embeddingModel ?? null,
    },
  });
  if (isJsonMode()) {
    printJson(data.createKnowledgeBase);
    return;
  }
  printSuccess(
    `Created knowledge base ${data.createKnowledgeBase.id} — ${data.createKnowledgeBase.name}`,
  );
}

interface UpdateOptions extends KbCliOptions {
  name?: string;
  description?: string;
}

async function runKbUpdate(id: string, opts: UpdateOptions): Promise<void> {
  const ctx = await resolveKbContext(opts);
  const input: Record<string, unknown> = {};
  if (opts.name !== undefined) input.name = opts.name;
  if (opts.description !== undefined) input.description = opts.description;
  if (Object.keys(input).length === 0) {
    printError("Nothing to update. Pass at least one of --name, --description.");
    process.exit(1);
  }
  const data = await gqlMutate(ctx.client, UpdateKBDoc, { id, input });
  if (isJsonMode()) {
    printJson(data.updateKnowledgeBase);
    return;
  }
  printSuccess(`Updated knowledge base ${data.updateKnowledgeBase.id}.`);
}

interface DeleteOptions extends KbCliOptions {
  yes?: boolean;
}

async function runKbDelete(id: string, opts: DeleteOptions): Promise<void> {
  const ctx = await resolveKbContext(opts);
  if (!opts.yes) {
    if (!isInteractive()) {
      printError("Refusing to delete without --yes in a non-interactive session.");
      process.exit(1);
    }
    requireTty("Confirmation");
    const go = await promptOrExit(() =>
      confirm({
        message: `Delete knowledge base ${id}? Embeddings + index will be destroyed.`,
        default: false,
      }),
    );
    if (!go) {
      logStderr("Cancelled.");
      process.exit(0);
    }
  }
  const data = await gqlMutate(ctx.client, DeleteKBDoc, { id });
  if (isJsonMode()) {
    printJson({ id, deleted: data.deleteKnowledgeBase });
    return;
  }
  if (data.deleteKnowledgeBase) printSuccess(`Deleted knowledge base ${id}.`);
  else printError(`Server reported not-deleted for ${id}.`);
}

interface SyncOptions extends KbCliOptions {
  wait?: boolean;
}

async function runKbSync(id: string, opts: SyncOptions): Promise<void> {
  const ctx = await resolveKbContext(opts);
  const data = await gqlMutate(ctx.client, SyncKBDoc, { id });
  if (isJsonMode()) {
    printJson(data.syncKnowledgeBase);
    return;
  }
  printSuccess(
    `Sync enqueued for ${id} — status: ${data.syncKnowledgeBase.status}, sync: ${data.syncKnowledgeBase.lastSyncStatus ?? "pending"}`,
  );
  if (opts.wait) {
    printWarning(
      "--wait is not yet implemented; check status with `thinkwork kb get` until lastSyncStatus is terminal.",
    );
  }
}

interface AttachOptions extends KbCliOptions {
  agent?: string;
  config?: string;
}

async function runKbAttach(kbId: string, opts: AttachOptions): Promise<void> {
  const ctx = await resolveKbContext(opts);
  if (!opts.agent) {
    printError("--agent <id> is required.");
    process.exit(1);
  }

  let searchConfig: unknown = null;
  if (opts.config) {
    try {
      searchConfig = JSON.parse(opts.config);
    } catch (err) {
      printError(`--config is not valid JSON: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  const current = await gqlQuery(ctx.client, AgentKBsDoc, { agentId: opts.agent });
  if (!current.agent) {
    printError(`Agent ${opts.agent} not found.`);
    process.exit(1);
  }
  const existing = current.agent.knowledgeBases ?? [];
  const filtered = existing.filter((a) => a.knowledgeBaseId !== kbId);
  const next = [
    ...filtered.map((a) => ({
      knowledgeBaseId: a.knowledgeBaseId,
      enabled: a.enabled,
      searchConfig: a.searchConfig ?? null,
    })),
    { knowledgeBaseId: kbId, enabled: true, searchConfig },
  ];

  const data = await gqlMutate(ctx.client, SetAgentKBsDoc, {
    agentId: opts.agent,
    knowledgeBases: next,
  });

  if (isJsonMode()) {
    printJson({ attached: kbId, agentId: opts.agent, set: data.setAgentKnowledgeBases });
    return;
  }
  printSuccess(`Attached ${kbId} to agent ${opts.agent}.`);
}

async function runKbDetach(kbId: string, opts: AttachOptions): Promise<void> {
  const ctx = await resolveKbContext(opts);
  if (!opts.agent) {
    printError("--agent <id> is required.");
    process.exit(1);
  }
  const current = await gqlQuery(ctx.client, AgentKBsDoc, { agentId: opts.agent });
  if (!current.agent) {
    printError(`Agent ${opts.agent} not found.`);
    process.exit(1);
  }
  const next = (current.agent.knowledgeBases ?? [])
    .filter((a) => a.knowledgeBaseId !== kbId)
    .map((a) => ({
      knowledgeBaseId: a.knowledgeBaseId,
      enabled: a.enabled,
      searchConfig: a.searchConfig ?? null,
    }));

  const data = await gqlMutate(ctx.client, SetAgentKBsDoc, {
    agentId: opts.agent,
    knowledgeBases: next,
  });

  if (isJsonMode()) {
    printJson({ detached: kbId, agentId: opts.agent, set: data.setAgentKnowledgeBases });
    return;
  }
  printSuccess(`Detached ${kbId} from agent ${opts.agent}.`);
}

export function registerKbCommand(program: Command): void {
  const kb = program
    .command("kb")
    .alias("knowledge-base")
    .description("Manage knowledge bases (RAG stores) and attach them to agents.");

  kb
    .command("list")
    .alias("ls")
    .description("List knowledge bases in the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runKbList);

  kb
    .command("get <id>")
    .description("Fetch one knowledge base with its source + sync status.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runKbGet);

  kb
    .command("create [name]")
    .description("Create a new knowledge base. Interactive prompts for missing fields.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--s3-uri <uri>", "S3 source (currently set in admin UI; flag accepted for forward compat)")
    .option("--description <text>")
    .option("--embedding-model <id>", "Bedrock embedding model ID")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork kb create "Runbooks"
  $ thinkwork kb create                                  # interactive
`,
    )
    .action(runKbCreate);

  kb
    .command("update <id>")
    .description("Update knowledge base metadata (name, description). Source changes need re-create.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--name <n>")
    .option("--description <text>")
    .action(runKbUpdate);

  kb
    .command("delete <id>")
    .description("Delete a knowledge base. Embeddings + index are destroyed.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(runKbDelete);

  kb
    .command("sync <id>")
    .description("Re-embed from S3. Idempotent; safe to re-run.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--wait", "Block until the sync finishes (not yet implemented)")
    .action(runKbSync);

  kb
    .command("attach <kbId>")
    .description("Attach a knowledge base to an agent.")
    .option("--agent <id>", "Agent ID")
    .option("--config <json>", "Retrieval config (topK, score threshold, …)")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork kb attach kb-runbooks --agent agt-oncall
  $ thinkwork kb attach kb-runbooks --agent agt-oncall --config '{"topK":5}'
`,
    )
    .action(runKbAttach);

  kb
    .command("detach <kbId>")
    .description("Detach a knowledge base from an agent.")
    .option("--agent <id>", "Agent ID")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runKbDetach);
}

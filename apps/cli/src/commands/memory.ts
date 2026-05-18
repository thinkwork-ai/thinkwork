/**
 * `thinkwork memory ...` — inspect + edit an agent's managed memory.
 */

import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import { graphql } from "../gql/index.js";
import { MemoryStrategy } from "../gql/graphql.js";
import { loadStageSession } from "../cli-config.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { getGqlClient, gqlMutate, gqlQuery } from "../lib/gql-client.js";
import { isInteractive, promptOrExit, requireTty } from "../lib/interactive.js";
import { isJsonMode, logStderr, printJson, printKeyValue, printTable } from "../lib/output.js";
import { printError, printMissingApiSessionError, printSuccess } from "../ui.js";

const MemoryRecordsDoc = graphql(`
  query CliMemoryRecords($tenantId: ID, $assistantId: ID, $namespace: String!) {
    memoryRecords(tenantId: $tenantId, assistantId: $assistantId, namespace: $namespace) {
      memoryRecordId
      namespace
      content {
        text
      }
      strategy
      createdAt
      updatedAt
    }
  }
`);

const MemorySearchDoc = graphql(`
  query CliMemorySearch($tenantId: ID, $assistantId: ID, $query: String!, $strategy: MemoryStrategy, $limit: Int) {
    memorySearch(tenantId: $tenantId, assistantId: $assistantId, query: $query, strategy: $strategy, limit: $limit) {
      records {
        memoryRecordId
        namespace
        content {
          text
        }
        score
      }
    }
  }
`);

const MemoryGraphDoc = graphql(`
  query CliMemoryGraph($tenantId: ID, $assistantId: ID) {
    memoryGraph(tenantId: $tenantId, assistantId: $assistantId) {
      nodes { id label type }
      edges { source target type }
    }
  }
`);

const UpdateMemoryRecordDoc = graphql(`
  mutation CliUpdateMemoryRecord($tenantId: ID, $assistantId: ID, $memoryRecordId: ID!, $content: String!) {
    updateMemoryRecord(tenantId: $tenantId, assistantId: $assistantId, memoryRecordId: $memoryRecordId, content: $content)
  }
`);

const DeleteMemoryRecordDoc = graphql(`
  mutation CliDeleteMemoryRecord($tenantId: ID, $assistantId: ID, $memoryRecordId: ID!) {
    deleteMemoryRecord(tenantId: $tenantId, assistantId: $assistantId, memoryRecordId: $memoryRecordId)
  }
`);

const MemoryTenantBySlugDoc = graphql(`
  query CliMemoryTenantBySlug($slug: String!) {
    tenantBySlug(slug: $slug) {
      id
    }
  }
`);

interface MemoryCliOptions {
  stage?: string;
  region?: string;
  tenant?: string;
}

async function resolveMemoryContext(opts: MemoryCliOptions) {
  const region = opts.region ?? "us-east-1";
  const stage = await resolveStage({ flag: opts.stage, region });
  const session = loadStageSession(stage);
  const { client, tenantSlug: ctxSlug } = await getGqlClient({ stage, region });
  const flagOrEnv = opts.tenant ?? process.env.THINKWORK_TENANT;
  if (flagOrEnv) {
    if (session?.tenantSlug === flagOrEnv && session.tenantId) {
      return { stage, region, client, tenantId: session.tenantId };
    }
    const data = await gqlQuery(client, MemoryTenantBySlugDoc, { slug: flagOrEnv });
    if (!data.tenantBySlug) {
      printError(`Tenant "${flagOrEnv}" not found.`);
      process.exit(1);
    }
    return { stage, region, client, tenantId: data.tenantBySlug.id };
  }
  if (session?.tenantId) return { stage, region, client, tenantId: session.tenantId };
  if (ctxSlug) {
    const data = await gqlQuery(client, MemoryTenantBySlugDoc, { slug: ctxSlug });
    if (data.tenantBySlug) return { stage, region, client, tenantId: data.tenantBySlug.id };
  }
  printMissingApiSessionError(stage, session !== null);
  process.exit(1);
}

const STRATEGY_BY_NAME: Record<string, MemoryStrategy> = {
  SEMANTIC: MemoryStrategy.Semantic,
  PREFERENCES: MemoryStrategy.Preferences,
  SUMMARIES: MemoryStrategy.Summaries,
  EPISODES: MemoryStrategy.Episodes,
  REFLECTIONS: MemoryStrategy.Reflections,
};

interface ListOptions extends MemoryCliOptions {
  agent?: string;
  namespace?: string;
}

async function runMemoryList(opts: ListOptions): Promise<void> {
  const ctx = await resolveMemoryContext(opts);
  const data = await gqlQuery(ctx.client, MemoryRecordsDoc, {
    tenantId: ctx.tenantId,
    assistantId: opts.agent ?? null,
    namespace: opts.namespace ?? "semantic",
  });
  const items = data.memoryRecords ?? [];
  if (isJsonMode()) {
    printJson({ items });
    return;
  }
  printTable(
    items.map((r) => ({
      id: r.memoryRecordId,
      ns: r.namespace ?? "—",
      preview: (r.content?.text ?? "").slice(0, 80),
    })),
    [
      { key: "id", header: "RECORD ID" },
      { key: "ns", header: "NAMESPACE" },
      { key: "preview", header: "PREVIEW" },
    ],
  );
}

interface SearchOptions extends MemoryCliOptions {
  agent?: string;
  query?: string;
  strategy?: string;
  limit?: string;
}

async function runMemorySearch(opts: SearchOptions): Promise<void> {
  const ctx = await resolveMemoryContext(opts);
  if (!opts.query) {
    printError("--query <q> is required.");
    process.exit(1);
  }
  const strategy = opts.strategy
    ? STRATEGY_BY_NAME[opts.strategy.toUpperCase()] ?? null
    : null;
  const data = await gqlQuery(ctx.client, MemorySearchDoc, {
    tenantId: ctx.tenantId,
    assistantId: opts.agent ?? null,
    query: opts.query,
    strategy,
    limit: opts.limit ? Number.parseInt(opts.limit, 10) : 10,
  });
  const records = data.memorySearch.records ?? [];
  if (isJsonMode()) {
    printJson({ records });
    return;
  }
  printTable(
    records.map((r) => ({
      id: r.memoryRecordId,
      ns: r.namespace ?? "—",
      score: r.score != null ? r.score.toFixed(3) : "—",
      preview: (r.content?.text ?? "").slice(0, 80),
    })),
    [
      { key: "id", header: "RECORD ID" },
      { key: "ns", header: "NAMESPACE" },
      { key: "score", header: "SCORE" },
      { key: "preview", header: "PREVIEW" },
    ],
  );
}

interface GetOptions extends MemoryCliOptions {
  agent?: string;
  namespace?: string;
}

async function runMemoryGet(recordId: string, opts: GetOptions): Promise<void> {
  const ctx = await resolveMemoryContext(opts);
  const data = await gqlQuery(ctx.client, MemoryRecordsDoc, {
    tenantId: ctx.tenantId,
    assistantId: opts.agent ?? null,
    namespace: opts.namespace ?? "semantic",
  });
  const rec = (data.memoryRecords ?? []).find((r) => r.memoryRecordId === recordId);
  if (!rec) {
    printError(
      `Memory record ${recordId} not found in namespace "${opts.namespace ?? "semantic"}". ` +
        "Try --namespace <ns> with a different value (semantic | preferences | episodes | reflections).",
    );
    process.exit(1);
  }
  if (isJsonMode()) {
    printJson(rec);
    return;
  }
  printKeyValue([
    ["ID", rec.memoryRecordId],
    ["Namespace", rec.namespace ?? undefined],
    ["Strategy", rec.strategy ?? undefined],
    ["Created", rec.createdAt ?? undefined],
    ["Updated", rec.updatedAt ?? undefined],
  ]);
  console.log("\n  Content:");
  console.log(`  ${rec.content?.text ?? "(empty)"}`);
}

interface UpdateOptions extends MemoryCliOptions {
  agent?: string;
  content?: string;
}

async function runMemoryUpdate(recordId: string, opts: UpdateOptions): Promise<void> {
  const ctx = await resolveMemoryContext(opts);
  if (!opts.content) {
    printError("--content <text> is required.");
    process.exit(1);
  }
  const data = await gqlMutate(ctx.client, UpdateMemoryRecordDoc, {
    tenantId: ctx.tenantId,
    assistantId: opts.agent ?? null,
    memoryRecordId: recordId,
    content: opts.content,
  });
  if (isJsonMode()) {
    printJson({ updated: data.updateMemoryRecord });
    return;
  }
  if (data.updateMemoryRecord) printSuccess(`Updated memory record ${recordId}.`);
  else printError(`Server reported not-updated for ${recordId}.`);
}

interface DeleteOptions extends MemoryCliOptions {
  agent?: string;
  yes?: boolean;
}

async function runMemoryDelete(recordId: string, opts: DeleteOptions): Promise<void> {
  const ctx = await resolveMemoryContext(opts);
  if (!opts.yes) {
    if (!isInteractive()) {
      printError("Refusing to delete without --yes in a non-interactive session.");
      process.exit(1);
    }
    requireTty("Confirmation");
    const go = await promptOrExit(() =>
      confirm({ message: `Delete memory record ${recordId}?`, default: false }),
    );
    if (!go) {
      logStderr("Cancelled.");
      process.exit(0);
    }
  }
  const data = await gqlMutate(ctx.client, DeleteMemoryRecordDoc, {
    tenantId: ctx.tenantId,
    assistantId: opts.agent ?? null,
    memoryRecordId: recordId,
  });
  if (isJsonMode()) {
    printJson({ deleted: data.deleteMemoryRecord });
    return;
  }
  if (data.deleteMemoryRecord) printSuccess(`Deleted memory record ${recordId}.`);
  else printError(`Server reported not-deleted for ${recordId}.`);
}

interface GraphOptions extends MemoryCliOptions {
  agent?: string;
}

async function runMemoryGraph(opts: GraphOptions): Promise<void> {
  const ctx = await resolveMemoryContext(opts);
  const data = await gqlQuery(ctx.client, MemoryGraphDoc, {
    tenantId: ctx.tenantId,
    assistantId: opts.agent ?? null,
  });
  const g = data.memoryGraph;
  if (isJsonMode()) {
    printJson(g);
    return;
  }
  printKeyValue([
    ["Nodes", String(g.nodes.length)],
    ["Edges", String(g.edges.length)],
  ]);
  if (g.nodes.length > 0) {
    console.log("\n  Top nodes:");
    printTable(
      g.nodes.slice(0, 15).map((n) => ({
        id: n.id.slice(0, 16),
        type: n.type,
        label: n.label.slice(0, 60),
      })),
      [
        { key: "id", header: "NODE ID" },
        { key: "type", header: "TYPE" },
        { key: "label", header: "LABEL" },
      ],
    );
  }
}

export function registerMemoryCommand(program: Command): void {
  const memory = program
    .command("memory")
    .description("Inspect, search, and edit an agent's memory records and graph.");

  memory
    .command("list")
    .alias("ls")
    .description("List memory records for an agent in a namespace.")
    .option("--agent <id>", "Agent (assistant) ID")
    .option(
      "--namespace <ns>",
      "Memory namespace (semantic | preferences | episodes | reflections)",
      "semantic",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runMemoryList);

  memory
    .command("search")
    .description("Search an agent's memory by query string.")
    .option("--agent <id>", "Agent (assistant) ID")
    .option("--query <q>", "Search query")
    .option("--strategy <s>", "SEMANTIC | KEYWORD | HYBRID", "SEMANTIC")
    .option("--limit <n>", "Max results", "10")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runMemorySearch);

  memory
    .command("get <recordId>")
    .description("Fetch one memory record (filters from namespace list).")
    .option("--agent <id>", "Agent (assistant) ID")
    .option("--namespace <ns>", "Namespace to scan", "semantic")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runMemoryGet);

  memory
    .command("update <recordId>")
    .description("Replace a memory record's content.")
    .option("--agent <id>", "Agent (assistant) ID")
    .option("--content <text>", "New content")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runMemoryUpdate);

  memory
    .command("delete <recordId>")
    .description("Remove a memory record.")
    .option("--agent <id>", "Agent (assistant) ID")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(runMemoryDelete);

  memory
    .command("graph")
    .description("Print the agent's memory graph (summary in human mode; full JSON with --json).")
    .option("--agent <id>", "Agent (assistant) ID")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runMemoryGraph);
}

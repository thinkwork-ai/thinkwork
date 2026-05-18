/**
 * `thinkwork artifact ...` — agent-produced markdown outputs.
 *
 * Read-only in v1 — list + get. create/update/delete stay in the admin UI.
 */

import { Command } from "commander";
import { graphql } from "../gql/index.js";
import { ArtifactType, ArtifactStatus } from "../gql/graphql.js";
import { loadStageSession } from "../cli-config.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { getGqlClient, gqlQuery } from "../lib/gql-client.js";
import { isJsonMode, printJson, printKeyValue, printTable } from "../lib/output.js";
import { printError, printMissingApiSessionError } from "../ui.js";

const ArtifactsDoc = graphql(`
  query CliArtifacts(
    $tenantId: ID!
    $threadId: ID
    $agentId: ID
    $type: ArtifactType
    $status: ArtifactStatus
    $limit: Int
    $cursor: String
  ) {
    artifacts(
      tenantId: $tenantId
      threadId: $threadId
      agentId: $agentId
      type: $type
      status: $status
      limit: $limit
      cursor: $cursor
    ) {
      id
      title
      type
      status
      agentId
      threadId
      createdAt
      updatedAt
    }
  }
`);

const ArtifactDoc = graphql(`
  query CliArtifact($id: ID!) {
    artifact(id: $id) {
      id
      tenantId
      agentId
      threadId
      title
      type
      status
      summary
      content
      s3Key
      sourceMessageId
      favoritedAt
      createdAt
      updatedAt
    }
  }
`);

const ArtifactTenantBySlugDoc = graphql(`
  query CliArtifactTenantBySlug($slug: String!) {
    tenantBySlug(slug: $slug) {
      id
    }
  }
`);

interface ArtCliOptions {
  stage?: string;
  region?: string;
  tenant?: string;
}

async function resolveArtContext(opts: ArtCliOptions) {
  const region = opts.region ?? "us-east-1";
  const stage = await resolveStage({ flag: opts.stage, region });
  const session = loadStageSession(stage);
  const { client, tenantSlug: ctxSlug } = await getGqlClient({ stage, region });
  const flagOrEnv = opts.tenant ?? process.env.THINKWORK_TENANT;
  if (flagOrEnv) {
    if (session?.tenantSlug === flagOrEnv && session.tenantId) {
      return { stage, region, client, tenantId: session.tenantId };
    }
    const data = await gqlQuery(client, ArtifactTenantBySlugDoc, { slug: flagOrEnv });
    if (!data.tenantBySlug) {
      printError(`Tenant "${flagOrEnv}" not found.`);
      process.exit(1);
    }
    return { stage, region, client, tenantId: data.tenantBySlug.id };
  }
  if (session?.tenantId) return { stage, region, client, tenantId: session.tenantId };
  if (ctxSlug) {
    const data = await gqlQuery(client, ArtifactTenantBySlugDoc, { slug: ctxSlug });
    if (data.tenantBySlug) return { stage, region, client, tenantId: data.tenantBySlug.id };
  }
  printMissingApiSessionError(stage, session !== null);
  process.exit(1);
}

const TYPE_BY_NAME: Record<string, ArtifactType> = Object.fromEntries(
  Object.values(ArtifactType).map((v) => [v as unknown as string, v]),
);
const STATUS_BY_NAME: Record<string, ArtifactStatus> = Object.fromEntries(
  Object.values(ArtifactStatus).map((v) => [v as unknown as string, v]),
);

interface ListOptions extends ArtCliOptions {
  thread?: string;
  agent?: string;
  type?: string;
  status?: string;
  limit?: string;
  cursor?: string;
}

async function runArtList(opts: ListOptions): Promise<void> {
  const ctx = await resolveArtContext(opts);
  const type = opts.type ? TYPE_BY_NAME[opts.type.toUpperCase()] ?? null : null;
  const status = opts.status ? STATUS_BY_NAME[opts.status.toUpperCase()] ?? null : null;
  const data = await gqlQuery(ctx.client, ArtifactsDoc, {
    tenantId: ctx.tenantId,
    threadId: opts.thread ?? null,
    agentId: opts.agent ?? null,
    type,
    status,
    limit: opts.limit ? Number.parseInt(opts.limit, 10) : 25,
    cursor: opts.cursor ?? null,
  });
  const items = data.artifacts ?? [];
  if (isJsonMode()) {
    printJson({ items });
    return;
  }
  printTable(
    items.map((a) => ({
      id: a.id,
      title: a.title.length > 50 ? `${a.title.slice(0, 47)}…` : a.title,
      type: a.type,
      status: a.status,
      created: a.createdAt,
    })),
    [
      { key: "id", header: "ID" },
      { key: "title", header: "TITLE" },
      { key: "type", header: "TYPE" },
      { key: "status", header: "STATUS" },
      { key: "created", header: "CREATED" },
    ],
  );
}

interface GetOptions extends ArtCliOptions {
  raw?: boolean;
}

async function runArtGet(id: string, opts: GetOptions): Promise<void> {
  const ctx = await resolveArtContext(opts);
  const data = await gqlQuery(ctx.client, ArtifactDoc, { id });
  const a = data.artifact;
  if (!a) {
    printError(`Artifact ${id} not found.`);
    process.exit(1);
  }
  if (opts.raw) {
    process.stdout.write(a.content ?? "");
    return;
  }
  if (isJsonMode()) {
    printJson(a);
    return;
  }
  printKeyValue([
    ["ID", a.id],
    ["Title", a.title],
    ["Type", a.type],
    ["Status", a.status],
    ["Agent", a.agentId ?? undefined],
    ["Thread", a.threadId ?? undefined],
    ["Source message", a.sourceMessageId ?? undefined],
    ["Favorited", a.favoritedAt ?? undefined],
    ["Created", a.createdAt],
    ["Updated", a.updatedAt],
  ]);
  if (a.summary) {
    console.log("\n  Summary:");
    console.log(`  ${a.summary}`);
  }
  if (a.content) {
    const preview = a.content.slice(0, 500);
    console.log("\n  Content preview:");
    console.log(`  ${preview}${a.content.length > 500 ? "\n  …" : ""}`);
    if (a.content.length > 500) {
      console.log(`\n  (pass --raw to pipe the full content to stdout)`);
    }
  }
}

export function registerArtifactCommand(program: Command): void {
  const art = program
    .command("artifact")
    .alias("artifacts")
    .description("List and fetch agent-produced artifacts.");

  art
    .command("list")
    .alias("ls")
    .description("List artifacts in the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--thread <id>", "Filter by thread")
    .option("--agent <id>", "Filter by producing agent")
    .option(
      "--type <t>",
      "DATA_VIEW | NOTE | REPORT | PLAN | DRAFT | DIGEST",
    )
    .option("--status <s>", "DRAFT | FINAL | SUPERSEDED")
    .option("--limit <n>", "Max rows", "25")
    .option("--cursor <c>", "Pagination cursor")
    .action(runArtList);

  art
    .command("get <id>")
    .description("Fetch one artifact. Human mode prints a preview; --json full; --raw pipes content.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--raw", "Print only the markdown body to stdout (for piping to pandoc / bat / less)")
    .action(runArtGet);
}

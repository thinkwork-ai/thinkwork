/**
 * `thinkwork wakeup ...` — queued agent wakeup requests (explicit / deferred).
 *
 * Maps to queuedWakeups query + createWakeupRequest mutation.
 */

import { Command } from "commander";
import { graphql } from "../gql/index.js";
import { loadStageSession } from "../cli-config.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { getGqlClient, gqlMutate, gqlQuery } from "../lib/gql-client.js";
import { isJsonMode, printJson, printTable } from "../lib/output.js";
import { printError, printMissingApiSessionError, printSuccess, printWarning } from "../ui.js";

const QueuedWakeupsDoc = graphql(`
  query CliQueuedWakeups($tenantId: ID!) {
    queuedWakeups(tenantId: $tenantId) {
      id
      agentId
      status
      source
      triggerDetail
      reason
      coalescedCount
      requestedAt
      claimedAt
    }
  }
`);

const CreateWakeupDoc = graphql(`
  mutation CliCreateWakeup($input: CreateWakeupRequestInput!) {
    createWakeupRequest(input: $input) {
      id
      agentId
      status
      requestedAt
    }
  }
`);

const WakeupTenantBySlugDoc = graphql(`
  query CliWakeupTenantBySlug($slug: String!) {
    tenantBySlug(slug: $slug) {
      id
    }
  }
`);

interface WakeupCliOptions {
  stage?: string;
  region?: string;
  tenant?: string;
}

async function resolveWakeupContext(opts: WakeupCliOptions) {
  const region = opts.region ?? "us-east-1";
  const stage = await resolveStage({ flag: opts.stage, region });
  const session = loadStageSession(stage);
  const { client, tenantSlug: ctxSlug } = await getGqlClient({ stage, region });
  const flagOrEnv = opts.tenant ?? process.env.THINKWORK_TENANT;
  if (flagOrEnv) {
    if (session?.tenantSlug === flagOrEnv && session.tenantId) {
      return { stage, region, client, tenantId: session.tenantId };
    }
    const data = await gqlQuery(client, WakeupTenantBySlugDoc, { slug: flagOrEnv });
    if (!data.tenantBySlug) {
      printError(`Tenant "${flagOrEnv}" not found.`);
      process.exit(1);
    }
    return { stage, region, client, tenantId: data.tenantBySlug.id };
  }
  if (session?.tenantId) return { stage, region, client, tenantId: session.tenantId };
  if (ctxSlug) {
    const data = await gqlQuery(client, WakeupTenantBySlugDoc, { slug: ctxSlug });
    if (data.tenantBySlug) return { stage, region, client, tenantId: data.tenantBySlug.id };
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

async function runWakeupList(opts: WakeupCliOptions): Promise<void> {
  const ctx = await resolveWakeupContext(opts);
  const data = await gqlQuery(ctx.client, QueuedWakeupsDoc, { tenantId: ctx.tenantId });
  const items = data.queuedWakeups ?? [];
  if (isJsonMode()) {
    printJson({ items });
    return;
  }
  printTable(
    items.map((w) => ({
      id: w.id,
      agent: w.agentId,
      status: w.status,
      source: w.source,
      coalesced: String(w.coalescedCount),
      requested: fmtIso(w.requestedAt),
    })),
    [
      { key: "id", header: "WAKEUP ID" },
      { key: "agent", header: "AGENT" },
      { key: "status", header: "STATUS" },
      { key: "source", header: "SOURCE" },
      { key: "coalesced", header: "COALESCED" },
      { key: "requested", header: "REQUESTED" },
    ],
  );
}

interface CreateOptions extends WakeupCliOptions {
  agent?: string;
  thread?: string;
  delaySeconds?: string;
  payload?: string;
}

async function runWakeupCreate(opts: CreateOptions): Promise<void> {
  const ctx = await resolveWakeupContext(opts);
  if (!opts.agent) {
    printError("--agent <id> is required.");
    process.exit(1);
  }

  let payload: unknown = null;
  if (opts.payload) {
    try {
      payload = JSON.parse(opts.payload);
    } catch (err) {
      printError(`--payload is not valid JSON: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  if (opts.delaySeconds && opts.delaySeconds !== "0") {
    // CreateWakeupRequestInput has no delaySeconds field; the scaffolded flag
    // is preserved for forward compat but the API doesn't currently honor it.
    printWarning(
      "--delay-seconds is not currently honored by the API (no delay field on CreateWakeupRequestInput). The wakeup will fire immediately.",
    );
  }

  const data = await gqlMutate(ctx.client, CreateWakeupDoc, {
    input: {
      tenantId: ctx.tenantId,
      agentId: opts.agent,
      source: "cli",
      triggerDetail: opts.thread ?? null,
      payload,
    },
  });
  if (isJsonMode()) {
    printJson(data.createWakeupRequest);
    return;
  }
  printSuccess(
    `Queued wakeup ${data.createWakeupRequest.id} for agent ${data.createWakeupRequest.agentId} (status: ${data.createWakeupRequest.status}).`,
  );
}

export function registerWakeupCommand(program: Command): void {
  const wake = program
    .command("wakeup")
    .alias("wakeups")
    .description("View and create agent wakeup requests (deferred/enqueued invocations).");

  wake
    .command("list")
    .alias("ls")
    .description("List queued wakeups in the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runWakeupList);

  wake
    .command("create")
    .description("Queue a wakeup for an agent.")
    .option("--agent <id>", "Target agent")
    .option("--thread <id>", "Thread to operate on (optional)")
    .option("--delay-seconds <n>", "Currently a no-op; the API has no delay field", "0")
    .option("--payload <json>", "Optional input payload")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork wakeup create --agent agt-ops --thread thr-abc
  $ thinkwork wakeup create --agent agt-ops --payload '{"task":"summarize"}'
`,
    )
    .action(runWakeupCreate);
}

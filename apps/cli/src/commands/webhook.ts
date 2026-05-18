/**
 * `thinkwork webhook ...` — inbound webhooks that dispatch agents or routines.
 *
 * GraphQL surface: webhooks/webhook queries + createWebhook/updateWebhook/
 * deleteWebhook/regenerateWebhookToken mutations. test/deliveries are
 * scaffolded but the API doesn't expose them yet; they print a clear
 * "not yet implemented at the API" error.
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

const WebhooksDoc = graphql(`
  query CliWebhooks($tenantId: ID!, $targetType: String, $enabled: Boolean, $limit: Int) {
    webhooks(tenantId: $tenantId, targetType: $targetType, enabled: $enabled, limit: $limit) {
      id
      name
      targetType
      agentId
      routineId
      enabled
      rateLimit
      invocationCount
      lastInvokedAt
      createdAt
    }
  }
`);

const WebhookDoc = graphql(`
  query CliWebhook($id: ID!) {
    webhook(id: $id) {
      id
      name
      description
      token
      targetType
      agentId
      routineId
      prompt
      enabled
      rateLimit
      invocationCount
      lastInvokedAt
      createdAt
      updatedAt
    }
  }
`);

const CreateWebhookDoc = graphql(`
  mutation CliCreateWebhook($input: CreateWebhookInput!) {
    createWebhook(input: $input) {
      id
      name
      token
      targetType
      enabled
    }
  }
`);

const UpdateWebhookDoc = graphql(`
  mutation CliUpdateWebhook($id: ID!, $input: UpdateWebhookInput!) {
    updateWebhook(id: $id, input: $input) {
      id
      name
      targetType
      enabled
      rateLimit
    }
  }
`);

const DeleteWebhookDoc = graphql(`
  mutation CliDeleteWebhook($id: ID!) {
    deleteWebhook(id: $id)
  }
`);

const RegenerateWebhookTokenDoc = graphql(`
  mutation CliRegenerateWebhookToken($id: ID!) {
    regenerateWebhookToken(id: $id) {
      id
      token
    }
  }
`);

const WebhookDeliveriesDoc = graphql(`
  query CliWebhookDeliveries($webhookId: ID!, $limit: Int) {
    webhookDeliveries(webhookId: $webhookId, limit: $limit) {
      id
      providerName
      providerEventId
      normalizedKind
      receivedAt
      signatureStatus
      resolutionStatus
      statusCode
      durationMs
      threadId
      threadCreated
      retryCount
      isReplay
      errorMessage
    }
  }
`);

const TestWebhookDoc = graphql(`
  mutation CliTestWebhook($id: ID!) {
    testWebhook(id: $id) {
      id
      webhookId
      tenantId
      receivedAt
      resolutionStatus
      signatureStatus
      statusCode
      bodyPreview
    }
  }
`);

const WebhookForTestDoc = graphql(`
  query CliWebhookForTest($id: ID!) {
    webhook(id: $id) {
      id
      token
    }
  }
`);

const WebhookTenantBySlugDoc = graphql(`
  query CliWebhookTenantBySlug($slug: String!) {
    tenantBySlug(slug: $slug) {
      id
    }
  }
`);

interface WebhookCliOptions {
  stage?: string;
  region?: string;
  tenant?: string;
}

async function resolveWebhookContext(opts: WebhookCliOptions) {
  const region = opts.region ?? "us-east-1";
  const stage = await resolveStage({ flag: opts.stage, region });
  const session = loadStageSession(stage);
  const { client, tenantSlug: ctxSlug } = await getGqlClient({ stage, region });
  const flagOrEnv = opts.tenant ?? process.env.THINKWORK_TENANT;
  if (flagOrEnv) {
    if (session?.tenantSlug === flagOrEnv && session.tenantId) {
      return { stage, region, client, tenantId: session.tenantId };
    }
    const data = await gqlQuery(client, WebhookTenantBySlugDoc, { slug: flagOrEnv });
    if (!data.tenantBySlug) {
      printError(`Tenant "${flagOrEnv}" not found.`);
      process.exit(1);
    }
    return { stage, region, client, tenantId: data.tenantBySlug.id };
  }
  if (session?.tenantId) return { stage, region, client, tenantId: session.tenantId };
  if (ctxSlug) {
    const data = await gqlQuery(client, WebhookTenantBySlugDoc, { slug: ctxSlug });
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

interface ListOptions extends WebhookCliOptions {
  enabled?: string;
  targetType?: string;
}

async function runWebhookList(opts: ListOptions): Promise<void> {
  const ctx = await resolveWebhookContext(opts);
  const enabled = opts.enabled === undefined ? null : opts.enabled === "true";
  const data = await gqlQuery(ctx.client, WebhooksDoc, {
    tenantId: ctx.tenantId,
    targetType: opts.targetType ?? null,
    enabled,
    limit: 100,
  });
  const items = data.webhooks ?? [];
  if (isJsonMode()) {
    printJson({ items });
    return;
  }
  printTable(
    items.map((w) => ({
      id: w.id,
      name: w.name,
      target: `${w.targetType}:${(w.agentId ?? w.routineId ?? "—").slice(0, 8)}`,
      enabled: w.enabled ? "yes" : "no",
      rateLimit: w.rateLimit != null ? `${w.rateLimit}/min` : "—",
      invocations: String(w.invocationCount),
      lastInvoked: fmtIso(w.lastInvokedAt),
    })),
    [
      { key: "id", header: "ID" },
      { key: "name", header: "NAME" },
      { key: "target", header: "TARGET" },
      { key: "enabled", header: "ON" },
      { key: "rateLimit", header: "LIMIT" },
      { key: "invocations", header: "CALLS" },
      { key: "lastInvoked", header: "LAST" },
    ],
  );
}

async function runWebhookGet(id: string, opts: WebhookCliOptions): Promise<void> {
  const ctx = await resolveWebhookContext(opts);
  const data = await gqlQuery(ctx.client, WebhookDoc, { id });
  const w = data.webhook;
  if (!w) {
    printError(`Webhook ${id} not found.`);
    process.exit(1);
  }
  if (isJsonMode()) {
    printJson(w);
    return;
  }
  printKeyValue([
    ["ID", w.id],
    ["Name", w.name],
    ["Description", w.description ?? undefined],
    ["Token (prefix)", `${w.token.slice(0, 12)}…`],
    ["Target type", w.targetType],
    ["Target ID", w.agentId ?? w.routineId ?? undefined],
    ["Enabled", w.enabled ? "yes" : "no"],
    ["Rate limit", w.rateLimit != null ? `${w.rateLimit}/min` : undefined],
    ["Invocations", String(w.invocationCount)],
    ["Last invoked", fmtIso(w.lastInvokedAt)],
    ["Created", fmtIso(w.createdAt)],
    ["Updated", fmtIso(w.updatedAt)],
  ]);
  if (w.prompt) {
    console.log("\n  Prompt:");
    console.log(`  ${w.prompt.slice(0, 200)}${w.prompt.length > 200 ? "…" : ""}`);
  }
}

interface CreateOptions extends WebhookCliOptions {
  targetType?: string;
  targetId?: string;
  rateLimit?: string;
  disabled?: boolean;
}

async function runWebhookCreate(
  name: string | undefined,
  opts: CreateOptions,
): Promise<void> {
  const ctx = await resolveWebhookContext(opts);
  let resolvedName = name;
  if (!resolvedName) {
    if (!isInteractive()) {
      printError("Webhook name required in non-interactive mode.");
      process.exit(1);
    }
    requireTty("Webhook name");
    resolvedName = await promptOrExit(() => input({ message: "Webhook name:" }));
  }
  if (!opts.targetType) {
    printError("--target-type <AGENT|ROUTINE> is required.");
    process.exit(1);
  }
  if (!opts.targetId) {
    printError("--target-id <id> is required.");
    process.exit(1);
  }
  const targetType = opts.targetType.toUpperCase();
  if (!["AGENT", "ROUTINE"].includes(targetType)) {
    printError(`--target-type "${opts.targetType}" must be AGENT or ROUTINE.`);
    process.exit(1);
  }

  const data = await gqlMutate(ctx.client, CreateWebhookDoc, {
    input: {
      tenantId: ctx.tenantId,
      name: resolvedName!,
      targetType,
      agentId: targetType === "AGENT" ? opts.targetId : null,
      routineId: targetType === "ROUTINE" ? opts.targetId : null,
      rateLimit: opts.rateLimit ? Number.parseInt(opts.rateLimit, 10) : null,
    },
  });
  const wh = data.createWebhook;
  if (isJsonMode()) {
    printJson(wh);
    return;
  }
  printSuccess(`Created webhook ${wh.id} — ${wh.name}.`);
  console.log("");
  console.log("  Token (SAVE THIS — used in the inbound URL):");
  console.log(`    ${wh.token}`);
}

interface UpdateOptions extends WebhookCliOptions {
  targetType?: string;
  targetId?: string;
  rateLimit?: string;
  enable?: boolean;
  disable?: boolean;
}

async function runWebhookUpdate(id: string, opts: UpdateOptions): Promise<void> {
  const ctx = await resolveWebhookContext(opts);
  const input: Record<string, unknown> = {};
  if (opts.targetType !== undefined) input.targetType = opts.targetType.toUpperCase();
  if (opts.targetId !== undefined) {
    const tt = (opts.targetType ?? "").toUpperCase();
    if (tt === "AGENT") input.agentId = opts.targetId;
    else if (tt === "ROUTINE") input.routineId = opts.targetId;
    else {
      printError("--target-id requires --target-type <AGENT|ROUTINE> on the same call.");
      process.exit(1);
    }
  }
  if (opts.rateLimit !== undefined) input.rateLimit = Number.parseInt(opts.rateLimit, 10);
  if (opts.enable) input.enabled = true;
  if (opts.disable) input.enabled = false;
  if (Object.keys(input).length === 0) {
    printError("Nothing to update.");
    process.exit(1);
  }
  const data = await gqlMutate(ctx.client, UpdateWebhookDoc, { id, input });
  if (isJsonMode()) {
    printJson(data.updateWebhook);
    return;
  }
  printSuccess(`Updated webhook ${data.updateWebhook.id}.`);
}

interface DeleteOptions extends WebhookCliOptions {
  yes?: boolean;
}

async function runWebhookDelete(id: string, opts: DeleteOptions): Promise<void> {
  const ctx = await resolveWebhookContext(opts);
  if (!opts.yes) {
    if (!isInteractive()) {
      printError("Refusing to delete without --yes in a non-interactive session.");
      process.exit(1);
    }
    requireTty("Confirmation");
    const go = await promptOrExit(() =>
      confirm({ message: `Delete webhook ${id}? Its URL stops working immediately.`, default: false }),
    );
    if (!go) {
      logStderr("Cancelled.");
      process.exit(0);
    }
  }
  const data = await gqlMutate(ctx.client, DeleteWebhookDoc, { id });
  if (isJsonMode()) {
    printJson({ id, deleted: data.deleteWebhook });
    return;
  }
  if (data.deleteWebhook) printSuccess(`Deleted webhook ${id}.`);
  else printError(`Server reported not-deleted for ${id}.`);
}

async function runWebhookRotate(id: string, opts: DeleteOptions): Promise<void> {
  const ctx = await resolveWebhookContext(opts);
  if (!opts.yes) {
    if (!isInteractive()) {
      printError("Refusing to rotate without --yes in a non-interactive session.");
      process.exit(1);
    }
    requireTty("Confirmation");
    const go = await promptOrExit(() =>
      confirm({
        message: `Rotate token on webhook ${id}? The old token stops working immediately.`,
        default: false,
      }),
    );
    if (!go) {
      logStderr("Cancelled.");
      process.exit(0);
    }
  }
  const data = await gqlMutate(ctx.client, RegenerateWebhookTokenDoc, { id });
  const wh = data.regenerateWebhookToken;
  if (!wh) {
    printError("Server returned no webhook (already deleted?).");
    process.exit(1);
  }
  if (isJsonMode()) {
    printJson(wh);
    return;
  }
  printSuccess(`Rotated token on webhook ${wh.id}.`);
  console.log("");
  console.log("  New token (SAVE THIS):");
  console.log(`    ${wh.token}`);
}

interface DeliveriesOptions extends WebhookCliOptions {
  limit?: string;
}

async function runWebhookDeliveries(
  id: string,
  opts: DeliveriesOptions,
): Promise<void> {
  const ctx = await resolveWebhookContext(opts);
  const limit = Math.min(
    Math.max(Number.parseInt(opts.limit ?? "25", 10) || 25, 1),
    500,
  );
  const data = await gqlQuery(ctx.client, WebhookDeliveriesDoc, {
    webhookId: id,
    limit,
  });
  const rows = data.webhookDeliveries;
  if (isJsonMode()) {
    printJson({ items: rows });
    return;
  }
  if (rows.length === 0) {
    logStderr(`No deliveries recorded for webhook ${id}.`);
    return;
  }
  printTable(
    rows.map((r) => ({
      received: r.receivedAt ?? "",
      provider: r.providerName ?? "—",
      event: r.normalizedKind ?? r.providerEventId ?? "—",
      sig: r.signatureStatus,
      resolution: r.resolutionStatus,
      status: r.statusCode != null ? String(r.statusCode) : "—",
      durMs: r.durationMs != null ? String(r.durationMs) : "—",
      retry: r.retryCount != null ? String(r.retryCount) : "—",
      thread: r.threadId ?? "—",
    })),
    [
      { key: "received", header: "Received" },
      { key: "provider", header: "Provider" },
      { key: "event", header: "Event" },
      { key: "sig", header: "Sig" },
      { key: "resolution", header: "Resolution" },
      { key: "status", header: "Status" },
      { key: "durMs", header: "Dur(ms)" },
      { key: "retry", header: "Retry" },
      { key: "thread", header: "Thread" },
    ],
  );
}

interface TestOptions extends WebhookCliOptions {}

async function runWebhookTest(id: string, _opts: TestOptions): Promise<void> {
  const ctx = await resolveWebhookContext(_opts);
  const data = await gqlMutate(ctx.client, TestWebhookDoc, { id });
  const delivery = data.testWebhook;

  // Best-effort fetch of the public URL so we can suggest an honest
  // "curl this for end-to-end reachability". Failure is non-fatal.
  let curlHint: string | null = null;
  try {
    const tokenData = await gqlQuery(ctx.client, WebhookForTestDoc, { id });
    if (tokenData.webhook?.token) {
      // Reconstruct the public URL pattern from the resolved stage's
      // API endpoint (api-client knows it).
      const { resolveApiConfig } = await import("../api-client.js");
      const api = resolveApiConfig(ctx.stage);
      if (api?.apiUrl) {
        const base = api.apiUrl.replace(/\/$/, "");
        curlHint = `${base}/webhooks/${tokenData.webhook.token}`;
      }
    }
  } catch {
    // Ignore — the test row was recorded; reachability hint is bonus.
  }

  if (isJsonMode()) {
    printJson({ delivery, publicUrl: curlHint });
    return;
  }
  printSuccess(
    `Recorded synthetic delivery ${delivery.id} (resolution=${delivery.resolutionStatus}).`,
  );
  if (curlHint) {
    console.log("");
    console.log("  For end-to-end reachability check, curl the public URL:");
    console.log(
      `    curl -X POST -H 'content-type: application/json' \\\n      -d '{"hello":"world"}' \\\n      ${curlHint}`,
    );
  }
}

function notYetImplementedAtApi(verb: string): never {
  printError(
    `\`webhook ${verb}\` is not yet implemented at the GraphQL API.\n` +
      "  Use admin UI for now; CLI parity is tracked as a Phase-3 follow-up.",
  );
  process.exit(2);
}

export function registerWebhookCommand(program: Command): void {
  const wh = program
    .command("webhook")
    .alias("webhooks")
    .description("Manage inbound webhooks that dispatch to agents or routines.");

  wh
    .command("list")
    .alias("ls")
    .description("List webhooks in the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--enabled <bool>", "true | false")
    .option("--target-type <t>", "AGENT | ROUTINE")
    .action(runWebhookList);

  wh
    .command("get <id>")
    .description("Fetch one webhook including its token prefix + rate limit.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runWebhookGet);

  wh
    .command("create [name]")
    .description("Create a new webhook. The token is printed once.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--target-type <t>", "AGENT | ROUTINE")
    .option("--target-id <id>", "ID of the agent or routine")
    .option("--rate-limit <rpm>", "Max requests per minute")
    .option("--allowed-ips <csv>", "Restrict to a CIDR list (not yet honored server-side)")
    .option("--disabled", "Create in disabled state")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork webhook create "GitHub PR opened" --target-type AGENT --target-id agt-reviewer --rate-limit 30
`,
    )
    .action(runWebhookCreate);

  wh
    .command("update <id>")
    .description("Update a webhook's target, rate limit, or enabled state.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--target-type <t>")
    .option("--target-id <id>")
    .option("--rate-limit <rpm>")
    .option("--allowed-ips <csv>")
    .option("--enable")
    .option("--disable")
    .action(runWebhookUpdate);

  wh
    .command("delete <id>")
    .description("Delete a webhook (its URL stops working immediately).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(runWebhookDelete);

  wh
    .command("test <id>")
    .description(
      "Record a synthetic test delivery row for the webhook (visible via `webhook deliveries`). Does NOT trigger downstream dispatch; prints a curl one-liner for end-to-end reachability against the public URL.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runWebhookTest);

  wh
    .command("rotate <id>")
    .description("Generate a new token for an existing webhook.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(runWebhookRotate);

  wh
    .command("deliveries <id>")
    .description(
      "Show recent delivery attempts for a webhook (newest first). Default 25, max 500.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--limit <n>", "Max rows (1-500)", "25")
    .action(runWebhookDeliveries);
}

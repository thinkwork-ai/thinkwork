import { readFile } from "node:fs/promises";
import { confirm, input } from "@inquirer/prompts";
import { AgentStatus, AgentType } from "../../gql/graphql.js";
import { gqlMutate, gqlQuery } from "../../lib/gql-client.js";
import {
  isInteractive,
  promptOrExit,
  requireTty,
} from "../../lib/interactive.js";
import {
  isJsonMode,
  logStderr,
  printJson,
  printKeyValue,
  printTable,
} from "../../lib/output.js";
import { printError, printSuccess } from "../../ui.js";
import {
  AgentDoc,
  AgentsDoc,
  AllTenantAgentsDoc,
  CreateAgentDoc,
  DeleteAgentDoc,
  UpdateAgentDoc,
  UpdateAgentStatusDoc,
} from "./gql.js";
import {
  resolveAgentContext,
  fmtIso,
  type AgentCliOptions,
} from "./helpers.js";

const STATUS_BY_NAME: Record<string, AgentStatus> = {
  IDLE: AgentStatus.Idle,
  BUSY: AgentStatus.Busy,
  OFFLINE: AgentStatus.Offline,
  ERROR: AgentStatus.Error,
};

const TYPE_BY_NAME: Record<string, AgentType> = {
  AGENT: AgentType.Agent,
  GATEWAY: AgentType.Gateway,
  SUPERVISOR: AgentType.Supervisor,
};

function parseEnum<E extends string>(
  raw: string,
  table: Record<string, E>,
  label: string,
): E {
  const v = table[raw.toUpperCase()];
  if (!v) {
    printError(
      `Invalid ${label} "${raw}". Expected one of: ${Object.keys(table).join(", ")}.`,
    );
    process.exit(1);
  }
  return v;
}

interface ListOptions extends AgentCliOptions {
  status?: string;
  type?: string;
  includeSystem?: boolean;
  all?: boolean;
}

export async function runAgentList(opts: ListOptions): Promise<void> {
  const ctx = await resolveAgentContext(opts);
  const status = opts.status
    ? parseEnum(opts.status, STATUS_BY_NAME, "--status")
    : null;
  const type = opts.type ? parseEnum(opts.type, TYPE_BY_NAME, "--type") : null;

  const agents = opts.all
    ? (
        await gqlQuery(ctx.client, AllTenantAgentsDoc, {
          tenantId: ctx.tenantId,
          includeSystem: opts.includeSystem ?? null,
          includeSubAgents: true,
        })
      ).allTenantAgents
    : (
        await gqlQuery(ctx.client, AgentsDoc, {
          tenantId: ctx.tenantId,
          status,
          type,
          includeSystem: opts.includeSystem ?? null,
        })
      ).agents;

  if (isJsonMode()) {
    printJson({ items: agents });
    return;
  }

  printTable(
    (agents ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      status: a.status,
      runtime: a.runtime,
      heartbeat: fmtIso(a.lastHeartbeatAt),
    })),
    [
      { key: "id", header: "ID" },
      { key: "name", header: "NAME" },
      { key: "type", header: "TYPE" },
      { key: "status", header: "STATUS" },
      { key: "runtime", header: "RUNTIME" },
      { key: "heartbeat", header: "HEARTBEAT" },
    ],
  );
}

export async function runAgentGet(
  id: string,
  opts: AgentCliOptions,
): Promise<void> {
  const ctx = await resolveAgentContext(opts);
  const data = await gqlQuery(ctx.client, AgentDoc, { id });
  const a = data.agent;
  if (!a) {
    printError(`Agent ${id} not found.`);
    process.exit(1);
  }
  if (isJsonMode()) {
    printJson(a);
    return;
  }
  printKeyValue([
    ["ID", a.id],
    ["Name", a.name],
    ["Slug", a.slug ?? undefined],
    ["Role", a.role ?? undefined],
    ["Type", a.type],
    ["Source", a.source ?? undefined],
    ["Status", a.status],
    ["Runtime", a.runtime],
    ["Adapter", a.adapterType ?? undefined],
    ["Version", String(a.version)],
    ["Human pair", a.humanPairId ?? undefined],
    ["Parent agent", a.parentAgentId ?? undefined],
    ["Reports to", a.reportsToId ?? undefined],
    ["Last heartbeat", fmtIso(a.lastHeartbeatAt)],
    ["Created", fmtIso(a.createdAt)],
    ["Updated", fmtIso(a.updatedAt)],
  ]);

  if (a.capabilities.length > 0) {
    console.log("\n  Capabilities:");
    printTable(
      a.capabilities.map((c) => ({
        capability: c.capability,
        enabled: c.enabled ? "yes" : "no",
      })),
      [
        { key: "capability", header: "CAPABILITY" },
        { key: "enabled", header: "ENABLED" },
      ],
    );
  }
  if (a.skills.length > 0) {
    console.log("\n  Skills:");
    printTable(
      a.skills.map((s) => ({
        skill: s.skillId,
        enabled: s.enabled ? "yes" : "no",
        rateLimit: s.rateLimitRpm != null ? String(s.rateLimitRpm) : "—",
      })),
      [
        { key: "skill", header: "SKILL" },
        { key: "enabled", header: "ENABLED" },
        { key: "rateLimit", header: "RATE/min" },
      ],
    );
  }
  if (a.budgetPolicy) {
    console.log("\n  Budget policy:");
    printKeyValue([
      ["Period", a.budgetPolicy.period],
      ["Limit (USD)", `$${a.budgetPolicy.limitUsd.toFixed(2)}`],
      ["On exceed", a.budgetPolicy.actionOnExceed ?? undefined],
    ]);
  }
}

interface CreateOptions extends AgentCliOptions {
  role?: string;
  type?: string;
  parent?: string;
  reportsTo?: string;
  systemPrompt?: string;
  systemPromptFile?: string;
  model?: string;
}

export async function runAgentCreate(
  name: string | undefined,
  opts: CreateOptions,
): Promise<void> {
  const ctx = await resolveAgentContext(opts);
  const interactive = isInteractive();

  let resolvedName = name;
  if (!resolvedName) {
    if (!interactive) {
      printError("Agent name required in non-interactive mode.");
      process.exit(1);
    }
    requireTty("Agent name");
    resolvedName = await promptOrExit(() => input({ message: "Agent name:" }));
  }

  let systemPrompt = opts.systemPrompt;
  if (!systemPrompt && opts.systemPromptFile) {
    systemPrompt = await readFile(opts.systemPromptFile, "utf-8");
  }

  const type = opts.type ? parseEnum(opts.type, TYPE_BY_NAME, "--type") : null;

  // CreateAgentInput is the schema-typed wrapper around the literal we build
  // below. Model overrides live in runtimeConfig.model rather than as a
  // top-level field, so --model is carried there.
  const createInput = {
    tenantId: ctx.tenantId,
    name: resolvedName!,
    role: opts.role ?? null,
    type,
    systemPrompt: systemPrompt ?? null,
    parentAgentId: opts.parent ?? null,
    reportsTo: opts.reportsTo ?? null,
    runtimeConfig: opts.model ? { model: opts.model } : null,
  };

  const data = await gqlMutate(ctx.client, CreateAgentDoc, {
    input: createInput,
  });
  if (isJsonMode()) {
    printJson(data.createAgent);
    return;
  }
  printSuccess(
    `Created agent ${data.createAgent.id} — ${data.createAgent.name} (type: ${data.createAgent.type}).`,
  );
}

interface UpdateOptions extends AgentCliOptions {
  name?: string;
  role?: string;
  type?: string;
  parent?: string;
  reportsTo?: string;
  systemPrompt?: string;
  systemPromptFile?: string;
  model?: string;
}

export async function runAgentUpdate(
  id: string,
  opts: UpdateOptions,
): Promise<void> {
  const ctx = await resolveAgentContext(opts);

  let systemPrompt = opts.systemPrompt;
  if (!systemPrompt && opts.systemPromptFile) {
    systemPrompt = await readFile(opts.systemPromptFile, "utf-8");
  }

  const input: Record<string, unknown> = {};
  if (opts.name !== undefined) input.name = opts.name;
  if (opts.role !== undefined) input.role = opts.role;
  if (opts.type !== undefined)
    input.type = parseEnum(opts.type, TYPE_BY_NAME, "--type");
  if (opts.parent !== undefined) input.parentAgentId = opts.parent;
  if (opts.reportsTo !== undefined) input.reportsTo = opts.reportsTo;
  if (systemPrompt !== undefined) input.systemPrompt = systemPrompt;
  if (opts.model !== undefined) input.runtimeConfig = { model: opts.model };

  if (Object.keys(input).length === 0) {
    printError("Nothing to update. Pass at least one field flag.");
    process.exit(1);
  }

  const data = await gqlMutate(ctx.client, UpdateAgentDoc, { id, input });
  if (isJsonMode()) {
    printJson(data.updateAgent);
    return;
  }
  printSuccess(`Updated agent ${data.updateAgent.id}.`);
}

interface DeleteOptions extends AgentCliOptions {
  yes?: boolean;
}

export async function runAgentDelete(
  id: string,
  opts: DeleteOptions,
): Promise<void> {
  const ctx = await resolveAgentContext(opts);
  if (!opts.yes) {
    if (!isInteractive()) {
      printError(
        "Refusing to archive without --yes in a non-interactive session.",
      );
      process.exit(1);
    }
    requireTty("Confirmation");
    const go = await promptOrExit(() =>
      confirm({
        message: `Archive agent ${id}? (existing threads stay; no new work routed)`,
        default: false,
      }),
    );
    if (!go) {
      logStderr("Cancelled.");
      process.exit(0);
    }
  }
  const data = await gqlMutate(ctx.client, DeleteAgentDoc, { id });
  if (isJsonMode()) {
    printJson({ id, deleted: data.deleteAgent });
    return;
  }
  if (data.deleteAgent) printSuccess(`Archived agent ${id}.`);
  else printError(`Server reported not-deleted for ${id}.`);
}

export async function runAgentStatus(
  id: string,
  statusRaw: string,
  opts: AgentCliOptions,
): Promise<void> {
  const ctx = await resolveAgentContext(opts);
  const status = parseEnum(statusRaw, STATUS_BY_NAME, "status");
  const data = await gqlMutate(ctx.client, UpdateAgentStatusDoc, {
    id,
    status,
  });
  if (isJsonMode()) {
    printJson(data.updateAgentStatus);
    return;
  }
  printSuccess(
    `Set agent ${data.updateAgentStatus.id} status: ${data.updateAgentStatus.status}.`,
  );
}

export async function runAgentUnpause(
  id: string,
  opts: AgentCliOptions,
): Promise<void> {
  const ctx = await resolveAgentContext(opts);
  const data = await gqlMutate(ctx.client, UpdateAgentStatusDoc, {
    id,
    status: AgentStatus.Idle,
  });
  if (isJsonMode()) {
    printJson(data.updateAgentStatus);
    return;
  }
  printSuccess(
    `Unpaused agent ${data.updateAgentStatus.id} (status now IDLE).`,
  );
}

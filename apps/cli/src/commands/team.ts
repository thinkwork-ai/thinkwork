/**
 * `thinkwork team ...` — teams (workspace subdivisions) with agent/user
 * membership and optional sub-budgets.
 *
 * Implementations inline. 9 subcommands but each is a thin wrapper over
 * one GraphQL operation.
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

const TeamsDoc = graphql(`
  query CliTeams($tenantId: ID!) {
    teams(tenantId: $tenantId) {
      id
      name
      slug
      type
      status
      budgetMonthlyCents
      createdAt
    }
  }
`);

const TeamDoc = graphql(`
  query CliTeam($id: ID!) {
    team(id: $id) {
      id
      name
      slug
      description
      type
      status
      budgetMonthlyCents
      createdAt
      updatedAt
      agents {
        id
        agentId
        role
        joinedAt
      }
      users {
        id
        userId
        role
        joinedAt
      }
    }
  }
`);

const CreateTeamDoc = graphql(`
  mutation CliCreateTeam($input: CreateTeamInput!) {
    createTeam(input: $input) {
      id
      name
      type
      status
    }
  }
`);

const UpdateTeamDoc = graphql(`
  mutation CliUpdateTeam($id: ID!, $input: UpdateTeamInput!) {
    updateTeam(id: $id, input: $input) {
      id
      name
      type
      status
      budgetMonthlyCents
    }
  }
`);

const DeleteTeamDoc = graphql(`
  mutation CliDeleteTeam($id: ID!) {
    deleteTeam(id: $id)
  }
`);

const AddTeamAgentDoc = graphql(`
  mutation CliAddTeamAgent($teamId: ID!, $input: AddTeamAgentInput!) {
    addTeamAgent(teamId: $teamId, input: $input) {
      id
      agentId
      role
    }
  }
`);

const RemoveTeamAgentDoc = graphql(`
  mutation CliRemoveTeamAgent($teamId: ID!, $agentId: ID!) {
    removeTeamAgent(teamId: $teamId, agentId: $agentId)
  }
`);

const AddTeamUserDoc = graphql(`
  mutation CliAddTeamUser($teamId: ID!, $input: AddTeamUserInput!) {
    addTeamUser(teamId: $teamId, input: $input) {
      id
      userId
      role
    }
  }
`);

const RemoveTeamUserDoc = graphql(`
  mutation CliRemoveTeamUser($teamId: ID!, $userId: ID!) {
    removeTeamUser(teamId: $teamId, userId: $userId)
  }
`);

const TeamTenantBySlugDoc = graphql(`
  query CliTeamTenantBySlug($slug: String!) {
    tenantBySlug(slug: $slug) {
      id
      slug
    }
  }
`);

interface TeamCliOptions {
  stage?: string;
  region?: string;
  tenant?: string;
}

async function resolveTeamContext(opts: TeamCliOptions) {
  const region = opts.region ?? "us-east-1";
  const stage = await resolveStage({ flag: opts.stage, region });
  const session = loadStageSession(stage);
  const { client, tenantSlug: ctxTenantSlug } = await getGqlClient({ stage, region });

  const flagOrEnv = opts.tenant ?? process.env.THINKWORK_TENANT;
  if (flagOrEnv) {
    if (session?.tenantSlug === flagOrEnv && session.tenantId) {
      return { stage, region, client, tenantId: session.tenantId };
    }
    const data = await gqlQuery(client, TeamTenantBySlugDoc, { slug: flagOrEnv });
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
    const data = await gqlQuery(client, TeamTenantBySlugDoc, { slug: ctxTenantSlug });
    if (data.tenantBySlug) {
      return { stage, region, client, tenantId: data.tenantBySlug.id };
    }
  }
  printMissingApiSessionError(stage, session !== null);
  process.exit(1);
}

function fmtUsd(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}/mo`;
}

async function runTeamList(opts: TeamCliOptions): Promise<void> {
  const ctx = await resolveTeamContext(opts);
  const data = await gqlQuery(ctx.client, TeamsDoc, { tenantId: ctx.tenantId });
  const items = data.teams ?? [];
  if (isJsonMode()) {
    printJson({ items });
    return;
  }
  printTable(
    items.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      status: t.status,
      budget: fmtUsd(t.budgetMonthlyCents),
    })),
    [
      { key: "id", header: "ID" },
      { key: "name", header: "NAME" },
      { key: "type", header: "TYPE" },
      { key: "status", header: "STATUS" },
      { key: "budget", header: "BUDGET" },
    ],
  );
}

async function runTeamGet(id: string, opts: TeamCliOptions): Promise<void> {
  const ctx = await resolveTeamContext(opts);
  const data = await gqlQuery(ctx.client, TeamDoc, { id });
  const team = data.team;
  if (!team) {
    printError(`Team ${id} not found.`);
    process.exit(1);
  }
  if (isJsonMode()) {
    printJson(team);
    return;
  }
  printKeyValue([
    ["ID", team.id],
    ["Name", team.name],
    ["Slug", team.slug ?? undefined],
    ["Description", team.description ?? undefined],
    ["Type", team.type],
    ["Status", team.status],
    ["Budget", fmtUsd(team.budgetMonthlyCents)],
  ]);
  if (team.agents.length > 0) {
    console.log("\n  Agents:");
    printTable(
      team.agents.map((a) => ({ memberId: a.id, agentId: a.agentId, role: a.role })),
      [
        { key: "memberId", header: "MEMBER ID" },
        { key: "agentId", header: "AGENT ID" },
        { key: "role", header: "ROLE" },
      ],
    );
  }
  if (team.users.length > 0) {
    console.log("\n  Users:");
    printTable(
      team.users.map((u) => ({ memberId: u.id, userId: u.userId, role: u.role })),
      [
        { key: "memberId", header: "MEMBER ID" },
        { key: "userId", header: "USER ID" },
        { key: "role", header: "ROLE" },
      ],
    );
  }
}

interface CreateOptions extends TeamCliOptions {
  description?: string;
  budgetUsd?: string;
}

async function runTeamCreate(
  name: string | undefined,
  opts: CreateOptions,
): Promise<void> {
  const ctx = await resolveTeamContext(opts);
  let resolvedName = name;
  if (!resolvedName) {
    if (!isInteractive()) {
      printError("Team name required in non-interactive mode.");
      process.exit(1);
    }
    requireTty("Team name");
    resolvedName = await promptOrExit(() => input({ message: "Team name:" }));
  }
  const budgetCents = opts.budgetUsd
    ? Math.round(Number.parseFloat(opts.budgetUsd) * 100)
    : null;
  const data = await gqlMutate(ctx.client, CreateTeamDoc, {
    input: {
      tenantId: ctx.tenantId,
      name: resolvedName!,
      description: opts.description ?? null,
      budgetMonthlyCents: budgetCents,
    },
  });
  if (isJsonMode()) {
    printJson(data.createTeam);
    return;
  }
  printSuccess(`Created team ${data.createTeam.id} — ${data.createTeam.name}`);
}

interface UpdateOptions extends TeamCliOptions {
  name?: string;
  description?: string;
  status?: string;
  budgetUsd?: string;
}

async function runTeamUpdate(id: string, opts: UpdateOptions): Promise<void> {
  const ctx = await resolveTeamContext(opts);
  const input: Record<string, unknown> = {};
  if (opts.name !== undefined) input.name = opts.name;
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.status !== undefined) input.status = opts.status;
  if (opts.budgetUsd !== undefined) {
    input.budgetMonthlyCents = Math.round(Number.parseFloat(opts.budgetUsd) * 100);
  }
  if (Object.keys(input).length === 0) {
    printError("Nothing to update. Pass at least one of --name, --description, --status, --budget-usd.");
    process.exit(1);
  }
  const data = await gqlMutate(ctx.client, UpdateTeamDoc, { id, input });
  if (isJsonMode()) {
    printJson(data.updateTeam);
    return;
  }
  printSuccess(`Updated team ${data.updateTeam.id}.`);
}

interface DeleteOptions extends TeamCliOptions {
  yes?: boolean;
}

async function runTeamDelete(id: string, opts: DeleteOptions): Promise<void> {
  const ctx = await resolveTeamContext(opts);
  if (!opts.yes) {
    if (!isInteractive()) {
      printError("Refusing to delete without --yes in a non-interactive session.");
      process.exit(1);
    }
    requireTty("Confirmation");
    const go = await promptOrExit(() =>
      confirm({ message: `Delete (archive) team ${id}?`, default: false }),
    );
    if (!go) {
      logStderr("Cancelled.");
      process.exit(0);
    }
  }
  const data = await gqlMutate(ctx.client, DeleteTeamDoc, { id });
  if (isJsonMode()) {
    printJson({ id, deleted: data.deleteTeam });
    return;
  }
  if (data.deleteTeam) printSuccess(`Deleted team ${id}.`);
  else printError(`Server reported not-deleted for ${id}.`);
}

async function runTeamAddAgent(
  teamId: string,
  agentId: string,
  opts: TeamCliOptions,
): Promise<void> {
  const ctx = await resolveTeamContext(opts);
  const data = await gqlMutate(ctx.client, AddTeamAgentDoc, {
    teamId,
    input: { agentId },
  });
  if (isJsonMode()) {
    printJson(data.addTeamAgent);
    return;
  }
  printSuccess(`Added agent ${agentId} to team ${teamId}.`);
}

async function runTeamRemoveAgent(
  teamId: string,
  agentId: string,
  opts: TeamCliOptions,
): Promise<void> {
  const ctx = await resolveTeamContext(opts);
  const data = await gqlMutate(ctx.client, RemoveTeamAgentDoc, { teamId, agentId });
  if (isJsonMode()) {
    printJson({ teamId, agentId, removed: data.removeTeamAgent });
    return;
  }
  if (data.removeTeamAgent) printSuccess(`Removed agent ${agentId} from team ${teamId}.`);
  else printError(`Server reported not-removed for agent ${agentId} on team ${teamId}.`);
}

async function runTeamAddUser(
  teamId: string,
  userId: string,
  opts: TeamCliOptions,
): Promise<void> {
  const ctx = await resolveTeamContext(opts);
  const data = await gqlMutate(ctx.client, AddTeamUserDoc, {
    teamId,
    input: { userId },
  });
  if (isJsonMode()) {
    printJson(data.addTeamUser);
    return;
  }
  printSuccess(`Added user ${userId} to team ${teamId}.`);
}

async function runTeamRemoveUser(
  teamId: string,
  userId: string,
  opts: TeamCliOptions,
): Promise<void> {
  const ctx = await resolveTeamContext(opts);
  const data = await gqlMutate(ctx.client, RemoveTeamUserDoc, { teamId, userId });
  if (isJsonMode()) {
    printJson({ teamId, userId, removed: data.removeTeamUser });
    return;
  }
  if (data.removeTeamUser) printSuccess(`Removed user ${userId} from team ${teamId}.`);
  else printError(`Server reported not-removed for user ${userId} on team ${teamId}.`);
}

export function registerTeamCommand(program: Command): void {
  const team = program
    .command("team")
    .alias("teams")
    .description("Manage teams within a tenant.");

  team
    .command("list")
    .alias("ls")
    .description("List teams in the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runTeamList);

  team
    .command("get <id>")
    .description("Fetch one team with its members and agents.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runTeamGet);

  team
    .command("create [name]")
    .description("Create a new team.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--description <text>")
    .option("--budget-usd <n>", "Optional sub-budget (monthly, USD)")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork team create "Ops" --description "24/7 on-call" --budget-usd 2000
`,
    )
    .action(runTeamCreate);

  team
    .command("update <id>")
    .description("Update team name, description, status, or budget.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--name <n>")
    .option("--description <text>")
    .option("--status <s>", "active | archived")
    .option("--budget-usd <n>")
    .action(runTeamUpdate);

  team
    .command("delete <id>")
    .description("Delete (archive) a team.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(runTeamDelete);

  team
    .command("add-agent <teamId> <agentId>")
    .description("Add an agent to a team.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runTeamAddAgent);

  team
    .command("remove-agent <teamId> <agentId>")
    .description("Remove an agent from a team.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runTeamRemoveAgent);

  team
    .command("add-user <teamId> <userId>")
    .description("Add a user to a team.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runTeamAddUser);

  team
    .command("remove-user <teamId> <userId>")
    .description("Remove a user from a team.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(runTeamRemoveUser);
}

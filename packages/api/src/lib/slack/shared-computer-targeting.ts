import { and, eq, ne } from "drizzle-orm";
import {
  computerAssignments,
  computers,
  slackUserLinks,
  teamUsers,
} from "@thinkwork/database-pg/schema";
import { db } from "../db.js";

export type SlackSharedComputerTargetingDbClient = typeof db;

export interface SlackAssignedComputer {
  computerId: string;
  computerName: string;
  computerSlug: string;
}

export interface SlackLinkedRequester {
  userId: string;
  slackUserName: string | null;
}

export interface SlackTargetingContext {
  requester: SlackLinkedRequester;
  assignedComputers: SlackAssignedComputer[];
}

export interface SlackResolvedComputerTarget extends SlackLinkedRequester {
  computerId: string;
  computerName: string;
  computerSlug: string;
  prompt: string;
  targetToken: string | null;
}

export type SlackComputerTargetResult =
  | { status: "resolved"; target: SlackResolvedComputerTarget }
  | { status: "unlinked" }
  | {
      status: "no_assignments";
      requester: SlackLinkedRequester;
    }
  | {
      status: "missing_target";
      requester: SlackLinkedRequester;
      options: SlackAssignedComputer[];
    }
  | {
      status: "unknown_target";
      requester: SlackLinkedRequester;
      targetToken: string;
      options: SlackAssignedComputer[];
    }
  | {
      status: "missing_prompt";
      requester: SlackLinkedRequester;
      targetToken: string;
      options: SlackAssignedComputer[];
    };

export interface ResolveSlackSharedComputerTargetInput {
  tenantId: string;
  slackTeamId: string;
  slackUserId: string;
  text: string;
  botUserId?: string | null;
  allowSingleAssignedFallback?: boolean;
}

export interface ResolveSlackSharedComputerTargetDeps {
  loadContext?: (input: {
    tenantId: string;
    slackTeamId: string;
    slackUserId: string;
  }) => Promise<SlackTargetingContext | null>;
}

export async function resolveSlackSharedComputerTarget(
  input: ResolveSlackSharedComputerTargetInput,
  deps: ResolveSlackSharedComputerTargetDeps = {},
): Promise<SlackComputerTargetResult> {
  const loadContext =
    deps.loadContext ??
    ((contextInput) => loadSlackTargetingContext(contextInput));
  const context = await loadContext({
    tenantId: input.tenantId,
    slackTeamId: input.slackTeamId,
    slackUserId: input.slackUserId,
  });
  if (!context) return { status: "unlinked" };
  if (context.assignedComputers.length === 0) {
    return { status: "no_assignments", requester: context.requester };
  }

  const parsed = parseSlackTargetedPrompt(input.text, input.botUserId);
  if (!parsed.targetToken) {
    if (
      input.allowSingleAssignedFallback &&
      context.assignedComputers.length === 1
    ) {
      return {
        status: "resolved",
        target: buildResolvedTarget({
          requester: context.requester,
          computer: context.assignedComputers[0]!,
          prompt: parsed.prompt,
          targetToken: null,
        }),
      };
    }
    return {
      status: "missing_target",
      requester: context.requester,
      options: context.assignedComputers,
    };
  }

  const computer = findAssignedComputerByTarget(
    context.assignedComputers,
    parsed.targetToken,
  );
  if (!computer) {
    if (
      input.allowSingleAssignedFallback &&
      context.assignedComputers.length === 1
    ) {
      return {
        status: "resolved",
        target: buildResolvedTarget({
          requester: context.requester,
          computer: context.assignedComputers[0]!,
          prompt: stripLeadingSlackMention(input.text, input.botUserId),
          targetToken: null,
        }),
      };
    }
    return {
      status: "unknown_target",
      requester: context.requester,
      targetToken: parsed.targetToken,
      options: context.assignedComputers,
    };
  }
  if (!parsed.prompt.trim()) {
    return {
      status: "missing_prompt",
      requester: context.requester,
      targetToken: parsed.targetToken,
      options: context.assignedComputers,
    };
  }

  return {
    status: "resolved",
    target: buildResolvedTarget({
      requester: context.requester,
      computer,
      prompt: parsed.prompt,
      targetToken: parsed.targetToken,
    }),
  };
}

export function parseSlackTargetedPrompt(
  text: string,
  botUserId?: string | null,
): { targetToken: string | null; prompt: string } {
  const remaining = stripLeadingSlackMention(text, botUserId);
  if (!remaining) return { targetToken: null, prompt: "" };

  const [targetToken = "", ...promptParts] = remaining.split(/\s+/);
  return {
    targetToken: targetToken.trim() || null,
    prompt: promptParts.join(" ").trim(),
  };
}

function stripLeadingSlackMention(text: string, botUserId?: string | null) {
  const mentionPattern = botUserId
    ? new RegExp(`^<@${escapeRegExp(botUserId)}(?:\\|[^>]+)?>\\s*`)
    : /^<@[A-Z0-9]+(?:\|[^>]+)?>\s*/;
  return text.trim().replace(mentionPattern, "").trim();
}

export function slackTargetingGuidance(
  result: Exclude<SlackComputerTargetResult, { status: "resolved" }>,
): string {
  switch (result.status) {
    case "unlinked":
      return "Link your Slack identity to ThinkWork before using Slack Computers.";
    case "no_assignments":
      return "You do not have access to any shared Computers yet. Ask a ThinkWork admin to assign one.";
    case "missing_target":
      return `Choose a shared Computer first, for example: \`/thinkwork ${exampleTarget(result.options)} summarize this thread\`.`;
    case "unknown_target":
      return `I could not find an assigned shared Computer named \`${result.targetToken}\`. Try one of: ${optionList(result.options)}.`;
    case "missing_prompt":
      return `Add a request after the Computer name, for example: \`/thinkwork ${result.targetToken} summarize this thread\`.`;
  }
}

export async function loadSlackTargetingContext(
  input: {
    tenantId: string;
    slackTeamId: string;
    slackUserId: string;
  },
  dbClient: SlackSharedComputerTargetingDbClient = db,
): Promise<SlackTargetingContext | null> {
  const [link] = await dbClient
    .select({
      userId: slackUserLinks.user_id,
      slackUserName: slackUserLinks.slack_user_name,
    })
    .from(slackUserLinks)
    .where(
      and(
        eq(slackUserLinks.tenant_id, input.tenantId),
        eq(slackUserLinks.slack_team_id, input.slackTeamId),
        eq(slackUserLinks.slack_user_id, input.slackUserId),
        eq(slackUserLinks.status, "active"),
      ),
    )
    .limit(1);
  if (!link) return null;

  const directRows = await dbClient
    .select({
      computerId: computers.id,
      computerName: computers.name,
      computerSlug: computers.slug,
    })
    .from(computerAssignments)
    .innerJoin(computers, eq(computers.id, computerAssignments.computer_id))
    .where(
      and(
        eq(computerAssignments.tenant_id, input.tenantId),
        eq(computerAssignments.subject_type, "user"),
        eq(computerAssignments.user_id, link.userId),
        ne(computers.status, "archived"),
      ),
    );

  const teamRows = await dbClient
    .select({
      computerId: computers.id,
      computerName: computers.name,
      computerSlug: computers.slug,
    })
    .from(computerAssignments)
    .innerJoin(teamUsers, eq(teamUsers.team_id, computerAssignments.team_id))
    .innerJoin(computers, eq(computers.id, computerAssignments.computer_id))
    .where(
      and(
        eq(computerAssignments.tenant_id, input.tenantId),
        eq(computerAssignments.subject_type, "team"),
        eq(teamUsers.tenant_id, input.tenantId),
        eq(teamUsers.user_id, link.userId),
        ne(computers.status, "archived"),
      ),
    );

  const byId = new Map<string, SlackAssignedComputer>();
  for (const row of [...directRows, ...teamRows]) {
    byId.set(row.computerId, row);
  }

  return {
    requester: link,
    assignedComputers: [...byId.values()].sort((left, right) =>
      left.computerName.localeCompare(right.computerName),
    ),
  };
}

function findAssignedComputerByTarget(
  assignedComputers: SlackAssignedComputer[],
  targetToken: string,
): SlackAssignedComputer | null {
  const normalizedTarget = normalizeTarget(targetToken);
  return (
    assignedComputers.find((computer) =>
      targetAliases(computer).includes(normalizedTarget),
    ) ?? null
  );
}

function targetAliases(computer: SlackAssignedComputer): string[] {
  const slug = normalizeTarget(computer.computerSlug);
  const name = normalizeTarget(computer.computerName);
  const aliases = new Set<string>();
  for (const value of [slug, name]) {
    aliases.add(value.replace(/-computer$/, ""));
  }
  aliases.add(slug);
  aliases.add(name);
  return [...aliases].filter(Boolean);
}

function buildResolvedTarget(input: {
  requester: SlackLinkedRequester;
  computer: SlackAssignedComputer;
  prompt: string;
  targetToken: string | null;
}): SlackResolvedComputerTarget {
  return {
    userId: input.requester.userId,
    slackUserName: input.requester.slackUserName,
    computerId: input.computer.computerId,
    computerName: input.computer.computerName,
    computerSlug: input.computer.computerSlug,
    prompt: input.prompt,
    targetToken: input.targetToken,
  };
}

function exampleTarget(options: SlackAssignedComputer[]): string {
  const fallback = {
    computerId: "",
    computerName: "Finance",
    computerSlug: "finance",
  };
  return targetAliases(options[0] ?? fallback)[0] ?? "finance";
}

function optionList(options: SlackAssignedComputer[]): string {
  return options
    .map((computer) => `\`${targetAliases(computer)[0]}\``)
    .join(", ");
}

function normalizeTarget(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `thinkwork message ...` — messages within a thread.
 *
 * Implementations inline (only 2 subcommands).
 */

import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { input } from "@inquirer/prompts";
import { graphql } from "../gql/index.js";
import { MessageRole } from "../gql/graphql.js";
import { loadStageSession } from "../cli-config.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { getGqlClient, gqlMutate, gqlQuery } from "../lib/gql-client.js";
import { isInteractive, promptOrExit, requireTty } from "../lib/interactive.js";
import { isJsonMode, printJson, printTable } from "../lib/output.js";
import { printError, printMissingApiSessionError, printSuccess } from "../ui.js";

const SendMessageDoc = graphql(`
  mutation CliMsgSendMessage($input: SendMessageInput!) {
    sendMessage(input: $input) {
      id
      threadId
      role
      content
      createdAt
    }
  }
`);

const MessagesDoc = graphql(`
  query CliMsgMessages($threadId: ID!, $limit: Int, $cursor: String) {
    messages(threadId: $threadId, limit: $limit, cursor: $cursor) {
      edges {
        cursor
        node {
          id
          role
          senderType
          senderId
          content
          tokenCount
          createdAt
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`);

interface MessageCliOptions {
  stage?: string;
  region?: string;
  tenant?: string;
}

interface SendOptions extends MessageCliOptions {
  file?: string;
  asAgent?: string;
}

interface ListOptions extends MessageCliOptions {
  limit?: string;
  cursor?: string;
}

async function resolveMessageContext(opts: MessageCliOptions) {
  const region = opts.region ?? "us-east-1";
  const stage = await resolveStage({ flag: opts.stage, region });
  const session = loadStageSession(stage);
  const { client } = await getGqlClient({ stage, region });

  if (!session) {
    printMissingApiSessionError(stage, false);
    process.exit(1);
  }

  return { stage, region, client, session };
}

function truncate(text: string | null | undefined, len: number): string {
  if (!text) return "—";
  return text.length > len ? `${text.slice(0, len - 1)}…` : text;
}

function fmtIso(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function runMessageSend(
  threadId: string,
  content: string | undefined,
  opts: SendOptions,
): Promise<void> {
  const ctx = await resolveMessageContext(opts);

  // --as-agent requires api-key session (the bearer must already authenticate
  // as the agent). Cognito sessions error out with a clear message.
  if (opts.asAgent && ctx.session.kind !== "api-key") {
    printError(
      "--as-agent <id> requires an api-key session. Run `thinkwork login --stage <s> --api-key <secret> --tenant <slug>`.",
    );
    process.exit(1);
  }

  let resolved = content;
  if (!resolved && opts.file) {
    resolved = await readFile(opts.file, "utf-8");
  }
  if (!resolved) {
    if (!isInteractive()) {
      printError(
        "Message content required. Pass it as an arg, use --file, or run in a TTY.",
      );
      process.exit(1);
    }
    requireTty("Message content");
    resolved = await promptOrExit(() => input({ message: "Message:" }));
  }

  const role = opts.asAgent ? MessageRole.Assistant : MessageRole.User;
  const senderType = opts.asAgent ? "agent" : ctx.session.kind === "cognito" ? "user" : null;
  const senderId =
    opts.asAgent ?? (ctx.session.kind === "cognito" ? ctx.session.principalId : null);

  const data = await gqlMutate(ctx.client, SendMessageDoc, {
    input: {
      threadId,
      role,
      content: resolved,
      senderType,
      senderId,
    },
  });
  const msg = data.sendMessage;

  if (isJsonMode()) {
    printJson(msg);
    return;
  }
  printSuccess(`Sent message ${msg.id} to thread ${threadId}`);
}

async function runMessageList(threadId: string, opts: ListOptions): Promise<void> {
  const ctx = await resolveMessageContext(opts);
  const limit = Number.parseInt(opts.limit ?? "50", 10);

  const data = await gqlQuery(ctx.client, MessagesDoc, {
    threadId,
    limit,
    cursor: opts.cursor ?? null,
  });

  const edges = data.messages.edges ?? [];

  if (isJsonMode()) {
    printJson({
      messages: edges.map((e) => e.node),
      pageInfo: data.messages.pageInfo,
    });
    return;
  }

  const rows = edges.map((e) => ({
    when: fmtIso(e.node.createdAt),
    role: e.node.role,
    sender:
      e.node.senderType && e.node.senderId
        ? `${e.node.senderType}:${e.node.senderId.slice(0, 8)}`
        : e.node.senderType ?? "—",
    content: truncate(e.node.content, 80),
    tokens: e.node.tokenCount != null ? String(e.node.tokenCount) : "—",
  }));

  printTable(rows, [
    { key: "when", header: "WHEN" },
    { key: "role", header: "ROLE" },
    { key: "sender", header: "SENDER" },
    { key: "content", header: "CONTENT" },
    { key: "tokens", header: "TOK" },
  ]);

  if (data.messages.pageInfo.hasNextPage && data.messages.pageInfo.endCursor) {
    console.log("");
    console.log(`  More results — next cursor: ${data.messages.pageInfo.endCursor}`);
  }
}

export function registerMessageCommand(program: Command): void {
  const msg = program
    .command("message")
    .alias("messages")
    .alias("msg")
    .description("Send and list messages inside a thread.");

  msg
    .command("send <threadId> [content]")
    .description("Send a message to a thread. Prompts for content if omitted and TTY.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--file <path>", "Read message content from a file")
    .option("--as-agent <id>", "Send as a specific agent (api-key auth only)")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork message send thr-abc "Investigating now"
  $ thinkwork message send thr-abc --file notes.md
  $ thinkwork message send thr-abc                    # interactive
`,
    )
    .action(runMessageSend);

  msg
    .command("list <threadId>")
    .alias("ls")
    .description("List messages in a thread (paginated).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--limit <n>", "Max messages to return", "50")
    .option("--cursor <c>", "Pagination cursor from a previous page")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork message list thr-abc
  $ thinkwork message list thr-abc --limit 10 --json | jq '.[].author'
`,
    )
    .action(runMessageList);
}

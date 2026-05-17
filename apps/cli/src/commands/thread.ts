/**
 * `thinkwork thread ...` — work items in a tenant.
 *
 * Maps 1:1 to the admin "Threads" UI. Implementations land in apps/cli/src/commands/thread/.
 */

import { Command } from "commander";
import { runThreadList } from "./thread/list.js";
import { runThreadGet } from "./thread/get.js";
import { runThreadCreate } from "./thread/create.js";
import { runThreadUpdate } from "./thread/update.js";
import { runThreadCheckout } from "./thread/checkout.js";
import { runThreadRelease } from "./thread/release.js";
import { runThreadComment } from "./thread/comment.js";
import { runThreadLabel } from "./thread/label.js";
import { runThreadEscalate } from "./thread/escalate.js";
import { runThreadDelegate } from "./thread/delegate.js";
import { runThreadDelete } from "./thread/delete.js";

export function registerThreadCommand(program: Command): void {
  const thread = program
    .command("thread")
    .alias("threads")
    .description(
      "Create, list, update, and comment on threads in a tenant.",
    );

  thread
    .command("list")
    .alias("ls")
    .description("List threads in a tenant with optional filters.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--assignee <id>", "Filter by assignee (user or agent ID). Use `me` to match the caller.")
    .option("--agent <id>", "Filter threads worked on by a specific agent")
    .option("--search <q>", "Full-text search over thread titles")
    .option("--limit <n>", "Max rows (default 50)", "50")
    .option("--archived", "Include archived threads")
    .addHelpText(
      "after",
      `
Examples:
  # Everything assigned to me
  $ thinkwork thread list --assignee me

  # Limit + JSON for piping
  $ thinkwork thread list --limit 100 --json | jq '.[] | .title'

  # Archived threads only
  $ thinkwork thread list --archived
`,
    )
    .action(runThreadList);

  thread
    .command("get <idOrNumber>")
    .description("Fetch one thread by ID or by its tenant-scoped issue number.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork thread get thr-abc123
  $ thinkwork thread get 42                 # by issue number
  $ thinkwork thread get 42 --json | jq .assignee
`,
    )
    .action(runThreadGet);

  thread
    .command("create [title]")
    .description("Create a new thread. Prompts for missing fields when running in a TTY.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--assignee <id>", "Assign on create (user or agent ID)")
    .option("--due <iso>", "Due date as ISO-8601")
    .option("--label <name...>", "Attach label(s) by name (repeatable)")
    .addHelpText(
      "after",
      `
Examples:
  # Fully interactive — walkthrough prompts for title and assignee.
  $ thinkwork thread create

  # Scripted
  $ thinkwork thread create "Investigate latency spike" \\
      --assignee agt-obs-1 --label ops --label oncall

  # Mix: pass the title, prompt for the rest.
  $ thinkwork thread create "Investigate latency spike"
`,
    )
    .action(runThreadCreate);

  thread
    .command("update <id>")
    .description("Update a thread's title, assignee, labels, or due date.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--title <t>", "Rename")
    .option("--assignee <id>", "Reassign (user or agent ID)")
    .option("--due <iso>", "Due date")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork thread update thr-abc --title "New title"
  $ thinkwork thread update thr-abc --assignee agt-ops
`,
    )
    .action(runThreadUpdate);

  thread
    .command("checkout <id>")
    .description("Claim a thread for a CLI-issued run-id (lock until release).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--agent <id>", "Informational — checkout is tracked by the generated runId")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork thread checkout thr-abc
  # Run ID is printed — pair with \`thread release\` to release the lock.
`,
    )
    .action(runThreadCheckout);

  thread
    .command("release <id>")
    .description("Release a checked-out thread (pass the run-id from checkout).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--run-id <id>", "The runId returned by `thinkwork thread checkout`")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork thread release thr-abc --run-id cli-1234abcd-…
`,
    )
    .action(runThreadRelease);

  thread
    .command("comment <id> [content]")
    .description("Add a comment to a thread. Prompts for content if omitted and TTY.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--file <path>", "Read comment content from a file (markdown)")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork thread comment thr-abc "Looks good, shipping"
  $ thinkwork thread comment thr-abc --file /tmp/review.md
  $ thinkwork thread comment thr-abc            # prompts interactively

Note: comments are sent as USER messages (no separate comment surface in the schema).
`,
    )
    .action(runThreadComment);

  thread
    .command("label <assign|remove> <threadId> <labelId>")
    .description("Attach or detach a label on a thread. Labels are managed via `thinkwork label`.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork thread label assign thr-abc lbl-ops
  $ thinkwork thread label remove thr-abc lbl-ops
`,
    )
    .action(runThreadLabel);

  thread
    .command("escalate <id>")
    .description("Escalate a thread to another agent (carries context, records actor).")
    .option("--to-agent <id>", "Agent to escalate to")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--reason <text>", "Reason note (appears in activity log)")
    .action(runThreadEscalate);

  thread
    .command("delegate <id>")
    .description("Delegate ownership to another agent without the 'escalation' semantics.")
    .option("--to-agent <id>", "Agent to delegate to")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--reason <text>", "Optional reason note")
    .action(runThreadDelegate);

  thread
    .command("delete <id>")
    .description("Permanently delete a thread (not just close). Requires confirmation.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip the confirmation prompt")
    .addHelpText(
      "after",
      `
Examples:
  # Prompts 'Are you sure?'
  $ thinkwork thread delete thr-abc

  # Scripted / destructive-no-prompt
  $ thinkwork thread delete thr-abc --yes
`,
    )
    .action(runThreadDelete);
}

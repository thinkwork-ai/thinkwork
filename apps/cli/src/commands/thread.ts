/**
 * `thinkwork thread ...` — work items in a tenant.
 *
 * Maps 1:1 to the admin "Threads" UI. Scaffolded in Phase 0; action bodies
 * land in Phase 1 — see apps/cli/README.md#roadmap.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

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
    .option("--status <status>", "Filter: BACKLOG | TODO | IN_PROGRESS | IN_REVIEW | BLOCKED | DONE | CANCELLED")
    .option("--assignee <id>", "Filter by assignee (user or agent ID). Use `me` to match the caller.")
    .option("--agent <id>", "Filter threads worked on by a specific agent")
    .option("--search <q>", "Full-text search over title/body")
    .option("--limit <n>", "Max rows (default 50)", "50")
    .option("--archived", "Include archived threads")
    .addHelpText(
      "after",
      `
Examples:
  # Open work on the default stage/tenant
  $ thinkwork thread list --status IN_PROGRESS

  # Pipe to jq
  $ thinkwork thread list --json | jq '.[] | select(.status=="IN_PROGRESS")'

  # Everything assigned to me
  $ thinkwork thread list --assignee me
`,
    )
    .action(() => notYetImplemented("thread list", 1));

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
    .action(() => notYetImplemented("thread get", 1));

  thread
    .command("create [title]")
    .description("Create a new thread. Prompts for missing fields when running in a TTY.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--assignee <id>", "Assign on create (user or agent ID)")
    .option("--body <text>", "Description body (markdown)")
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
    .action(() => notYetImplemented("thread create", 1));

  thread
    .command("update <id>")
    .description("Update a thread's title, status, assignee, labels, or due date.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--title <t>", "Rename")
    .option("--status <s>", "Move to a new status")
    .option("--assignee <id>", "Reassign (user or agent ID)")
    .option("--due <iso>", "Due date")
    .option("--body <text>", "Replace description body")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork thread update thr-abc --status IN_REVIEW
  $ thinkwork thread update thr-abc --assignee agt-ops
`,
    )
    .action(() => notYetImplemented("thread update", 1));

  thread
    .command("close <id>")
    .description("Mark a thread DONE. Shortcut for `thread update <id> --status DONE`.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--comment <text>", "Add a closing comment")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork thread close thr-abc
  $ thinkwork thread close thr-abc --comment "fixed in #124"
`,
    )
    .action(() => notYetImplemented("thread close", 1));

  thread
    .command("reopen <id>")
    .description("Move a thread from DONE/CANCELLED back to TODO.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("thread reopen", 1));

  thread
    .command("checkout <id>")
    .description("Claim a thread so an agent can work it (locks other agents out).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--agent <id>", "Agent to check it out to (defaults to the caller)")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork thread checkout thr-abc --agent agt-fixer
`,
    )
    .action(() => notYetImplemented("thread checkout", 1));

  thread
    .command("release <id>")
    .description("Release a checked-out thread, optionally moving it to a new status.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--status <s>", "Status to release into")
    .action(() => notYetImplemented("thread release", 1));

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
`,
    )
    .action(() => notYetImplemented("thread comment", 1));

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
    .action(() => notYetImplemented("thread label", 1));

  thread
    .command("escalate <id>")
    .description("Escalate a thread to another agent (carries context, records actor).")
    .option("--to-agent <id>", "Agent to escalate to")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--reason <text>", "Reason note (appears in activity log)")
    .action(() => notYetImplemented("thread escalate", 1));

  thread
    .command("delegate <id>")
    .description("Delegate ownership to another agent without the 'escalation' semantics.")
    .option("--to-agent <id>", "Agent to delegate to")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("thread delegate", 1));

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
    .action(() => notYetImplemented("thread delete", 1));
}

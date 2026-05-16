import { Command } from "commander";
import { runEvalRun } from "./eval/run.js";
import { runEvalList } from "./eval/list.js";
import { runEvalGet } from "./eval/get.js";
import { runEvalWatch } from "./eval/watch.js";
import { runEvalCancel } from "./eval/cancel.js";
import { runEvalDelete } from "./eval/delete.js";
import { runEvalCategories } from "./eval/categories.js";
import { runEvalSeed } from "./eval/seed.js";
import { runEvalTestCaseList } from "./eval/test-case/list.js";
import { runEvalTestCaseGet } from "./eval/test-case/get.js";
import { runEvalTestCaseCreate } from "./eval/test-case/create.js";
import { runEvalTestCaseUpdate } from "./eval/test-case/update.js";
import { runEvalTestCaseDelete } from "./eval/test-case/delete.js";

export function registerEvalCommand(program: Command): void {
  const evals = program
    .command("eval")
    .alias("evals")
    .description(
      "Run evaluations against running Computers and manage eval test cases. Integrates with the Evaluations Studio in the admin UI.",
    );

  evals
    .command("run")
    .description(
      "Start an evaluation run. Prompts for missing values in a TTY; fails fast in non-interactive sessions.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-r, --region <region>", "AWS region", "us-east-1")
    .option("--computer <id>", "Running Computer ID to evaluate")
    .option("--model <id>", "Optional model override")
    .option("--category <name...>", "Only run these categories (repeatable)")
    .option(
      "--test-case <id...>",
      "Only run these specific test case IDs (repeatable)",
    )
    .option("--all", "Run all enabled test cases for the tenant")
    .option("--watch", "Block and poll until the run reaches a terminal status")
    .option(
      "--timeout <seconds>",
      "Max wait seconds for --watch (default 900)",
      "900",
    )
    .addHelpText(
      "after",
      `
Examples:
  # Fire and return — prints the runId; view results in the admin UI
  $ thinkwork eval run --computer comp-abc --category tool-safety

  # Pick categories + test cases interactively
  $ thinkwork eval run

  # Block until done
  $ thinkwork eval run --computer comp-abc --all --watch --timeout 1800
`,
    )
    .action(runEvalRun);

  evals
    .command("list")
    .alias("ls")
    .description("List recent eval runs for the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-r, --region <region>", "AWS region", "us-east-1")
    .option("--agent <id>", "Filter by agent under test")
    .option("--limit <n>", "Max rows (default 25)", "25")
    .option("--offset <n>", "Skip N rows", "0")
    .action(runEvalList);

  evals
    .command("get <runId>")
    .description("Show one eval run with its per-test-case results.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-r, --region <region>", "AWS region", "us-east-1")
    .option(
      "--results",
      "Also fetch per-test-case results (default: true)",
      true,
    )
    .option("--no-results", "Skip fetching per-test-case results")
    .action(runEvalGet);

  evals
    .command("watch <runId>")
    .description("Poll an eval run until it reaches a terminal status.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-r, --region <region>", "AWS region", "us-east-1")
    .option("--interval <seconds>", "Poll interval (default 3)", "3")
    .option("--timeout <seconds>", "Max wait seconds (default 900)", "900")
    .action(runEvalWatch);

  evals
    .command("cancel <runId>")
    .description("Cancel a running or pending eval run.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-r, --region <region>", "AWS region", "us-east-1")
    .action(runEvalCancel);

  evals
    .command("delete <runId>")
    .description(
      "Delete an eval run and its results. Requires confirmation unless --yes.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-r, --region <region>", "AWS region", "us-east-1")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(runEvalDelete);

  evals
    .command("categories")
    .description(
      "List distinct categories present across the tenant's test cases.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-r, --region <region>", "AWS region", "us-east-1")
    .action(runEvalCategories);

  evals
    .command("seed")
    .description(
      "Idempotently seed the ThinkWork RedTeam starter pack (189 test cases across 4 categories). Safe to re-run.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-r, --region <region>", "AWS region", "us-east-1")
    .option("--category <name...>", "Only seed these categories (repeatable)")
    .action(runEvalSeed);

  // ─────────────────────────── test-case sub-group ───────────────────────────
  const tc = evals
    .command("test-case")
    .alias("test-cases")
    .description("Manage individual eval test cases (CRUD).");

  tc.command("list")
    .alias("ls")
    .description("List test cases, optionally filtered by category or search.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-r, --region <region>", "AWS region", "us-east-1")
    .option("--category <name>", "Filter by a single category")
    .option("--search <q>", "Substring match on test case name")
    .action(runEvalTestCaseList);

  tc.command("get <id>")
    .description("Show a single test case.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-r, --region <region>", "AWS region", "us-east-1")
    .action(runEvalTestCaseGet);

  tc.command("create")
    .description("Create a new test case. Prompts for missing values in a TTY.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-r, --region <region>", "AWS region", "us-east-1")
    .option("--name <text>", "Human-readable name")
    .option("--category <name>", "Category label (e.g. tool-safety, red-team)")
    .option("--query <text>", "The user-facing query this agent will receive")
    .option("--system-prompt <text>", "Optional system-prompt override")
    .option("--agent-template <id>", "Pin to a specific agent template")
    .option("--evaluator <id...>", "AgentCore evaluator IDs (repeatable)")
    .option("--tag <name...>", "Tags (repeatable)")
    .option("--enabled", "Mark enabled (default)", true)
    .option("--no-enabled", "Mark disabled")
    .option(
      "--assertions-file <path>",
      "JSON file containing an array of assertions",
    )
    .action(runEvalTestCaseCreate);

  tc.command("update <id>")
    .description("Update a test case. Only supplied fields are changed.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-r, --region <region>", "AWS region", "us-east-1")
    .option("--name <text>")
    .option("--category <name>")
    .option("--query <text>")
    .option("--system-prompt <text>")
    .option("--agent-template <id>")
    .option(
      "--evaluator <id...>",
      "Replace AgentCore evaluator IDs (repeatable)",
    )
    .option("--tag <name...>", "Replace tags (repeatable)")
    .option("--enabled", "Mark enabled")
    .option("--no-enabled", "Mark disabled")
    .option(
      "--assertions-file <path>",
      "JSON file containing an array of assertions (replaces all)",
    )
    .action(runEvalTestCaseUpdate);

  tc.command("delete <id>")
    .description("Delete a test case. Requires confirmation unless --yes.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-r, --region <region>", "AWS region", "us-east-1")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(runEvalTestCaseDelete);
}

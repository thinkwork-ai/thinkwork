#!/usr/bin/env node

import { Command } from "commander";
import { VERSION } from "./version.js";
import { loadCliConfig } from "./cli-config.js";
import { setJsonMode } from "./lib/output.js";
import { registerPlanCommand } from "./commands/plan.js";
import { registerDeployCommand } from "./commands/deploy.js";
import { registerDestroyCommand } from "./commands/destroy.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerOutputsCommand } from "./commands/outputs.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerBootstrapCommand } from "./commands/bootstrap.js";
import { registerLoginCommand } from "./commands/login.js";
import { registerLogoutCommand } from "./commands/logout.js";
import { registerInitCommand } from "./commands/init.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerToolsCommand } from "./commands/tools.js";
import { registerUpdateCommand } from "./commands/update.js";
import { registerUserCommand } from "./commands/user.js";
import { registerMeCommand } from "./commands/me.js";
// Phase-1 (threads / approvals) — scaffolded in Phase 0, implemented next.
import { registerThreadCommand } from "./commands/thread.js";
import { registerMessageCommand } from "./commands/message.js";
import { registerLabelCommand } from "./commands/label.js";
import { registerInboxCommand } from "./commands/inbox.js";
// Phase-2 (agents / templates / tenancy / teams / kb).
import { registerAgentCommand } from "./commands/agent.js";
import { registerTemplateCommand } from "./commands/template.js";
import { registerTenantCommand } from "./commands/tenant.js";
import { registerMemberCommand } from "./commands/member.js";
import { registerTeamCommand } from "./commands/team.js";
import { registerKbCommand } from "./commands/kb.js";
// Phase-3 (automation / integrations).
import { registerRoutineCommand } from "./commands/routine.js";
import { registerScheduledJobCommand } from "./commands/scheduled-job.js";
import { registerTurnCommand } from "./commands/turn.js";
import { registerWakeupCommand } from "./commands/wakeup.js";
import { registerWebhookCommand } from "./commands/webhook.js";
import { registerConnectorCommand } from "./commands/connector.js";
import { registerSkillCommand } from "./commands/skill.js";
// Phase-4 (memory / recipes / artifacts).
import { registerMemoryCommand } from "./commands/memory.js";
import { registerRecipeCommand } from "./commands/recipe.js";
import { registerArtifactCommand } from "./commands/artifact.js";
// Phase-5 (observability / spend / polish).
import { registerCostCommand } from "./commands/cost.js";
import { registerBudgetCommand } from "./commands/budget.js";
import { registerPerformanceCommand } from "./commands/performance.js";
import { registerTraceCommand } from "./commands/trace.js";
import { registerDashboardCommand } from "./commands/dashboard.js";

const program = new Command();

program
  .name("thinkwork")
  .description(
    "Thinkwork CLI — deploy, manage, and interact with your Thinkwork stack",
  )
  .version(VERSION, "-v, --version", "Print the CLI version")
  .option(
    "-p, --profile <name>",
    "AWS profile to use (sets AWS_PROFILE for Terraform and AWS CLI)",
  )
  .option(
    "--json",
    "Emit machine-readable JSON on stdout. Warnings/spinners stay on stderr.",
  );

// Global preAction hook. Runs before every command.
//   1. Resolve --profile (explicit > env > config default) and export it.
//   2. Flip the --json bit so `lib/output` knows which mode to use.
program.hook("preAction", (_thisCommand, actionCommand) => {
  // Profile precedence (unchanged from pre-Phase-0 behavior).
  const explicit = actionCommand.opts().profile ?? program.opts().profile;
  if (explicit) {
    process.env.AWS_PROFILE = explicit;
  } else if (!process.env.AWS_PROFILE) {
    const fallback = loadCliConfig().defaultProfile;
    if (fallback) process.env.AWS_PROFILE = fallback;
  }

  // --json is global — children re-expose it so it's accepted after the
  // subcommand too (`thinkwork me --json`). Either form works.
  const jsonGlobal = Boolean(program.opts().json);
  const jsonLocal = Boolean(actionCommand.opts().json);
  setJsonMode(jsonGlobal || jsonLocal);
});

// Setup
registerLoginCommand(program);
registerLogoutCommand(program);
registerInitCommand(program);
registerDoctorCommand(program);
registerMeCommand(program);

// Deploy
registerPlanCommand(program);
registerDeployCommand(program);
registerBootstrapCommand(program);
registerDestroyCommand(program);

// Manage
registerStatusCommand(program);
registerOutputsCommand(program);
registerConfigCommand(program);
registerMcpCommand(program);
registerToolsCommand(program);
registerUpdateCommand(program);
registerUserCommand(program);

// Phase-1 stubs
registerThreadCommand(program);
registerMessageCommand(program);
registerLabelCommand(program);
registerInboxCommand(program);

// Phase-2 stubs
registerAgentCommand(program);
registerTemplateCommand(program);
registerTenantCommand(program);
registerMemberCommand(program);
registerTeamCommand(program);
registerKbCommand(program);

// Phase-3 stubs
registerRoutineCommand(program);
registerScheduledJobCommand(program);
registerTurnCommand(program);
registerWakeupCommand(program);
registerWebhookCommand(program);
registerConnectorCommand(program);
registerSkillCommand(program);

// Phase-4 stubs
registerMemoryCommand(program);
registerRecipeCommand(program);
registerArtifactCommand(program);

// Phase-5 stubs
registerCostCommand(program);
registerBudgetCommand(program);
registerPerformanceCommand(program);
registerTraceCommand(program);
registerDashboardCommand(program);

// Accept `--json` after any subcommand too (not just right after `thinkwork`).
// Keeps individual registerXxxCommand functions free of plumbing. Walk only
// direct children — subcommand groups (e.g. `user invite`) inherit via
// `cmd.commands` since commander cascades option parsing.
for (const cmd of program.commands) {
  if (!cmd.options.some((o) => o.long === "--json")) {
    cmd.option("--json", "Emit machine-readable JSON on stdout.");
  }
}

program.parse();

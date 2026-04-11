#!/usr/bin/env node

import { Command } from "commander";
import { VERSION } from "./version.js";
import { registerPlanCommand } from "./commands/plan.js";
import { registerDeployCommand } from "./commands/deploy.js";
import { registerDestroyCommand } from "./commands/destroy.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerOutputsCommand } from "./commands/outputs.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerBootstrapCommand } from "./commands/bootstrap.js";
import { registerLoginCommand } from "./commands/login.js";
import { registerInitCommand } from "./commands/init.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerMcpCommand } from "./commands/mcp.js";

const program = new Command();

program
  .name("thinkwork")
  .description(
    "Thinkwork CLI — deploy, manage, and interact with your Thinkwork stack"
  )
  .version(VERSION, "-v, --version", "Print the CLI version")
  .option(
    "-p, --profile <name>",
    "AWS profile to use (sets AWS_PROFILE for Terraform and AWS CLI)"
  );

// Apply --profile globally before any command runs
program.hook("preAction", (_thisCommand, actionCommand) => {
  const profile =
    actionCommand.opts().profile ?? program.opts().profile;
  if (profile) {
    process.env.AWS_PROFILE = profile;
  }
});

// Setup
registerLoginCommand(program);
registerInitCommand(program);
registerDoctorCommand(program);

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

program.parse();

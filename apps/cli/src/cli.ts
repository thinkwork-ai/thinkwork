#!/usr/bin/env node

import { Command } from "commander";
import { VERSION } from "./version.js";
import { registerPlanCommand } from "./commands/plan.js";
import { registerDeployCommand } from "./commands/deploy.js";
import { registerDestroyCommand } from "./commands/destroy.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerOutputsCommand } from "./commands/outputs.js";

const program = new Command();

program
  .name("thinkwork")
  .description(
    "Thinkwork CLI — deploy, manage, and interact with your Thinkwork stack"
  )
  .version(VERSION, "-v, --version", "Print the CLI version");

// Phase 1.5: deploy-focused commands
registerPlanCommand(program);
registerDeployCommand(program);
registerDestroyCommand(program);
registerDoctorCommand(program);
registerOutputsCommand(program);

// Phase 7 will add: init, agents, threads, skills

program.parse();

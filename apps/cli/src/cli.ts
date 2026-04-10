#!/usr/bin/env node

import { Command } from "commander";
import { VERSION } from "./version.js";

const program = new Command();

program
  .name("thinkwork")
  .description(
    "Thinkwork CLI — deploy, manage, and interact with your Thinkwork stack"
  )
  .version(VERSION, "-v, --version", "Print the CLI version");

// Phase 1.5 will add: plan, deploy, destroy, doctor, outputs
// Phase 7 will add: init, agents, threads, skills

program.parse();

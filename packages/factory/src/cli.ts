#!/usr/bin/env tsx

/**
 * factoryd — daemon that dispatches headless Claude/Codex workers against
 * Linear issues. U2 scaffold: `run` wires config + store + logger and exits;
 * the poll loop lands in a later unit. `status`/`pause`/`resume`/`halt` are
 * stubs until the control surface exists.
 */

import { Command } from "commander";
import { ConfigError, getStateDir, loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { openStore } from "./store/db.js";

const program = new Command();

program
  .name("factoryd")
  .description("ThinkWork factory daemon")
  .version("0.0.0");

program
  .command("run")
  .description(
    "Start the daemon (config + store + logger wiring; poll loop lands later)",
  )
  .action(() => {
    const log = createLogger({ component: "factoryd" });
    let config;
    try {
      config = loadConfig();
    } catch (e) {
      if (e instanceof ConfigError) {
        log.error("invalid configuration", {
          error: e.message,
          missing: e.missing,
          configPath: `${getStateDir()}/config.json`,
        });
        process.exitCode = 1;
        return;
      }
      throw e;
    }

    const stateDir = getStateDir();
    const store = openStore(stateDir);
    log.info("factoryd starting", {
      stateDir,
      teamKey: config.linear.teamKey,
      hosts: config.hosts.map((h) => h.name),
      pollIntervalSeconds: config.pollIntervalSeconds,
      phases: Object.keys(config.phases),
    });
    log.info("poll loop not yet implemented — exiting cleanly (U2 scaffold)");
    store.close();
  });

program
  .command("status")
  .description("Show daemon and issue pipeline status (not yet implemented)")
  .action(() => {
    console.log("factoryd status: not yet implemented");
  });

program
  .command("pause")
  .description("Pause dispatching of new work (not yet implemented)")
  .action(() => {
    console.log("factoryd pause: not yet implemented");
  });

program
  .command("resume")
  .description("Resume dispatching after a pause (not yet implemented)")
  .action(() => {
    console.log("factoryd resume: not yet implemented");
  });

program
  .command("halt")
  .description(
    "Stop the daemon and all in-flight workers (not yet implemented)",
  )
  .action(() => {
    console.log("factoryd halt: not yet implemented");
  });

program.parse();

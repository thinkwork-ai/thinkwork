#!/usr/bin/env tsx

/**
 * factoryd — daemon that dispatches headless Claude/Codex workers against
 * Linear issues. U5 wiring: `run` executes the real poll loop (pollTick →
 * preflight → StoreView → decideAction → executeAction) with clean
 * SIGINT/SIGTERM shutdown and a `--once` tracer mode; `doctor` checks the
 * daemon's own dependencies. `status`/`pause`/`resume`/`halt` are stubs
 * until the control surface exists (U8).
 */

import { join } from "node:path";

import { Command } from "commander";

import { ConfigError, getStateDir, loadConfig } from "./config.js";
import {
  createDaemonController,
  runDaemon,
  type DaemonDeps,
} from "./daemon.js";
import { formatDoctorReport, runDoctor } from "./doctor.js";
import { createLinearGateway, type CommentTrust } from "./linear/client.js";
import { createLogger } from "./logger.js";
import { createGhCliGateway } from "./phases/evidence.js";
import {
  defaultBootstrapScriptPath,
  executeAction,
  type ExecutorDeps,
} from "./phases/executor.js";
import { openStore } from "./store/db.js";
import { createAttemptMachine } from "./workers/attempts.js";
import { ClaudeRunner } from "./workers/claude-runner.js";
import { LocalTransport } from "./workers/transport.js";

const program = new Command();

program
  .name("factoryd")
  .description("ThinkWork factory daemon")
  .version("0.0.0");

program
  .command("run")
  .description("Start the daemon poll loop (single dispatch authority)")
  .option("--once", "run a single poll tick and exit (tracer mode)")
  .option(
    "--issue <ids...>",
    "restrict this run to the given issue identifier(s); every other candidate is skipped (safe-rollout / tracer scope)",
  )
  .action(async (opts: { once?: boolean; issue?: string[] }) => {
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

    const host = config.hosts.find(
      (h) => h.kind === "local" && h.capabilities.includes("claude"),
    );
    if (host === undefined) {
      log.error(
        "no local host with the claude capability in config.hosts — nothing can launch",
      );
      process.exitCode = 1;
      return;
    }

    const stateDir = getStateDir();
    const store = openStore(stateDir);
    const machine = createAttemptMachine(store);
    const gateway = createLinearGateway(config.linear.apiKey);
    const transport = new LocalTransport();

    // Trust allowlist: the daemon's own viewer id is implicitly trusted;
    // operators extend it via config linear.trustedUserIds. Resolution
    // failure is fail-safe (nothing is auto-trusted) — batons then always
    // synthesize rather than reuse comment text.
    let daemonViewerId: string | null = null;
    try {
      daemonViewerId = await gateway.viewerId();
    } catch (e) {
      log.warn(
        "could not resolve the Linear viewer id — daemon-authored comments will not be auto-trusted",
        { error: String(e) },
      );
    }
    const trust: CommentTrust = {
      daemonViewerId,
      trustedUserIds: config.linear.trustedUserIds ?? [],
    };

    // GitHub gateway for the merged-PR evidence fallback (a worker that
    // merged its PR but died before posting the baton must not be relaunched
    // over already-merged work).
    const github = createGhCliGateway({ repoDir: host.repoPath });

    const claudeRunner =
      host.claudeBin !== undefined
        ? new ClaudeRunner({
            claudeBin: host.claudeBin,
            logsDir: join(stateDir, "logs"),
            transport,
          })
        : null;
    if (claudeRunner === null) {
      log.warn(
        "host has no claudeBin — launch decisions will be skipped until it is configured",
        { host: host.name },
      );
    }

    const executorDeps: ExecutorDeps = {
      gateway,
      store,
      machine,
      config,
      host,
      teamKey: config.linear.teamKey,
      worktreesDir: join(stateDir, "worktrees"),
      bootstrapScript: defaultBootstrapScriptPath(),
      runnerFor: (kind) => (kind === "claude" ? claudeRunner : null),
      log: log.child("executor"),
      github,
      trust,
    };

    const onlyIssues =
      opts.issue && opts.issue.length > 0
        ? new Set(opts.issue.map((s) => s.trim()).filter((s) => s !== ""))
        : undefined;

    const daemonDeps: DaemonDeps = {
      gateway,
      store,
      transport,
      repoPath: host.repoPath,
      teamKey: config.linear.teamKey,
      log: log.child("loop"),
      execute: (action, candidate) =>
        executeAction(action, candidate, executorDeps),
      trust,
      onlyIssues,
    };

    const controller = createDaemonController();
    const onSignal = (signal: string) => {
      log.info(
        "shutdown requested — finishing current issue; detached workers keep running",
        { signal },
      );
      controller.stop();
    };
    process.once("SIGINT", () => onSignal("SIGINT"));
    process.once("SIGTERM", () => onSignal("SIGTERM"));

    log.info("factoryd starting", {
      stateDir,
      teamKey: config.linear.teamKey,
      host: host.name,
      pollIntervalSeconds: config.pollIntervalSeconds,
      phases: Object.keys(config.phases),
      once: opts.once === true,
      ...(onlyIssues ? { issueScope: [...onlyIssues] } : {}),
    });

    try {
      await runDaemon(daemonDeps, {
        pollIntervalSeconds: config.pollIntervalSeconds,
        once: opts.once === true,
        controller,
      });
    } finally {
      store.close();
    }
    log.info("factoryd stopped");
  });

program
  .command("doctor")
  .description(
    "Check daemon prerequisites: config, store, Linear API, claude binary, gh auth, bootstrap script",
  )
  .action(async () => {
    const { checks, ok } = await runDoctor();
    console.log(formatDoctorReport(checks));
    if (!ok) process.exitCode = 1;
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

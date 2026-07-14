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

import { getArtifactsDir,
  ConfigError,
  getStateDir,
  isSlackEnabled,
  loadConfig,
  slackConfigWarnings,
} from "./config.js";
import {
  createDaemonController,
  runDaemon,
  type DaemonDeps,
} from "./daemon.js";
import { formatDoctorReport, runDoctor } from "./doctor.js";
import { heartbeatPath } from "./heartbeat.js";
import { reconcile, type ReconcileDeps } from "./reconcile/reconciler.js";
import { runWatchdog } from "./watchdog.js";
import { installFactoryd, uninstallFactoryd } from "./cli-install.js";
import { createLinearGateway, type CommentTrust } from "./linear/client.js";
import { createLogger } from "./logger.js";
import { createSlackGateway, type SlackGateway } from "./slack/client.js";
import { createInspectionExecutors, createMergeExecutor, createReleaseExecutors, createSteeringExecutors } from "./slack/console.js";
import { createDeployExecutors, resumeDeployWatches } from "./slack/deploy.js";
import { createSlackSync, type SlackSync } from "./slack/sync.js";
import { buildStatusView, formatStatusView } from "./slack/status.js";
import { postNag } from "./slack/threads.js";
import type { FiredNag } from "./sweep/nags.js";
import { createGhCliGateway } from "./phases/evidence.js";
import {
  defaultBootstrapScriptPath,
  executeAction,
  type ExecutorDeps,
} from "./phases/executor.js";
import { openStore } from "./store/db.js";
import { createAttemptMachine } from "./workers/attempts.js";
import { ClaudeRunner } from "./workers/claude-runner.js";
import { CodexRunner } from "./workers/codex-runner.js";
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

    const codexRunner =
      host.codexBin !== undefined
        ? new CodexRunner({
            codexBin: host.codexBin,
            logsDir: join(stateDir, "logs"),
            transport,
          })
        : null;
    if (codexRunner === null) {
      log.warn(
        "host has no codexBin — verification launches (always Codex) will be skipped until it is configured",
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
      runnerFor: (kind) =>
        kind === "claude" ? claudeRunner : kind === "codex" ? codexRunner : null,
      log: log.child("executor"),
      github,
      trust,
    };

    const onlyIssues =
      opts.issue && opts.issue.length > 0
        ? new Set(opts.issue.map((s) => s.trim()).filter((s) => s !== ""))
        : undefined;

    // Slack surface (U8) — purely additive. Only constructed when a bot token
    // is configured; otherwise the daemon runs Linear-only exactly as before.
    let slackGateway: SlackGateway | null = null;
    let slackSync: SlackSync | undefined;
    if (isSlackEnabled(config.slack)) {
      for (const w of slackConfigWarnings(config.slack)) {
        log.warn(w);
      }
      try {
        slackGateway = await createSlackGateway({
          botToken: config.slack.botToken as string,
          appToken: config.slack.appToken as string,
          channelId: config.slack.channelId as string,
        });
        const deployDeps = {
          store,
          slack: slackGateway,
          transport,
          repoPath: host.repoPath,
          stateDir: getStateDir(),
          channelId: config.slack.channelId as string,
          targets: config.deployTargets ?? {},
          release: config.release,
          log: log.child("deploy"),
        };
        slackSync = createSlackSync({
          slack: slackGateway,
          store,
          gateway,
          channelId: config.slack.channelId as string,
          operatorUserIds: config.slack.operatorUserIds ?? [],
          log: log.child("slack"),
          trust,
          consoleExecutors: {
            ...createSteeringExecutors({
              gateway,
              store,
              log: log.child("console"),
            }),
            merge: createMergeExecutor({
              gateway,
              store,
              github,
              log: log.child("console"),
            }),
            ...createInspectionExecutors({
              gateway,
              store,
              github,
              slack: slackGateway,
              transport,
              artifactsDirFor: getArtifactsDir,
              log: log.child("console"),
            }),
          },
          repoExecutors: {
            ...createReleaseExecutors({
              store,
              slack: slackGateway,
              transport,
              repoPath: host.repoPath,
              channelId: config.slack.channelId as string,
              release: config.release,
              log: log.child("console"),
            }),
            ...createDeployExecutors(deployDeps),
          },
          github,
        });
        // Re-arm outcome watchers for deploys that survived a daemon restart.
        resumeDeployWatches(deployDeps);
        slackGateway.onMessage((message) => slackSync!.handleInbound(message));
        // Answer-form button clicks (block_actions) ride the same socket.
        slackGateway.onAction((action) => slackSync!.handleAction(action));
        await slackGateway.start();
        log.info("slack surface online", {
          channel: config.slack.channelId,
          operators: (config.slack.operatorUserIds ?? []).length,
        });
      } catch (e) {
        // A Slack bring-up failure must NOT take the daemon down — it is
        // additive. Log and continue Linear-only.
        log.error("slack surface failed to start — continuing Linear-only", {
          error: String(e),
        });
        slackGateway = null;
        slackSync = undefined;
      }
    }

    // Nag delivery seam (U6→U8): when Slack is online, fire the R23 nag through
    // the issue's thread via postNag. Without Slack, the sweep enqueues nags to
    // the store outbox instead (deliverNag omitted).
    const operatorUserIds = config.slack.operatorUserIds ?? [];
    const deliverNag =
      slackGateway !== null
        ? async (nag: FiredNag): Promise<void> => {
            const row = store.getSlackThreadByIssue(nag.timer.issue_id);
            if (row === undefined) return;
            await postNag(
              { channel: row.channel_id, threadTs: row.thread_ts },
              nag.text,
              { slack: slackGateway!, operatorUserIds },
            );
          }
        : undefined;

    const silenceBudgetMinutesFor = (phase: string): number =>
      config.phases[phase]?.silenceBudgetMinutes ?? 10;

    // U7 reconciliation: repairs partial state at boot + periodically. A scoped
    // (tracer / --issue) run must NOT rebuild-from-Linear or expire attempts it
    // is not authoritative over, so reconciliation is wired only for full runs.
    const reconcileDeps: ReconcileDeps = {
      store,
      gateway,
      transport,
      github,
      now: () => new Date(),
      teamKey: config.linear.teamKey,
      silenceBudgetMinutesFor,
      trust,
      log: log.child("reconcile"),
    };

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
      slack: slackSync,
      // U6 no-orphan sweep wiring.
      silenceBudgetMinutesFor,
      deliverNag,
      // U7 reboot/crash survival wiring.
      heartbeatPath: heartbeatPath(stateDir),
      reconcile: onlyIssues ? undefined : () => reconcile(reconcileDeps),
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
        // Re-reconcile roughly every 20 ticks (~10 min at the 30s cadence).
        reconcileEveryTicks: 20,
      });
    } finally {
      if (slackGateway !== null) {
        await slackGateway.stop().catch((e: unknown) =>
          log.warn("slack surface stop failed", { error: String(e) }),
        );
      }
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
  .description("Show the daemon/pipeline status (R18) from the operational store")
  .action(() => {
    const store = openStore(getStateDir());
    try {
      console.log(formatStatusView(buildStatusView(store)));
    } finally {
      store.close();
    }
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

program
  .command("install")
  .description(
    "Install the daemon + watchdog as launchd LaunchAgents (renders plists " +
      "with absolute paths, bootstraps into gui/<uid>, warns on reboot preconditions)",
  )
  .option(
    "--watchdog-interval <seconds>",
    "watchdog heartbeat-check cadence in seconds",
    (v) => Number.parseInt(v, 10),
  )
  .option(
    "--working-dir <path>",
    "daemon working directory (defaults to the factory package root)",
  )
  .action(
    async (opts: { watchdogInterval?: number; workingDir?: string }) => {
      const log = createLogger({ component: "factoryd.install" });
      await installFactoryd({
        stateDir: getStateDir(),
        workingDir: opts.workingDir,
        watchdogIntervalSeconds: opts.watchdogInterval,
        log,
      });
    },
  );

program
  .command("uninstall")
  .description("Bootout the daemon + watchdog LaunchAgents and remove the plists")
  .action(async () => {
    const log = createLogger({ component: "factoryd.uninstall" });
    await uninstallFactoryd({ log });
  });

program
  .command("watchdog")
  .description(
    "Check the daemon heartbeat age and post a Slack webhook alert when overdue " +
      "(the independent launchd interval job)",
  )
  .action(async () => {
    const log = createLogger({ component: "factoryd.watchdog" });
    const stateDir = getStateDir();
    let webhookUrl: string | undefined;
    let pollIntervalSeconds = 30;
    try {
      const config = loadConfig();
      webhookUrl = config.slack.webhookUrl;
      pollIntervalSeconds = config.pollIntervalSeconds;
    } catch (e) {
      // The watchdog is deliberately resilient: it still checks the heartbeat
      // even when config is unreadable — it just cannot alert without a webhook.
      log.warn("watchdog: config unreadable — proceeding without a webhook", {
        error: String(e),
      });
    }
    // Overdue when the heartbeat is older than ~6 poll cycles (floor 5 min).
    const overdueMs = Math.max(pollIntervalSeconds * 6, 300) * 1000;
    const result = await runWatchdog({
      heartbeatPath: heartbeatPath(stateDir),
      overdueMs,
      webhookUrl,
      hostname: process.env.HOSTNAME ?? undefined,
      log,
    });
    log.info("watchdog check complete", {
      posted: result.posted,
      overdue: result.overdue,
      ageMs: result.ageMs,
      reason: result.reason,
    });
    if (result.overdue && !result.posted) process.exitCode = 1;
  });

program.parse();

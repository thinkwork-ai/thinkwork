/**
 * `deploy <target>` (THINK-286): roll a cut release out to a configured stack
 * — customer stages (TEI, McPherson) and the platform prod stage — from Slack.
 *
 * Targets are pure config (`deployTargets` in the factory config): per-target
 * argv/env/cwd with a `<VERSION>` placeholder resolved to the newest
 * `v0.1.0-canary.*` tag (or the version the operator typed). The daemon never
 * hardcodes a customer command — the confirm offer shows EXACTLY what will
 * run (show-what-you-execute, same rule as the release verb).
 *
 * Deploys run for many minutes, so execution is DETACHED: the confirm spawns
 * the command into its own process group with output at
 * `<stateDir>/logs/deploy-<target>-<ts>.log`, acks immediately, and an
 * in-process watcher posts the outcome (log tail on failure) when the process
 * exits. A daemon restart orphans the watcher, not the deploy — the running
 * meta record + log path let the operator (or a later `deploy <target>`)
 * pick up the thread.
 */

import { join } from "node:path";

import type { DeployTargetConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { FactoryStore } from "../store/db.js";
import { actions, context, section } from "./blocks.js";
import type { SlackGateway } from "./client.js";
import {
  consoleButton,
  type ConsoleAck,
  type ConsoleVerb,
  type RepoExecutor,
} from "./console.js";
import {
  latestTag,
  tagGlob,
  tagRegex,
  type ReleaseConfig,
} from "../domain/release.js";

/** meta key: the one live deploy-confirm offer (JSON DeployOffer). */
export const DEPLOY_OFFER_KEY = "deploy-confirm-offer";
/** meta key prefix: a running deploy per target (JSON DeployRun). */
export const DEPLOY_RUNNING_KEY_PREFIX = "deploy-running:";
/** Offers expire after 10 minutes, same as release. */
export const DEPLOY_OFFER_TTL_MS = 10 * 60 * 1000;
/** The exit-code marker the wrapper appends to the log (watcher greps it). */
export const DEPLOY_EXIT_MARKER = "FACTORY-DEPLOY-EXIT:";

interface DeployOffer {
  token: string;
  target: string;
  version: string;
  /** Fully resolved argv (VERSION substituted) — what the operator confirmed. */
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  expiresAtMs: number;
  messageTs: string | null;
}

interface DeployRun {
  pid: number;
  logPath: string;
  version: string;
  startedAt: string;
}

/** The transport surface deploys need (structural subset of HostTransport). */
export interface DeployTransport {
  exec(
    command: string,
    args: string[],
    opts?: { cwd?: string; timeoutMs?: number },
  ): Promise<{ code: number | null; stdout: string; stderr: string }>;
  spawnDetached(req: {
    command: string;
    args: string[];
    env: Record<string, string>;
    logPath: string;
    cwd?: string;
  }): Promise<{ pid: number }>;
  pidAlive(pid: number): Promise<boolean>;
  readTail(path: string, lines: number): Promise<string>;
}

export interface DeployDeps {
  store: FactoryStore;
  slack: SlackGateway;
  transport: DeployTransport;
  repoPath: string;
  stateDir: string;
  channelId: string;
  targets: Record<string, DeployTargetConfig>;
  /** Tag scheme — `<VERSION>` resolution + typed-version validation. */
  release: ReleaseConfig;
  log: Logger;
  /** Watcher poll interval — injectable for tests. */
  watchIntervalMs?: number;
}

function parseOffer(raw: string | undefined): DeployOffer | null {
  if (raw === undefined) return null;
  try {
    const o = JSON.parse(raw) as DeployOffer;
    return typeof o.token === "string" && typeof o.target === "string" ? o : null;
  } catch {
    return null;
  }
}

function parseRun(raw: string | undefined): DeployRun | null {
  if (raw === undefined) return null;
  try {
    const r = JSON.parse(raw) as DeployRun;
    return typeof r.pid === "number" && typeof r.logPath === "string" ? r : null;
  } catch {
    return null;
  }
}

/** `deploy tei` / `deploy tei v0.1.0-canary.356` → target + optional version. */
export function parseDeployArg(
  arg: string | undefined,
  release: ReleaseConfig,
): { target: string; version?: string } | null {
  if (arg === undefined || arg.trim() === "") return null;
  const parts = arg.trim().split(/\s+/);
  const target = parts[0];
  const version = parts[1];
  if (version !== undefined && !tagRegex(release.tagTemplate).test(version)) {
    return null;
  }
  return { target, ...(version !== undefined ? { version } : {}) };
}

function targetList(targets: Record<string, DeployTargetConfig>): string {
  const names = Object.keys(targets);
  if (names.length === 0) {
    return "_No deploy targets configured — add `deployTargets` to the factory config._";
  }
  return names
    .map((n) => `• \`deploy ${n}\`${targets[n].note ? ` — ${targets[n].note}` : ""}`)
    .join("\n");
}

async function resolveOfferMessage(
  deps: DeployDeps,
  offer: DeployOffer,
  outcome: string,
): Promise<void> {
  if (offer.messageTs === null) return;
  await deps.slack
    .updateMessage(deps.channelId, offer.messageTs, outcome, [section(outcome)])
    .catch((e: unknown) =>
      deps.log.warn("deploy: offer-message update failed — stale buttons remain", {
        error: String(e),
      }),
    );
}

/** Newest release tag (per the scheme) after a fetch, or null. */
async function latestReleaseVersion(deps: DeployDeps): Promise<string | null> {
  const fetch = await deps.transport.exec(
    "git",
    ["fetch", "--tags", "--quiet", "origin"],
    { cwd: deps.repoPath, timeoutMs: 60_000 },
  );
  if (fetch.code !== 0) return null;
  const tags = await deps.transport.exec(
    "git",
    ["tag", "--list", tagGlob(deps.release.tagTemplate), "--sort=-version:refname"],
    { cwd: deps.repoPath, timeoutMs: 30_000 },
  );
  return latestTag(deps.release.tagTemplate, tags.stdout);
}

/**
 * Arm the in-process outcome watcher for a detached deploy. Polls the pid;
 * on exit, reads the log's exit marker and posts the outcome to the channel.
 * The timer is unref'd — it never keeps the daemon alive.
 */
export function watchDeploy(deps: DeployDeps, target: string): void {
  const intervalMs = deps.watchIntervalMs ?? 30_000;
  const key = `${DEPLOY_RUNNING_KEY_PREFIX}${target}`;
  const timer = setInterval(() => {
    void (async () => {
      let raw: string | undefined;
      try {
        raw = deps.store.getMeta(key);
      } catch {
        // Store closed (daemon shutting down / test teardown) — the deploy
        // itself is detached and unaffected; just stop watching.
        clearInterval(timer);
        return;
      }
      const run = parseRun(raw);
      if (run === null) {
        clearInterval(timer);
        return;
      }
      if (await deps.transport.pidAlive(run.pid)) return; // still going
      clearInterval(timer);
      try {
        deps.store.deleteMeta(key);
      } catch {
        return; // store closed mid-poll — same shutdown race as above
      }
      const tail = await deps.transport
        .readTail(run.logPath, 40)
        .catch(() => "");
      const marker = tail
        .split("\n")
        .reverse()
        .find((l) => l.startsWith(DEPLOY_EXIT_MARKER));
      const exitCode = marker ? Number(marker.slice(DEPLOY_EXIT_MARKER.length)) : null;
      const ok = exitCode === 0;
      const text = ok
        ? `✅ \`deploy ${target}\` (${run.version}) finished successfully.`
        : `❌ \`deploy ${target}\` (${run.version}) FAILED${exitCode !== null ? ` (exit ${exitCode})` : " (no exit marker — killed?)"} — log: \`${run.logPath}\``;
      const blocks = ok
        ? [section(text)]
        : [
            section(text),
            section(
              "```\n" +
                tail
                  .split("\n")
                  .filter((l) => !l.startsWith(DEPLOY_EXIT_MARKER))
                  .slice(-15)
                  .join("\n") +
                "\n```",
            ),
          ];
      await deps.slack
        .postMessage(deps.channelId, text, { blocks })
        .catch((e: unknown) =>
          deps.log.warn("deploy: outcome post failed", { target, error: String(e) }),
        );
      deps.log.info("deploy finished", { target, version: run.version, ok, exitCode });
    })();
  }, intervalMs);
  timer.unref();
}

/**
 * Re-arm watchers for deploys that were running when the daemon restarted.
 * Called once at bring-up; a dead pid resolves on the first poll.
 */
export function resumeDeployWatches(deps: DeployDeps): void {
  const rows = deps.store.db
    .prepare("SELECT key FROM meta WHERE key LIKE ?")
    .all(`${DEPLOY_RUNNING_KEY_PREFIX}%`) as { key: string }[];
  for (const row of rows) {
    watchDeploy(deps, row.key.slice(DEPLOY_RUNNING_KEY_PREFIX.length));
  }
}

export function createDeployExecutors(
  deps: DeployDeps,
): Partial<Record<ConsoleVerb, RepoExecutor>> {
  return {
    deploy: async (ctx): Promise<ConsoleAck> => {
      const parsed = parseDeployArg(ctx.arg, deps.release);
      if (parsed === null) {
        return {
          text: `Usage: \`deploy <target> [${deps.release.tagTemplate}]\`\n${targetList(deps.targets)}`,
        };
      }
      const target = deps.targets[parsed.target];
      if (target === undefined) {
        return {
          text: `Unknown deploy target \`${parsed.target}\`.\n${targetList(deps.targets)}`,
        };
      }
      // One deploy per target at a time.
      const running = parseRun(
        deps.store.getMeta(`${DEPLOY_RUNNING_KEY_PREFIX}${parsed.target}`),
      );
      if (running !== null && (await deps.transport.pidAlive(running.pid))) {
        return {
          text: `\`deploy ${parsed.target}\` is already running (${running.version}, since ${running.startedAt}) — log: \`${running.logPath}\``,
        };
      }
      const version = parsed.version ?? (await latestReleaseVersion(deps));
      if (version === null) {
        return {
          text: `❌ couldn't resolve the latest release tag (git fetch failed, or no \`${tagGlob(deps.release.tagTemplate)}\` tags?) — pass a version explicitly: \`deploy ${parsed.target} ${deps.release.tagTemplate}\``,
        };
      }
      const argv = target.argv.map((a) => a.replaceAll("<VERSION>", version));
      const env = target.env ?? {};
      const cwd = target.cwd ?? deps.repoPath;
      const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const offer: DeployOffer = {
        token,
        target: parsed.target,
        version,
        argv,
        cwd,
        env,
        expiresAtMs: Date.now() + DEPLOY_OFFER_TTL_MS,
        messageTs: null,
      };
      deps.store.setMeta(DEPLOY_OFFER_KEY, JSON.stringify(offer));
      const envNote = Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      const text = `Confirm \`deploy ${parsed.target}\` ← \`${version}\`? (expires in 10 min)`;
      return {
        text,
        blocks: [
          section(text),
          section("```\n" + `${envNote ? envNote + " " : ""}${argv.join(" ")}` + "\n```"),
          ...(target.note ? [context(target.note)] : []),
          actions([
            consoleButton("deploy-confirm", {
              arg: token,
              label: `🚀 Confirm deploy ${parsed.target}`,
              style: "primary",
            }),
            consoleButton("deploy-cancel", { arg: token, label: "Cancel" }),
          ]),
        ],
        onPosted: (ts) => {
          if (ts === null) return;
          const stored = parseOffer(deps.store.getMeta(DEPLOY_OFFER_KEY));
          if (stored !== null && stored.token === token) {
            deps.store.setMeta(
              DEPLOY_OFFER_KEY,
              JSON.stringify({ ...stored, messageTs: ts }),
            );
          }
        },
      };
    },

    "deploy-confirm": async (ctx): Promise<ConsoleAck> => {
      const offer = parseOffer(deps.store.getMeta(DEPLOY_OFFER_KEY));
      if (offer === null || offer.token !== ctx.arg) {
        return {
          text: "That deploy offer is no longer live (already used or superseded) — run `deploy <target>` for a fresh one.",
        };
      }
      // One-shot: consume BEFORE executing.
      deps.store.deleteMeta(DEPLOY_OFFER_KEY);
      if (Date.now() > offer.expiresAtMs) {
        await resolveOfferMessage(
          deps,
          offer,
          `⏰ Deploy offer for \`${offer.target}\` expired — run \`deploy ${offer.target}\` again.`,
        );
        return { text: `⏰ That offer expired — run \`deploy ${offer.target}\` again.` };
      }
      const runningKey = `${DEPLOY_RUNNING_KEY_PREFIX}${offer.target}`;
      const running = parseRun(deps.store.getMeta(runningKey));
      if (running !== null && (await deps.transport.pidAlive(running.pid))) {
        await resolveOfferMessage(deps, offer, `\`deploy ${offer.target}\` is already running.`);
        return { text: `\`deploy ${offer.target}\` is already running — log: \`${running.logPath}\`` };
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const logPath = join(deps.stateDir, "logs", `deploy-${offer.target}-${stamp}.log`);
      // Wrap so the exit code lands in the log — a detached process's status
      // is otherwise unknowable after the fact.
      const shellCmd =
        offer.argv.map((a) => `'${a.replaceAll("'", `'\\''`)}'`).join(" ") +
        `; echo "${DEPLOY_EXIT_MARKER}$?"`;
      const { pid } = await deps.transport.spawnDetached({
        command: "/bin/bash",
        args: ["-lc", shellCmd],
        env: {
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          HOME: process.env.HOME ?? "",
          ...offer.env,
        },
        logPath,
        cwd: offer.cwd,
      });
      deps.store.setMeta(
        runningKey,
        JSON.stringify({
          pid,
          logPath,
          version: offer.version,
          startedAt: new Date().toISOString(),
        } satisfies DeployRun),
      );
      watchDeploy(deps, offer.target);
      await resolveOfferMessage(
        deps,
        offer,
        `🚀 \`deploy ${offer.target}\` (${offer.version}) started by <@${ctx.userId}>.`,
      );
      return {
        text: `🚀 \`deploy ${offer.target}\` (${offer.version}) started (pid ${pid}) — I'll post the outcome here when it finishes. Log: \`${logPath}\``,
      };
    },

    "deploy-cancel": async (ctx): Promise<ConsoleAck> => {
      const offer = parseOffer(deps.store.getMeta(DEPLOY_OFFER_KEY));
      if (offer === null || offer.token !== ctx.arg) {
        return { text: "That offer is already resolved — nothing to cancel." };
      }
      deps.store.deleteMeta(DEPLOY_OFFER_KEY);
      await resolveOfferMessage(
        deps,
        offer,
        `🚫 Deploy offer for \`${offer.target}\` cancelled by <@${ctx.userId}>.`,
      );
      return { text: `🚫 Cancelled — nothing deployed.` };
    },
  };
}

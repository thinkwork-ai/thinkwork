/**
 * Factory daemon configuration.
 *
 * Lives at `<stateDir>/config.json`, where stateDir defaults to
 * `~/.thinkwork-factory` and can be overridden with the
 * `THINKWORK_FACTORY_DIR` env var (tests point it at a tmpdir; the
 * operational sqlite store also lives under the same dir).
 *
 * All env reads happen at call time — never capture process.env at module
 * load, or vitest env-stubbing breaks.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface LinearConfig {
  apiKey: string;
  teamKey: string;
  /**
   * Linear user ids whose comments (batons, override markers) automation may
   * trust, in addition to the daemon's own viewer id. Comments from anyone
   * else never steer a worker prompt or count as phase evidence.
   */
  trustedUserIds?: string[];
}

export interface SlackConfig {
  botToken?: string;
  appToken?: string;
  channelId?: string;
  operatorUserIds?: string[];
  webhookUrl?: string;
}

/**
 * Slack is ENABLED when a bot token is present. A `{}` slack config leaves the
 * daemon Linear-only — Slack is purely additive and never required.
 */
export function isSlackEnabled(slack: SlackConfig): boolean {
  return typeof slack.botToken === "string" && slack.botToken.trim() !== "";
}

/**
 * Non-fatal Slack config advisories. An enabled Slack with an EMPTY operator
 * allowlist would trust no one — the inbound relay injects nothing, so every
 * answer is acknowledged and dropped. Surfaced by the cli/doctor, not thrown.
 */
export function slackConfigWarnings(slack: SlackConfig): string[] {
  const warnings: string[] = [];
  if (
    isSlackEnabled(slack) &&
    (slack.operatorUserIds === undefined || slack.operatorUserIds.length === 0)
  ) {
    warnings.push(
      "slack.operatorUserIds is empty — the inbound relay will trust no one; " +
        "every in-thread answer is acknowledged but never injected. Add the " +
        "operator's Slack user id(s) to enable the answer round-trip.",
    );
  }
  return warnings;
}

export type HostKind = "local" | "ssh";

export interface HostConfig {
  name: string;
  kind: HostKind;
  /** Required when kind === "ssh" (e.g. "user@buildbox"). */
  sshTarget?: string;
  /** Absolute path to the repo checkout on that host. */
  repoPath: string;
  /** Worker kinds this host can run, e.g. ["claude", "codex"]. */
  capabilities: string[];
  maxConcurrent: number;
  claudeBin?: string;
  codexBin?: string;
}

export interface PhaseConfig {
  model: string;
  wallClockSlaMinutes: number;
  silenceBudgetMinutes: number;
  /**
   * `--max-budget-usd` runaway backstop, in notional API-equivalent dollars.
   * Applied ONLY when `enforceBudgetUsd` is true (default false). On a
   * subscription this figure is not real spend, so the dollar cap is an
   * artificial limit that could prematurely kill legitimate long work — the
   * real governors are the wall-clock SLA and the silence/stall budget. The
   * value stays here as a documented ceiling for anyone who opts in (e.g. an
   * API-billed host).
   */
  budgetUsd: number;
}

export interface FactoryConfig {
  linear: LinearConfig;
  slack: SlackConfig;
  hosts: HostConfig[];
  /** Per-phase model + SLA table, defaults merged in. */
  phases: Record<string, PhaseConfig>;
  pollIntervalSeconds: number;
  /**
   * Pass each phase's `budgetUsd` to the worker as `--max-budget-usd`. Default
   * false: subscription workers are governed by wall-clock SLA + stall
   * detection, not a dollar cap. Set true only on API-billed hosts where the
   * reported cost is real spend.
   */
  enforceBudgetUsd: boolean;
}

export const DEFAULT_POLL_INTERVAL_SECONDS = 30;

/**
 * Default phase table. Keys are the factory's pipeline phases; user config
 * may override any field per phase (shallow-merged) or add extra phases.
 *
 * Models/budgets mirror the Model Policy table in
 * .claude/skills/linear-dispatch/SKILL.md verbatim:
 *   Brainstorm, Plan        → fable  / $25
 *   Implement (and repair)  → fable  / $100
 *   Verify, Debug           → opus   / $50
 *   Compound                → sonnet / $10
 */
export const DEFAULT_PHASES: Record<string, PhaseConfig> = {
  brainstorm: {
    model: "fable",
    wallClockSlaMinutes: 45,
    silenceBudgetMinutes: 10,
    budgetUsd: 25,
  },
  plan: {
    model: "fable",
    wallClockSlaMinutes: 45,
    silenceBudgetMinutes: 10,
    budgetUsd: 25,
  },
  debug: {
    model: "opus",
    wallClockSlaMinutes: 60,
    silenceBudgetMinutes: 10,
    budgetUsd: 50,
  },
  implement: {
    model: "fable",
    wallClockSlaMinutes: 120,
    silenceBudgetMinutes: 15,
    budgetUsd: 100,
  },
  verify: {
    // Codex runner model (verification is always Codex; engine.launch).
    model: "gpt-5.6-sol",
    wallClockSlaMinutes: 60,
    silenceBudgetMinutes: 10,
    budgetUsd: 50,
  },
  compound: {
    model: "sonnet",
    wallClockSlaMinutes: 30,
    silenceBudgetMinutes: 10,
    budgetUsd: 10,
  },
};

/**
 * Named startup error. `missing` lists dotted config paths that are absent
 * or invalid, so the daemon can report exactly what to fix and exit cleanly
 * instead of crashing mid-poll.
 */
export class ConfigError extends Error {
  readonly missing: string[];

  constructor(message: string, missing: string[] = []) {
    super(missing.length > 0 ? `${message}: ${missing.join(", ")}` : message);
    this.name = "ConfigError";
    this.missing = missing;
  }
}

/** Resolve the state dir. Env is read at call time on purpose. */
export function getStateDir(): string {
  const override = process.env.THINKWORK_FACTORY_DIR;
  if (override && override.trim() !== "") return override;
  return join(homedir(), ".thinkwork-factory");
}

export function getConfigPath(): string {
  return join(getStateDir(), "config.json");
}

/**
 * Durable per-issue artifacts folder (U7): verify workers copy their
 * screenshots here (worktrees are cleaned up after the run), and the Slack
 * console's `result` verb reads them back. No retention policy in v1.
 */
export function getArtifactsDir(identifier: string): string {
  return join(getStateDir(), "artifacts", identifier);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

function validateHost(
  raw: unknown,
  index: number,
  missing: string[],
): HostConfig | undefined {
  const prefix = `hosts[${index}]`;
  if (typeof raw !== "object" || raw === null) {
    missing.push(prefix);
    return undefined;
  }
  const h = raw as Record<string, unknown>;
  const before = missing.length;
  if (!isNonEmptyString(h.name)) missing.push(`${prefix}.name`);
  if (h.kind !== "local" && h.kind !== "ssh") missing.push(`${prefix}.kind`);
  if (h.kind === "ssh" && !isNonEmptyString(h.sshTarget))
    missing.push(`${prefix}.sshTarget`);
  if (!isNonEmptyString(h.repoPath)) missing.push(`${prefix}.repoPath`);
  if (!Array.isArray(h.capabilities)) missing.push(`${prefix}.capabilities`);
  if (typeof h.maxConcurrent !== "number" || h.maxConcurrent < 1)
    missing.push(`${prefix}.maxConcurrent`);
  if (missing.length > before) return undefined;
  return {
    name: h.name as string,
    kind: h.kind as HostKind,
    sshTarget: isNonEmptyString(h.sshTarget) ? h.sshTarget : undefined,
    repoPath: h.repoPath as string,
    capabilities: (h.capabilities as unknown[]).map(String),
    maxConcurrent: h.maxConcurrent as number,
    claudeBin: isNonEmptyString(h.claudeBin) ? h.claudeBin : undefined,
    codexBin: isNonEmptyString(h.codexBin) ? h.codexBin : undefined,
  };
}

function mergePhases(raw: unknown): Record<string, PhaseConfig> {
  const merged: Record<string, PhaseConfig> = {};
  for (const [name, def] of Object.entries(DEFAULT_PHASES))
    merged[name] = { ...def };
  if (typeof raw !== "object" || raw === null) return merged;
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const v = value as Partial<PhaseConfig>;
    const base = merged[name] ?? {
      model: "sonnet",
      wallClockSlaMinutes: 60,
      silenceBudgetMinutes: 10,
      budgetUsd: 25,
    };
    merged[name] = {
      model: isNonEmptyString(v.model) ? v.model : base.model,
      wallClockSlaMinutes:
        typeof v.wallClockSlaMinutes === "number" && v.wallClockSlaMinutes > 0
          ? v.wallClockSlaMinutes
          : base.wallClockSlaMinutes,
      silenceBudgetMinutes:
        typeof v.silenceBudgetMinutes === "number" && v.silenceBudgetMinutes > 0
          ? v.silenceBudgetMinutes
          : base.silenceBudgetMinutes,
      budgetUsd:
        typeof v.budgetUsd === "number" && v.budgetUsd > 0
          ? v.budgetUsd
          : base.budgetUsd,
    };
  }
  return merged;
}

/**
 * Load and validate config from `<stateDir>/config.json`.
 * Throws ConfigError (never a bare throw) for: missing file, unreadable
 * file, malformed/empty JSON, or missing required keys.
 */
export function loadConfig(): FactoryConfig {
  const path = getConfigPath();
  if (!existsSync(path)) {
    throw new ConfigError(`config file not found at ${path}`);
  }
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (e) {
    throw new ConfigError(`config file unreadable at ${path}: ${String(e)}`);
  }
  if (text.trim() === "") {
    throw new ConfigError(`config file at ${path} is empty`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new ConfigError(
      `config file at ${path} is not valid JSON: ${String(e)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError(`config file at ${path} must be a JSON object`);
  }
  const raw = parsed as Record<string, unknown>;
  const missing: string[] = [];

  const linearRaw = (raw.linear ?? {}) as Record<string, unknown>;
  if (!isNonEmptyString(linearRaw.apiKey)) missing.push("linear.apiKey");
  if (!isNonEmptyString(linearRaw.teamKey)) missing.push("linear.teamKey");

  const hostsRaw = raw.hosts;
  const hosts: HostConfig[] = [];
  if (!Array.isArray(hostsRaw) || hostsRaw.length === 0) {
    missing.push("hosts[0]");
  } else {
    hostsRaw.forEach((h, i) => {
      const host = validateHost(h, i, missing);
      if (host) hosts.push(host);
    });
  }

  if (missing.length > 0) {
    throw new ConfigError("invalid factory config", missing);
  }

  const slackRaw = (raw.slack ?? {}) as Record<string, unknown>;
  const slack: SlackConfig = {};
  if (isNonEmptyString(slackRaw.botToken)) slack.botToken = slackRaw.botToken;
  if (isNonEmptyString(slackRaw.appToken)) slack.appToken = slackRaw.appToken;
  if (isNonEmptyString(slackRaw.channelId))
    slack.channelId = slackRaw.channelId;
  if (Array.isArray(slackRaw.operatorUserIds))
    slack.operatorUserIds = slackRaw.operatorUserIds.map(String);
  if (isNonEmptyString(slackRaw.webhookUrl))
    slack.webhookUrl = slackRaw.webhookUrl;

  // Slack is optional, but a HALF-configured Slack is a startup error: a bot
  // token with no app token can't open a Socket Mode connection (no inbound
  // relay), and with no channel id has nowhere to post. Fail loudly rather
  // than run a daemon whose Slack surface is silently dead.
  if (isSlackEnabled(slack)) {
    const slackMissing: string[] = [];
    if (!isNonEmptyString(slack.appToken)) slackMissing.push("slack.appToken");
    if (!isNonEmptyString(slack.channelId))
      slackMissing.push("slack.channelId");
    if (slackMissing.length > 0) {
      throw new ConfigError(
        "Slack is enabled (slack.botToken set) but incompletely configured",
        slackMissing,
      );
    }
  }

  const pollIntervalSeconds =
    typeof raw.pollIntervalSeconds === "number" && raw.pollIntervalSeconds > 0
      ? raw.pollIntervalSeconds
      : DEFAULT_POLL_INTERVAL_SECONDS;

  const trustedUserIds = Array.isArray(linearRaw.trustedUserIds)
    ? (linearRaw.trustedUserIds as unknown[]).map(String)
    : undefined;

  return {
    linear: {
      apiKey: linearRaw.apiKey as string,
      teamKey: linearRaw.teamKey as string,
      ...(trustedUserIds !== undefined ? { trustedUserIds } : {}),
    },
    slack,
    hosts,
    phases: mergePhases(raw.phases),
    pollIntervalSeconds,
    enforceBudgetUsd: raw.enforceBudgetUsd === true,
  };
}

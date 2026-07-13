/**
 * `factoryd doctor` — named pass/fail preflight for the daemon's own
 * dependencies: config parse, store open, Linear API reachability (viewer
 * query), claude binary per local host, `gh auth status`, and the bundled
 * worker-bootstrap.sh. Slack checks land with the Slack unit.
 */

import { execFile } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";

import { LinearClient } from "@linear/sdk";

import {
  ConfigError,
  getConfigPath,
  getStateDir,
  isSlackEnabled,
  loadConfig,
  slackConfigWarnings,
  type FactoryConfig,
} from "./config.js";
import { openStore } from "./store/db.js";
import { defaultBootstrapScriptPath } from "./phases/executor.js";
import { createSlackGateway } from "./slack/client.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

function execFileOk(
  cmd: string,
  args: string[],
  timeoutMs = 15_000,
): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ ok: true, detail: String(stdout || stderr).split("\n")[0] });
      } else {
        resolve({
          ok: false,
          detail:
            String(stderr || stdout || error.message).split("\n")[0] ||
            String(error),
        });
      }
    });
  });
}

export async function runDoctor(): Promise<{
  checks: DoctorCheck[];
  ok: boolean;
}> {
  const checks: DoctorCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) =>
    checks.push({ name, ok, detail });

  // 1. Config parses.
  let config: FactoryConfig | null = null;
  try {
    config = loadConfig();
    add(
      "config",
      true,
      `parsed ${getConfigPath()} (team ${config.linear.teamKey}, ${config.hosts.length} host(s))`,
    );
  } catch (e) {
    add(
      "config",
      false,
      e instanceof ConfigError ? e.message : String(e),
    );
  }

  // 2. Store opens.
  try {
    const store = openStore(getStateDir());
    store.close();
    add("store", true, `sqlite opens at ${getStateDir()}/factory.db`);
  } catch (e) {
    add("store", false, String(e));
  }

  // 3. Linear API reachable (viewer query).
  if (config === null) {
    add("linear-api", false, "skipped: config invalid");
  } else {
    try {
      const viewer = await new LinearClient({
        apiKey: config.linear.apiKey,
      }).viewer;
      add("linear-api", true, `viewer: ${viewer.displayName ?? viewer.name}`);
    } catch (e) {
      add("linear-api", false, `viewer query failed: ${String(e)}`);
    }
  }

  // 4. claude binary per local host.
  if (config === null) {
    add("claude-bin", false, "skipped: config invalid");
  } else {
    const localClaudeHosts = config.hosts.filter(
      (h) => h.kind === "local" && h.capabilities.includes("claude"),
    );
    if (localClaudeHosts.length === 0) {
      add("claude-bin", false, "no local host with the claude capability");
    }
    for (const h of localClaudeHosts) {
      if (h.claudeBin === undefined) {
        add(
          `claude-bin(${h.name})`,
          false,
          "claudeBin not set (must be an ABSOLUTE path — launchd never sources shell rc)",
        );
        continue;
      }
      try {
        accessSync(h.claudeBin, constants.X_OK);
        add(`claude-bin(${h.name})`, true, `executable at ${h.claudeBin}`);
      } catch {
        add(
          `claude-bin(${h.name})`,
          false,
          `not executable (or missing) at ${h.claudeBin}`,
        );
      }
    }
  }

  // 5. gh CLI authed.
  {
    const gh = await execFileOk("gh", ["auth", "status"]);
    add("gh-auth", gh.ok, gh.detail || "gh auth status");
  }

  // 6. worker-bootstrap.sh present + executable.
  {
    const script = defaultBootstrapScriptPath();
    if (!existsSync(script)) {
      add("worker-bootstrap", false, `missing at ${script}`);
    } else {
      try {
        accessSync(script, constants.X_OK);
        add("worker-bootstrap", true, `executable at ${script}`);
      } catch {
        add("worker-bootstrap", false, `present but not executable: ${script}`);
      }
    }
  }

  // 7. Slack surface — ONLY when configured (Slack is optional/additive).
  if (config !== null && isSlackEnabled(config.slack)) {
    const { botToken, appToken, channelId, operatorUserIds } = config.slack;
    // App token presence (Socket Mode inbound relay can't run without it).
    add(
      "slack-app-token",
      typeof appToken === "string" && appToken.trim() !== "",
      appToken ? "app token present (Socket Mode)" : "missing (no inbound relay)",
    );
    // Operator allowlist non-empty (else the relay trusts no one).
    const warnings = slackConfigWarnings(config.slack);
    add(
      "slack-operators",
      operatorUserIds !== undefined && operatorUserIds.length > 0,
      operatorUserIds && operatorUserIds.length > 0
        ? `${operatorUserIds.length} operator id(s) allowlisted`
        : warnings[0] ?? "slack.operatorUserIds is empty",
    );
    try {
      const slack = await createSlackGateway({
        botToken: botToken as string,
        appToken: appToken as string,
        channelId: channelId as string,
      });
      // Bot token auth (auth.test).
      try {
        const auth = await slack.authTest();
        add("slack-auth", true, `bot user ${auth.userId} (team ${auth.team})`);
      } catch (e) {
        add("slack-auth", false, `auth.test failed: ${String(e)}`);
      }
      // Channel reachable (conversations.info).
      const reachable = await slack.channelReachable(channelId as string);
      add(
        "slack-channel",
        reachable,
        reachable
          ? `channel ${channelId} reachable`
          : `channel ${channelId} not reachable (invite the bot / check the id)`,
      );
      for (const check of await slackConsoleChecks(slack, channelId as string)) {
        checks.push(check);
      }
    } catch (e) {
      add("slack-auth", false, `could not build Slack client: ${String(e)}`);
    }
  }

  return { checks, ok: checks.every((c) => c.ok) };
}

/**
 * Console-scope checks (U10). `pins:read` is the one console scope probe-able
 * without a side effect (pins.list); `pins:write` and `files:write` cannot be
 * verified side-effect-free, so they render as checklist items — never false
 * passes. First use of the board/result paths surfaces Slack's missing_scope
 * with the same remediation.
 */
export async function slackConsoleChecks(
  slack: Pick<import("./slack/client.js").SlackGateway, "listPins">,
  channelId: string,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  try {
    const pinCount = await slack.listPins(channelId);
    checks.push({
      name: "slack-pins-read",
      ok: true,
      detail: `pins.list ok (${pinCount} pinned)`,
    });
  } catch (e) {
    checks.push({
      name: "slack-pins-read",
      ok: false,
      detail: `pins.list failed — add the \`pins:read\` bot scope and reinstall the app (${String(e).split("\n")[0]})`,
    });
  }
  checks.push({
    name: "slack-scope-checklist",
    ok: true,
    detail:
      "verify in the Slack app config: pins:write (pinned board) and files:write (result screenshots) — not probe-able without side effects",
  });
  return checks;
}

export function formatDoctorReport(checks: DoctorCheck[]): string {
  return checks
    .map((c) => `${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`)
    .join("\n");
}

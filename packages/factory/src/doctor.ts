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
  loadConfig,
  type FactoryConfig,
} from "./config.js";
import { openStore } from "./store/db.js";
import { defaultBootstrapScriptPath } from "./phases/executor.js";

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

  return { checks, ok: checks.every((c) => c.ok) };
}

export function formatDoctorReport(checks: DoctorCheck[]): string {
  return checks
    .map((c) => `${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`)
    .join("\n");
}

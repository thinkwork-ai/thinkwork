#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";

const DEFAULT_REMOTE = "thinkwork-crm";
const DEFAULT_APP_DIR = "plugins/twenty/twenty-app";

function parseArgs(argv) {
  const args = {
    appDir: process.env.TWENTY_THINKWORK_APP_DIR || DEFAULT_APP_DIR,
    remoteName: process.env.TWENTY_THINKWORK_APP_REMOTE_NAME || DEFAULT_REMOTE,
    dryRun: process.env.TWENTY_THINKWORK_APP_SYNC_DRY_RUN !== "0",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--app-dir") {
      args.appDir = requireValue(argv, ++index, arg);
    } else if (arg === "--remote-name") {
      args.remoteName = requireValue(argv, ++index, arg);
    } else if (arg === "--url") {
      args.url = requireValue(argv, ++index, arg);
    } else if (arg === "--api-key") {
      args.apiKey = requireValue(argv, ++index, arg);
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--apply") {
      args.dryRun = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  args.url ||= process.env.TWENTY_PUBLIC_URL;
  args.apiKey ||= process.env.TWENTY_APP_SYNC_API_KEY;
  return args;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function validateUrl(url) {
  if (!url) {
    throw new Error("Set TWENTY_PUBLIC_URL or pass --url.");
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new Error(`Twenty URL must be HTTPS or localhost, got ${url}.`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      YARN_ENABLE_IMMUTABLE_INSTALLS: "false",
    },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}.`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = validateUrl(args.url);
  if (!args.apiKey) {
    throw new Error("Set TWENTY_APP_SYNC_API_KEY or pass --api-key.");
  }

  console.log(
    JSON.stringify(
      {
        app: "ThinkWork",
        remoteName: args.remoteName,
        url,
        mode: args.dryRun ? "dry-run" : "apply",
        note: args.dryRun
          ? "Dry run previews metadata only. A first install requires --apply because Twenty cannot diff an app that has never been synced."
          : "Apply sync will install or update the native ThinkWork app in the target Twenty workspace.",
      },
      null,
      2,
    ),
  );

  run("corepack", ["enable"], { cwd: args.appDir });
  run("yarn", ["install"], { cwd: args.appDir });
  run(
    "yarn",
    [
      "twenty",
      "remote:add",
      "--as",
      args.remoteName,
      "--url",
      url,
      "--api-key",
      args.apiKey,
    ],
    { cwd: args.appDir },
  );

  const syncArgs = ["twenty", "dev", "--once"];
  if (args.dryRun) syncArgs.push("--dry-run");
  run("yarn", syncArgs, { cwd: args.appDir });
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

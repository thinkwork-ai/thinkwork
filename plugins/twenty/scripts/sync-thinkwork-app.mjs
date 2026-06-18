#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

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
  args.apiKey ||=
    process.env.TWENTY_DEPLOY_API_KEY || process.env.TWENTY_APP_SYNC_API_KEY;
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

function readTwentyConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return {};
  }

  const rawConfig = fs.readFileSync(configPath, "utf8");
  if (rawConfig.trim() === "") {
    return {};
  }

  return JSON.parse(rawConfig);
}

export function buildTwentyRemoteConfig(
  existingConfig,
  { remoteName, url, apiKey },
) {
  return {
    ...existingConfig,
    version: existingConfig.version ?? 1,
    defaultRemote: remoteName,
    remotes: {
      ...existingConfig.remotes,
      [remoteName]: {
        apiUrl: url,
        apiKey,
      },
    },
  };
}

function writeTwentyRemoteConfig({ remoteName, url, apiKey }) {
  const configDir = path.join(os.homedir(), ".twenty");
  const configPath = path.join(configDir, "config.json");
  fs.mkdirSync(configDir, { recursive: true });
  const existingConfig = readTwentyConfig(configPath);
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      buildTwentyRemoteConfig(existingConfig, { remoteName, url, apiKey }),
      null,
      2,
    ),
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = validateUrl(args.url);
  if (!args.apiKey) {
    throw new Error(
      "Set TWENTY_DEPLOY_API_KEY, TWENTY_APP_SYNC_API_KEY, or pass --api-key.",
    );
  }

  console.log(
    JSON.stringify(
      {
        app: "ThinkWork",
        remoteName: args.remoteName,
        url,
        mode: args.dryRun ? "dry-run" : "apply",
        note: args.dryRun
          ? "Dry run previews app metadata with Twenty dev sync and writes nothing."
          : "Apply deploys the private app package to Twenty and installs it into the target workspace.",
      },
      null,
      2,
    ),
  );

  run("corepack", ["enable"], { cwd: args.appDir });
  run("yarn", ["install"], { cwd: args.appDir });
  writeTwentyRemoteConfig({
    remoteName: args.remoteName,
    url,
    apiKey: args.apiKey,
  });

  if (args.dryRun) {
    run(
      "yarn",
      ["twenty", "--remote", args.remoteName, "dev", "--once", "--dry-run"],
      {
        cwd: args.appDir,
      },
    );
    return;
  }

  run(
    "yarn",
    ["twenty", "app:publish", "--private", "--remote", args.remoteName],
    { cwd: args.appDir },
  );
  run("yarn", ["twenty", "app:install", "--remote", args.remoteName], {
    cwd: args.appDir,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

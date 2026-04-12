import { Command } from "commander";
import { execSync } from "node:child_process";
import { realpathSync } from "node:fs";
import chalk from "chalk";
import { VERSION } from "../version.js";
import { printHeader } from "../ui.js";

function getLatestVersion(): string | null {
  try {
    return execSync("npm view thinkwork-cli version", {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function detectInstallMethod(): "npm" | "homebrew" {
  try {
    const which = execSync("which thinkwork", {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    // Resolve symlinks: Homebrew-installed Node puts npm global binaries in
    // /opt/homebrew/bin, so a plain "homebrew" substring match yields a false
    // positive. Only a true Homebrew formula install resolves under /Cellar/.
    let resolved = which;
    try {
      resolved = realpathSync(which);
    } catch {
      /* use `which` value as-is if realpath fails */
    }
    if (resolved.includes("/Cellar/")) return "homebrew";
    return "npm";
  } catch {
    return "npm";
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
  }
  return 0;
}

export function registerUpdateCommand(program: Command): void {
  program
    .command("update")
    .description("Check for and install CLI updates")
    .option("--check", "Only check for updates, don't install")
    .action(async (opts: { check?: boolean }) => {
      printHeader("update", "", null);

      console.log(`  Current version: ${chalk.bold(VERSION)}`);

      const latest = getLatestVersion();
      if (!latest) {
        console.log(chalk.yellow("  Could not check npm registry for updates."));
        return;
      }

      console.log(`  Latest version:  ${chalk.bold(latest)}`);
      console.log("");

      const cmp = compareVersions(VERSION, latest);
      if (cmp >= 0) {
        console.log(chalk.green("  ✓ You're on the latest version."));
        console.log("");
        return;
      }

      console.log(chalk.cyan(`  Update available: ${VERSION} → ${latest}`));
      console.log("");

      if (opts.check) {
        const method = detectInstallMethod();
        if (method === "homebrew") {
          console.log(`  Run: ${chalk.cyan("brew upgrade thinkwork-ai/tap/thinkwork")}`);
        } else {
          console.log(`  Run: ${chalk.cyan(`npm install -g thinkwork-cli@${latest}`)}`);
        }
        console.log("");
        return;
      }

      const method = detectInstallMethod();
      const cmd = method === "homebrew"
        ? "brew upgrade thinkwork-ai/tap/thinkwork"
        : `npm install -g thinkwork-cli@${latest}`;

      console.log(`  Installing via ${method}...`);
      console.log(chalk.dim(`  $ ${cmd}`));
      console.log("");

      try {
        execSync(cmd, { stdio: "inherit", timeout: 120_000 });
        console.log("");
        console.log(chalk.green(`  ✓ Upgraded to thinkwork-cli@${latest}`));
      } catch {
        console.log("");
        console.log(chalk.red(`  Failed to upgrade. Try manually:`));
        console.log(`    ${chalk.cyan(cmd)}`);
      }
      console.log("");
    });
}

import { Command } from "commander";
import { execSync } from "node:child_process";
import { createInterface } from "node:readline";
import chalk from "chalk";
import { getAwsIdentity } from "../aws.js";
import { listAwsProfiles, type AwsProfile } from "../aws-profiles.js";
import { saveCliConfig } from "../cli-config.js";
import { ensureAwsCli } from "../prerequisites.js";
import { printHeader, printSuccess, printError } from "../ui.js";

function ask(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Verify a profile with `sts get-caller-identity`. Returns null on failure. */
function verifyProfile(
  profile: string,
): { account: string; arn: string } | null {
  try {
    const raw = execSync(
      `aws sts get-caller-identity --profile ${profile} --output json`,
      { encoding: "utf-8", timeout: 15_000, stdio: ["pipe", "pipe", "pipe"] },
    );
    const parsed = JSON.parse(raw) as { Account: string; Arn: string };
    return { account: parsed.Account, arn: parsed.Arn };
  } catch {
    return null;
  }
}

function describeType(type: AwsProfile["type"]): string {
  switch (type) {
    case "keys":
      return "access keys";
    case "sso":
      return "SSO";
    case "role":
      return "assumed role";
    default:
      return "config only";
  }
}

type Choice =
  | { kind: "existing"; name: string }
  | { kind: "keys" }
  | { kind: "sso" }
  | { kind: "cancel" };

async function pickProfile(profiles: AwsProfile[]): Promise<Choice> {
  console.log("");
  console.log(chalk.bold("  Found these profiles in ~/.aws:"));
  profiles.forEach((p, i) => {
    const idx = String(i + 1).padStart(2, " ");
    console.log(
      `    ${chalk.cyan(idx)}. ${chalk.bold(p.name)}  ${chalk.dim(`(${describeType(p.type)})`)}`,
    );
  });
  const newIdx = profiles.length + 1;
  const ssoIdx = profiles.length + 2;
  console.log(
    `    ${chalk.cyan(String(newIdx).padStart(2, " "))}. Enter new access keys`,
  );
  console.log(
    `    ${chalk.cyan(String(ssoIdx).padStart(2, " "))}. Log in via AWS SSO`,
  );
  console.log("");

  const answer = await ask(`  Pick a profile [1-${ssoIdx}] (Enter to cancel): `);
  if (!answer) return { kind: "cancel" };
  const n = Number.parseInt(answer, 10);
  if (Number.isNaN(n) || n < 1 || n > ssoIdx) {
    printError(`"${answer}" is not a valid option.`);
    return { kind: "cancel" };
  }
  if (n === newIdx) return { kind: "keys" };
  if (n === ssoIdx) return { kind: "sso" };
  return { kind: "existing", name: profiles[n - 1]!.name };
}

async function runKeyEntry(targetProfile: string): Promise<boolean> {
  console.log("");
  console.log("  Enter your AWS credentials. These will be saved to the");
  console.log(`  AWS CLI profile "${targetProfile}".`);
  console.log("");

  const accessKeyId = await ask("  AWS Access Key ID: ");
  if (!accessKeyId) {
    printError("Access Key ID is required");
    return false;
  }

  const secretAccessKey = await ask("  AWS Secret Access Key: ");
  if (!secretAccessKey) {
    printError("Secret Access Key is required");
    return false;
  }

  const region = await ask("  Default region [us-east-1]: ");
  const finalRegion = region || "us-east-1";

  try {
    execSync(
      `aws configure set aws_access_key_id "${accessKeyId}" --profile ${targetProfile}`,
      { stdio: "pipe" },
    );
    execSync(
      `aws configure set aws_secret_access_key "${secretAccessKey}" --profile ${targetProfile}`,
      { stdio: "pipe" },
    );
    execSync(
      `aws configure set region "${finalRegion}" --profile ${targetProfile}`,
      { stdio: "pipe" },
    );
    return true;
  } catch (err) {
    printError(`Failed to save credentials: ${err}`);
    return false;
  }
}

function runSsoLogin(targetProfile: string): boolean {
  console.log("  Launching AWS SSO login...");
  console.log("");
  try {
    execSync(`aws sso login --profile ${targetProfile}`, { stdio: "inherit" });
    return true;
  } catch {
    printError(
      `SSO login failed. Run \`aws configure sso --profile ${targetProfile}\` first to set up the profile.`,
    );
    return false;
  }
}

function finalize(profile: string, mode: string): void {
  const identity = getAwsIdentity();
  if (!identity) {
    printError(
      `Credentials saved but could not verify with profile "${profile}". Try \`aws sts get-caller-identity --profile ${profile}\`.`,
    );
    process.exit(1);
  }
  saveCliConfig({ defaultProfile: profile });
  printSuccess(
    `Logged in via ${mode} (account: ${identity.account}, region: ${identity.region})`,
  );
  console.log("");
  console.log(
    `  Profile "${profile}" saved as your Thinkwork default. Subsequent commands`,
  );
  console.log(
    `  (\`thinkwork list\`, \`thinkwork deploy\`, …) will use it automatically.`,
  );
  console.log(
    chalk.dim(
      `  Override per-command with --profile <other>, or unset with \`rm ~/.thinkwork/config.json\`.`,
    ),
  );
}

export function registerLoginCommand(program: Command): void {
  program
    .command("login")
    .description(
      "Configure AWS credentials for Thinkwork. Picks from existing ~/.aws profiles by default; falls back to new keys or SSO.",
    )
    .option(
      "--profile <name>",
      "AWS profile name to configure (used when entering new keys or SSO)",
      "thinkwork",
    )
    .option("--sso", "Skip the picker and go straight to SSO login")
    .option("--keys", "Skip the picker and go straight to access-key entry")
    .addHelpText(
      "after",
      `
Examples:
  # Interactive picker — lists profiles from ~/.aws, verifies the one you pick,
  # and saves it as your Thinkwork default.
  $ thinkwork login

  # Skip the picker, enter fresh access keys into a named profile
  $ thinkwork login --keys --profile thinkwork

  # Skip the picker, log in via AWS SSO
  $ thinkwork login --sso --profile work-sso

After login, commands resolve the AWS profile in this order:
  1. --profile <name>            (per-command override)
  2. \$AWS_PROFILE env var
  3. defaultProfile from ~/.thinkwork/config.json  (set by this command)
`,
    )
    .action(async (opts: { profile: string; sso?: boolean; keys?: boolean }) => {
      printHeader("login", opts.profile);

      const awsOk = await ensureAwsCli();
      if (!awsOk) process.exit(1);

      if (opts.sso) {
        if (!runSsoLogin(opts.profile)) process.exit(1);
        process.env.AWS_PROFILE = opts.profile;
        finalize(opts.profile, "SSO");
        return;
      }
      if (opts.keys) {
        if (!(await runKeyEntry(opts.profile))) process.exit(1);
        process.env.AWS_PROFILE = opts.profile;
        finalize(opts.profile, "access keys");
        return;
      }

      const profiles = listAwsProfiles();

      if (profiles.length === 0) {
        console.log("");
        console.log(chalk.dim("  No AWS profiles found in ~/.aws/."));
        console.log(
          chalk.dim("  Falling through to access-key entry for a new profile."),
        );
        if (!(await runKeyEntry(opts.profile))) process.exit(1);
        process.env.AWS_PROFILE = opts.profile;
        finalize(opts.profile, "access keys");
        return;
      }

      const choice = await pickProfile(profiles);
      if (choice.kind === "cancel") {
        console.log("");
        console.log(chalk.dim("  Cancelled. No changes made."));
        return;
      }

      if (choice.kind === "keys") {
        if (!(await runKeyEntry(opts.profile))) process.exit(1);
        process.env.AWS_PROFILE = opts.profile;
        finalize(opts.profile, "access keys");
        return;
      }

      if (choice.kind === "sso") {
        if (!runSsoLogin(opts.profile)) process.exit(1);
        process.env.AWS_PROFILE = opts.profile;
        finalize(opts.profile, "SSO");
        return;
      }

      const picked = choice.name;
      console.log("");
      console.log(`  Verifying "${picked}"...`);
      const identity = verifyProfile(picked);
      if (!identity) {
        printError(
          `Could not authenticate with profile "${picked}". If it's an SSO profile, try \`aws sso login --profile ${picked}\` first.`,
        );
        process.exit(1);
      }
      process.env.AWS_PROFILE = picked;
      finalize(picked, "existing profile");
    });
}

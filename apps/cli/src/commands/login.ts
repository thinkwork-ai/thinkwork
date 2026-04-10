import { Command } from "commander";
import { execSync } from "node:child_process";
import { createInterface } from "node:readline";
import { getAwsIdentity } from "../aws.js";
import { ensureAwsCli } from "../prerequisites.js";
import { printHeader, printSuccess, printError, printWarning } from "../ui.js";

function ask(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function registerLoginCommand(program: Command): void {
  program
    .command("login")
    .description("Configure AWS credentials for Thinkwork deployments")
    .option("--profile <name>", "AWS profile name to configure", "thinkwork")
    .option("--sso", "Use AWS SSO (Identity Center) login")
    .action(async (opts: { profile: string; sso?: boolean }) => {
      printHeader("login", opts.profile);

      // Auto-install AWS CLI if missing
      const awsOk = await ensureAwsCli();
      if (!awsOk) {
        process.exit(1);
      }

      // Check if already authenticated
      const existing = getAwsIdentity();
      if (existing) {
        console.log(`  Already authenticated:`);
        console.log(`    Account: ${existing.account}`);
        console.log(`    Region:  ${existing.region}`);
        console.log(`    ARN:     ${existing.arn}`);
        console.log("");

        const reauth = await ask("  Re-authenticate? [y/N] ");
        if (reauth.toLowerCase() !== "y") {
          printSuccess("Using existing credentials");
          return;
        }
      }

      if (opts.sso) {
        // SSO flow
        console.log("  Launching AWS SSO login...");
        console.log("");
        try {
          execSync(`aws sso login --profile ${opts.profile}`, {
            stdio: "inherit",
          });
          process.env.AWS_PROFILE = opts.profile;
          const identity = getAwsIdentity();
          if (identity) {
            printSuccess(`Logged in via SSO (account: ${identity.account}, region: ${identity.region})`);
          } else {
            printError("SSO login succeeded but could not verify identity");
          }
        } catch {
          printError("SSO login failed. Run `aws configure sso` first to set up your SSO profile.");
        }
        return;
      }

      // Access key flow
      console.log("  Enter your AWS credentials. These will be saved to the");
      console.log(`  AWS CLI profile "${opts.profile}".`);
      console.log("");

      const accessKeyId = await ask("  AWS Access Key ID: ");
      if (!accessKeyId) {
        printError("Access Key ID is required");
        process.exit(1);
      }

      const secretAccessKey = await ask("  AWS Secret Access Key: ");
      if (!secretAccessKey) {
        printError("Secret Access Key is required");
        process.exit(1);
      }

      const region = await ask("  Default region [us-east-1]: ");
      const finalRegion = region || "us-east-1";

      // Save to AWS CLI profile
      try {
        execSync(`aws configure set aws_access_key_id "${accessKeyId}" --profile ${opts.profile}`, { stdio: "pipe" });
        execSync(`aws configure set aws_secret_access_key "${secretAccessKey}" --profile ${opts.profile}`, { stdio: "pipe" });
        execSync(`aws configure set region "${finalRegion}" --profile ${opts.profile}`, { stdio: "pipe" });
      } catch (err) {
        printError(`Failed to save credentials: ${err}`);
        process.exit(1);
      }

      // Verify
      process.env.AWS_PROFILE = opts.profile;
      const identity = getAwsIdentity();
      if (identity) {
        printSuccess(`Logged in (account: ${identity.account}, region: ${identity.region})`);
        console.log("");
        console.log(`  Profile saved as "${opts.profile}". Use it with:`);
        console.log(`    thinkwork deploy -s dev --profile ${opts.profile}`);
        console.log(`    export AWS_PROFILE=${opts.profile}`);
      } else {
        printError("Credentials saved but could not verify. Check your Access Key ID and Secret.");
      }
    });
}

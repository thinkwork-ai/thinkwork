import { Command } from "commander";
import chalk from "chalk";
import { execSync } from "node:child_process";
import { getAwsIdentity } from "../aws.js";
import { printHeader } from "../ui.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { isCancellation } from "../lib/interactive.js";

interface Check {
  name: string;
  run: () => { pass: boolean; detail: string };
}

function checkAwsCli(): Check {
  return {
    name: "AWS CLI installed",
    run: () => {
      try {
        const v = execSync("aws --version", { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }).trim();
        return { pass: true, detail: v.split(" ")[0] ?? v };
      } catch {
        return { pass: false, detail: "aws CLI not found. Install: https://aws.amazon.com/cli/" };
      }
    },
  };
}

function checkTerraformCli(): Check {
  return {
    name: "Terraform CLI installed",
    run: () => {
      try {
        const v = execSync("terraform version -json", { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
        const parsed = JSON.parse(v) as { terraform_version: string };
        return { pass: true, detail: `v${parsed.terraform_version}` };
      } catch {
        return { pass: false, detail: "terraform CLI not found. Install: https://developer.hashicorp.com/terraform/install" };
      }
    },
  };
}

function checkAwsIdentity(): Check {
  return {
    name: "AWS credentials configured",
    run: () => {
      const identity = getAwsIdentity();
      if (identity) {
        return { pass: true, detail: `account=${identity.account} region=${identity.region}` };
      }
      return { pass: false, detail: "Could not resolve AWS identity. Run `aws configure` or set AWS_PROFILE." };
    },
  };
}

function checkBedrockAccess(): Check {
  return {
    name: "Bedrock model access",
    run: () => {
      try {
        execSync(
          'aws bedrock get-foundation-model --model-identifier anthropic.claude-3-haiku-20240307-v1:0 --output json --region us-east-1',
          { encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }
        );
        return { pass: true, detail: "anthropic.claude-3-haiku accessible" };
      } catch {
        return {
          pass: false,
          detail: "Bedrock model access not confirmed. You may need to request model access in the AWS console.",
        };
      }
    },
  };
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Check AWS account prerequisites for a Thinkwork deployment. Prompts for stage in a TTY when omitted.")
    .option("-p, --profile <name>", "AWS profile")
    .option("-s, --stage <name>", "Deployment stage")
    .action(async (opts: { stage?: string }) => {
      let stage: string;
      try {
        stage = await resolveStage({ flag: opts.stage });
      } catch (err) {
        if (isCancellation(err)) return;
        throw err;
      }

      printHeader("doctor", stage);

      const checks: Check[] = [
        checkAwsCli(),
        checkTerraformCli(),
        checkAwsIdentity(),
        checkBedrockAccess(),
      ];

      let allPass = true;
      for (const check of checks) {
        const result = check.run();
        const icon = result.pass ? chalk.green("✓") : chalk.red("✗");
        const detail = result.pass ? chalk.dim(result.detail) : chalk.yellow(result.detail);
        console.log(`  ${icon} ${check.name}  ${detail}`);
        if (!result.pass) allPass = false;
      }

      if (allPass) {
        console.log(`\n  ${chalk.green.bold("All checks passed.")}`);
      } else {
        console.log(`\n  ${chalk.yellow.bold("Some checks failed.")} Fix the issues above before deploying.`);
      }
      process.exit(allPass ? 0 : 1);
    });
}

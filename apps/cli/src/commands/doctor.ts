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
        const v = execSync("aws --version", {
          encoding: "utf-8",
          timeout: 5000,
          stdio: ["pipe", "pipe", "pipe"],
        }).trim();
        return { pass: true, detail: v.split(" ")[0] ?? v };
      } catch {
        return {
          pass: false,
          detail: "aws CLI not found. Install: https://aws.amazon.com/cli/",
        };
      }
    },
  };
}

function checkTerraformCli(): Check {
  return {
    name: "Terraform CLI installed",
    run: () => {
      try {
        const v = execSync("terraform version -json", {
          encoding: "utf-8",
          timeout: 5000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        const parsed = JSON.parse(v) as { terraform_version: string };
        return { pass: true, detail: `v${parsed.terraform_version}` };
      } catch {
        return {
          pass: false,
          detail:
            "terraform CLI not found. Install: https://developer.hashicorp.com/terraform/install",
        };
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
        return {
          pass: true,
          detail: `account=${identity.account} region=${identity.region}`,
        };
      }
      return {
        pass: false,
        detail:
          "Could not resolve AWS identity. Run `aws configure` or set AWS_PROFILE.",
      };
    },
  };
}

export const DOCTOR_BEDROCK_PROBE_MODEL_ID =
  "us.anthropic.claude-haiku-4-5-20251001-v1:0";

/**
 * Interpret a Bedrock converse probe outcome. An entitlement listing is not
 * enough: the McPherson install (2026-06-12) green-checked an account whose
 * effective inference allowance was zero (new-account dynamic quota ramp) and
 * whose Anthropic use-case form was unsubmitted — both only visible by
 * actually invoking a model.
 */
export function evaluateBedrockProbe(error: string | null): {
  pass: boolean;
  detail: string;
} {
  if (error === null) {
    return {
      pass: true,
      detail: `${DOCTOR_BEDROCK_PROBE_MODEL_ID} invocation OK`,
    };
  }
  if (error.includes("use case details")) {
    return {
      pass: false,
      detail:
        "Anthropic use-case form not submitted for this account. Submit it via " +
        "`aws bedrock put-use-case-for-model-access` or the Bedrock console " +
        "(Model access); it processes in ~15 minutes.",
    };
  }
  if (error.includes("ThrottlingException")) {
    return {
      pass: false,
      detail:
        "Bedrock throttled the probe — new AWS accounts start with an effective " +
        "inference allowance of ~zero (per region) that ramps up with account " +
        "age/billing history over hours-to-days. The applied Service Quotas " +
        "values are not the enforced values; nothing is configurable here.",
    };
  }
  if (error.includes("AccessDeniedException")) {
    return {
      pass: false,
      detail:
        "Bedrock model access denied. Request model access in the AWS console " +
        "(Bedrock → Model access) for the Anthropic models.",
    };
  }
  return {
    pass: false,
    detail: `Bedrock invocation failed: ${error.slice(0, 200)}`,
  };
}

function checkBedrockAccess(): Check {
  return {
    name: "Bedrock model invocation",
    run: () => {
      const region = process.env.AWS_REGION || "us-east-1";
      try {
        execSync(
          `aws bedrock-runtime converse --model-id ${DOCTOR_BEDROCK_PROBE_MODEL_ID} ` +
            `--messages '[{"role":"user","content":[{"text":"Reply with OK"}]}]' ` +
            `--inference-config '{"maxTokens":1}' --output json --region ${region}`,
          {
            encoding: "utf-8",
            timeout: 30000,
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        return evaluateBedrockProbe(null);
      } catch (err) {
        const stderr =
          err instanceof Error && "stderr" in err
            ? String((err as { stderr?: unknown }).stderr ?? err.message)
            : String(err);
        return evaluateBedrockProbe(stderr);
      }
    },
  };
}

/**
 * New AWS accounts default to 10 concurrent Lambda executions — too low for
 * the stack's reserved-concurrency handlers (the apply fails on
 * PutFunctionConcurrency) and for production traffic generally.
 */
export const MIN_LAMBDA_CONCURRENT_EXECUTIONS = 100;

export function evaluateLambdaConcurrency(value: number | null): {
  pass: boolean;
  detail: string;
} {
  if (value === null) {
    return {
      pass: false,
      detail: "Could not read the account's Lambda concurrency limit.",
    };
  }
  if (value < MIN_LAMBDA_CONCURRENT_EXECUTIONS) {
    return {
      pass: false,
      detail:
        `Account Lambda concurrency limit is ${value} (new-account default is 10); ` +
        `the deploy fails on reserved-concurrency handlers below ` +
        `${MIN_LAMBDA_CONCURRENT_EXECUTIONS}. Request an increase: ` +
        "`aws service-quotas request-service-quota-increase --service-code lambda " +
        "--quota-code L-B99A9384 --desired-value 1000`.",
    };
  }
  return { pass: true, detail: `concurrent executions limit ${value}` };
}

function checkLambdaConcurrency(): Check {
  return {
    name: "Lambda concurrency quota",
    run: () => {
      const region = process.env.AWS_REGION || "us-east-1";
      try {
        const raw = execSync(
          `aws lambda get-account-settings --query AccountLimit.ConcurrentExecutions --output text --region ${region}`,
          {
            encoding: "utf-8",
            timeout: 10000,
            stdio: ["pipe", "pipe", "pipe"],
          },
        ).trim();
        const value = Number.parseInt(raw, 10);
        return evaluateLambdaConcurrency(Number.isNaN(value) ? null : value);
      } catch {
        return evaluateLambdaConcurrency(null);
      }
    },
  };
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description(
      "Check AWS account prerequisites for a Thinkwork deployment. Prompts for stage in a TTY when omitted.",
    )
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
        checkLambdaConcurrency(),
      ];

      let allPass = true;
      for (const check of checks) {
        const result = check.run();
        const icon = result.pass ? chalk.green("✓") : chalk.red("✗");
        const detail = result.pass
          ? chalk.dim(result.detail)
          : chalk.yellow(result.detail);
        console.log(`  ${icon} ${check.name}  ${detail}`);
        if (!result.pass) allPass = false;
      }

      if (allPass) {
        console.log(`\n  ${chalk.green.bold("All checks passed.")}`);
      } else {
        console.log(
          `\n  ${chalk.yellow.bold("Some checks failed.")} Fix the issues above before deploying.`,
        );
      }
      process.exit(allPass ? 0 : 1);
    });
}

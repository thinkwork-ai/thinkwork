import { Command } from "commander";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { listEnvironments, loadEnvironment } from "../environments.js";
import { getAwsIdentity } from "../aws.js";
import { printHeader, printError } from "../ui.js";

interface DiscoveredStage {
  stage: string;
  source: "aws" | "local" | "both";
  region: string;
  accountId: string;
  apiEndpoint?: string;
  dbEndpoint?: string;
  memoryEngine?: string;
  hindsightHealth?: string;
  agentcoreStatus?: string;
  bucketName?: string;
  lambdaCount?: number;
}

function runAws(cmd: string): string | null {
  try {
    return execSync(`aws ${cmd}`, {
      encoding: "utf-8",
      timeout: 15_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Discover all Thinkwork stages deployed in the current AWS account
 * by listing Lambda functions matching thinkwork-*-api-graphql-http.
 */
function discoverAwsStages(region: string): Map<string, Partial<DiscoveredStage>> {
  const stages = new Map<string, Partial<DiscoveredStage>>();

  // List Lambda functions — the graphql-http handler is the best signal (one per stage)
  const raw = runAws(
    `lambda list-functions --region ${region} --query "Functions[?starts_with(FunctionName, 'thinkwork-')].FunctionName" --output json`
  );
  if (!raw) return stages;

  const functions = JSON.parse(raw) as string[];
  for (const fn of functions) {
    const match = fn.match(/^thinkwork-(.+?)-api-graphql-http$/);
    if (match) {
      const stage = match[1];
      stages.set(stage, { stage, source: "aws", region });
    }
  }

  // Enrich each discovered stage with details
  for (const [stage, info] of stages) {
    // Count lambdas
    const count = functions.filter(f => f.startsWith(`thinkwork-${stage}-`)).length;
    info.lambdaCount = count;

    // Check API Gateway
    const apiRaw = runAws(
      `apigatewayv2 get-apis --region ${region} --query "Items[?Name=='thinkwork-${stage}-api'].ApiEndpoint|[0]" --output text`
    );
    if (apiRaw && apiRaw !== "None") info.apiEndpoint = apiRaw;

    // Check AgentCore Lambda
    const acRaw = runAws(
      `lambda get-function --function-name thinkwork-${stage}-agentcore --region ${region} --query "Configuration.State" --output text 2>/dev/null`
    );
    info.agentcoreStatus = acRaw || "not deployed";

    // Check S3 bucket
    const bucketRaw = runAws(
      `s3api head-bucket --bucket thinkwork-${stage}-storage --region ${region} 2>/dev/null && echo "exists"`
    );
    info.bucketName = bucketRaw ? `thinkwork-${stage}-storage` : undefined;

    // Check Hindsight ECS
    const ecsRaw = runAws(
      `ecs describe-services --cluster thinkwork-${stage}-cluster --services thinkwork-${stage}-hindsight --region ${region} --query "services[0].runningCount" --output text 2>/dev/null`
    );
    if (ecsRaw && ecsRaw !== "None" && ecsRaw !== "0") {
      info.memoryEngine = "hindsight";
      // Health check
      const albRaw = runAws(
        `elbv2 describe-load-balancers --region ${region} --query "LoadBalancers[?contains(LoadBalancerName, 'tw-${stage}-hindsight')].DNSName|[0]" --output text`
      );
      if (albRaw && albRaw !== "None") {
        try {
          const health = execSync(`curl -s --max-time 3 http://${albRaw}/health`, { encoding: "utf-8" }).trim();
          info.hindsightHealth = health.includes("healthy") ? "healthy" : "unhealthy";
        } catch {
          info.hindsightHealth = "unreachable";
        }
      }
    } else {
      info.memoryEngine = "managed";
    }
  }

  return stages;
}

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show all Thinkwork environments (AWS + local)")
    .option("-s, --stage <name>", "Show details for a specific stage")
    .option("--region <region>", "AWS region to scan", "us-east-1")
    .action(async (opts: { stage?: string; region: string }) => {
      const identity = getAwsIdentity();
      printHeader("status", opts.stage || "all", identity);

      if (!identity) {
        printError("AWS credentials not configured. Run `thinkwork login` first.");
        process.exit(1);
      }

      console.log(chalk.dim("  Scanning AWS account for Thinkwork deployments...\n"));

      // Discover from AWS
      const awsStages = discoverAwsStages(opts.region);

      // Merge with local environment registry
      const localEnvs = listEnvironments();
      const merged = new Map<string, DiscoveredStage>();

      for (const [stage, info] of awsStages) {
        const local = localEnvs.find(e => e.stage === stage);
        merged.set(stage, {
          stage,
          source: local ? "both" : "aws",
          region: opts.region,
          accountId: identity.account,
          ...info,
        } as DiscoveredStage);
      }

      // Add local-only environments (not found in AWS — maybe destroyed or different account)
      for (const env of localEnvs) {
        if (!merged.has(env.stage)) {
          merged.set(env.stage, {
            stage: env.stage,
            source: "local",
            region: env.region,
            accountId: env.accountId,
          });
        }
      }

      if (opts.stage) {
        // Detail view for one stage
        const info = merged.get(opts.stage);
        if (!info) {
          printError(`No environment "${opts.stage}" found in AWS or local config.`);
          process.exit(1);
        }

        console.log(chalk.bold.cyan(`  ⬡ ${info.stage}`));
        console.log(chalk.dim("  ─────────────────────────────────────────"));
        console.log(`  ${chalk.bold("Source:")}          ${info.source === "both" ? "AWS + local config" : info.source === "aws" ? "AWS (no local config)" : "local only (not in AWS)"}`);
        console.log(`  ${chalk.bold("Region:")}          ${info.region}`);
        console.log(`  ${chalk.bold("Account:")}         ${info.accountId}`);
        if (info.apiEndpoint) console.log(`  ${chalk.bold("API:")}             ${info.apiEndpoint}`);
        if (info.lambdaCount) console.log(`  ${chalk.bold("Lambda fns:")}      ${info.lambdaCount}`);
        console.log(`  ${chalk.bold("AgentCore:")}       ${info.agentcoreStatus || "unknown"}`);
        console.log(`  ${chalk.bold("Memory:")}          ${info.memoryEngine || "unknown"}`);
        if (info.hindsightHealth) console.log(`  ${chalk.bold("Hindsight:")}       ${info.hindsightHealth}`);
        if (info.bucketName) console.log(`  ${chalk.bold("S3 bucket:")}       ${info.bucketName}`);
        console.log(chalk.dim("  ─────────────────────────────────────────"));

        const local = loadEnvironment(opts.stage);
        if (local) {
          console.log("");
          console.log(chalk.dim(`  Terraform dir: ${local.terraformDir}`));
        } else {
          console.log("");
          console.log(chalk.dim(`  No local config. Run: thinkwork init -s ${opts.stage}`));
        }
        console.log("");
        return;
      }

      // Table view — all stages
      if (merged.size === 0) {
        console.log("  No Thinkwork environments found.");
        console.log(`  Run ${chalk.cyan("thinkwork init -s <stage>")} to create one.`);
        console.log("");
        return;
      }

      console.log(chalk.bold("  Environments"));
      console.log(chalk.dim("  ──────────────────────────────────────────────────────────────────────"));
      console.log(
        chalk.dim("  ") +
        "Stage".padEnd(16) +
        "Source".padEnd(10) +
        "Lambdas".padEnd(10) +
        "AgentCore".padEnd(14) +
        "Memory".padEnd(14) +
        "API"
      );
      console.log(chalk.dim("  ──────────────────────────────────────────────────────────────────────"));

      for (const [, info] of [...merged].sort((a, b) => a[0].localeCompare(b[0]))) {
        const sourceBadge = info.source === "both" ? chalk.green("●")
          : info.source === "aws" ? chalk.yellow("●")
          : chalk.dim("○");

        const acStatus = info.agentcoreStatus === "Active"
          ? chalk.green("active")
          : info.agentcoreStatus === "not deployed"
          ? chalk.dim("—")
          : chalk.yellow(info.agentcoreStatus || "—");

        const memBadge = info.memoryEngine === "hindsight"
          ? (info.hindsightHealth === "healthy" ? chalk.magenta("hindsight ✓") : chalk.yellow("hindsight ?"))
          : chalk.dim(info.memoryEngine || "—");

        console.log(
          `  ${sourceBadge} ` +
          chalk.bold(info.stage.padEnd(14)) +
          (info.source === "both" ? "aws+cli" : info.source).padEnd(10) +
          String(info.lambdaCount || "—").padEnd(10) +
          acStatus.padEnd(22) +
          memBadge.padEnd(22) +
          chalk.dim(info.apiEndpoint || "—")
        );
      }

      console.log(chalk.dim("  ──────────────────────────────────────────────────────────────────────"));
      console.log(chalk.dim(`  ${merged.size} environment(s)  `) + chalk.green("●") + chalk.dim(" aws+cli  ") + chalk.yellow("●") + chalk.dim(" aws only  ") + chalk.dim("○ local only"));
      console.log("");
      console.log(`  Details: ${chalk.cyan("thinkwork status -s <stage>")}`);
      console.log("");
    });
}

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
  appsyncUrl?: string;
  hindsightEndpoint?: string;
  adminUrl?: string;
  docsUrl?: string;
  appsyncApiUrl?: string;
  dbEndpoint?: string;
  ecrUrl?: string;
  memoryEngine?: string;
  hindsightHealth?: string;
  agentcoreStatus?: string;
  bucketName?: string;
  lambdaCount?: number;
}

/**
 * Create a clickable terminal hyperlink (OSC 8).
 * Falls back to plain text if terminal doesn't support it.
 */
function link(url: string, label?: string): string {
  const text = label || url;
  // OSC 8 hyperlink: \e]8;;URL\e\\TEXT\e]8;;\e\\
  return `\u001B]8;;${url}\u001B\\${text}\u001B]8;;\u001B\\`;
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

function discoverAwsStages(region: string): Map<string, Partial<DiscoveredStage>> {
  const stages = new Map<string, Partial<DiscoveredStage>>();

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

  for (const [stage, info] of stages) {
    const count = functions.filter(f => f.startsWith(`thinkwork-${stage}-`)).length;
    info.lambdaCount = count;

    // API Gateway
    const apiRaw = runAws(
      `apigatewayv2 get-apis --region ${region} --query "Items[?Name=='thinkwork-${stage}-api'].ApiEndpoint|[0]" --output text`
    );
    if (apiRaw && apiRaw !== "None") info.apiEndpoint = apiRaw;

    // AppSync (both realtime WS and HTTP API URL)
    const appsyncRaw = runAws(
      `appsync list-graphql-apis --region ${region} --query "graphqlApis[?name=='thinkwork-${stage}-subscriptions'].uris.REALTIME|[0]" --output text`
    );
    if (appsyncRaw && appsyncRaw !== "None") info.appsyncUrl = appsyncRaw;

    const appsyncApiRaw = runAws(
      `appsync list-graphql-apis --region ${region} --query "graphqlApis[?name=='thinkwork-${stage}-subscriptions'].uris.GRAPHQL|[0]" --output text`
    );
    if (appsyncApiRaw && appsyncApiRaw !== "None") info.appsyncApiUrl = appsyncApiRaw;

    // AgentCore Lambda
    const acRaw = runAws(
      `lambda get-function --function-name thinkwork-${stage}-agentcore --region ${region} --query "Configuration.State" --output text 2>/dev/null`
    );
    info.agentcoreStatus = acRaw || "not deployed";

    // S3 bucket
    const bucketRaw = runAws(
      `s3api head-bucket --bucket thinkwork-${stage}-storage --region ${region} 2>/dev/null && echo "exists"`
    );
    info.bucketName = bucketRaw ? `thinkwork-${stage}-storage` : undefined;

    // Hindsight ECS
    const ecsRaw = runAws(
      `ecs describe-services --cluster thinkwork-${stage}-cluster --services thinkwork-${stage}-hindsight --region ${region} --query "services[0].runningCount" --output text 2>/dev/null`
    );
    if (ecsRaw && ecsRaw !== "None" && ecsRaw !== "0") {
      info.memoryEngine = "hindsight";
      const albRaw = runAws(
        `elbv2 describe-load-balancers --region ${region} --query "LoadBalancers[?contains(LoadBalancerName, 'tw-${stage}-hindsight')].DNSName|[0]" --output text`
      );
      if (albRaw && albRaw !== "None") {
        info.hindsightEndpoint = `http://${albRaw}`;
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

    // Database (RDS/Aurora)
    const dbRaw = runAws(
      `rds describe-db-clusters --region ${region} --query "DBClusters[?starts_with(DBClusterIdentifier, 'thinkwork-${stage}')].Endpoint|[0]" --output text`
    );
    if (dbRaw && dbRaw !== "None") info.dbEndpoint = dbRaw;

    // ECR
    const ecrRaw = runAws(
      `ecr describe-repositories --region ${region} --query "repositories[?repositoryName=='thinkwork-${stage}-agentcore'].repositoryUri|[0]" --output text`
    );
    if (ecrRaw && ecrRaw !== "None") info.ecrUrl = ecrRaw;

    // CloudFront distributions (admin + docs in one call)
    const cfJson = runAws(
      `cloudfront list-distributions --query "DistributionList.Items[?contains(Origins.Items[0].DomainName, 'thinkwork-${stage}-')].{Origin:Origins.Items[0].DomainName,Domain:DomainName}" --output json`
    );
    if (cfJson) {
      try {
        const dists = JSON.parse(cfJson) as { Origin: string; Domain: string }[];
        for (const d of dists) {
          if (d.Origin.includes(`thinkwork-${stage}-admin`)) info.adminUrl = `https://${d.Domain}`;
          if (d.Origin.includes(`thinkwork-${stage}-docs`)) info.docsUrl = `https://${d.Domain}`;
        }
      } catch { /* ignore parse errors */ }
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

      const awsStages = discoverAwsStages(opts.region);
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
        // ── Detail view ──────────────────────────────────────────────
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
        console.log(`  ${chalk.bold("Lambda fns:")}      ${info.lambdaCount || "—"}`);
        console.log(`  ${chalk.bold("AgentCore:")}       ${info.agentcoreStatus || "unknown"}`);
        console.log(`  ${chalk.bold("Memory:")}          ${info.memoryEngine || "unknown"}`);
        if (info.hindsightHealth) console.log(`  ${chalk.bold("Hindsight:")}       ${info.hindsightHealth}`);
        if (info.bucketName) console.log(`  ${chalk.bold("S3 bucket:")}       ${info.bucketName}`);
        if (info.dbEndpoint) console.log(`  ${chalk.bold("Database:")}        ${info.dbEndpoint}`);
        if (info.ecrUrl) console.log(`  ${chalk.bold("ECR:")}             ${info.ecrUrl}`);
        console.log("");
        console.log(chalk.bold("  URLs:"));
        if (info.adminUrl) console.log(`    Admin:     ${link(info.adminUrl)}`);
        if (info.docsUrl) console.log(`    Docs:      ${link(info.docsUrl)}`);
        if (info.apiEndpoint) console.log(`    API:       ${link(info.apiEndpoint)}`);
        if (info.appsyncApiUrl) console.log(`    AppSync:   ${link(info.appsyncApiUrl)}`);
        if (info.appsyncUrl) console.log(`    WebSocket: ${link(info.appsyncUrl)}`);
        if (info.hindsightEndpoint) console.log(`    Hindsight: ${link(info.hindsightEndpoint)}`);
        console.log(chalk.dim("  ─────────────────────────────────────────"));

        const local = loadEnvironment(opts.stage);
        if (local) {
          console.log(chalk.dim(`  Terraform dir: ${local.terraformDir}`));
        } else {
          console.log(chalk.dim(`  No local config. Run: thinkwork init -s ${opts.stage}`));
        }
        console.log("");
        return;
      }

      // ── Table view ─────────────────────────────────────────────────
      if (merged.size === 0) {
        console.log("  No Thinkwork environments found.");
        console.log(`  Run ${chalk.cyan("thinkwork init -s <stage>")} to create one.`);
        console.log("");
        return;
      }

      const COL1 = 16; // stage
      const COL2 = 10; // source
      const COL3 = 10; // lambdas
      const COL4 = 14; // agentcore
      const COL5 = 14; // memory
      const pad = " ".repeat(2 + 2 + COL1 + COL2 + COL3 + COL4 + COL5);

      console.log(chalk.bold("  Environments"));
      console.log(chalk.dim("  ──────────────────────────────────────────────────────────────────────────"));
      console.log(
        chalk.dim("  ") +
        "Stage".padEnd(COL1) +
        "Source".padEnd(COL2) +
        "Lambdas".padEnd(COL3) +
        "AgentCore".padEnd(COL4) +
        "Memory".padEnd(COL5) +
        "URLs"
      );
      console.log(chalk.dim("  ──────────────────────────────────────────────────────────────────────────"));

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

        // First row: stage info + API URL
        const prefix =
          `  ${sourceBadge} ` +
          chalk.bold(info.stage.padEnd(COL1 - 1)) + " " +
          (info.source === "both" ? "aws+cli" : info.source).padEnd(COL2) +
          String(info.lambdaCount || "—").padEnd(COL3);

        // Build URL lines
        const urls: string[] = [];
        if (info.adminUrl) urls.push(`Admin: ${link(info.adminUrl, info.adminUrl)}`);
        if (info.docsUrl) urls.push(`Docs:  ${link(info.docsUrl, info.docsUrl)}`);
        if (info.apiEndpoint) urls.push(`API:   ${link(info.apiEndpoint, info.apiEndpoint)}`);
        if (info.appsyncUrl) urls.push(`WS:    ${link(info.appsyncUrl, info.appsyncUrl.replace("wss://", "").split(".")[0] + "...")}`);
        if (info.hindsightEndpoint) urls.push(`Mem:   ${link(info.hindsightEndpoint, info.hindsightEndpoint)}`);

        if (urls.length === 0) {
          console.log(prefix + acStatus.padEnd(22) + memBadge.padEnd(22) + chalk.dim("—"));
        } else {
          // First URL on the same line as the stage
          console.log(prefix + acStatus.padEnd(22) + memBadge.padEnd(22) + chalk.dim(urls[0]));
          // Remaining URLs on continuation lines
          for (let i = 1; i < urls.length; i++) {
            console.log(pad + chalk.dim(urls[i]));
          }
        }
      }

      console.log(chalk.dim("  ──────────────────────────────────────────────────────────────────────────"));
      console.log(
        chalk.dim(`  ${merged.size} environment(s)  `) +
        chalk.green("●") + chalk.dim(" aws+cli  ") +
        chalk.yellow("●") + chalk.dim(" aws only  ") +
        chalk.dim("○ local only")
      );
      console.log("");
      console.log(`  Details: ${chalk.cyan("thinkwork status -s <stage>")}`);
      console.log("");
    });
}

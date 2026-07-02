/**
 * Post-deploy stack verification (U6 / R8, R9).
 *
 * `terraform apply` exiting 0 is non-evidence: institutional history includes
 * green applies with unreachable APIs, healthy-looking stacks nobody could
 * log into, /healthz 200s with dead email paths, and CI-green deploys running
 * stale images. Verification exercises live paths and asserts deployed
 * artifacts. Pending external approvals (SES production access, DNS
 * delegation) render as a checklist and count as success (AE3).
 *
 * Runs standalone (`thinkwork verify -s <stage>`) and as the deploy tail.
 */

import { Command } from "commander";
import { execSync, spawnSync } from "node:child_process";
import chalk from "chalk";
import { getAwsIdentity } from "../aws.js";
import { printHeader, printError, printSuccess } from "../ui.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { isCancellation } from "../lib/interactive.js";
import {
  type Check,
  type CheckResult,
  checkDomainDelegation,
  checkSesStatus,
  runChecks,
} from "../lib/checks.js";
import type { ExecResult } from "../lib/state-backend.js";

const CANARY_QUERY = JSON.stringify({ query: "{ __typename }" });

function awsText(cmd: string): string | null {
  try {
    const out = execSync(`aws ${cmd}`, {
      encoding: "utf-8",
      timeout: 20_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return out === "None" || out === "" ? null : out;
  } catch {
    return null;
  }
}

function httpProbe(
  url: string,
  options: { method?: string; headers?: string[]; body?: string } = {},
): { status: number; body: string } {
  const args = [
    "-s",
    "--max-time",
    "10",
    "-o",
    "-",
    "-w",
    "\n%{http_code}",
    "-X",
    options.method ?? "GET",
  ];
  for (const header of options.headers ?? []) args.push("-H", header);
  if (options.body) args.push("--data", options.body);
  args.push(url);
  const proc = spawnSync("curl", args, { encoding: "utf8" });
  const output = proc.stdout ?? "";
  const splitAt = output.lastIndexOf("\n");
  const status = Number.parseInt(output.slice(splitAt + 1), 10);
  return {
    status: Number.isNaN(status) ? 0 : status,
    body: output.slice(0, Math.max(splitAt, 0)),
  };
}

export interface VerifyContext {
  stage: string;
  region: string;
  accountId: string;
  /** Service bearer for the authenticated probe (tfvars api_auth_secret). */
  apiAuthSecret?: string;
  /** customer_domain when configured — drives the DNS pending check. */
  domain?: string;
  /** true when SES is configured — drives the SES pending check. */
  sesConfigured?: boolean;
}

/** GraphQL endpoint discovery (same query `status` uses). */
function discoverApiEndpoint(ctx: VerifyContext): string | null {
  return awsText(
    `apigatewayv2 get-apis --region ${ctx.region} --query "Items[?Name=='thinkwork-${ctx.stage}-api'].ApiEndpoint|[0]" --output text`,
  );
}

export function buildVerifyChecks(ctx: VerifyContext): Check[] {
  const checks: Check[] = [];

  checks.push({
    name: "GraphQL API answers",
    run: () => {
      const endpoint = discoverApiEndpoint(ctx);
      if (!endpoint) {
        return {
          pass: false,
          detail: `No API Gateway named thinkwork-${ctx.stage}-api in ${ctx.region}.`,
        };
      }
      const res = httpProbe(`${endpoint}/graphql`, {
        method: "POST",
        headers: ["content-type: application/json"],
        body: CANARY_QUERY,
      });
      // Any well-formed GraphQL response (incl. an auth challenge) proves the
      // Lambda answers; a 5xx or connection failure does not.
      if (res.status >= 200 && res.status < 500 && res.body.includes("{")) {
        return { pass: true, detail: `POST /graphql → ${res.status}` };
      }
      return {
        pass: false,
        detail: `POST /graphql → ${res.status || "unreachable"} ${res.body.slice(0, 120)}`,
      };
    },
  });

  checks.push({
    name: "Authenticated API call",
    run: () => {
      if (!ctx.apiAuthSecret) {
        return {
          pass: false,
          detail:
            "No api_auth_secret available (run from the stage's init directory, or a stage with local config).",
        };
      }
      const endpoint = discoverApiEndpoint(ctx);
      if (!endpoint) {
        return { pass: false, detail: "API endpoint not discovered." };
      }
      const res = httpProbe(`${endpoint}/graphql`, {
        method: "POST",
        headers: [
          "content-type: application/json",
          `authorization: Bearer ${ctx.apiAuthSecret}`,
        ],
        body: CANARY_QUERY,
      });
      if (res.status === 200 && res.body.includes('"__typename"')) {
        return { pass: true, detail: "service-bearer GraphQL call succeeded" };
      }
      return {
        pass: false,
        detail: `authenticated call → ${res.status || "unreachable"}: the deployed API did not accept the stage's auth secret`,
      };
    },
  });

  checks.push({
    name: "Web app loads",
    run: () => {
      const cfJson = awsText(
        `cloudfront list-distributions --query "DistributionList.Items[?contains(Origins.Items[0].DomainName, 'thinkwork-${ctx.stage}-')].{Origin:Origins.Items[0].DomainName,Domain:DomainName}" --output json`,
      );
      let url: string | null = null;
      if (cfJson) {
        try {
          const dists = JSON.parse(cfJson) as {
            Origin: string;
            Domain: string;
          }[];
          // The end-user app bucket is named ...-computer (legacy naming);
          // admin/app cover older stacks (harness cycle-7 ledger entry).
          const admin = dists.find((d) =>
            /thinkwork-.+-(admin|app|computer)/.test(d.Origin),
          );
          if (admin) url = `https://${admin.Domain}`;
        } catch {
          /* fall through */
        }
      }
      if (!url) {
        return {
          pass: false,
          detail: "No CloudFront distribution found for the stage's web app.",
        };
      }
      const res = httpProbe(url);
      if (res.status === 200 && /<html|<!doctype/i.test(res.body)) {
        return { pass: true, detail: `${url} → 200 (html)` };
      }
      return {
        pass: false,
        detail: `${url} → ${res.status || "unreachable"} (no html — were web assets published?)`,
      };
    },
  });

  checks.push({
    name: "Database schema applied",
    run: () => {
      const secretArn = awsText(
        `secretsmanager describe-secret --secret-id thinkwork-${ctx.stage}-db-credentials --query ARN --output text --region ${ctx.region}`,
      );
      if (!secretArn) {
        return {
          pass: false,
          detail: `Secret thinkwork-${ctx.stage}-db-credentials not found.`,
        };
      }
      const resourceArn = `arn:aws:rds:${ctx.region}:${ctx.accountId}:cluster:thinkwork-${ctx.stage}-db`;
      const result = awsText(
        `rds-data execute-statement --resource-arn ${resourceArn} --secret-arn ${secretArn} ` +
          `--database thinkwork --region ${ctx.region} --sql "SELECT to_regclass('public.tenants')::text" --output json`,
      );
      if (!result) {
        return {
          pass: false,
          detail:
            "Data API query failed — cluster unreachable or Data API disabled.",
        };
      }
      const hasTable = result.includes("tenants");
      return hasTable
        ? { pass: true, detail: "tenants table present (Data API)" }
        : {
            pass: false,
            detail:
              "Schema missing (no tenants table) — rerun `thinkwork deploy` to apply migrations.",
          };
    },
  });

  checks.push({
    name: "Hindsight health",
    run: () => {
      const counts = awsText(
        `ecs describe-services --cluster thinkwork-${ctx.stage}-cluster --services thinkwork-${ctx.stage}-hindsight --region ${ctx.region} --query "services[0].[runningCount,desiredCount]" --output text`,
      );
      if (!counts) {
        return { pass: true, detail: "Hindsight not enabled — skipped" };
      }
      const [running, desired] = counts.split(/\s+/);
      // A provisioned service with zero running tasks is a FAILURE, not
      // "not enabled" — cycle-7's stack sat at desired=1/running=0 (tasks
      // could not reach CloudWatch) and the probe reported it as skipped.
      if (running === "0" && desired !== "0") {
        return {
          pass: false,
          detail: `Hindsight service desired=${desired} but running=0 — tasks are failing to start (check stopped-task reasons).`,
        };
      }
      if (running === "0") {
        return { pass: true, detail: "Hindsight not enabled — skipped" };
      }
      const alb = awsText(
        `elbv2 describe-load-balancers --region ${ctx.region} --query "LoadBalancers[?contains(LoadBalancerName, 'tw-${ctx.stage}-hindsight')].DNSName|[0]" --output text`,
      );
      if (!alb) {
        return {
          pass: false,
          detail: "Hindsight service running but no ALB found.",
        };
      }
      const res = httpProbe(`http://${alb}/health`);
      return res.status === 200 && res.body.includes("healthy")
        ? { pass: true, detail: `ECS running, /health healthy` }
        : {
            pass: false,
            detail: `/health → ${res.status || "unreachable"}`,
          };
    },
  });

  checks.push({
    name: "Workspace seeded",
    run: () => {
      const objects = awsText(
        `s3api list-objects-v2 --bucket thinkwork-${ctx.stage}-storage --prefix tenants/ --max-items 1 --query "KeyCount" --output text --region ${ctx.region}`,
      );
      if (objects && Number.parseInt(objects, 10) > 0) {
        return { pass: true, detail: "tenant workspace objects present" };
      }
      return {
        pass: false,
        detail: `No workspace objects — run \`thinkwork bootstrap -s ${ctx.stage}\` to seed defaults.`,
      };
    },
  });

  checks.push({
    name: "Deployed artifact evidence",
    run: () => {
      const fn = `thinkwork-${ctx.stage}-api-graphql-http`;
      const envStage = awsText(
        `lambda get-function-configuration --function-name ${fn} --region ${ctx.region} --query "Environment.Variables.STAGE" --output text`,
      );
      const codeSize = awsText(
        `lambda get-function-configuration --function-name ${fn} --region ${ctx.region} --query CodeSize --output text`,
      );
      const size = Number.parseInt(codeSize ?? "0", 10);
      if (envStage !== ctx.stage) {
        return {
          pass: false,
          detail: `Lambda env STAGE="${envStage ?? "unset"}" ≠ "${ctx.stage}" — deployed env drifted.`,
        };
      }
      if (size < 100_000) {
        return {
          pass: false,
          detail: `graphql-http code size ${size}B — placeholder artifact, not a real handler bundle.`,
        };
      }
      return {
        pass: true,
        detail: `env STAGE=${ctx.stage}, code ${(size / 1024 / 1024).toFixed(1)}MB`,
      };
    },
  });

  // Pending external approvals (R9) — warn-tier, never blocking (AE3).
  if (ctx.sesConfigured) checks.push(checkSesStatus());
  if (ctx.domain) {
    const dns = checkDomainDelegation(ctx.domain);
    checks.push({ ...dns, blocking: false });
  }

  return checks;
}

export interface StageVerificationResult {
  passed: boolean;
  failures: { name: string; detail: string }[];
  pending: { name: string; detail: string }[];
}

export async function runStageVerification(
  ctx: VerifyContext,
): Promise<StageVerificationResult> {
  console.log("\n  Verifying deployed stack:");
  const summary = await runChecks(buildVerifyChecks(ctx));
  for (const { name, blocking, result } of summary.results) {
    const icon = result.pass
      ? chalk.green("✓")
      : blocking
        ? chalk.red("✗")
        : chalk.yellow("!");
    console.log(`    ${icon} ${name}  ${chalk.dim(result.detail)}`);
  }
  if (summary.warnings.length > 0) {
    console.log(
      chalk.bold("\n  Pending external approvals (tracked, not blocking):"),
    );
    for (const w of summary.warnings) {
      console.log(`    • ${w.name}: ${w.detail}`);
    }
  }
  return {
    passed: summary.passed,
    failures: summary.failures,
    pending: summary.warnings,
  };
}

export function registerVerifyCommand(program: Command): void {
  program
    .command("verify")
    .description(
      "Prove a deployed stage works: GraphQL, auth, web, database schema, Hindsight, seeding, deployed-artifact evidence.",
    )
    .option("-p, --profile <name>", "AWS profile")
    .option("-s, --stage <name>", "Deployment stage")
    .option("--region <region>", "AWS region", "us-east-1")
    .option(
      "--api-auth-secret <value>",
      "Service bearer for the authenticated probe (defaults to the stage's local tfvars)",
    )
    .action(
      async (opts: {
        stage?: string;
        region: string;
        apiAuthSecret?: string;
      }) => {
        let stage: string;
        try {
          stage = await resolveStage({ flag: opts.stage });
        } catch (err) {
          if (isCancellation(err)) return;
          throw err;
        }
        const identity = getAwsIdentity();
        printHeader("verify", stage, identity);
        if (!identity) {
          printError("AWS credentials not configured.");
          process.exit(1);
        }

        const result = await runStageVerification({
          stage,
          region: identity.region !== "unknown" ? identity.region : opts.region,
          accountId: identity.account,
          apiAuthSecret: opts.apiAuthSecret,
        });
        if (result.passed) {
          printSuccess(
            result.pending.length > 0
              ? `Stage "${stage}" verified — ${result.pending.length} pending external approval(s) tracked.`
              : `Stage "${stage}" verified.`,
          );
          process.exit(0);
        }
        printError(
          `Stage "${stage}" failed verification (${result.failures.length} probe(s)).`,
        );
        process.exit(1);
      },
    );
}

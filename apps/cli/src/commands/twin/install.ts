/**
 * `thinkwork twin install` — orchestrator (THINK-334).
 *
 * Sequence (each step idempotent; failure stops the run and the report
 * shows completed vs remaining — re-run to resume):
 *   1. Prereq checks (doctor-style; nothing touched on failure).
 *   2. etl-repo Terraform stacks in dependency order (plan-gated, R4).
 *   3. Product-side Neptune tfvars sync + standard deploy for the stage's
 *      deployment model, verified against /thinkwork/<stage>/runtime-config.
 *   4. digital-twin MCP registration (check-then-skip; --rotate to re-key).
 */

import { execFileSync, spawnSync } from "node:child_process";

import { getAwsIdentity } from "../../aws.js";
import { apiFetchRaw, resolveApiConfig } from "../../api-client.js";
import { runChecks } from "../../lib/checks.js";
import { resolveStage } from "../../lib/resolve-stage.js";
import {
  evaluateTenantResolution,
  twinInstallChecks,
} from "../../lib/twin-install-checks.js";
import {
  runEtlTwinStacks,
  type NeptuneOutputs,
} from "../../lib/etl-terraform.js";
import {
  DEV_GH_VARIABLE_KEYS,
  NEPTUNE_FIELDS,
  mergeRunnerSecrets,
  readRunnerSecretChannel,
  resolveDeployModel,
  syncProductWiring,
  type NeptuneField,
  type WiringDeps,
} from "../../lib/twin-product-wiring.js";
import {
  registerTwinMcp,
  type McpServerSummary,
} from "../../lib/twin-mcp-register.js";
import {
  createReport,
  markNotAttempted,
  record,
  renderReport,
  reportExitCode,
  type StepState,
} from "../../lib/twin-install-report.js";
import {
  parsePriorControllerInput,
  recoverPriorControllerInput,
  type PriorControllerInput,
} from "../release/helpers.js";
import { controllerStateMachineArn } from "../deploy.js";
import { printError, printSuccess } from "../../ui.js";

const PRODUCT_REPO = "thinkwork-ai/thinkwork";

export interface TwinInstallOptions {
  stage?: string;
  tenant?: string;
  etlRepoDir?: string;
  etlAccount?: string;
  rotate?: boolean;
  allowChanges?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

export async function runTwinInstall(opts: TwinInstallOptions): Promise<void> {
  const stage = await resolveStage({ flag: opts.stage });
  const dryRun = opts.dryRun === true;
  const etlRepoDir = opts.etlRepoDir ?? process.env.THINKWORK_ETL_REPO ?? null;

  // ── 1. Prereq checks ───────────────────────────────────────────────────────
  console.log(`\nTwin install prereq checks (stage: ${stage}):`);
  const summary = await runChecks(twinInstallChecks({ etlRepoDir }));
  for (const { name, result } of summary.results) {
    console.log(`  ${result.pass ? "✓" : "✗"} ${name} — ${result.detail}`);
  }
  if (!summary.passed) {
    printError(
      `Prereqs failed (${summary.failures.map((f) => f.name).join(", ")}); nothing was changed.`,
    );
    process.exit(1);
  }

  const api = resolveApiConfig(stage);
  if (!api) {
    printError(`Could not resolve the ${stage} API endpoint/credential.`);
    process.exit(1);
  }

  // ── Tenant resolution (KTD-5) ──────────────────────────────────────────────
  const tenantsRes = await apiFetchRaw<Array<{ id: string; slug: string }>>(
    api.apiUrl,
    api.authSecret,
    "/api/tenants",
  );
  if (!tenantsRes.ok || !Array.isArray(tenantsRes.body)) {
    printError(`Could not list tenants (HTTP ${tenantsRes.status}).`);
    process.exit(1);
  }
  const tenants = tenantsRes.body;
  const resolution = evaluateTenantResolution(
    tenants.map((t) => t.slug),
    opts.tenant,
  );
  console.log(
    `  ${resolution.result.pass ? "✓" : "✗"} tenant resolution — ${resolution.result.detail}`,
  );
  if (!resolution.tenant) {
    process.exit(1);
  }
  const tenantSlug = resolution.tenant;
  const tenantId = tenants.find((t) => t.slug === tenantSlug)!.id;

  const accountSlug =
    opts.etlAccount ?? (stage === "dev" ? "thinkwork" : stage);
  console.log(
    `  etl account: ${accountSlug}  (deploy model: ${resolveDeployModel(stage)})`,
  );
  if (dryRun) console.log("  DRY RUN — plans and diffs only; no changes.\n");

  const report = createReport();
  const finish = (): never => {
    console.log(renderReport(report));
    process.exit(reportExitCode(report));
  };

  // ── 2. etl-repo stacks ─────────────────────────────────────────────────────
  const etl = runEtlTwinStacks({
    etlRepoDir: etlRepoDir!,
    accountSlug,
    dryRun,
    allowChanges: opts.allowChanges === true,
    log: (line) => console.log(`  ${line}`),
  });
  for (const e of etl.entries) {
    const state: StepState =
      e.state === "changed"
        ? "created"
        : e.state === "planned"
          ? "skipped"
          : e.state;
    record(report, `etl stack: ${e.stack}`, state, e.detail);
  }
  if (etl.failed) {
    markNotAttempted(report, [
      ...etl.notAttempted.map((s) => `etl stack: ${s}`),
      "product Neptune wiring",
      "MCP registration",
    ]);
    finish();
  }

  // ── 3. Product wiring ──────────────────────────────────────────────────────
  if (!etl.neptuneOutputs) {
    // Dry-run against an account whose neptune stack has not applied yet.
    record(
      report,
      "product Neptune wiring",
      "skipped",
      "no neptune outputs available yet (dry-run on an uninstalled account)",
    );
    record(report, "MCP registration", "skipped", "blocked on product wiring");
    finish();
    return;
  }
  const outputs: NeptuneOutputs = etl.neptuneOutputs;

  const wiringDeps = buildWiringDeps(stage);
  const wiring = await syncProductWiring(outputs, wiringDeps, { dryRun });
  record(
    report,
    "product Neptune wiring",
    wiring.state === "planned" ? "skipped" : wiring.state,
    wiring.detail,
  );
  if (wiring.state === "failed") {
    markNotAttempted(report, ["MCP registration"]);
    finish();
  }

  // ── 4. MCP registration ────────────────────────────────────────────────────
  if (dryRun) {
    const servers = await listMcpServers(api, tenantSlug);
    const active = servers.some(
      (s) => s.slug === "digital-twin" && s.enabled !== false,
    );
    record(
      report,
      "MCP registration",
      active ? "found" : "skipped",
      active
        ? "digital-twin registration already active"
        : "would provision digital-twin MCP server (dry-run)",
    );
    finish();
  }

  const mcp = await registerTwinMcp(
    {
      listServers: () => listMcpServers(api, tenantSlug),
      provision: async () => {
        const res = await apiFetchRaw<{ provisioned?: string; error?: string }>(
          api.apiUrl,
          api.authSecret,
          `/api/tenants/${tenantId}/mcp-twin-provision`,
          { method: "POST", body: JSON.stringify({}) },
        );
        if (!res.ok) {
          throw { status: res.status, body: res.body };
        }
        return res.body;
      },
    },
    { rotate: opts.rotate === true },
  );
  record(report, "MCP registration", mcp.state, mcp.detail);

  if (reportExitCode(report) === 0) {
    printSuccess(`Digital Twin install complete for ${stage}/${tenantSlug}.`);
  }
  finish();
}

// ── Real-world wiring deps ───────────────────────────────────────────────────

async function listMcpServers(
  api: { apiUrl: string; authSecret: string },
  tenantSlug: string,
): Promise<McpServerSummary[]> {
  const res = await apiFetchRaw<{ servers?: McpServerSummary[] }>(
    api.apiUrl,
    api.authSecret,
    "/api/skills/mcp-servers",
    {},
    { "x-tenant-slug": tenantSlug },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} listing MCP servers`);
  return res.body.servers ?? [];
}

function aws(args: string[]): string {
  return execFileSync("aws", args, {
    encoding: "utf8",
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gh(args: string[], opts: { stream?: boolean } = {}): string {
  if (opts.stream) {
    const res = spawnSync("gh", args, { stdio: "inherit" });
    if (res.status !== 0) {
      throw new Error(`gh ${args[0]} exited with ${res.status ?? "unknown"}`);
    }
    return "";
  }
  return execFileSync("gh", args, {
    encoding: "utf8",
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function buildWiringDeps(stage: string): WiringDeps {
  const model = resolveDeployModel(stage);
  const runtimeConfig = async (): Promise<string | null> => {
    try {
      return aws([
        "ssm",
        "get-parameter",
        "--name",
        `/thinkwork/${stage}/runtime-config`,
        "--query",
        "Parameter.Value",
        "--output",
        "text",
      ]);
    } catch {
      return null;
    }
  };

  if (model === "dev-github") {
    return {
      readChannel: async () => {
        const channel: Partial<Record<NeptuneField, string | null>> = {};
        for (const field of NEPTUNE_FIELDS) {
          try {
            channel[field] = gh([
              "variable",
              "get",
              DEV_GH_VARIABLE_KEYS[field],
              "-R",
              PRODUCT_REPO,
            ]);
          } catch {
            channel[field] = null;
          }
        }
        return channel;
      },
      writeChannel: async (desired) => {
        for (const field of NEPTUNE_FIELDS) {
          gh([
            "variable",
            "set",
            DEV_GH_VARIABLE_KEYS[field],
            "-R",
            PRODUCT_REPO,
            "--body",
            desired[field],
          ]);
        }
      },
      runDeploy: async () => {
        // GHA vars snapshot at trigger — set (above) happens before this run.
        gh([
          "workflow",
          "run",
          "deploy.yml",
          "-R",
          PRODUCT_REPO,
          "--ref",
          "main",
        ]);
        await new Promise((r) => setTimeout(r, 10_000));
        const runId = gh([
          "run",
          "list",
          "-R",
          PRODUCT_REPO,
          "--workflow",
          "deploy.yml",
          "--limit",
          "1",
          "--json",
          "databaseId",
          "--jq",
          ".[0].databaseId",
        ]);
        console.log(`  watching deploy.yml run ${runId} …`);
        gh(
          [
            "run",
            "watch",
            runId,
            "-R",
            PRODUCT_REPO,
            "--exit-status",
            "--interval",
            "30",
          ],
          { stream: true },
        );
      },
      readRuntimeConfig: runtimeConfig,
    };
  }

  const secretId = `/thinkwork/${stage}/deployment/runner-secrets`;
  const readSecret = (): string =>
    aws([
      "secretsmanager",
      "get-secret-value",
      "--secret-id",
      secretId,
      "--query",
      "SecretString",
      "--output",
      "text",
    ]);

  return {
    readChannel: async () => readRunnerSecretChannel(readSecret()),
    writeChannel: async (desired) => {
      const merged = mergeRunnerSecrets(readSecret(), desired);
      // aws CLI v2 does not reliably parse --cli-input-json from /dev/stdin;
      // stage the document in a 0600 temp file and delete it immediately.
      const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const dir = mkdtempSync(join(tmpdir(), "twin-rs-"));
      const path = join(dir, "put.json");
      try {
        writeFileSync(
          path,
          JSON.stringify({ SecretId: secretId, SecretString: merged }),
          { mode: 0o600 },
        );
        const res = spawnSync(
          "aws",
          [
            "secretsmanager",
            "put-secret-value",
            "--cli-input-json",
            `file://${path}`,
          ],
          {
            encoding: "utf8",
            timeout: 60_000,
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        if (res.status !== 0) {
          // Never echo stderr — diagnostics may include the secret document.
          throw new Error(
            `secretsmanager put-secret-value exited with ${res.status ?? "unknown"}.`,
          );
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    runDeploy: () => runCustomerControllerDeploy(stage),
    readRuntimeConfig: runtimeConfig,
  };
}

// ── Customer controller update deploy ────────────────────────────────────────

async function runCustomerControllerDeploy(stage: string): Promise<void> {
  const identity = getAwsIdentity();
  if (!identity || identity.region === "unknown") {
    throw new Error("Could not resolve AWS identity and region.");
  }
  const stateMachineArn = controllerStateMachineArn({
    stage,
    region: identity.region,
    accountId: identity.account,
  });
  const prior = readPriorControllerInput(stateMachineArn);
  if (
    prior.awsAccountId !== identity.account ||
    prior.environmentName !== stage
  ) {
    throw new Error(
      "AWS identity or stage does not match the deployed controller's prior input.",
    );
  }
  if (
    !prior.releaseVersion ||
    !prior.releaseManifestUrl ||
    !prior.releaseManifestSha256
  ) {
    throw new Error(
      "The previous successful deployment lacks a release manifest pin; deploy a current release first.",
    );
  }
  const input = buildTwinUpdateControllerInput(prior);
  const executionName = `tw-${stage}-twin-wiring-${Date.now()}`.slice(0, 80);
  const executionArn = aws([
    "stepfunctions",
    "start-execution",
    "--state-machine-arn",
    stateMachineArn,
    "--name",
    executionName,
    "--input",
    JSON.stringify(input),
    "--query",
    "executionArn",
    "--output",
    "text",
  ]);
  console.log(`  started controller update ${executionName}`);
  await waitForControllerExecution(executionArn);
}

export function buildTwinUpdateControllerInput(
  prior: PriorControllerInput,
): Record<string, unknown> {
  const sessionId = `twin-wiring-${Date.now()}`;
  const preservedConfig = {
    ...(prior.customerDomain ? { customerDomain: prior.customerDomain } : {}),
    ...(prior.customerDomainDelegated !== undefined
      ? { customerDomainDelegated: prior.customerDomainDelegated }
      : {}),
    ...(prior.customerDomainLegacyRetired !== undefined
      ? { customerDomainLegacyRetired: prior.customerDomainLegacyRetired }
      : {}),
    ...(prior.enableHindsight !== undefined
      ? { enableHindsight: prior.enableHindsight }
      : {}),
    ...(prior.hindsightDatabaseName
      ? { hindsightDatabaseName: prior.hindsightDatabaseName }
      : {}),
  };
  return {
    schemaVersion: 1,
    contract: "thinkwork.deployment.controller.v1",
    phase: "update",
    action: "update",
    sessionId,
    customerName: prior.customerName,
    environmentName: prior.environmentName,
    awsAccountId: prior.awsAccountId,
    awsRegion: prior.awsRegion,
    availabilityZones: prior.availabilityZones,
    evidenceBucket: prior.evidenceBucket,
    source: "twin-install-cli",
    runnerSecretArn:
      prior.runnerSecretArn ??
      `/thinkwork/${prior.environmentName}/deployment/runner-secrets`,
    preservedConfig,
    releaseVersion: prior.releaseVersion,
    releaseManifestUrl: prior.releaseManifestUrl,
    releaseManifestSha256: prior.releaseManifestSha256,
    terraformModuleSource:
      prior.terraformModuleSource ?? "thinkwork-ai/thinkwork/aws",
    terraformModuleVersion:
      prior.terraformModuleVersion ??
      (prior.releaseVersion ?? "").replace(/^v/, ""),
    ...(prior.agentcorePiSourceImageUri
      ? { agentcorePiSourceImageUri: prior.agentcorePiSourceImageUri }
      : {}),
    ...(prior.authRetirementPhase
      ? { authRetirementPhase: prior.authRetirementPhase }
      : {}),
    operation: {
      kind: "foundation",
      action: "update",
      plan: true,
      apply: true,
      destroy: false,
    },
    features: prior.features ?? {
      baseInstall: { slack: false, stripe: false, twenty: false },
      optionalApps: [],
    },
    terraform: prior.terraform ?? {
      stateRecovery: { mode: "state", recoverByTags: false },
    },
  };
}

function readPriorControllerInput(
  stateMachineArn: string,
): PriorControllerInput {
  const executions = JSON.parse(
    aws([
      "stepfunctions",
      "list-executions",
      "--state-machine-arn",
      stateMachineArn,
      "--status-filter",
      "SUCCEEDED",
      "--max-results",
      "20",
      "--query",
      "executions[].executionArn",
      "--output",
      "json",
    ]),
  ) as string[];
  if (executions.length === 0) {
    throw new Error("No successful deployment controller execution was found.");
  }
  const inputs = executions.map((executionArn) =>
    JSON.parse(
      aws([
        "stepfunctions",
        "describe-execution",
        "--execution-arn",
        executionArn,
        "--query",
        "input",
        "--output",
        "text",
      ]),
    ),
  );
  try {
    return recoverPriorControllerInput(inputs);
  } catch {
    return parsePriorControllerInput(inputs[0]);
  }
}

async function waitForControllerExecution(executionArn: string): Promise<void> {
  const deadline = Date.now() + 45 * 60 * 1000;
  process.stdout.write("  waiting for the controller run");
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    const result = JSON.parse(
      aws([
        "stepfunctions",
        "describe-execution",
        "--execution-arn",
        executionArn,
        "--query",
        "{status:status,error:error}",
        "--output",
        "json",
      ]),
    ) as { status: string; error?: string };
    if (result.status === "RUNNING") {
      process.stdout.write(".");
      continue;
    }
    console.log("");
    if (result.status !== "SUCCEEDED") {
      throw new Error(
        `Controller ${result.status}: ${result.error ?? "unknown error"}`,
      );
    }
    return;
  }
  throw new Error("Timed out waiting for the deployment controller.");
}

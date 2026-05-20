import { Command } from "commander";
import { resolve } from "node:path";
import { gqlMutate, gqlQuery } from "../../lib/gql-client.js";
import { resolveAuth } from "../../lib/resolve-auth.js";
import { getApiEndpoint } from "../../aws-discovery.js";
import { isJsonMode, printJson } from "../../lib/output.js";
import { printError, printSuccess } from "../../ui.js";
import {
  CreateEvalTestCaseDoc,
  EvalTestCasesDoc,
  UpdateEvalTestCaseDoc,
} from "../eval/gql.js";
import { resolveEvalContext } from "../eval/helpers.js";
import {
  applyEnterpriseOverlay,
  buildEnterpriseOverlayPlan,
  type EnterpriseOverlayPlan,
  type ExistingEvalTestCase,
  type OverlayApiClient,
  type OverlayApplyResult,
} from "./overlay-apply.js";
import type { CustomerEvalSeed } from "./overlay-schema.js";

interface OverlayOptions {
  stage?: string;
  region?: string;
  tenant?: string;
  dryRun?: boolean;
}

export function registerEnterpriseOverlayCommand(program: Command): void {
  const overlay = program
    .command("overlay")
    .description(
      "Validate and apply customer overlay packs from a deployment repo.",
    );

  overlay
    .command("plan")
    .argument("[repoRoot]", "Deployment repository root", ".")
    .description(
      "Validate customer/deployment.json and print the overlay plan.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-r, --region <region>", "AWS region", "us-east-1")
    .action((repoRoot: string, opts: OverlayOptions) =>
      runEnterpriseOverlayPlan(repoRoot, opts),
    );

  overlay
    .command("apply")
    .argument("[repoRoot]", "Deployment repository root", ".")
    .description("Apply customer overlay packs to the deployed stage.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-r, --region <region>", "AWS region", "us-east-1")
    .option("--dry-run", "Validate and print the apply plan without mutation")
    .action((repoRoot: string, opts: OverlayOptions) =>
      runEnterpriseOverlayApply(repoRoot, opts),
    );
}

export async function runEnterpriseOverlayPlan(
  repoRoot: string,
  opts: OverlayOptions,
): Promise<void> {
  const plan = buildEnterpriseOverlayPlan({
    repoRoot: resolve(repoRoot),
    stage: resolveOverlayStage(opts),
  });
  printJson(publicPlan(plan));
}

export async function runEnterpriseOverlayApply(
  repoRoot: string,
  opts: OverlayOptions,
): Promise<void> {
  const stage = resolveOverlayStage(opts);
  const plan = buildEnterpriseOverlayPlan({
    repoRoot: resolve(repoRoot),
    stage,
  });
  if (opts.dryRun) {
    printJson({ dryRun: true, plan: publicPlan(plan) });
    return;
  }

  const client = await createOverlayApiClient(plan, opts);
  const result = await applyEnterpriseOverlay(plan, client);
  if (isJsonMode()) {
    printJson(result);
    return;
  }
  printSuccess(
    `Applied overlay for ${plan.tenantSlug}: ${result.evals.inserted} eval(s) inserted, ${result.evals.updated} updated, ${result.workspaceFiles.written} workspace file(s) written.`,
  );
}

async function createOverlayApiClient(
  plan: EnterpriseOverlayPlan,
  opts: OverlayOptions,
): Promise<OverlayApiClient> {
  const region = opts.region ?? "us-east-1";
  const ctx = await resolveEvalContext({
    stage: plan.stage,
    region,
    tenant: opts.tenant ?? plan.tenantSlug,
  });
  const auth = await resolveAuth({ stage: plan.stage, region });
  const apiUrl = getApiEndpoint(plan.stage, region);
  if (!apiUrl) {
    printError(
      `Cannot discover API endpoint for stage "${plan.stage}" in ${region}.`,
    );
    process.exit(1);
  }

  return {
    targetAgentTemplateId: null,
    async listEvalTestCases() {
      const data = await gqlQuery(ctx.client, EvalTestCasesDoc, {
        tenantId: ctx.tenantId,
        category: null,
        search: null,
      });
      return data.evalTestCases as ExistingEvalTestCase[];
    },
    async createEvalTestCase(input) {
      await gqlMutate(ctx.client, CreateEvalTestCaseDoc, {
        tenantId: ctx.tenantId,
        input: evalInput(input),
      });
    },
    async updateEvalTestCase(id, input) {
      await gqlMutate(ctx.client, UpdateEvalTestCaseDoc, {
        id,
        input: evalInput(input),
      });
    },
    async putWorkspaceFile(input) {
      const response = await fetch(
        `${apiUrl.replace(/\/+$/, "")}/api/workspaces/files`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...auth.headers,
            "x-tenant-id": ctx.tenantId,
          },
          body: JSON.stringify({
            action: "put",
            path: input.path,
            content: input.content,
          }),
        },
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `PUT ${input.path} failed: ${response.status} ${text || response.statusText}`,
        );
      }
    },
  };
}

function evalInput(input: CustomerEvalSeed) {
  return {
    name: input.name,
    category: input.category,
    query: input.query,
    systemPrompt: input.systemPrompt ?? null,
    agentTemplateId: input.agentTemplateId ?? null,
    assertions: input.assertions,
    agentcoreEvaluatorIds: input.agentcoreEvaluatorIds ?? [],
    tags: input.tags ?? [],
    enabled: input.enabled ?? true,
  };
}

function publicPlan(plan: EnterpriseOverlayPlan) {
  return {
    stage: plan.stage,
    tenantSlug: plan.tenantSlug,
    targetTemplateSlug: plan.targetTemplateSlug,
    operations: plan.operations.map((operation) => {
      if (operation.kind === "eval-pack") {
        return {
          kind: operation.kind,
          pack: operation.pack,
          testCases: operation.testCases.length,
        };
      }
      if (operation.kind === "workspace-file-pack") {
        return {
          kind: operation.kind,
          family: operation.family,
          pack: operation.pack,
          targetTemplateSlug: operation.targetTemplateSlug,
          files: operation.files.length,
        };
      }
      if (operation.kind === "seed-pack") {
        return {
          kind: operation.kind,
          pack: operation.pack,
          status: "validated",
        };
      }
      return { kind: operation.kind, status: "recorded" };
    }),
  };
}

function resolveOverlayStage(opts: OverlayOptions): string {
  const stage = opts.stage ?? process.env.STAGE;
  if (!stage) {
    throw new Error("Deployment stage is required. Pass --stage or set STAGE.");
  }
  return stage;
}

export type { OverlayApplyResult };

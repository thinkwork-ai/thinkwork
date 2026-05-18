import {
  collectOverlayFiles,
  loadEnterpriseOverlayDefinition,
  readCustomerEvalPack,
  readJsonSeedPack,
  stageOverlay,
  type CustomerEvalSeed,
  type EnterpriseOverlayStage,
  type OverlayFile,
} from "./overlay-schema.js";

export type OverlayOperation =
  | {
      kind: "eval-pack";
      pack: string;
      testCases: CustomerEvalSeed[];
    }
  | {
      kind: "workspace-file-pack";
      family: "skills" | "workspace-defaults";
      pack: string;
      targetTemplateSlug: string;
      files: OverlayFile[];
    }
  | {
      kind: "seed-pack";
      pack: string;
      payload: unknown;
    }
  | {
      kind: "branding";
      branding: Record<string, unknown>;
    };

export interface EnterpriseOverlayPlan {
  repoRoot: string;
  stage: string;
  tenantSlug: string;
  targetTemplateSlug: string;
  operations: OverlayOperation[];
}

export interface OverlayApplyResult {
  stage: string;
  tenantSlug: string;
  evals: {
    inserted: number;
    updated: number;
    skipped: number;
    packs: Array<{
      pack: string;
      inserted: number;
      updated: number;
      skipped: number;
    }>;
  };
  workspaceFiles: {
    written: number;
    packs: Array<{ family: string; pack: string; written: number }>;
  };
  seeds: {
    validated: number;
    packs: string[];
  };
  branding: "recorded" | "not-configured";
}

export interface ExistingEvalTestCase {
  id: string;
  name: string;
  category: string;
  query: string;
  systemPrompt?: string | null;
  assertions?: unknown;
  agentcoreEvaluatorIds?: string[];
  tags?: string[];
  enabled?: boolean;
  source?: string;
}

export interface OverlayApiClient {
  targetAgentTemplateId: string;
  listEvalTestCases(): Promise<ExistingEvalTestCase[]>;
  createEvalTestCase(input: CustomerEvalSeed): Promise<void>;
  updateEvalTestCase(id: string, input: CustomerEvalSeed): Promise<void>;
  putWorkspaceFile(input: {
    templateSlug: string;
    path: string;
    content: string;
  }): Promise<void>;
}

export function buildEnterpriseOverlayPlan(options: {
  repoRoot: string;
  stage: string;
}): EnterpriseOverlayPlan {
  const definition = loadEnterpriseOverlayDefinition(options.repoRoot);
  const stage = stageOverlay(definition, options.stage);
  return {
    repoRoot: options.repoRoot,
    stage: options.stage,
    tenantSlug: stage.tenantSlug,
    targetTemplateSlug: stage.defaultAgentTemplateSlug,
    operations: [
      ...evalOperations(options.repoRoot, stage),
      ...workspaceFileOperations(options.repoRoot, stage),
      ...seedOperations(options.repoRoot, stage),
      ...(stage.branding
        ? [{ kind: "branding" as const, branding: stage.branding }]
        : []),
    ],
  };
}

export async function applyEnterpriseOverlay(
  plan: EnterpriseOverlayPlan,
  client: OverlayApiClient,
): Promise<OverlayApplyResult> {
  const result: OverlayApplyResult = {
    stage: plan.stage,
    tenantSlug: plan.tenantSlug,
    evals: { inserted: 0, updated: 0, skipped: 0, packs: [] },
    workspaceFiles: { written: 0, packs: [] },
    seeds: { validated: 0, packs: [] },
    branding: "not-configured",
  };

  const existing = await client.listEvalTestCases();
  const existingByOverlayKey = new Map(
    existing.flatMap((testCase) =>
      (testCase.tags ?? [])
        .filter((tag) => tag.startsWith("customer-overlay:key:"))
        .map((tag) => [tag, testCase] as const),
    ),
  );

  for (const operation of plan.operations) {
    if (operation.kind === "eval-pack") {
      const packResult = {
        pack: operation.pack,
        inserted: 0,
        updated: 0,
        skipped: 0,
      };
      for (const testCase of operation.testCases) {
        const input = withOverlayTags(
          operation.pack,
          testCase,
          client.targetAgentTemplateId,
        );
        const existingCase = existingByOverlayKey.get(
          overlayKeyTag(operation.pack, testCase),
        );
        if (existingCase) {
          if (sameEval(existingCase, input)) {
            result.evals.skipped++;
            packResult.skipped++;
          } else {
            await client.updateEvalTestCase(existingCase.id, input);
            result.evals.updated++;
            packResult.updated++;
          }
        } else {
          await client.createEvalTestCase(input);
          result.evals.inserted++;
          packResult.inserted++;
        }
      }
      result.evals.packs.push(packResult);
      continue;
    }

    if (operation.kind === "workspace-file-pack") {
      for (const file of operation.files) {
        await client.putWorkspaceFile({
          templateSlug: operation.targetTemplateSlug,
          path: workspaceTargetPath(
            operation.family,
            operation.pack,
            file.relativePath,
          ),
          content: file.content,
        });
        result.workspaceFiles.written++;
      }
      result.workspaceFiles.packs.push({
        family: operation.family,
        pack: operation.pack,
        written: operation.files.length,
      });
      continue;
    }

    if (operation.kind === "seed-pack") {
      result.seeds.validated++;
      result.seeds.packs.push(operation.pack);
      continue;
    }

    if (operation.kind === "branding") {
      result.branding = "recorded";
    }
  }

  return result;
}

function evalOperations(
  repoRoot: string,
  stage: EnterpriseOverlayStage,
): OverlayOperation[] {
  return stage.evalPacks.map((pack) => ({
    kind: "eval-pack",
    pack,
    testCases: readCustomerEvalPack(repoRoot, pack),
  }));
}

function workspaceFileOperations(
  repoRoot: string,
  stage: EnterpriseOverlayStage,
): OverlayOperation[] {
  return [
    ...stage.skillPacks.map((pack) => ({
      kind: "workspace-file-pack" as const,
      family: "skills" as const,
      pack,
      targetTemplateSlug: stage.defaultAgentTemplateSlug,
      files: collectOverlayFiles(repoRoot, "skills", pack),
    })),
    ...stage.workspaceDefaultPacks.map((pack) => ({
      kind: "workspace-file-pack" as const,
      family: "workspace-defaults" as const,
      pack,
      targetTemplateSlug: stage.defaultAgentTemplateSlug,
      files: collectOverlayFiles(repoRoot, "workspace-defaults", pack),
    })),
  ];
}

function seedOperations(
  repoRoot: string,
  stage: EnterpriseOverlayStage,
): OverlayOperation[] {
  return stage.seedPacks.map((pack) => ({
    kind: "seed-pack",
    pack,
    payload: readJsonSeedPack(repoRoot, pack),
  }));
}

function workspaceTargetPath(
  family: "skills" | "workspace-defaults",
  pack: string,
  relativePath: string,
): string {
  if (family === "skills") return `skills/${pack}/${relativePath}`;
  return relativePath;
}

function withOverlayTags(
  pack: string,
  testCase: CustomerEvalSeed,
  defaultAgentTemplateId: string,
): CustomerEvalSeed {
  return {
    ...testCase,
    agentTemplateId: testCase.agentTemplateId ?? defaultAgentTemplateId,
    tags: Array.from(
      new Set([
        ...(testCase.tags ?? []),
        "source:customer-overlay",
        `customer-overlay:pack:${pack}`,
        overlayKeyTag(pack, testCase),
      ]),
    ),
  };
}

function overlayKeyTag(
  pack: string,
  testCase: Pick<CustomerEvalSeed, "name">,
): string {
  return `customer-overlay:key:${pack}/${slugify(testCase.name)}`;
}

function sameEval(
  existing: ExistingEvalTestCase,
  next: CustomerEvalSeed,
): boolean {
  return (
    existing.name === next.name &&
    existing.category === next.category &&
    existing.query === next.query &&
    (existing.systemPrompt ?? null) === (next.systemPrompt ?? null) &&
    JSON.stringify(existing.assertions ?? []) ===
      JSON.stringify(next.assertions ?? []) &&
    JSON.stringify(existing.agentcoreEvaluatorIds ?? []) ===
      JSON.stringify(next.agentcoreEvaluatorIds ?? []) &&
    JSON.stringify(existing.tags ?? []) === JSON.stringify(next.tags ?? []) &&
    (existing.enabled ?? true) === (next.enabled ?? true)
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

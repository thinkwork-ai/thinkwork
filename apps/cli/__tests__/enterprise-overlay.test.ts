import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyEnterpriseOverlay,
  buildEnterpriseOverlayPlan,
  type OverlayApiClient,
} from "../src/commands/enterprise/overlay-apply.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "thinkwork-enterprise-overlay-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "customer", "evals"), { recursive: true });
  mkdirSync(join(dir, "customer", "skills", "support-skill"), {
    recursive: true,
  });
  mkdirSync(join(dir, "customer", "workspace-defaults", "default-guardrails"), {
    recursive: true,
  });
  mkdirSync(join(dir, "customer", "seeds"), { recursive: true });
  writeJson(join(dir, "customer", "deployment.json"), {
    schemaVersion: 1,
    customerSlug: "acme",
    stages: {
      dev: {
        tenantSlug: "acme-dev",
        defaultAgentTemplateSlug: "default",
        evalPacks: ["support"],
        seedPacks: ["starter"],
        skillPacks: ["support-skill"],
        workspaceDefaultPacks: ["default-guardrails"],
        branding: { logo: "branding/logo.svg" },
      },
    },
  });
  writeJson(join(dir, "customer", "evals", "support.json"), [
    {
      name: "Answers with policy context",
      category: "support-quality",
      query: "How should we handle a refund?",
      assertions: [{ type: "contains", value: "policy" }],
      agentcoreEvaluatorIds: ["Builtin.Helpfulness"],
      tags: ["support"],
    },
  ]);
  writeFileSync(
    join(dir, "customer", "skills", "support-skill", "SKILL.md"),
    "---\nname: support-skill\ndescription: Support skill\n---\n",
  );
  writeFileSync(
    join(
      dir,
      "customer",
      "workspace-defaults",
      "default-guardrails",
      "GUARDRAILS.md",
    ),
    "# Customer Guardrails\n",
  );
  writeJson(join(dir, "customer", "seeds", "starter.json"), {
    tenants: [],
  });
  return dir;
}

describe("enterprise customer overlay", () => {
  it("validates customer overlay packs and produces a deterministic apply plan", () => {
    const root = tempRepo();
    const plan = buildEnterpriseOverlayPlan({ repoRoot: root, stage: "dev" });

    expect(plan.tenantSlug).toBe("acme-dev");
    expect(plan.targetTemplateSlug).toBe("default");
    expect(plan.operations.map((operation) => operation.kind)).toEqual([
      "eval-pack",
      "workspace-file-pack",
      "workspace-file-pack",
      "seed-pack",
      "branding",
    ]);
    expect(plan.operations[0]).toMatchObject({
      kind: "eval-pack",
      pack: "support",
      testCases: [{ name: "Answers with policy context" }],
    });
  });

  it("applies evals and workspace files idempotently", async () => {
    const root = tempRepo();
    const plan = buildEnterpriseOverlayPlan({ repoRoot: root, stage: "dev" });
    const client = fakeClient();

    const first = await applyEnterpriseOverlay(plan, client);
    const second = await applyEnterpriseOverlay(plan, client);

    expect(first.evals).toMatchObject({ inserted: 1, updated: 0, skipped: 0 });
    expect(second.evals).toMatchObject({ inserted: 0, updated: 0, skipped: 1 });
    expect(first.workspaceFiles.written).toBe(2);
    expect(second.workspaceFiles.written).toBe(2);
    expect(client.putWorkspaceFile).toHaveBeenCalledWith(
      expect.objectContaining({
        templateSlug: "default",
        path: "skills/support-skill/SKILL.md",
      }),
    );
    expect(client.createEvalTestCase).toHaveBeenCalledWith(
      expect.objectContaining({
        agentTemplateId: "template-default",
      }),
    );
  });

  it("fails invalid eval JSON before API calls", async () => {
    const root = tempRepo();
    writeJson(join(root, "customer", "evals", "support.json"), [
      { name: "Broken", assertions: [] },
    ]);
    const client = fakeClient();

    expect(() =>
      buildEnterpriseOverlayPlan({ repoRoot: root, stage: "dev" }),
    ).toThrow(/category is required/);
    expect(client.createEvalTestCase).not.toHaveBeenCalled();
    expect(client.putWorkspaceFile).not.toHaveBeenCalled();
  });
});

function fakeClient(): OverlayApiClient & {
  putWorkspaceFile: ReturnType<typeof vi.fn>;
  createEvalTestCase: ReturnType<typeof vi.fn>;
} {
  const evals: any[] = [];
  return {
    targetAgentTemplateId: "template-default",
    listEvalTestCases: vi.fn(async () => evals),
    createEvalTestCase: vi.fn(async (input) => {
      evals.push({ id: `eval-${evals.length + 1}`, ...input });
    }),
    updateEvalTestCase: vi.fn(async (id, input) => {
      const index = evals.findIndex((item) => item.id === id);
      evals[index] = { id, ...input };
    }),
    putWorkspaceFile: vi.fn(async () => {}),
  };
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

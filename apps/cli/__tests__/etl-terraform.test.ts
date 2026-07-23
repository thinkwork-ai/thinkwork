import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  TWIN_STACK_ORDER,
  buildInitArgs,
  buildPlanArgs,
  buildShowArgs,
  buildApplyArgs,
  classifyPlanActions,
  gatePlan,
  parseNeptuneOutputs,
  resolveEtlLayout,
  runEtlTwinStacks,
  type EtlExec,
  type EtlExecResult,
} from "../src/lib/etl-terraform.js";

function makeEtlRepo(
  opts: { skipStacks?: string[]; slug?: string } = {},
): string {
  const slug = opts.slug ?? "tei";
  const repo = mkdtempSync(join(tmpdir(), "etl-repo-"));
  const infra = join(repo, "etl-platform", "infrastructure");
  for (const stack of TWIN_STACK_ORDER) {
    mkdirSync(join(infra, "stacks", stack), { recursive: true });
  }
  mkdirSync(join(infra, "accounts"), { recursive: true });
  writeFileSync(
    join(infra, "accounts", `${slug}.backend.hcl`),
    'bucket = "b"\n',
  );
  writeFileSync(
    join(infra, "accounts", `${slug}.tfvars`),
    'vpc_id = "vpc-1"\n',
  );
  if (opts.skipStacks) {
    writeFileSync(
      join(infra, "accounts", `${slug}.skip-stacks`),
      opts.skipStacks.join("\n") + "\n",
    );
  }
  return repo;
}

const NO_CHANGES: EtlExecResult = { status: 0, stdout: "", stderr: "" };

describe("argument construction (KTD-2)", () => {
  it("init uses -chdir, -reconfigure and the account backend config", () => {
    expect(
      buildInitArgs("/etl/stacks/neptune", "/etl/accounts/tei.backend.hcl"),
    ).toEqual([
      "-chdir=/etl/stacks/neptune",
      "init",
      "-input=false",
      "-reconfigure",
      "-backend-config=/etl/accounts/tei.backend.hcl",
    ]);
  });

  it("plan uses -detailed-exitcode, the account var-file, and a plan out-file", () => {
    const args = buildPlanArgs(
      "/etl/stacks/neptune",
      "/etl/accounts/tei.tfvars",
      "/tmp/p.tfplan",
    );
    expect(args).toContain("-detailed-exitcode");
    expect(args).toContain("-var-file=/etl/accounts/tei.tfvars");
    expect(args).toContain("-out=/tmp/p.tfplan");
  });

  it("apply applies the saved plan file, never re-plans", () => {
    expect(buildApplyArgs("/s", "/tmp/p.tfplan")).toEqual([
      "-chdir=/s",
      "apply",
      "-input=false",
      "/tmp/p.tfplan",
    ]);
  });

  it("ordering matches the declared twin dependency order", () => {
    expect([...TWIN_STACK_ORDER]).toEqual([
      "aurora",
      "data-lake",
      "landing",
      "query-router",
      "dagster",
      "neptune",
    ]);
  });
});

describe("resolveEtlLayout", () => {
  it("resolves a valid account and honors skip-stacks", () => {
    const repo = makeEtlRepo({ skipStacks: ["neptune"] });
    const probe = resolveEtlLayout(repo, "tei");
    expect(probe.problems).toEqual([]);
    expect(probe.layout!.stacks).not.toContain("neptune");
    expect(probe.layout!.stacks).toContain("dagster");
  });

  it("fails loudly when the account files are missing", () => {
    const repo = makeEtlRepo();
    const probe = resolveEtlLayout(repo, "acme");
    expect(probe.layout).toBeNull();
    expect(probe.problems.join(" ")).toMatch(/acme/);
    expect(probe.problems.join(" ")).toMatch(/backend/);
  });
});

describe("plan gate (R4)", () => {
  const show = (changes: Array<{ address: string; actions: string[] }>) =>
    JSON.stringify({
      resource_changes: changes.map((c) => ({
        address: c.address,
        change: { actions: c.actions },
      })),
    });

  it("classifies create/update/delete/replace", () => {
    const s = classifyPlanActions(
      show([
        { address: "a.one", actions: ["create"] },
        { address: "a.two", actions: ["update"] },
        { address: "a.three", actions: ["delete"] },
        { address: "a.four", actions: ["delete", "create"] },
        { address: "a.five", actions: ["no-op"] },
      ]),
    );
    expect(s.creates).toEqual(["a.one"]);
    expect(s.updates).toEqual(["a.two"]);
    expect(s.deletes).toEqual(["a.three"]);
    expect(s.replaces).toEqual(["a.four"]);
  });

  it("destructive plans abort even with --allow-changes", () => {
    const s = classifyPlanActions(
      show([{ address: "a.x", actions: ["delete"] }]),
    );
    const v = gatePlan(s, true);
    expect(v.kind).toBe("abort");
    if (v.kind === "abort") expect(v.reason).toMatch(/never destroys/);
  });

  it("updates require --allow-changes", () => {
    const s = classifyPlanActions(
      show([{ address: "a.x", actions: ["update"] }]),
    );
    expect(gatePlan(s, false).kind).toBe("abort");
    expect(gatePlan(s, true).kind).toBe("apply");
  });

  it("pure creates apply without the flag; no-op plans no-op", () => {
    const creates = classifyPlanActions(
      show([{ address: "a.x", actions: ["create"] }]),
    );
    expect(gatePlan(creates, false).kind).toBe("apply");
    const none = classifyPlanActions(show([]));
    expect(gatePlan(none, false).kind).toBe("no-op");
  });
});

describe("parseNeptuneOutputs", () => {
  it("captures the three product-side values", () => {
    const json = JSON.stringify({
      cluster_endpoint: { value: "neptune.example:8182" },
      cluster_resource_id: { value: "cluster-ABC" },
      client_sg_id: { value: "sg-123" },
      reader_endpoint: { value: "r.example" },
    });
    const { outputs, missing } = parseNeptuneOutputs(json);
    expect(missing).toEqual([]);
    expect(outputs).toEqual({
      neptuneEndpoint: "neptune.example:8182",
      clusterResourceId: "cluster-ABC",
      clientSgId: "sg-123",
    });
  });

  it("missing output fails naming the output", () => {
    const { outputs, missing } = parseNeptuneOutputs(
      JSON.stringify({ cluster_endpoint: { value: "x" } }),
    );
    expect(outputs).toBeNull();
    expect(missing).toContain("cluster_resource_id");
    expect(missing).toContain("client_sg_id");
  });
});

describe("runEtlTwinStacks", () => {
  const NEPTUNE_OUT = JSON.stringify({
    cluster_endpoint: { value: "ep:8182" },
    cluster_resource_id: { value: "rid" },
    client_sg_id: { value: "sg-1" },
  });

  function scriptedExec(script: {
    planStatus?: (stack: string) => number;
    onCall?: (args: string[]) => void;
  }): EtlExec {
    return (args) => {
      script.onCall?.(args);
      const verb = args[1];
      const stack = args[0].split("/").pop()!;
      if (verb === "init") return NO_CHANGES;
      if (verb === "plan") {
        return {
          status: script.planStatus?.(stack) ?? 0,
          stdout: "",
          stderr: "",
        };
      }
      if (verb === "show") {
        return {
          status: 0,
          stdout: JSON.stringify({
            resource_changes: [
              { address: "r.x", change: { actions: ["create"] } },
            ],
          }),
          stderr: "",
        };
      }
      if (verb === "apply") return NO_CHANGES;
      if (verb === "output")
        return { status: 0, stdout: NEPTUNE_OUT, stderr: "" };
      return NO_CHANGES;
    };
  }

  it("all-no-change run reports every stack as found and captures outputs", () => {
    const repo = makeEtlRepo();
    const result = runEtlTwinStacks({
      etlRepoDir: repo,
      accountSlug: "tei",
      dryRun: false,
      allowChanges: false,
      exec: scriptedExec({}),
    });
    expect(result.failed).toBe(false);
    expect(result.entries.map((e) => e.state)).toEqual([
      "found",
      "found",
      "found",
      "found",
      "found",
      "found",
    ]);
    expect(result.neptuneOutputs).toEqual({
      neptuneEndpoint: "ep:8182",
      clusterResourceId: "rid",
      clientSgId: "sg-1",
    });
  });

  it("--dry-run plans but never applies (argv assertion)", () => {
    const repo = makeEtlRepo();
    const verbs: string[] = [];
    const result = runEtlTwinStacks({
      etlRepoDir: repo,
      accountSlug: "tei",
      dryRun: true,
      allowChanges: false,
      exec: scriptedExec({
        planStatus: () => 2,
        onCall: (args) => verbs.push(args[1]),
      }),
    });
    expect(result.failed).toBe(false);
    expect(verbs).toContain("plan");
    expect(verbs).not.toContain("apply");
    expect(result.entries.every((e) => e.state === "planned")).toBe(true);
  });

  it("a failing stack stops the sequence and reports completed vs remaining (R3)", () => {
    const repo = makeEtlRepo();
    const result = runEtlTwinStacks({
      etlRepoDir: repo,
      accountSlug: "tei",
      dryRun: false,
      allowChanges: false,
      exec: scriptedExec({
        planStatus: (stack) => (stack === "landing" ? 1 : 0),
      }),
    });
    expect(result.failed).toBe(true);
    expect(result.entries.map((e) => e.stack)).toEqual([
      "aurora",
      "data-lake",
      "landing",
    ]);
    expect(result.entries.at(-1)!.state).toBe("failed");
    expect(result.notAttempted).toEqual(["query-router", "dagster", "neptune"]);
  });

  it("missing account files fail before any terraform call", () => {
    const repo = makeEtlRepo();
    let called = 0;
    const result = runEtlTwinStacks({
      etlRepoDir: repo,
      accountSlug: "nope",
      dryRun: false,
      allowChanges: false,
      exec: (() => {
        called++;
        return NO_CHANGES;
      }) as EtlExec,
    });
    expect(result.failed).toBe(true);
    expect(called).toBe(0);
  });
});

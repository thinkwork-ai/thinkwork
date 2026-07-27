import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

/**
 * `plan_only` runs the real Terraform Apply job and stops at the plan.
 *
 * It exists because the plan is the only correctness proof for state-moving
 * Terraform changes — a `moved`-block rename over shared VPC infrastructure
 * should show zero creates and zero destroys, and recreating an interface
 * endpoint instead is a live Bedrock outage for everything in the VPC. That
 * distinction is invisible in a diff.
 *
 * A standalone plan-only workflow was the obvious shape and was wrong: the
 * variable set depends on job steps that write to AWS, so a read-only
 * workflow could not reproduce them (`TWENTY_PROVISIONED: unbound variable`).
 * Running the genuine job is what makes the plan trustworthy — which in turn
 * means the mode's safety rests entirely on guards rather than on isolation.
 * This pins those guards.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

type Step = { name?: string; if?: string; run?: string; uses?: string };
type Job = { if?: string; env?: Record<string, string>; steps?: Step[] };

const deploy = parse(
  readFileSync(path.join(REPO_ROOT, ".github/workflows/deploy.yml"), "utf8"),
) as {
  on: { workflow_dispatch: { inputs: Record<string, unknown> } };
  jobs: Record<string, Job>;
};

const applyJob = deploy.jobs["terraform-apply"];
const applyStep = applyJob.steps?.find((s) => s.name === "Terraform Apply");
if (!applyStep?.run) throw new Error("missing Terraform Apply step");

test("plan_only is a declared dispatch input", () => {
  assert.ok(deploy.on.workflow_dispatch.inputs.plan_only);
  // Resolved once at job level so every guard reads the same value.
  assert.match(String(applyJob.env?.PLAN_ONLY ?? ""), /inputs\.plan_only/);
});

test("every mutating step in the apply job is guarded", () => {
  // These write to Aurora, Secrets Manager, or S3 before Terraform runs.
  // A plan-only run that executes any of them is not read-only.
  const MUTATING = [
    "Backfill agents.runtime flue to pi",
    "Backfill thread_participants from senders (plan 2026-07-03-003 U2)",
    "Add threads.session_data column (plan §005 U4)",
    "Apply native checklist linked task constraints",
    "Apply Agent Profile message mention constraint",
    "Apply native Work Items schema",
    "Apply eval schema prerequisites",
    "Migrate Data Integrations plugin state to Company ETL",
    "Prepare Twenty CRM runtime secrets and database",
    "Empty retired admin static site bucket",
    "Reconcile Cognito-native auth metadata",
    "Restart Twenty CRM runtime after database prep",
    "Destroy Twenty CRM retained data",
  ];

  for (const name of MUTATING) {
    const step = applyJob.steps?.find((s) => s.name === name);
    assert.ok(
      step,
      `missing step "${name}" — renamed steps silently lose their guard`,
    );
    assert.equal(
      step.if,
      "env.PLAN_ONLY != 'true'",
      `step "${name}" is not guarded`,
    );
  }
});

test("the apply step stops before applying", () => {
  const run = applyStep.run!;
  const exitIndex = run.indexOf('if [ "$PLAN_ONLY" = "true" ]');
  const applyIndex = run.indexOf(
    'terraform apply -auto-approve -lock-timeout=10m "$plan_file"',
  );

  assert.ok(exitIndex > 0, "no plan-only exit branch");
  assert.ok(applyIndex > 0, "no full apply");
  assert.ok(
    exitIndex < applyIndex,
    "the plan-only exit must precede the apply",
  );

  // In-step state mutation: the greenfield DB bootstrap runs a targeted
  // apply, and the route reconciliation runs `terraform import` / `state rm`.
  for (const guarded of ["terraform import", "terraform state rm", "psql "]) {
    assert.ok(run.includes(guarded), `expected ${guarded} in the step`);
  }
  assert.equal(
    (run.match(/if \[ "\$PLAN_ONLY" != "true" \]; then/g) ?? []).length,
    3,
    "expected guards around the native-auth bootstrap, the route imports, and the destructive refusal",
  );
});

test("surfacing deletes is not blocked by the destructive-apply refusal", () => {
  // The refusal protects auto-apply. Under plan_only there is nothing to
  // refuse, and the deletes are the output being asked for.
  assert.match(
    applyStep.run!,
    /if \[ "\$PLAN_ONLY" != "true" \] && \[ "\$allow_destructive" != "true" \]; then/,
  );
});

test("no downstream job deploys under plan_only", () => {
  // build-lambdas is deliberately absent: it only produces zips, which the
  // plan needs for filebase64sha256. Everything else touches AWS.
  const DEPLOYING = [
    "build-container",
    "sync-twenty-thinkwork-app",
    "wire-twenty-thinkwork-workflow",
    "update-agentcore-runtimes",
    "compliance-bootstrap",
    "migration-drift-check",
    "build-web",
    "build-docs",
    "bootstrap",
    "workspace-layout-migration",
  ];

  for (const name of DEPLOYING) {
    const job = deploy.jobs[name];
    assert.ok(job, `missing job "${name}"`);
    assert.match(
      String(job.if ?? ""),
      /!\(github\.event_name == 'workflow_dispatch' && inputs\.plan_only == true\)/,
      `job "${name}" runs under plan_only`,
    );
  }
});

test("variable construction is shared, not forked", () => {
  assert.ok(applyStep.run!.includes("scripts/deploy/terraform-vars.sh"));
  assert.ok(
    !applyStep.run!.includes("TF_VAR_ARGS=("),
    "the step reintroduced its own variable array",
  );
});

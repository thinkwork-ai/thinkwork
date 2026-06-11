import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const LAMBDA_API_IAM_GROUPED = resolve(
  REPO_ROOT,
  "terraform/modules/app/lambda-api/iam-grouped.tf",
);
const LAMBDA_API_HANDLERS = resolve(
  REPO_ROOT,
  "terraform/modules/app/lambda-api/handlers.tf",
);

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Requester memory Terraform wiring", () => {
  it("allows job-trigger to invoke the idle-learning worker Lambda", () => {
    // R9 (plan 2026-06-11-006 U6): the former standalone
    // thread_idle_memory_learning_invoke managed policy was absorbed into
    // the grouped api-orchestration policy in iam-grouped.tf.
    const source = read(LAMBDA_API_IAM_GROUPED);

    expect(source).toMatch(/resource "aws_iam_policy" "api_orchestration"/);
    expect(source).toMatch(
      /resource "aws_iam_role_policy_attachment" "api_orchestration"/,
    );
    expect(source).toContain(
      "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-thread-idle-memory-learning",
    );
  });

  it("derives the idle-learning worker function name in job-trigger instead of storing it", () => {
    // Plan 2026-06-11-006 U6 (R7): job-trigger's runtimeFunctionName()
    // computes thinkwork-<stage>-api-thread-idle-memory-learning from
    // STAGE at call time — the env wiring was deleted with the 4KB
    // env-ceiling migration, so handlers.tf must NOT reintroduce it.
    const source = read(LAMBDA_API_HANDLERS);
    expect(source).not.toContain("THREAD_IDLE_MEMORY_LEARNING_FUNCTION_NAME");

    const jobTrigger = read(
      resolve(REPO_ROOT, "packages/lambda/job-trigger.ts"),
    );
    expect(jobTrigger).toContain('"THREAD_IDLE_MEMORY_LEARNING_FUNCTION_NAME"');
    expect(jobTrigger).toContain('"thread-idle-memory-learning"');
  });
});

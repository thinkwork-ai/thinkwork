import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const LAMBDA_API_MAIN = resolve(
  REPO_ROOT,
  "terraform/modules/app/lambda-api/main.tf",
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
    const source = read(LAMBDA_API_MAIN);

    expect(source).toMatch(
      /resource "aws_iam_policy" "thread_idle_memory_learning_invoke"/,
    );
    expect(source).toMatch(
      /resource "aws_iam_role_policy_attachment" "lambda_thread_idle_memory_learning_invoke"/,
    );
    expect(source).toContain(
      "thinkwork-${var.stage}-thread-idle-memory-learning-invoke",
    );
    expect(source).toContain(
      "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-thread-idle-memory-learning",
    );
  });

  it("passes the idle-learning worker function name to job-trigger", () => {
    const source = read(LAMBDA_API_HANDLERS);

    expect(source).toMatch(/"job-trigger" = \{/);
    expect(source).toContain(
      'THREAD_IDLE_MEMORY_LEARNING_FUNCTION_NAME = "thinkwork-${var.stage}-api-thread-idle-memory-learning"',
    );
  });
});

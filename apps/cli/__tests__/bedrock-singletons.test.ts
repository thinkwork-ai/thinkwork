import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBedrockLoggingPin } from "../src/commands/deploy.js";

/**
 * Harness cycle-5 ledger entries: two account/region-singleton collisions.
 *
 * 1. The Bedrock model-invocation log group + account logging configuration
 *    may be managed by exactly ONE stage per account+region — the second
 *    stack's create collides, and its destroy would remove the account-level
 *    config out from under the managing stage.
 * 2. skill-trust-runner's container image is CI-seeded only; releases publish
 *    no image for it, so scaffolded installs must not deploy that Lambda.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..");

describe("resolveBedrockLoggingPin", () => {
  it("pins true when no other stage owns the log group", () => {
    expect(resolveBedrockLoggingPin({}, false)).toBe("true");
  });

  it("pins false when the log group already exists in the account", () => {
    expect(resolveBedrockLoggingPin({}, true)).toBe("false");
  });

  it("never flips an existing pin (reruns see their own log group)", () => {
    expect(
      resolveBedrockLoggingPin(
        { manage_bedrock_invocation_logging: "true" },
        true,
      ),
    ).toBeNull();
    expect(
      resolveBedrockLoggingPin(
        { manage_bedrock_invocation_logging: "false" },
        false,
      ),
    ).toBeNull();
  });
});

describe("account-singleton terraform gating (fixtures)", () => {
  const handlers = readFileSync(
    join(REPO_ROOT, "terraform", "modules", "app", "lambda-api", "handlers.tf"),
    "utf8",
  );
  const thinkworkMain = readFileSync(
    join(REPO_ROOT, "terraform", "modules", "thinkwork", "main.tf"),
    "utf8",
  );
  const initSource = readFileSync(
    join(__dirname, "..", "src", "commands", "init.ts"),
    "utf8",
  );

  it("every bedrock invocation-logging resource is gated on the manage flag", () => {
    for (const marker of [
      'resource "aws_cloudwatch_log_group" "bedrock_model_invocations"',
      'resource "aws_iam_role" "bedrock_model_invocation_logging"',
      'resource "aws_iam_role_policy" "bedrock_model_invocation_logging"',
      'resource "aws_bedrock_model_invocation_logging_configuration" "this"',
    ]) {
      const start = handlers.indexOf(marker);
      expect(start, marker).toBeGreaterThan(-1);
      const block = handlers.slice(start, start + 300);
      expect(block, `${marker} must be count-gated`).toContain(
        "var.manage_bedrock_invocation_logging ? 1 : 0",
      );
    }
  });

  it("no reference to the log group remains un-indexed (count-gated resource)", () => {
    const unindexed = handlers
      .split("\n")
      .filter(
        (l) =>
          l.includes("aws_cloudwatch_log_group.bedrock_model_invocations") &&
          !l.includes("[0]") &&
          !l.includes("resource ") &&
          // moved-block `from` addresses are the pre-count names by design
          !l.trim().startsWith("from "),
      );
    expect(unindexed).toEqual([]);
  });

  it("thinkwork module threads both singleton gates", () => {
    expect(thinkworkMain).toContain(
      "ecr_repository_provisioned                    = var.skill_trust_runner_enabled",
    );
    expect(thinkworkMain).toContain(
      "manage_bedrock_invocation_logging             = var.manage_bedrock_invocation_logging",
    );
  });

  it("scaffold template disables skill-trust-runner and threads the logging pin", () => {
    expect(initSource).toContain("skill_trust_runner_enabled        = false");
    expect(initSource).toContain(
      "manage_bedrock_invocation_logging = var.manage_bedrock_invocation_logging",
    );
    expect(initSource).toContain(
      'variable "manage_bedrock_invocation_logging"',
    );
  });
});

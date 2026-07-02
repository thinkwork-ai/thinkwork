import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ExecResult,
  backendConfigArgs,
  backendMatches,
  backendResourceNames,
  backendTarget,
  detectLocalStateOrphanRisk,
  ensureStateBackend,
  parseLockError,
  readRecordedBackend,
} from "../src/lib/state-backend.js";

const ok: ExecResult = { status: 0, stdout: "", stderr: "" };
const missing: ExecResult = { status: 254, stdout: "", stderr: "Not Found" };

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "state-backend-test-"));
}

describe("backend naming and config", () => {
  it("scopes resource names to the account and the key to the stage", () => {
    const names = backendResourceNames("123456789012");
    expect(names.bucket).toBe("thinkwork-tfstate-123456789012");
    expect(names.lockTable).toBe("thinkwork-tflocks-123456789012");

    const target = backendTarget(
      "123456789012",
      "us-east-1",
      "hprod-260701-001",
    );
    expect(target.key).toBe("thinkwork/hprod-260701-001/terraform.tfstate");
  });

  it("produces complete -backend-config args including encryption", () => {
    const args = backendConfigArgs(
      backendTarget("123456789012", "us-west-2", "prod"),
    );
    expect(args).toContain(
      "-backend-config=bucket=thinkwork-tfstate-123456789012",
    );
    expect(args).toContain(
      "-backend-config=key=thinkwork/prod/terraform.tfstate",
    );
    expect(args).toContain("-backend-config=region=us-west-2");
    expect(args).toContain(
      "-backend-config=dynamodb_table=thinkwork-tflocks-123456789012",
    );
    expect(args).toContain("-backend-config=encrypt=true");
  });
});

describe("ensureStateBackend", () => {
  it("creates bucket + lock table with hardening on a fresh account", () => {
    const calls: string[][] = [];
    const exec = (args: string[]): ExecResult => {
      calls.push(args);
      if (args[1] === "head-bucket" || args[1] === "describe-table") {
        return missing;
      }
      return ok;
    };

    const result = ensureStateBackend(
      "123456789012",
      "us-east-1",
      "prod",
      exec,
    );
    expect(result.createdBucket).toBe(true);
    expect(result.createdLockTable).toBe(true);

    const invoked = calls.map((c) => c[1]);
    expect(invoked).toContain("create-bucket");
    expect(invoked).toContain("put-bucket-versioning");
    expect(invoked).toContain("put-bucket-encryption");
    expect(invoked).toContain("put-public-access-block");
    expect(invoked).toContain("put-bucket-lifecycle-configuration");
    expect(invoked).toContain("create-table");
    // us-east-1 must NOT pass a LocationConstraint.
    const createBucket = calls.find((c) => c[1] === "create-bucket")!;
    expect(createBucket).not.toContain("--create-bucket-configuration");
  });

  it("verifies without recreating when resources exist, still asserting hardening", () => {
    const calls: string[][] = [];
    const exec = (args: string[]): ExecResult => {
      calls.push(args);
      return ok; // everything exists
    };

    const result = ensureStateBackend(
      "123456789012",
      "us-west-2",
      "prod",
      exec,
    );
    expect(result.createdBucket).toBe(false);
    expect(result.createdLockTable).toBe(false);

    const invoked = calls.map((c) => c[1]);
    expect(invoked).not.toContain("create-bucket");
    expect(invoked).not.toContain("create-table");
    expect(invoked).toContain("put-bucket-versioning");
    expect(invoked).toContain("put-bucket-encryption");
  });

  it("passes LocationConstraint outside us-east-1 and throws on create failure", () => {
    const exec = (args: string[]): ExecResult => {
      if (args[1] === "head-bucket") return missing;
      if (args[1] === "create-bucket") {
        expect(args).toContain("--create-bucket-configuration");
        return { status: 1, stdout: "", stderr: "AccessDenied" };
      }
      return ok;
    };
    expect(() =>
      ensureStateBackend("123456789012", "eu-west-1", "prod", exec),
    ).toThrow(/AccessDenied/);
  });
});

describe("recorded backend comparison", () => {
  it("returns null for an uninitialized directory", () => {
    expect(readRecordedBackend(makeTmpDir())).toBeNull();
  });

  it("matches only when bucket, key, and lock table all agree", () => {
    const dir = makeTmpDir();
    mkdirSync(join(dir, ".terraform"));
    const target = backendTarget("123456789012", "us-east-1", "prod");
    writeFileSync(
      join(dir, ".terraform", "terraform.tfstate"),
      JSON.stringify({
        backend: {
          type: "s3",
          config: {
            bucket: target.bucket,
            key: target.key,
            region: "us-east-1",
            dynamodb_table: target.lockTable,
          },
        },
      }),
    );
    const recorded = readRecordedBackend(dir);
    expect(backendMatches(recorded, target)).toBe(true);
    expect(
      backendMatches(
        recorded,
        backendTarget("123456789012", "us-east-1", "other"),
      ),
    ).toBe(false);
  });
});

describe("local state orphan risk", () => {
  it("is false for a fresh directory and empty state", () => {
    const dir = makeTmpDir();
    expect(detectLocalStateOrphanRisk(dir)).toBe(false);
    writeFileSync(
      join(dir, "terraform.tfstate"),
      JSON.stringify({ resources: [] }),
    );
    expect(detectLocalStateOrphanRisk(dir)).toBe(false);
  });

  it("is true when local state (default or workspace) has resources", () => {
    const dir = makeTmpDir();
    writeFileSync(
      join(dir, "terraform.tfstate"),
      JSON.stringify({ resources: [{ type: "aws_s3_bucket" }] }),
    );
    expect(detectLocalStateOrphanRisk(dir)).toBe(true);

    const wsDir = makeTmpDir();
    mkdirSync(join(wsDir, "terraform.tfstate.d", "dev"), { recursive: true });
    writeFileSync(
      join(wsDir, "terraform.tfstate.d", "dev", "terraform.tfstate"),
      JSON.stringify({ resources: [{ type: "aws_db_instance" }] }),
    );
    expect(detectLocalStateOrphanRisk(wsDir)).toBe(true);
  });

  it("treats unparseable state as state worth protecting", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "terraform.tfstate"), "not json {{{");
    expect(detectLocalStateOrphanRisk(dir)).toBe(true);
  });
});

describe("parseLockError", () => {
  it("parses terraform's lock error fields", () => {
    const text = `
Error: Error acquiring the state lock

Lock Info:
  ID:        3d9f2b1a-1111-2222-3333-444455556666
  Path:      thinkwork-tfstate-123/thinkwork/prod/terraform.tfstate
  Operation: OperationTypeApply
  Who:       eric@host
  Version:   1.7.0
  Created:   2026-07-01 20:00:00 UTC
`;
    const lock = parseLockError(text);
    expect(lock).not.toBeNull();
    expect(lock!.id).toBe("3d9f2b1a-1111-2222-3333-444455556666");
    expect(lock!.who).toBe("eric@host");
    expect(lock!.operation).toBe("OperationTypeApply");
    expect(lock!.created).toBe("2026-07-01 20:00:00 UTC");
  });

  it("returns null for non-lock errors", () => {
    expect(
      parseLockError("Error: creating Lambda Function: AccessDenied"),
    ).toBeNull();
  });

  it("strips │-box decoration and never matches AWS RequestID lines (cycle-7)", () => {
    const text = `
│ Error: Error acquiring the state lock
│
│ ConditionalCheckFailedException: The conditional request failed
│ status code: 400, RequestID: P5TEVJVUAASR8TAE52HN87QUSBVV4KQNSO5AEMVJF66Q9ASUAAJG,
│ Lock Info:
│   ID:        0b70bfe5-0cf0-0839-4c03-f61890206d77
│   Operation: OperationTypeApply,
│   Who:       ericodom@Erics-Mac-mini.local,
`;
    const lock = parseLockError(text);
    expect(lock!.id).toBe("0b70bfe5-0cf0-0839-4c03-f61890206d77");
    expect(lock!.who).toBe("ericodom@Erics-Mac-mini.local");
    expect(lock!.operation).toBe("OperationTypeApply");
  });
});

// Regression: harness cycle-1 ledger entry — init copies examples/ into the
// scaffold, and resolveTierDir must prefer the flat tfvars layout over the
// bundled greenfield example (which the npm bundler ships without tfvars).
import { resolveTierDir } from "../src/terraform.js";

describe("resolveTierDir precedence (harness cycle-1 regression)", () => {
  it("prefers the flat scaffolded layout over the bundled greenfield example", () => {
    const dir = makeTmpDir();
    mkdirSync(join(dir, "examples", "greenfield"), { recursive: true });
    writeFileSync(join(dir, "examples", "greenfield", "main.tf"), "");
    writeFileSync(join(dir, "main.tf"), "");
    writeFileSync(join(dir, "terraform.tfvars"), 'stage = "x"');
    expect(resolveTierDir(dir, "x", "app")).toBe(dir);
  });

  it("still resolves greenfield for the repo layout (no flat tfvars pair)", () => {
    const dir = makeTmpDir();
    mkdirSync(join(dir, "examples", "greenfield"), { recursive: true });
    writeFileSync(join(dir, "examples", "greenfield", "main.tf"), "");
    expect(resolveTierDir(dir, "x", "app")).toBe(
      join(dir, "examples", "greenfield"),
    );
  });
});

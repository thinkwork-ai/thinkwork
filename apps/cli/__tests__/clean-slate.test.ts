import { describe, expect, it } from "vitest";
import {
  deleteStageLogGroups,
  disableClusterDeletionProtection,
  emptyBucket,
  forceDeleteStageSecrets,
  listStageBuckets,
  orphanCount,
  scanOrphans,
} from "../src/lib/clean-slate.js";
import type { ExecResult } from "../src/lib/state-backend.js";

const ok = (stdout = ""): ExecResult => ({ status: 0, stdout, stderr: "" });

describe("emptyBucket", () => {
  it("sequences rm → version listing → batch delete until empty", () => {
    const calls: string[][] = [];
    let listCount = 0;
    const exec = (args: string[]): ExecResult => {
      calls.push(args);
      if (args[1] === "list-object-versions") {
        listCount += 1;
        // First listing has versions; second is empty.
        return ok(
          JSON.stringify({
            Objects: listCount === 1 ? [{ Key: "a", VersionId: "v1" }] : [],
          }),
        );
      }
      return ok();
    };
    const result = emptyBucket("thinkwork-hprod-1-storage", exec);
    expect(result.emptied).toBe(true);
    expect(calls[0][0]).toBe("s3"); // rm --recursive first
    expect(calls.some((c) => c[1] === "delete-objects")).toBe(true);
  });

  it("reports not-emptied when the listing keeps failing", () => {
    const exec = (args: string[]): ExecResult =>
      args[1] === "list-object-versions"
        ? { status: 254, stdout: "", stderr: "denied" }
        : ok();
    expect(emptyBucket("b", exec).emptied).toBe(false);
  });
});

describe("forceDeleteStageSecrets", () => {
  it("includes planned-deletion secrets and force-deletes each", () => {
    const deleted: string[] = [];
    const exec = (args: string[]): ExecResult => {
      if (args[1] === "list-secrets") {
        expect(args).toContain("--include-planned-deletion");
        return ok(JSON.stringify(["arn:a", "arn:b"]));
      }
      if (args[1] === "delete-secret") {
        expect(args).toContain("--force-delete-without-recovery");
        deleted.push(args[args.indexOf("--secret-id") + 1]);
        return ok();
      }
      return ok();
    };
    const result = forceDeleteStageSecrets("hprod-1", "us-east-1", exec);
    expect(result).toEqual(["arn:a", "arn:b"]);
    expect(deleted).toEqual(["arn:a", "arn:b"]);
  });
});

describe("scanOrphans", () => {
  it("reports leftovers across resource classes and counts them", () => {
    const exec = (args: string[]): ExecResult => {
      if (args[0] === "lambda") return ok(JSON.stringify(["thinkwork-x-fn"]));
      if (args[1] === "list-buckets") return ok(JSON.stringify([]));
      if (args[0] === "rds") return ok(JSON.stringify(["thinkwork-x-db"]));
      if (args[0] === "secretsmanager") return ok(JSON.stringify([]));
      if (args[0] === "logs") return ok(JSON.stringify([]));
      return ok(JSON.stringify([]));
    };
    const report = scanOrphans("x", "us-east-1", exec);
    expect(report.lambdas).toEqual(["thinkwork-x-fn"]);
    expect(report.dbClusters).toEqual(["thinkwork-x-db"]);
    expect(orphanCount(report)).toBe(2);
  });

  it("returns a clean report when everything is gone", () => {
    const exec = (): ExecResult => ok(JSON.stringify([]));
    expect(orphanCount(scanOrphans("x", "us-east-1", exec))).toBe(0);
  });
});

describe("listStageBuckets", () => {
  it("filters to the stage prefix", () => {
    const exec = (args: string[]): ExecResult => {
      expect(args.join(" ")).toContain("thinkwork-hprod-1-");
      return ok(JSON.stringify(["thinkwork-hprod-1-storage"]));
    };
    expect(listStageBuckets("hprod-1", exec)).toEqual([
      "thinkwork-hprod-1-storage",
    ]);
  });
});

describe("disableClusterDeletionProtection", () => {
  it("disables protection when the cluster is protected", () => {
    const calls: string[][] = [];
    const exec = (args: string[]): ExecResult => {
      calls.push(args);
      if (args[1] === "describe-db-clusters") return ok("True\n");
      return ok();
    };
    const result = disableClusterDeletionProtection("hprod-1", "us-east-1", exec);
    expect(result).toEqual({ found: true, disabled: true });
    const modify = calls.find((c) => c[1] === "modify-db-cluster")!;
    expect(modify).toContain("--no-deletion-protection");
    expect(modify).toContain("thinkwork-hprod-1-db");
  });

  it("does not call modify when the cluster is already unprotected", () => {
    const calls: string[][] = [];
    const exec = (args: string[]): ExecResult => {
      calls.push(args);
      return ok("False\n");
    };
    const result = disableClusterDeletionProtection("hprod-1", "us-east-1", exec);
    expect(result).toEqual({ found: true, disabled: true });
    expect(calls.some((c) => c[1] === "modify-db-cluster")).toBe(false);
  });

  it("treats a missing cluster as already clean", () => {
    const exec = (): ExecResult => ({
      status: 254,
      stdout: "",
      stderr: "DBClusterNotFoundFault",
    });
    expect(disableClusterDeletionProtection("hprod-1", "us-east-1", exec)).toEqual(
      { found: false, disabled: true },
    );
  });

  it("reports failure when modify is refused", () => {
    const exec = (args: string[]): ExecResult =>
      args[1] === "describe-db-clusters"
        ? ok("True\n")
        : { status: 1, stdout: "", stderr: "AccessDenied" };
    expect(disableClusterDeletionProtection("hprod-1", "us-east-1", exec)).toEqual(
      { found: true, disabled: false },
    );
  });
});

describe("secret prefix coverage (dash- and slash-style)", () => {
  it("forceDeleteStageSecrets queries both naming schemes", () => {
    let query = "";
    const exec = (args: string[]): ExecResult => {
      if (args[1] === "list-secrets") {
        query = args[args.indexOf("--query") + 1];
        return ok(JSON.stringify([]));
      }
      return ok();
    };
    forceDeleteStageSecrets("hprod-1", "us-east-1", exec);
    expect(query).toContain("'thinkwork-hprod-1-'");
    expect(query).toContain("'thinkwork/hprod-1/'");
    expect(query).toContain("'/thinkwork/hprod-1/'");
  });

  it("scanOrphans secret listing covers both naming schemes", () => {
    let query = "";
    const exec = (args: string[]): ExecResult => {
      if (args[0] === "secretsmanager") {
        query = args[args.indexOf("--query") + 1];
      }
      return ok(JSON.stringify([]));
    };
    scanOrphans("hprod-1", "us-east-1", exec);
    expect(query).toContain("'thinkwork/hprod-1/'");
    expect(query).toContain("'/thinkwork/hprod-1/'");
  });
});

describe("deleteStageLogGroups", () => {
  it("deletes both lambda-auto and module log group prefixes", () => {
    const calls: string[][] = [];
    const exec = (args: string[]): ExecResult => {
      calls.push(args);
      if (args[1] === "describe-log-groups") {
        const prefix = args[args.indexOf("--log-group-name-prefix") + 1];
        return ok(JSON.stringify([`${prefix}graphql-http`]));
      }
      return ok();
    };
    const deleted = deleteStageLogGroups("hp1", "us-east-1", exec);
    expect(deleted).toEqual([
      "/aws/lambda/thinkwork-hp1-graphql-http",
      "/thinkwork/hp1/graphql-http",
    ]);
    expect(calls.filter((c) => c[1] === "delete-log-group")).toHaveLength(2);
  });
});

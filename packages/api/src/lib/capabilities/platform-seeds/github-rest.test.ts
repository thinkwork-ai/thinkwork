import { describe, it, expect } from "vitest";

import {
  assertValidDescriptor,
  operationExecutabilityViolations,
  descriptorFingerprint,
} from "@thinkwork/capability-contracts";

import {
  GITHUB_REST_OPERATION_IDS,
  githubIssueGetContract,
  githubIssuesListContract,
  githubRepoGetContract,
  githubRestOperations,
  githubRestReferenceDescriptor,
  type GithubRestConfig,
} from "./github-rest.js";

const CFG: GithubRestConfig = {
  namespace: "acme",
  owner: "acme",
  repo: "widgets",
};

describe("github-rest reference contracts", () => {
  it("exposes exactly the three tracer operation ids", () => {
    expect([...GITHUB_REST_OPERATION_IDS]).toEqual([
      "repos.get",
      "issues.list",
      "issues.get",
    ]);
    expect(githubRestOperations(CFG).map((o) => o.operationId)).toEqual([
      "repos.get",
      "issues.list",
      "issues.get",
    ]);
  });

  it("builds a descriptor that passes assertValidDescriptor with a stable fingerprint", () => {
    const descriptor = githubRestReferenceDescriptor(CFG);
    expect(() => assertValidDescriptor(descriptor)).not.toThrow();
    // Fingerprint is deterministic for identical config.
    expect(descriptorFingerprint(descriptor)).toBe(
      descriptorFingerprint(githubRestReferenceDescriptor(CFG)),
    );
  });

  it("every operation is executable (no executability violations)", () => {
    for (const op of githubRestOperations(CFG)) {
      expect(operationExecutabilityViolations(op)).toEqual([]);
    }
  });

  it("all operations are read, closed-scoped to one repo, service-principal capable, low cost", () => {
    for (const op of githubRestOperations(CFG)) {
      expect(op.effect).toBe("read");
      expect(op.targetScope.kind).toBe("closed");
      expect(op.principalModes).toEqual(["service"]);
      expect(op.costClass).toBe("low");
      expect(op.approvalPolicy).toBe("never");
      // Closed scope bakes the configured repo into the path.
      if (op.targetScope.kind === "closed") {
        const sel = op.targetScope.resourceSelector as Record<string, unknown>;
        expect(sel.host).toBe("api.github.com");
        expect(String(sel.path)).toContain("/repos/acme/widgets");
        expect(sel.method).toBe("GET");
      }
    }
  });

  it("issue listing is bounded (fixed per_page, capped page, maxItems output)", () => {
    const op = githubIssuesListContract(CFG);
    const sel = (
      op.targetScope as { resourceSelector: Record<string, unknown> }
    ).resourceSelector;
    expect((sel.fixedQuery as Record<string, string>).per_page).toBe("50");
    const props = (op.inputSchema as Record<string, unknown>)
      .properties as Record<string, Record<string, unknown>>;
    expect(props.page.maximum).toBe(20);
    expect((op.outputSchema as Record<string, unknown>).maxItems).toBe(50);
  });

  it("issue detail binds an integer path param and requires it", () => {
    const op = githubIssueGetContract(CFG);
    const sel = (
      op.targetScope as { resourceSelector: Record<string, unknown> }
    ).resourceSelector;
    expect(sel.path).toBe("/repos/acme/widgets/issues/{issueNumber}");
    expect(sel.pathParams).toEqual({ issueNumber: "issueNumber" });
    expect((op.inputSchema as Record<string, unknown>).required).toEqual([
      "issueNumber",
    ]);
  });

  it("repo metadata takes no input parameters", () => {
    const op = githubRepoGetContract(CFG);
    expect((op.inputSchema as Record<string, unknown>).properties).toEqual({});
  });

  it("URL-encodes owner/repo into the closed path", () => {
    const descriptor = githubRestReferenceDescriptor({
      namespace: "acme",
      owner: "a b",
      repo: "c/d",
    });
    const listOp = descriptor.operations.find(
      (o) => o.operationId === "issues.list",
    )!;
    const sel = (
      listOp.targetScope as { resourceSelector: Record<string, unknown> }
    ).resourceSelector;
    expect(String(sel.path)).toBe("/repos/a%20b/c%2Fd/issues");
  });
});

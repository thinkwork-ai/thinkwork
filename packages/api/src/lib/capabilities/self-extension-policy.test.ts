import { describe, expect, it } from "vitest";
import type {
  CapabilityDescriptor,
  OperationContract,
} from "@thinkwork/capability-contracts";
import {
  classifyDescriptor,
  classifyOperation,
  isAutoAdmissible,
  worstTier,
} from "./self-extension-policy.js";

function makeOp(overrides: Partial<OperationContract> = {}): OperationContract {
  return {
    operationId: "issues.list",
    summary: "List public issues",
    effect: "read",
    targetScope: {
      kind: "closed",
      resourceSelector: { host: "api.github.com" },
    },
    reversibility: "reversible",
    idempotency: "idempotent",
    principalModes: ["service"],
    approvalPolicy: "never",
    inputSchema: { type: "object" },
    outputSchema: { type: "array" },
    inputDataClass: "public",
    outputDataClass: "public",
    costClass: "low",
    latencyClass: "interactive",
    outputClass: "inline",
    ...overrides,
  };
}

function makeDescriptor(
  ops: OperationContract[],
  credentialKinds: string[] = [],
): CapabilityDescriptor {
  return {
    namespace: "acme",
    class: "connection",
    slug: "github-rest-public",
    version: "1",
    adapter: {
      kind: "http_openapi",
      config: { baseUrl: "https://api.github.com" },
    },
    bindingRequirements: { credentialKinds, principalModes: ["service"] },
    provenance: { sourceUrls: ["https://docs.github.com"], evidenceRefs: [] },
    operations: ops,
  };
}

describe("classifyOperation", () => {
  it("classifies a public, read-only, no-credential, reversible op as auto", () => {
    const c = classifyOperation(makeOp(), makeDescriptor([makeOp()]));
    expect(c.tier).toBe("auto");
    expect(c.reasons).toEqual([]);
  });

  it("reviews a write op (effect changes state)", () => {
    const c = classifyOperation(
      makeOp({ effect: "create" }),
      makeDescriptor([makeOp({ effect: "create" })]),
    );
    expect(c.tier).toBe("review");
    expect(c.reasons.join(" ")).toMatch(/effect 'create' changes/);
  });

  it("reviews an op that requires a credential (descriptor-level)", () => {
    const op = makeOp();
    const c = classifyOperation(op, makeDescriptor([op], ["bearer_token"]));
    expect(c.tier).toBe("review");
    expect(c.reasons.join(" ")).toMatch(/requires credential \(bearer_token\)/);
  });

  it("reviews an irreversible op", () => {
    const op = makeOp({ effect: "read", reversibility: "irreversible" });
    const c = classifyOperation(op, makeDescriptor([op]));
    expect(c.tier).toBe("review");
    expect(c.reasons.join(" ")).toMatch(/not reversible/);
  });

  it("reviews an elevated cost class", () => {
    const op = makeOp({ costClass: "high" });
    const c = classifyOperation(op, makeDescriptor([op]));
    expect(c.tier).toBe("review");
    expect(c.reasons.join(" ")).toMatch(/costClass 'high'/);
  });

  it("reviews a confidential/restricted data class", () => {
    const op = makeOp({ outputDataClass: "confidential" });
    const c = classifyOperation(op, makeDescriptor([op]));
    expect(c.tier).toBe("review");
    expect(c.reasons.join(" ")).toMatch(/outputDataClass 'confidential'/);
  });

  it("forbids an op with an unknown classification (fail-closed via executability)", () => {
    const op = makeOp({ costClass: "unknown" });
    const c = classifyOperation(op, makeDescriptor([op]));
    expect(c.tier).toBe("forbidden");
    expect(c.reasons.join(" ")).toMatch(/costClass is unknown/);
  });

  it("forbids a credential data-class op (never even review)", () => {
    const op = makeOp({ inputDataClass: "credential" });
    const c = classifyOperation(op, makeDescriptor([op]));
    expect(c.tier).toBe("forbidden");
  });

  it("fails closed when credentialKinds is malformed (not an array)", () => {
    const op = makeOp();
    const bad = makeDescriptor([op]);
    // Simulate a malformed descriptor reaching the classifier.
    (bad.bindingRequirements as { credentialKinds: unknown }).credentialKinds =
      undefined;
    const c = classifyOperation(op, bad);
    expect(c.tier).toBe("review");
    expect(c.reasons.join(" ")).toMatch(
      /credential requirement is unspecified/,
    );
  });
});

describe("classifyDescriptor", () => {
  it("is auto when every operation is auto", () => {
    const d = makeDescriptor([makeOp(), makeOp({ operationId: "repos.get" })]);
    expect(classifyDescriptor(d).tier).toBe("auto");
    expect(isAutoAdmissible(d)).toBe(true);
  });

  it("is review when any single operation needs review (worst wins)", () => {
    const d = makeDescriptor([
      makeOp(),
      makeOp({ operationId: "issues.create", effect: "create" }),
    ]);
    expect(classifyDescriptor(d).tier).toBe("review");
    expect(isAutoAdmissible(d)).toBe(false);
  });

  it("is forbidden when any operation is forbidden (worst wins)", () => {
    const d = makeDescriptor([
      makeOp(),
      makeOp({ operationId: "x", latencyClass: "unknown" }),
    ]);
    expect(classifyDescriptor(d).tier).toBe("forbidden");
  });

  it("forbids a descriptor with no operations (malformed, never silently auto)", () => {
    const d = makeDescriptor([]);
    expect(classifyDescriptor(d).tier).toBe("forbidden");
    expect(isAutoAdmissible(d)).toBe(false);
  });
});

describe("worstTier", () => {
  it("ranks forbidden > review > auto", () => {
    expect(worstTier(["auto", "auto"])).toBe("auto");
    expect(worstTier(["auto", "review"])).toBe("review");
    expect(worstTier(["review", "forbidden", "auto"])).toBe("forbidden");
    expect(worstTier([])).toBe("auto");
  });
});

import { describe, expect, it } from "vitest";
import {
  DESCRIPTOR_CONTRACT_REFERENCE,
  CapabilityContractError,
  type CapabilityDescriptor,
  type OperationContract,
  assertValidDescriptor,
  descriptorFingerprint,
  formatTwcapRef,
  operationContractHash,
  operationExecutabilityViolations,
  parseTwcapRef,
} from "./descriptor";

function makeOperation(
  overrides: Partial<OperationContract> = {},
): OperationContract {
  return {
    operationId: "issues/list",
    summary: "List open issues for the admitted repository",
    effect: "read",
    targetScope: {
      kind: "closed",
      resourceSelector: { repository: "acme/widgets" },
    },
    reversibility: "reversible",
    idempotency: "idempotent",
    principalModes: ["service"],
    approvalPolicy: "never",
    inputSchema: { type: "object", properties: { page: { type: "integer" } } },
    outputSchema: { type: "array" },
    inputDataClass: "internal",
    outputDataClass: "internal",
    costClass: "low",
    latencyClass: "interactive",
    outputClass: "inline",
    ...overrides,
  };
}

function makeDescriptor(
  overrides: Partial<CapabilityDescriptor> = {},
): CapabilityDescriptor {
  return {
    namespace: "acme",
    class: "connection",
    slug: "github-rest",
    version: "1",
    adapter: {
      kind: "http_openapi",
      config: { baseUrl: "https://api.github.com" },
    },
    bindingRequirements: {
      credentialKinds: ["bearer_token"],
      principalModes: ["service"],
    },
    provenance: {
      sourceUrls: ["https://docs.github.com/en/rest/issues/issues"],
      evidenceRefs: ["research:abc123"],
    },
    operations: [makeOperation()],
    ...overrides,
  };
}

describe("descriptor validation", () => {
  it("accepts a well-formed descriptor", () => {
    expect(() => assertValidDescriptor(makeDescriptor())).not.toThrow();
  });

  it("collects every violation instead of stopping at the first", () => {
    const bad = makeDescriptor({
      namespace: "Not Valid!",
      version: "v1",
      operations: [
        makeOperation({
          effect: "destroy" as never,
          costClass: "cheap" as never,
        }),
      ],
    });
    try {
      assertValidDescriptor(bad);
      expect.unreachable();
    } catch (e) {
      const err = e as CapabilityContractError;
      expect(err.violations.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("rejects duplicate operation ids", () => {
    const d = makeDescriptor({
      operations: [makeOperation(), makeOperation()],
    });
    expect(() => assertValidDescriptor(d)).toThrow(/duplicate operationId/);
  });

  it("rejects unknown enum values and empty operations", () => {
    expect(() =>
      assertValidDescriptor(makeDescriptor({ operations: [] })),
    ).toThrow(CapabilityContractError);
    expect(() =>
      assertValidDescriptor(
        makeDescriptor({ adapter: { kind: "grpc" as never, config: {} } }),
      ),
    ).toThrow(/adapter/);
  });

  it("requires a resource selector for closed target scope", () => {
    const op = makeOperation();
    delete (op.targetScope as Record<string, unknown>).resourceSelector;
    expect(() =>
      assertValidDescriptor(makeDescriptor({ operations: [op] })),
    ).toThrow(/resourceSelector/);
  });
});

describe("executability withholding", () => {
  it("passes a fully annotated read operation", () => {
    expect(operationExecutabilityViolations(makeOperation())).toEqual([]);
  });

  it("withholds unknown cost/latency/output classes", () => {
    expect(
      operationExecutabilityViolations(makeOperation({ costClass: "unknown" })),
    ).toContain("costClass is unknown");
    expect(
      operationExecutabilityViolations(
        makeOperation({ latencyClass: "unknown" }),
      ),
    ).toContain("latencyClass is unknown");
    expect(
      operationExecutabilityViolations(
        makeOperation({ outputClass: "unknown" }),
      ),
    ).toContain("outputClass is unknown");
  });

  it("withholds credential data classifications in v1", () => {
    expect(
      operationExecutabilityViolations(
        makeOperation({ outputDataClass: "credential" }),
      ),
    ).toHaveLength(1);
    expect(
      operationExecutabilityViolations(
        makeOperation({ inputDataClass: "credential" }),
      ),
    ).toHaveLength(1);
  });

  it("withholds compensable operations without compensation", () => {
    expect(
      operationExecutabilityViolations(
        makeOperation({ reversibility: "compensable" }),
      ),
    ).toContain("compensable operation missing compensation");
    expect(
      operationExecutabilityViolations(
        makeOperation({
          reversibility: "compensable",
          compensation: "delete the created issue",
        }),
      ),
    ).toEqual([]);
  });
});

describe("fingerprints", () => {
  it("is insensitive to object key order", () => {
    const a = makeDescriptor();
    const reversed = Object.fromEntries(
      Object.entries(a).reverse(),
    ) as unknown as CapabilityDescriptor;
    expect(descriptorFingerprint(reversed)).toBe(descriptorFingerprint(a));
  });

  it("changes when any contract field changes", () => {
    const base = operationContractHash(makeOperation());
    expect(
      operationContractHash(makeOperation({ costClass: "high" })),
    ).not.toBe(base);
    expect(operationContractHash(makeOperation({ effect: "create" }))).not.toBe(
      base,
    );
  });
});

describe("twcap references", () => {
  it("percent-encodes operation ids in the formatted URI", () => {
    const uri = formatTwcapRef({
      namespace: "acme",
      class: "connection",
      slug: "github-rest",
      version: "1",
      operationId: "GET /repos/{owner}/{repo}/issues",
      contractHash: "a".repeat(64),
    });
    expect(uri).toBe(
      "twcap://acme/connection/github-rest/versions/1/operations/" +
        "GET%20%2Frepos%2F%7Bowner%7D%2F%7Brepo%7D%2Fissues" +
        `?contract=sha256:${"a".repeat(64)}`,
    );
  });

  it("round-trips structured fields exactly", () => {
    const contractHash = operationContractHash(makeOperation());
    const ref = {
      namespace: "acme",
      class: "connection",
      slug: "github-rest",
      version: "12",
      operationId: "GET /repos/{owner}/{repo}/issues",
      contractHash,
    };
    expect(parseTwcapRef(formatTwcapRef(ref))).toEqual(ref);
  });

  it("fails closed on malformed references", () => {
    const good = formatTwcapRef({
      namespace: "acme",
      class: "connection",
      slug: "github-rest",
      version: "1",
      operationId: "issues/list",
      contractHash: "a".repeat(64),
    });
    expect(() => parseTwcapRef(good)).not.toThrow();
    expect(() => parseTwcapRef(good.replace("twcap://", "https://"))).toThrow(
      CapabilityContractError,
    );
    expect(() => parseTwcapRef(good.replace("sha256:", "md5:"))).toThrow(
      CapabilityContractError,
    );
    expect(() =>
      parseTwcapRef(good.replace(/contract=sha256:.*$/, "contract=sha256:zz")),
    ).toThrow(CapabilityContractError);
    expect(() =>
      parseTwcapRef("twcap://acme/connection/github-rest/versions/1"),
    ).toThrow(CapabilityContractError);
    expect(() => parseTwcapRef(`${good}&extra=1`)).toThrow(
      CapabilityContractError,
    );
    expect(() =>
      parseTwcapRef(good.replace("/versions/1/", "/versions/one/")),
    ).toThrow(CapabilityContractError);
  });

  it("rejects invalid segments at format time", () => {
    expect(() =>
      formatTwcapRef({
        namespace: "Bad Namespace",
        class: "connection",
        slug: "github-rest",
        version: "1",
        operationId: "x",
        contractHash: "a".repeat(64),
      }),
    ).toThrow(CapabilityContractError);
  });
});

describe("DESCRIPTOR_CONTRACT_REFERENCE", () => {
  it("ships an example that passes the validator it documents", () => {
    expect(() =>
      assertValidDescriptor(
        JSON.parse(JSON.stringify(DESCRIPTOR_CONTRACT_REFERENCE.example)),
      ),
    ).not.toThrow();
  });

  it("example has no executability violations (auto-tier eligible shape)", () => {
    const example = JSON.parse(
      JSON.stringify(DESCRIPTOR_CONTRACT_REFERENCE.example),
    ) as CapabilityDescriptor;
    for (const op of example.operations) {
      expect(operationExecutabilityViolations(op)).toEqual([]);
      expect(op.effect === "none" || op.effect === "read").toBe(true);
      expect(op.reversibility).toBe("reversible");
    }
    expect(example.bindingRequirements.credentialKinds).toEqual([]);
  });
});

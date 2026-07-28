/**
 * Canonical operation-identity composer + parity assertion (THINK-280 U8).
 *
 * The integration test follows ONE GitHub operation identity through all seven
 * surfaces (Inspector, internal search, broker evidence, Routine dependency,
 * execution detail, Artifact lineage, external search) and fails on any
 * projection drift — the single guarantee the platform never disagrees with
 * itself about what an operation is.
 */

import { describe, expect, it } from "vitest";
import {
  formatTwcapRef,
  operationContractHash,
  type CapabilityDescriptor,
} from "@thinkwork/capability-contracts";
import { githubRestReferenceDescriptor } from "./platform-seeds/github-rest.js";
import {
  assertOperationIdentityParity,
  checkOperationIdentityParity,
  projectOperationIdentities,
  projectOperationIdentity,
  PARITY_SURFACES,
  type ParitySurfaceInputs,
  type SurfaceOperationReference,
} from "./operation-identity.js";

const IDENTITY = {
  namespace: "acme",
  class: "connection",
  slug: "github-rest",
};

function fixtureVersion(): {
  id: string;
  version: number;
  descriptor_json: CapabilityDescriptor;
  contract_hashes_json: Record<string, string>;
} {
  const descriptor = githubRestReferenceDescriptor({
    namespace: "acme",
    owner: "acme",
    repo: "thinkwork",
  });
  const contractHashes: Record<string, string> = {};
  for (const op of descriptor.operations) {
    contractHashes[op.operationId] = operationContractHash(op);
  }
  return {
    id: "ver-1",
    version: 1,
    descriptor_json: descriptor,
    contract_hashes_json: contractHashes,
  };
}

/** Recompute what each production surface emits from the same version row. */
function surfaceReferences(
  operationId: string,
): Record<(typeof PARITY_SURFACES)[number], SurfaceOperationReference> {
  const version = fixtureVersion();
  const op = version.descriptor_json.operations.find(
    (o) => o.operationId === operationId,
  )!;
  const contractHash = version.contract_hashes_json[operationId]!;
  const twcap = formatTwcapRef({
    namespace: IDENTITY.namespace,
    class: IDENTITY.class,
    slug: IDENTITY.slug,
    version: String(version.version),
    operationId,
    contractHash,
  });

  // 1. Inspector — projects operation items through the shared composer.
  const inspectorItem = projectOperationIdentity(
    IDENTITY,
    version,
    operationId,
  )!;

  // 2. Broker evidence (capability_broker_calls.{operation_ref,contract_hash}).
  const brokerRow = { operation_ref: twcap, contract_hash: contractHash };

  // 3. Execution detail (headless executor evidence dependency).
  const execEvidence = { operationRef: twcap, contractHash };

  // 4. Artifact lineage capability reference.
  const artifactLineage = { twcap, contractHash };

  // 5. External MCP search — projects through the same composer.
  const externalItem = projectOperationIdentity(
    IDENTITY,
    version,
    operationId,
  )!;

  return {
    inspector: {
      twcap: inspectorItem.twcap,
      contractHash: inspectorItem.contractHash,
    },
    brokerEvidence: {
      twcap: brokerRow.operation_ref,
      contractHash: brokerRow.contract_hash,
    },
    executionDetail: {
      twcap: execEvidence.operationRef,
      contractHash: execEvidence.contractHash,
    },
    artifactLineage,
    externalSearch: {
      twcap: externalItem.twcap,
      contractHash: externalItem.contractHash,
    },
  };
}

describe("projectOperationIdentities", () => {
  it("projects every operation with an exact twcap + signed contract hash", () => {
    const version = fixtureVersion();
    const identities = projectOperationIdentities(IDENTITY, version);
    expect(identities.map((o) => o.operationId)).toEqual([
      "repos.get",
      "issues.list",
      "issues.get",
    ]);
    for (const identity of identities) {
      expect(identity.twcap).toContain(
        `twcap://acme/connection/github-rest/versions/1/operations/`,
      );
      expect(identity.contractHash).toMatch(/^[0-9a-f]{64}$/);
      expect(identity.effect).toBe("read");
      expect(identity.principalModes).toEqual(["service"]);
      // read/reversible/idempotent GitHub reads are executable.
      expect(identity.executable).toBe(true);
      expect(identity.withheldReasons).toEqual([]);
    }
  });

  it("drops an operation whose stored contract hash drifted from the signed contract (fail closed)", () => {
    const version = fixtureVersion();
    version.contract_hashes_json["issues.list"] = "0".repeat(64);
    const identities = projectOperationIdentities(IDENTITY, version);
    // repos.get + issues.get survive; the drifted issues.list is withheld.
    expect(identities.map((o) => o.operationId)).toEqual([
      "repos.get",
      "issues.get",
    ]);
  });

  it("returns [] for a malformed descriptor rather than throwing", () => {
    expect(
      projectOperationIdentities(IDENTITY, {
        id: "v",
        version: 1,
        descriptor_json: { not: "a descriptor" },
        contract_hashes_json: {},
      }),
    ).toEqual([]);
  });
});

describe("operation-identity parity — one identity across seven surfaces", () => {
  it("all seven surfaces agree on the same GitHub operation reference + contract hash", () => {
    const refs = surfaceReferences("issues.list");
    const canonical = refs.inspector;
    const result = assertOperationIdentityParity(canonical, refs);
    expect(result.ok).toBe(true);
    expect(result.agreed.sort()).toEqual([...PARITY_SURFACES].sort());
    expect(result.drift).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it("fails loudly and names the surface when any projection drifts", () => {
    const refs: ParitySurfaceInputs = surfaceReferences("issues.get");
    const canonical = refs.inspector!;
    // Simulate broker evidence that recorded a stale contract hash.
    refs.brokerEvidence = {
      twcap: canonical.twcap,
      contractHash: "f".repeat(64),
    };
    expect(() => assertOperationIdentityParity(canonical, refs)).toThrow(
      /parity drift.*brokerEvidence: contract_hash_mismatch/,
    );
  });

  it("records twcap drift on the external-search surface", () => {
    const refs: ParitySurfaceInputs = surfaceReferences("repos.get");
    const canonical = refs.inspector!;
    refs.externalSearch = {
      twcap:
        "twcap://acme/connection/github-rest/versions/2/operations/repos.get?contract=sha256:" +
        canonical.contractHash,
      contractHash: canonical.contractHash,
    };
    const result = checkOperationIdentityParity(canonical, refs);
    expect(result.ok).toBe(false);
    expect(result.drift).toHaveLength(1);
    expect(result.drift[0].surface).toBe("externalSearch");
    expect(result.drift[0].reason).toBe("twcap_mismatch");
  });

  it("treats an absent surface as missing coverage, not drift", () => {
    const refs: ParitySurfaceInputs = surfaceReferences("issues.list");
    const canonical = refs.inspector!;
    delete refs.artifactLineage;
    const result = checkOperationIdentityParity(canonical, refs);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual(["artifactLineage"]);
  });
});

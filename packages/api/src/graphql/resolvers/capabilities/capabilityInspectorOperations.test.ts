/**
 * Inspector capability-operation projection (THINK-280 U8).
 *
 * Confirms the Inspector projects admitted operations through the SAME
 * canonical composer as internal/external search (identical twcap + contract
 * hash), attaches binding readiness + remediation, and stays best-effort.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  operationContractHash,
  formatTwcapRef,
} from "@thinkwork/capability-contracts";
import { githubRestReferenceDescriptor } from "../../../lib/capabilities/platform-seeds/github-rest.js";

const { rowsByTable, TABLES } = vi.hoisted(() => ({
  rowsByTable: new Map<string, unknown[]>(),
  TABLES: {
    capabilityDefinitions: "capabilityDefinitions",
    capabilityDefinitionVersions: "capabilityDefinitionVersions",
    capabilityCredentialBindings: "capabilityCredentialBindings",
    capabilityBrokerCalls: "capabilityBrokerCalls",
  } as const,
}));

vi.mock("../../utils.js", () => {
  function builder(table: string) {
    const resolve = () => Promise.resolve(rowsByTable.get(table) ?? []);
    const chain = {
      where: () => chain,
      orderBy: () => chain,
      limit: () => resolve(),
      then: (...a: unknown[]) =>
        (resolve() as Promise<unknown>).then(...(a as [never])),
      catch: (...a: unknown[]) =>
        (resolve() as Promise<unknown>).catch(...(a as [never])),
    };
    return chain;
  }
  return {
    db: { select: () => ({ from: (t: string) => builder(t) }) },
    and: (...preds: unknown[]) => ({ preds }),
    eq: (col: unknown, val: unknown) => ({ col, val }),
    desc: (col: unknown) => ({ col }),
  };
});
vi.mock("@thinkwork/database-pg/schema", () => TABLES);

import { projectCapabilityOperationItems } from "./capabilityInspectorOperations.js";

const TENANT = "tenant-a";
const descriptor = githubRestReferenceDescriptor({
  namespace: "acme",
  owner: "acme",
  repo: "thinkwork",
});
const contractHashes: Record<string, string> = {};
for (const op of descriptor.operations) {
  contractHashes[op.operationId] = operationContractHash(op);
}
function twcapFor(operationId: string): string {
  return formatTwcapRef({
    namespace: "acme",
    class: "connection",
    slug: "github-rest",
    version: "1",
    operationId,
    contractHash: contractHashes[operationId]!,
  });
}

function seed(readiness: string | null) {
  rowsByTable.set(TABLES.capabilityDefinitions, [
    {
      id: "def-1",
      tenant_id: TENANT,
      namespace: "acme",
      class: "connection",
      slug: "github-rest",
      display_name: "GitHub REST",
      status: "active",
    },
  ]);
  rowsByTable.set(TABLES.capabilityDefinitionVersions, [
    {
      id: "ver-1",
      definition_id: "def-1",
      version: 1,
      lifecycle: "admitted",
      descriptor_json: descriptor,
      contract_hashes_json: contractHashes,
    },
  ]);
  rowsByTable.set(
    TABLES.capabilityCredentialBindings,
    readiness
      ? [
          {
            id: "b1",
            tenant_id: TENANT,
            definition_version_id: "ver-1",
            principal_mode: "service",
            readiness,
          },
        ]
      : [],
  );
  rowsByTable.set(TABLES.capabilityBrokerCalls, [
    {
      status: "completed",
      contract_hash: contractHashes["issues.list"],
      created_at: new Date(),
    },
  ]);
}

describe("projectCapabilityOperationItems", () => {
  beforeEach(() => rowsByTable.clear());

  it("projects admitted operations with the exact composer identity + ready active state", async () => {
    seed("ready");
    const items = await projectCapabilityOperationItems(TENANT);
    expect(items).toHaveLength(3);
    const list = items.find((i) => i.capabilityId === twcapFor("issues.list"))!;
    expect(list.capabilityClass).toBe("capability_operation");
    expect(list.operationTwcap).toBe(twcapFor("issues.list"));
    expect(list.contractHash).toBe(contractHashes["issues.list"]);
    expect(list.effect).toBe("read");
    expect(list.readiness).toBe("ready");
    expect(list.active).toBe(true);
    expect(list.latestBrokerCallStatus).toBe("completed");
  });

  it("marks operations inactive with remediation when no ready binding exists", async () => {
    seed(null);
    const items = await projectCapabilityOperationItems(TENANT);
    for (const item of items) {
      expect(item.active).toBe(false);
      expect(item.readiness).toBe("pending_setup");
      expect(item.reason).toBe("binding_not_ready");
      expect(item.remediation).toMatch(/operator must complete setup/);
    }
  });

  it("returns [] when the tenant has no admitted definitions", async () => {
    const items = await projectCapabilityOperationItems(TENANT);
    expect(items).toEqual([]);
  });
});

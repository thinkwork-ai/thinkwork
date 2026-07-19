import { GraphQLError } from "graphql";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireTenantAdmin,
  mockResolveCallerUserId,
  mockListOntologyDefinitions,
  mockGetOntologySchemaGraph,
  mockListOntologyChangeSets,
  mockLoadOntologySuggestionScanJob,
  mockLoadOntologyReprocessJob,
  mockStartOntologySuggestionScan,
  mockCreateOntologyChangeSet,
  mockUpdateOntologyChangeSet,
  mockApproveOntologyChangeSet,
  mockRejectOntologyChangeSet,
  mockRejectOntologyChangeSetItem,
  mockUpdateOntologyEntityType,
  mockUpdateOntologyRelationshipType,
  mockListOntologyPacks,
  mockInstallOntologyPack,
  mockStageOntologyEntityTypeSystemMap,
} = vi.hoisted(() => ({
  mockRequireTenantAdmin: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  mockListOntologyDefinitions: vi.fn(),
  mockGetOntologySchemaGraph: vi.fn(),
  mockListOntologyChangeSets: vi.fn(),
  mockLoadOntologySuggestionScanJob: vi.fn(),
  mockLoadOntologyReprocessJob: vi.fn(),
  mockStartOntologySuggestionScan: vi.fn(),
  mockCreateOntologyChangeSet: vi.fn(),
  mockUpdateOntologyChangeSet: vi.fn(),
  mockApproveOntologyChangeSet: vi.fn(),
  mockRejectOntologyChangeSet: vi.fn(),
  mockRejectOntologyChangeSetItem: vi.fn(),
  mockUpdateOntologyEntityType: vi.fn(),
  mockUpdateOntologyRelationshipType: vi.fn(),
  mockListOntologyPacks: vi.fn(),
  mockInstallOntologyPack: vi.fn(),
  mockStageOntologyEntityTypeSystemMap: vi.fn(),
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
  // Read-only queries here now route through requireAdminOrServiceCaller;
  // delegate to the same mock so existing role-gate tests carry over.
  requireAdminOrServiceCaller: (ctx: any, tenantId: string) =>
    mockRequireTenantAdmin(ctx, tenantId),
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
  resolveCallerTenantId: vi.fn().mockResolvedValue("tenant-1"),
}));

vi.mock("../../../lib/ontology/repository.js", () => ({
  listOntologyDefinitions: mockListOntologyDefinitions,
  getOntologySchemaGraph: mockGetOntologySchemaGraph,
  listOntologyChangeSets: mockListOntologyChangeSets,
  loadOntologySuggestionScanJob: mockLoadOntologySuggestionScanJob,
  loadOntologyReprocessJob: mockLoadOntologyReprocessJob,
  createOntologyChangeSet: mockCreateOntologyChangeSet,
  updateOntologyChangeSet: mockUpdateOntologyChangeSet,
  approveOntologyChangeSet: mockApproveOntologyChangeSet,
  rejectOntologyChangeSet: mockRejectOntologyChangeSet,
  rejectOntologyChangeSetItem: mockRejectOntologyChangeSetItem,
  updateOntologyEntityType: mockUpdateOntologyEntityType,
  updateOntologyRelationshipType: mockUpdateOntologyRelationshipType,
  stageOntologyEntityTypeSystemMap: mockStageOntologyEntityTypeSystemMap,
}));

vi.mock("../../../lib/ontology/suggestions.js", () => ({
  startOntologySuggestionScanJob: mockStartOntologySuggestionScan,
}));

vi.mock("../../../lib/ontology/packs.js", () => ({
  listOntologyPacks: mockListOntologyPacks,
  installOntologyPack: mockInstallOntologyPack,
}));

import { approveOntologyChangeSetMutation } from "./approveOntologyChangeSet.mutation.js";
import { createOntologyChangeSetMutation } from "./createOntologyChangeSet.mutation.js";
import {
  changeSetStatusFromGraphQL,
  itemStatusFromGraphQL,
} from "./coercion.js";
import { installOntologyPackMutation } from "./installOntologyPack.mutation.js";
import { ontologyChangeSets } from "./ontologyChangeSets.query.js";
import { ontologyPacks } from "./ontologyPacks.query.js";
import { ontologyDefinitions } from "./ontologyDefinitions.query.js";
import { ontologyReprocessJob } from "./ontologyReprocessJob.query.js";
import { ontologySchemaGraph } from "./ontologySchemaGraph.query.js";
import { ontologySuggestionScanJob } from "./ontologySuggestionScanJob.query.js";
import { rejectOntologyChangeSetMutation } from "./rejectOntologyChangeSet.mutation.js";
import { rejectOntologyChangeSetItemMutation } from "./rejectOntologyChangeSetItem.mutation.js";
import { startOntologySuggestionScanMutation } from "./startOntologySuggestionScan.mutation.js";
import { updateOntologyChangeSetMutation } from "./updateOntologyChangeSet.mutation.js";
import { updateOntologyEntityTypeMutation } from "./updateOntologyEntityType.mutation.js";
import { updateOntologyRelationshipTypeMutation } from "./updateOntologyRelationshipType.mutation.js";
import { setOntologyEntityTypeSystemMapMutation } from "./setOntologyEntityTypeSystemMap.mutation.js";
import { changeItemTypeFromGraphQL } from "./coercion.js";

const ctx = { auth: { authType: "cognito" } } as any;

describe("ontology GraphQL resolvers", () => {
  beforeEach(() => {
    mockRequireTenantAdmin.mockReset();
    mockResolveCallerUserId.mockReset();
    mockListOntologyDefinitions.mockReset();
    mockGetOntologySchemaGraph.mockReset();
    mockListOntologyChangeSets.mockReset();
    mockLoadOntologySuggestionScanJob.mockReset();
    mockLoadOntologyReprocessJob.mockReset();
    mockStartOntologySuggestionScan.mockReset();
    mockCreateOntologyChangeSet.mockReset();
    mockUpdateOntologyChangeSet.mockReset();
    mockApproveOntologyChangeSet.mockReset();
    mockRejectOntologyChangeSet.mockReset();
    mockRejectOntologyChangeSetItem.mockReset();
    mockUpdateOntologyEntityType.mockReset();
    mockUpdateOntologyRelationshipType.mockReset();
    mockListOntologyPacks.mockReset();
    mockInstallOntologyPack.mockReset();
    mockStageOntologyEntityTypeSystemMap.mockReset();

    mockRequireTenantAdmin.mockResolvedValue("admin");
    mockResolveCallerUserId.mockResolvedValue("user-1");
  });

  it("lists tenant ontology definitions after an admin gate", async () => {
    const definitions = {
      tenantId: "tenant-1",
      activeVersion: { id: "version-1", versionNumber: 1 },
      entityTypes: [
        {
          id: "entity-customer",
          slug: "customer",
          externalMappings: [
            {
              mappingKind: "BROAD",
              vocabulary: "schema.org",
              externalUri: "https://schema.org/Organization",
            },
          ],
        },
      ],
      relationshipTypes: [{ id: "rel-owns", slug: "owns" }],
      facetTemplates: [],
      externalMappings: [],
    };
    mockListOntologyDefinitions.mockResolvedValue(definitions);

    const result = await ontologyDefinitions(
      null,
      { tenantId: "tenant-1" },
      ctx,
    );

    expect(result).toBe(definitions);
    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(ctx, "tenant-1");
    expect(mockListOntologyDefinitions).toHaveBeenCalledWith({
      tenantId: "tenant-1",
    });
    expect(result.entityTypes[0].externalMappings[0].mappingKind).toBe("BROAD");
  });

  it("serves the Living Map schema graph after an admin gate", async () => {
    const graph = {
      tenantId: "tenant-1",
      types: [
        { slug: "customer", name: "Customer", instanceCount: 12 },
        { slug: "person", name: "Person", instanceCount: 0 },
      ],
      relationships: [
        {
          slug: "owns",
          name: "Owns",
          sourceTypeSlugs: ["customer"],
          targetTypeSlugs: ["asset"],
        },
      ],
      candidates: [
        {
          itemId: "item-1",
          changeSetId: "change-set-1",
          slug: "work_order",
          evidenceCount: 12,
          origin: "suggestion_engine",
        },
      ],
    };
    mockGetOntologySchemaGraph.mockResolvedValue(graph);

    const result = await ontologySchemaGraph(
      null,
      { tenantId: "tenant-1" },
      ctx,
    );

    expect(result).toBe(graph);
    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(ctx, "tenant-1");
    expect(mockGetOntologySchemaGraph).toHaveBeenCalledWith({
      tenantId: "tenant-1",
    });
  });

  it("does not leak another tenant's schema graph to unauthorized callers", async () => {
    mockRequireTenantAdmin.mockRejectedValue(
      new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } }),
    );

    await expect(
      ontologySchemaGraph(null, { tenantId: "tenant-2" }, ctx),
    ).rejects.toThrow("Forbidden");

    expect(mockGetOntologySchemaGraph).not.toHaveBeenCalled();
  });

  it("maps change-set status filters before listing suggestions", async () => {
    mockListOntologyChangeSets.mockResolvedValue([{ id: "change-set-1" }]);

    await ontologyChangeSets(
      null,
      {
        tenantId: "tenant-1",
        status: "PENDING_REVIEW",
      },
      ctx,
    );

    expect(mockListOntologyChangeSets).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      status: "pending_review",
    });
  });

  it("fails closed when admin authorization rejects a cross-tenant query", async () => {
    mockRequireTenantAdmin.mockRejectedValue(
      new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } }),
    );

    await expect(
      ontologyChangeSets(null, { tenantId: "tenant-2" }, ctx),
    ).rejects.toThrow("Forbidden");

    expect(mockListOntologyChangeSets).not.toHaveBeenCalled();
  });

  it("updates draft line items with GraphQL statuses normalized for storage", async () => {
    mockUpdateOntologyChangeSet.mockResolvedValue({
      id: "change-set-1",
      status: "PENDING_REVIEW",
      items: [{ id: "item-1", status: "REJECTED" }],
    });

    const result = await updateOntologyChangeSetMutation(
      null,
      {
        input: {
          tenantId: "tenant-1",
          changeSetId: "change-set-1",
          title: "Sharper customer type",
          status: "PENDING_REVIEW",
          items: [
            {
              id: "item-1",
              status: "REJECTED",
              editedValue: { slug: "customer" },
            },
          ],
        },
      },
      ctx,
    );

    expect(result.status).toBe("PENDING_REVIEW");
    expect(mockUpdateOntologyChangeSet).toHaveBeenCalledWith({
      actorUserId: "user-1",
      input: {
        tenantId: "tenant-1",
        changeSetId: "change-set-1",
        title: "Sharper customer type",
        status: "pending_review",
        items: [
          {
            id: "item-1",
            status: "rejected",
            editedValue: { slug: "customer" },
          },
        ],
      },
    });
  });

  it("approves a reviewed change set through the repository version boundary", async () => {
    mockApproveOntologyChangeSet.mockResolvedValue({
      id: "change-set-1",
      status: "APPROVED",
      appliedVersionId: "version-2",
    });

    const result = await approveOntologyChangeSetMutation(
      null,
      {
        input: { tenantId: "tenant-1", changeSetId: "change-set-1" },
      },
      ctx,
    );

    expect(result.appliedVersionId).toBe("version-2");
    expect(mockApproveOntologyChangeSet).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      changeSetId: "change-set-1",
      excludedItemIds: undefined,
      excludedDisposition: null,
      actorUserId: "user-1",
    });
  });

  it("passes per-item exclusions and a normalized disposition to approval (R15)", async () => {
    mockApproveOntologyChangeSet.mockResolvedValue({
      id: "change-set-1",
      status: "APPROVED",
    });

    await approveOntologyChangeSetMutation(
      null,
      {
        input: {
          tenantId: "tenant-1",
          changeSetId: "change-set-1",
          excludedItemIds: ["item-b"],
          excludedDisposition: "REJECTED",
        },
      },
      ctx,
    );

    expect(mockApproveOntologyChangeSet).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      changeSetId: "change-set-1",
      excludedItemIds: ["item-b"],
      excludedDisposition: "rejected",
      actorUserId: "user-1",
    });
  });

  it("stages manual authoring through createOntologyChangeSet with normalized item kinds (KTD-5)", async () => {
    mockCreateOntologyChangeSet.mockResolvedValue({
      changeSet: { id: "draft-1", status: "DRAFT" },
      mergedItemIds: ["item-merged"],
      conflicts: [
        {
          slug: "order",
          itemType: "entity_type",
          reason: "approved_definition",
        },
      ],
    });

    const result = await createOntologyChangeSetMutation(
      null,
      {
        input: {
          tenantId: "tenant-1",
          items: [
            {
              itemType: "ENTITY_TYPE",
              slug: "shipment",
              proposedValue: '{"slug":"shipment","name":"Shipment"}',
            },
          ],
        },
      },
      ctx,
    );

    expect(mockCreateOntologyChangeSet).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        actorUserId: "user-1",
        items: [
          expect.objectContaining({
            itemType: "entity_type",
            action: "create",
            slug: "shipment",
            // AWSJSON string payloads are parsed before hitting the repository.
            proposedValue: { slug: "shipment", name: "Shipment" },
          }),
        ],
      }),
    );
    // Conflicts round-trip back to the GraphQL enum casing.
    expect(result.conflicts).toEqual([
      { slug: "order", itemType: "ENTITY_TYPE", reason: "approved_definition" },
    ]);
    expect(result.mergedItemIds).toEqual(["item-merged"]);
  });

  it("does not stage manual authoring for non-admin callers", async () => {
    mockRequireTenantAdmin.mockRejectedValue(new Error("forbidden"));

    await expect(
      createOntologyChangeSetMutation(
        null,
        { input: { tenantId: "tenant-1", items: [] } },
        ctx,
      ),
    ).rejects.toThrow("forbidden");

    expect(mockCreateOntologyChangeSet).not.toHaveBeenCalled();
  });

  it("does not mutate ontology change sets for non-admin callers", async () => {
    mockRequireTenantAdmin.mockRejectedValue(new Error("forbidden"));

    await expect(
      approveOntologyChangeSetMutation(
        null,
        {
          input: { tenantId: "tenant-1", changeSetId: "change-set-1" },
        },
        ctx,
      ),
    ).rejects.toThrow("forbidden");

    expect(mockApproveOntologyChangeSet).not.toHaveBeenCalled();
  });

  it("rejects a change set with an audit reason", async () => {
    mockRejectOntologyChangeSet.mockResolvedValue({
      id: "change-set-1",
      status: "REJECTED",
    });

    await rejectOntologyChangeSetMutation(
      null,
      {
        input: {
          tenantId: "tenant-1",
          changeSetId: "change-set-1",
          reason: "Too broad",
        },
      },
      ctx,
    );

    expect(mockRejectOntologyChangeSet).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      changeSetId: "change-set-1",
      reason: "Too broad",
      actorUserId: "user-1",
    });
  });

  it("rejects a single change-set item after an admin gate (U6)", async () => {
    mockRejectOntologyChangeSetItem.mockResolvedValue({
      id: "change-set-1",
      status: "PENDING_REVIEW",
    });

    await rejectOntologyChangeSetItemMutation(
      null,
      {
        input: {
          tenantId: "tenant-1",
          itemId: "item-1",
          reason: "Not a real concept",
        },
      },
      ctx,
    );

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(ctx, "tenant-1");
    expect(mockRejectOntologyChangeSetItem).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      itemId: "item-1",
      reason: "Not a real concept",
      actorUserId: "user-1",
    });
  });

  it("propagates the admin-gate failure for item-level reject", async () => {
    mockRequireTenantAdmin.mockRejectedValue(new GraphQLError("Forbidden"));

    await expect(
      rejectOntologyChangeSetItemMutation(
        null,
        { input: { tenantId: "tenant-1", itemId: "item-1" } },
        ctx,
      ),
    ).rejects.toThrow("Forbidden");
    expect(mockRejectOntologyChangeSetItem).not.toHaveBeenCalled();
  });

  it("updates entity definitions through an admin-gated mutation", async () => {
    mockUpdateOntologyEntityType.mockResolvedValue({
      id: "entity-customer",
      name: "Customer",
      lifecycleStatus: "APPROVED",
    });

    const result = await updateOntologyEntityTypeMutation(
      null,
      {
        input: {
          tenantId: "tenant-1",
          entityTypeId: "entity-customer",
          name: "Customer",
          description: "Commercial account",
          broadType: "organization",
          aliases: ["account", "client"],
          guidanceNotes: "Compile account-facing facts.",
          lifecycleStatus: "APPROVED",
        },
      },
      ctx,
    );

    expect(result.name).toBe("Customer");
    expect(mockUpdateOntologyEntityType).toHaveBeenCalledWith({
      actorUserId: "user-1",
      input: {
        tenantId: "tenant-1",
        entityTypeId: "entity-customer",
        name: "Customer",
        description: "Commercial account",
        broadType: "organization",
        aliases: ["account", "client"],
        guidanceNotes: "Compile account-facing facts.",
        lifecycleStatus: "approved",
      },
    });
  });

  it("updates relationship definitions through an admin-gated mutation", async () => {
    mockUpdateOntologyRelationshipType.mockResolvedValue({
      id: "rel-stakeholder",
      name: "Stakeholder",
      lifecycleStatus: "APPROVED",
    });

    await updateOntologyRelationshipTypeMutation(
      null,
      {
        input: {
          tenantId: "tenant-1",
          relationshipTypeId: "rel-stakeholder",
          name: "Stakeholder",
          inverseName: "Has stakeholder",
          sourceTypeSlugs: ["person"],
          targetTypeSlugs: ["customer"],
          aliases: ["contact"],
          guidanceNotes: "Connect people to accounts.",
          lifecycleStatus: "DEPRECATED",
        },
      },
      ctx,
    );

    expect(mockUpdateOntologyRelationshipType).toHaveBeenCalledWith({
      actorUserId: "user-1",
      input: {
        tenantId: "tenant-1",
        relationshipTypeId: "rel-stakeholder",
        name: "Stakeholder",
        inverseName: "Has stakeholder",
        sourceTypeSlugs: ["person"],
        targetTypeSlugs: ["customer"],
        aliases: ["contact"],
        guidanceNotes: "Connect people to accounts.",
        lifecycleStatus: "deprecated",
      },
    });
  });

  it("does not mutate ontology definitions for non-admin callers", async () => {
    mockRequireTenantAdmin.mockRejectedValue(new Error("forbidden"));

    await expect(
      updateOntologyEntityTypeMutation(
        null,
        {
          input: {
            tenantId: "tenant-1",
            entityTypeId: "entity-customer",
            name: "Customer",
          },
        },
        ctx,
      ),
    ).rejects.toThrow("forbidden");

    expect(mockUpdateOntologyEntityType).not.toHaveBeenCalled();
  });

  it("starts suggestion scans and exposes scan and reprocess jobs", async () => {
    mockStartOntologySuggestionScan.mockResolvedValue({ id: "scan-1" });
    mockLoadOntologySuggestionScanJob.mockResolvedValue({
      id: "scan-1",
      status: "PENDING",
    });
    mockLoadOntologyReprocessJob.mockResolvedValue({
      id: "reprocess-1",
      status: "PENDING",
    });

    await startOntologySuggestionScanMutation(
      null,
      {
        input: {
          tenantId: "tenant-1",
          trigger: "manual",
          dedupeKey: "tenant-1:manual",
        },
      },
      ctx,
    );
    const scan = await ontologySuggestionScanJob(
      null,
      { tenantId: "tenant-1", jobId: "scan-1" },
      ctx,
    );
    const reprocess = await ontologyReprocessJob(
      null,
      { tenantId: "tenant-1", jobId: "reprocess-1" },
      ctx,
    );

    expect(mockStartOntologySuggestionScan).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      trigger: "manual",
      dedupeKey: "tenant-1:manual",
    });
    expect(scan?.status).toBe("PENDING");
    expect(reprocess?.status).toBe("PENDING");
  });

  it("rejects invalid draft item statuses before hitting the repository", () => {
    expect(changeSetStatusFromGraphQL("PENDING_REVIEW")).toBe("pending_review");
    expect(() => itemStatusFromGraphQL("DRAFT")).toThrow(
      /not a valid ontology change-set item status/,
    );
  });

  it("coerces IDENTITY_MAP to the identity_map storage kind (THINK-321 U3)", () => {
    expect(changeItemTypeFromGraphQL("IDENTITY_MAP")).toBe("identity_map");
  });

  it("stages a system-map edit as a draft identity_map item behind the admin gate (THINK-321 U3)", async () => {
    mockStageOntologyEntityTypeSystemMap.mockResolvedValue({
      changeSet: { id: "draft-1", status: "DRAFT" },
      mergedItemIds: [],
      conflicts: [],
    });

    const result = await setOntologyEntityTypeSystemMapMutation(
      null,
      {
        tenantId: "tenant-1",
        entityTypeSlug: "customer",
        // AWSJSON string payloads are parsed before hitting the repository.
        systemMap:
          '[{"facet":"invoices","sourceSystem":"lastmile"},{"facet":"touchpoints","sourceSystem":"twenty"}]',
      },
      ctx,
    );

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(ctx, "tenant-1");
    expect(mockStageOntologyEntityTypeSystemMap).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      entityTypeSlug: "customer",
      systemMap: [
        { facet: "invoices", sourceSystem: "lastmile" },
        { facet: "touchpoints", sourceSystem: "twenty" },
      ],
      actorUserId: "user-1",
    });
    expect(result.changeSet).toEqual({ id: "draft-1", status: "DRAFT" });
  });

  it("does not stage system-map edits for non-admin callers", async () => {
    mockRequireTenantAdmin.mockRejectedValue(new Error("forbidden"));

    await expect(
      setOntologyEntityTypeSystemMapMutation(
        null,
        {
          tenantId: "tenant-1",
          entityTypeSlug: "customer",
          systemMap: [],
        },
        ctx,
      ),
    ).rejects.toThrow("forbidden");

    expect(mockStageOntologyEntityTypeSystemMap).not.toHaveBeenCalled();
  });

  it("lists ontology packs behind the admin gate with uppercased states", async () => {
    mockListOntologyPacks.mockResolvedValue([
      {
        slug: "revenue",
        name: "Revenue Operations",
        description: "Opportunities and orders.",
        types: [
          { slug: "opportunity", name: "Opportunity", state: "approved" },
          { slug: "order", name: "Order", state: "available" },
        ],
      },
    ]);

    const packs = await ontologyPacks({}, { tenantId: "tenant-1" }, ctx);

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(ctx, "tenant-1");
    expect(packs[0]?.types).toEqual([
      expect.objectContaining({ slug: "opportunity", state: "APPROVED" }),
      expect.objectContaining({ slug: "order", state: "AVAILABLE" }),
    ]);
  });

  it("installs a pack behind the admin gate and maps conflicts to GraphQL", async () => {
    mockInstallOntologyPack.mockResolvedValue({
      changeSet: { id: "set-1" },
      mergedItemIds: ["item-1"],
      conflicts: [
        {
          slug: "order",
          itemType: "entity_type",
          reason: "approved_definition",
        },
      ],
      skippedRejectedSlugs: ["risk"],
    });

    const payload = await installOntologyPackMutation(
      {},
      { input: { tenantId: "tenant-1", packSlug: "revenue" } },
      ctx,
    );

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(ctx, "tenant-1");
    expect(mockInstallOntologyPack).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      packSlug: "revenue",
    });
    expect(payload).toEqual({
      changeSet: { id: "set-1" },
      mergedItemIds: ["item-1"],
      conflicts: [
        {
          slug: "order",
          itemType: "ENTITY_TYPE",
          reason: "approved_definition",
        },
      ],
      skippedRejectedSlugs: ["risk"],
    });
  });

  it("propagates the admin-gate rejection for pack surfaces", async () => {
    mockRequireTenantAdmin.mockRejectedValue(new GraphQLError("forbidden"));

    await expect(
      ontologyPacks({}, { tenantId: "tenant-1" }, ctx),
    ).rejects.toThrow("forbidden");
    await expect(
      installOntologyPackMutation(
        {},
        { input: { tenantId: "tenant-1", packSlug: "revenue" } },
        ctx,
      ),
    ).rejects.toThrow("forbidden");
    expect(mockListOntologyPacks).not.toHaveBeenCalled();
    expect(mockInstallOntologyPack).not.toHaveBeenCalled();
  });
});

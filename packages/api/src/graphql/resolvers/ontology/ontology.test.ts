import { GraphQLError } from "graphql";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireTenantAdmin,
  mockResolveCallerUserId,
  mockListOntologyDefinitions,
  mockListOntologyChangeSets,
  mockLoadOntologySuggestionScanJob,
  mockLoadOntologyReprocessJob,
  mockStartOntologySuggestionScan,
  mockUpdateOntologyChangeSet,
  mockApproveOntologyChangeSet,
  mockRejectOntologyChangeSet,
  mockUpdateOntologyEntityType,
  mockUpdateOntologyRelationshipType,
} = vi.hoisted(() => ({
  mockRequireTenantAdmin: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  mockListOntologyDefinitions: vi.fn(),
  mockListOntologyChangeSets: vi.fn(),
  mockLoadOntologySuggestionScanJob: vi.fn(),
  mockLoadOntologyReprocessJob: vi.fn(),
  mockStartOntologySuggestionScan: vi.fn(),
  mockUpdateOntologyChangeSet: vi.fn(),
  mockApproveOntologyChangeSet: vi.fn(),
  mockRejectOntologyChangeSet: vi.fn(),
  mockUpdateOntologyEntityType: vi.fn(),
  mockUpdateOntologyRelationshipType: vi.fn(),
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("../../../lib/ontology/repository.js", () => ({
  listOntologyDefinitions: mockListOntologyDefinitions,
  listOntologyChangeSets: mockListOntologyChangeSets,
  loadOntologySuggestionScanJob: mockLoadOntologySuggestionScanJob,
  loadOntologyReprocessJob: mockLoadOntologyReprocessJob,
  updateOntologyChangeSet: mockUpdateOntologyChangeSet,
  approveOntologyChangeSet: mockApproveOntologyChangeSet,
  rejectOntologyChangeSet: mockRejectOntologyChangeSet,
  updateOntologyEntityType: mockUpdateOntologyEntityType,
  updateOntologyRelationshipType: mockUpdateOntologyRelationshipType,
}));

vi.mock("../../../lib/ontology/suggestions.js", () => ({
  startOntologySuggestionScanJob: mockStartOntologySuggestionScan,
}));

import { approveOntologyChangeSetMutation } from "./approveOntologyChangeSet.mutation.js";
import {
  changeSetStatusFromGraphQL,
  itemStatusFromGraphQL,
} from "./coercion.js";
import { ontologyChangeSets } from "./ontologyChangeSets.query.js";
import { ontologyDefinitions } from "./ontologyDefinitions.query.js";
import { ontologyReprocessJob } from "./ontologyReprocessJob.query.js";
import { ontologySuggestionScanJob } from "./ontologySuggestionScanJob.query.js";
import { rejectOntologyChangeSetMutation } from "./rejectOntologyChangeSet.mutation.js";
import { startOntologySuggestionScanMutation } from "./startOntologySuggestionScan.mutation.js";
import { updateOntologyChangeSetMutation } from "./updateOntologyChangeSet.mutation.js";
import { updateOntologyEntityTypeMutation } from "./updateOntologyEntityType.mutation.js";
import { updateOntologyRelationshipTypeMutation } from "./updateOntologyRelationshipType.mutation.js";

const ctx = { auth: { authType: "cognito" } } as any;

describe("ontology GraphQL resolvers", () => {
  beforeEach(() => {
    mockRequireTenantAdmin.mockReset();
    mockResolveCallerUserId.mockReset();
    mockListOntologyDefinitions.mockReset();
    mockListOntologyChangeSets.mockReset();
    mockLoadOntologySuggestionScanJob.mockReset();
    mockLoadOntologyReprocessJob.mockReset();
    mockStartOntologySuggestionScan.mockReset();
    mockUpdateOntologyChangeSet.mockReset();
    mockApproveOntologyChangeSet.mockReset();
    mockRejectOntologyChangeSet.mockReset();
    mockUpdateOntologyEntityType.mockReset();
    mockUpdateOntologyRelationshipType.mockReset();

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
      actorUserId: "user-1",
    });
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
});

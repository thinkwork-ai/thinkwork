import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mocks, queryDocs } = vi.hoisted(() => ({
  mocks: {
    requestMigration: vi.fn(),
    setHeader: vi.fn(),
    updateMigration: vi.fn(),
    useQuery: vi.fn(),
  },
  queryDocs: {
    SettingsCompanyBrainStatusQuery: Symbol("companyBrainStatus"),
    SettingsRequestCompanyBrainProductionMigrationMutation: Symbol(
      "requestCompanyBrainProductionMigration",
    ),
    SettingsUpdateCompanyBrainMigrationMutation: Symbol(
      "updateCompanyBrainMigration",
    ),
  },
}));

vi.mock("urql", () => ({
  useMutation: (doc: unknown) => {
    if (
      doc === queryDocs.SettingsRequestCompanyBrainProductionMigrationMutation
    ) {
      return [{ fetching: false }, mocks.requestMigration];
    }
    if (doc === queryDocs.SettingsUpdateCompanyBrainMigrationMutation) {
      return [{ fetching: false }, mocks.updateMigration];
    }
    return [{ fetching: false }, vi.fn()];
  },
  useQuery: mocks.useQuery,
}));

vi.mock("@/lib/settings-queries", () => queryDocs);

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: mocks.setHeader,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children?: unknown;
  } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children as never}
    </a>
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { BrainOperationsPage } from "./BrainOperationsPage";

const refreshStatus = vi.fn();

function mockStatus(status = baseStatus) {
  mocks.useQuery.mockReturnValue([
    {
      data: { companyBrainStatus: status },
      fetching: false,
    },
    refreshStatus,
  ]);
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  refreshStatus.mockReset();
  mocks.requestMigration.mockResolvedValue({
    data: { requestCompanyBrainProductionMigration: baseStatus.migration },
  });
  mocks.updateMigration.mockResolvedValue({
    data: { updateCompanyBrainMigration: baseStatus.migration },
  });
  mockStatus();
});

afterEach(cleanup);

describe("BrainOperationsPage", () => {
  it("renders tenant-safe Brain posture without backend evidence", () => {
    mockStatus({ ...baseStatus, evidence: null });

    render(<BrainOperationsPage />);

    expect(screen.getByText("Brain operations")).toBeTruthy();
    expect(screen.getByText("default tier")).toBeTruthy();
    expect(screen.getByText("default active")).toBeTruthy();
    expect(screen.getByText("query_brain_context")).toBeTruthy();
    expect(screen.getByText("Evidence hidden")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /open graph/i }).getAttribute("href"),
    ).toBe("/settings/memory/knowledge-graph");
    expect(screen.getByText("Memory graph")).toBeTruthy();
    expect(screen.getByText("Ontology posture")).toBeTruthy();
    expect(screen.getByText("Projection follow-up")).toBeTruthy();
    expect(screen.getByText("Company/wiki projections")).toBeTruthy();
    expect(
      screen.getByText(/company distillation and wiki projection/i),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /open tools/i }).getAttribute("href"),
    ).toBe("/settings/tools");
    expect(screen.queryByText("Cognee endpoint")).toBeNull();
    expect(screen.queryByText("S3 artifact root")).toBeNull();
    expect(JSON.stringify(document.body.textContent)).not.toContain("s3://");
    expect(JSON.stringify(document.body.textContent)).not.toContain(
      "https://cognee.internal",
    );
  });

  it("renders operator evidence when the status query includes it", () => {
    mockStatus({
      ...baseStatus,
      evidence: {
        __typename: "CompanyBrainOperatorEvidence",
        managedApplicationId: "app-1",
        latestDeploymentJobId: "job-1",
        backendMode: "private-substrate",
        graphProvider: "cognee",
        vectorProvider: "postgres",
        embeddingModel: "amazon.titan-embed-text-v2:0",
        vectorDimension: 1024,
        cogneeVersion: "1.0.0",
        cogneeEndpoint: "https://cognee.internal.example.com",
        s3ArtifactRoot: "s3://brain-artifacts/tenant-1/",
        s3ManifestRoot: "s3://brain-manifests/tenant-1/",
        s3VaultProjectionRoot: "s3://brain-vault/tenant-1/",
        neptuneGraphId: "graph-1",
        neptuneEndpoint: "https://neptune.example.com",
        efsFileSystemId: "fs-1",
        productionPosture: "shadow-ready",
        operatorEvidence: { checkedBy: "operator" },
        migrationEvidence: { replay: "pass" },
      },
    });

    render(<BrainOperationsPage />);

    expect(screen.getByText("Cognee endpoint")).toBeTruthy();
    expect(
      screen.getByText("https://cognee.internal.example.com"),
    ).toBeTruthy();
    expect(screen.getByText("S3 artifact root")).toBeTruthy();
    expect(screen.getByText("s3://brain-artifacts/tenant-1/")).toBeTruthy();
    expect(screen.getByText("Neptune graph")).toBeTruthy();
    expect(screen.getByText("graph-1")).toBeTruthy();
  });

  it("promotes degraded and failed states into failure actions", () => {
    mockStatus({
      ...baseStatus,
      status: "failed",
      healthStatus: "failed",
      migration: {
        ...baseStatus.migration,
        id: "migration-1",
        phase: "failed",
        status: "failed",
        errorMessage: "Replay validation failed",
      },
    });

    render(<BrainOperationsPage />);

    expect(
      screen.getAllByText("Brain substrate failed").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Replay validation failed")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /mark rolled back/i }),
    ).toBeTruthy();
  });

  it("requests production migration from ready default posture", async () => {
    render(<BrainOperationsPage />);

    fireEvent.click(
      screen.getByRole("button", { name: /request production migration/i }),
    );

    await waitFor(() => {
      expect(mocks.requestMigration).toHaveBeenCalledWith({ input: {} });
      expect(refreshStatus).toHaveBeenCalledWith({
        requestPolicy: "network-only",
      });
    });
  });

  it("records rollback after a failed migration", async () => {
    mockStatus({
      ...baseStatus,
      migration: {
        ...baseStatus.migration,
        id: "migration-1",
        phase: "failed",
        status: "failed",
      },
    });
    render(<BrainOperationsPage />);

    fireEvent.click(screen.getByRole("button", { name: /mark rolled back/i }));

    await waitFor(() => {
      expect(mocks.updateMigration).toHaveBeenCalledWith({
        input: {
          migrationId: "migration-1",
          phase: "rolled_back",
          status: "rolled_back",
        },
      });
    });
  });

  it("allows a new production request after a rolled-back migration", async () => {
    mockStatus({
      ...baseStatus,
      migration: {
        ...baseStatus.migration,
        id: "migration-1",
        phase: "rolled_back",
        status: "rolled_back",
      },
    });
    render(<BrainOperationsPage />);

    fireEvent.click(
      screen.getByRole("button", { name: /request production migration/i }),
    );

    await waitFor(() => {
      expect(mocks.requestMigration).toHaveBeenCalledWith({ input: {} });
    });
  });
});

// Keep the fixture intentionally loose: individual tests override nullable
// GraphQL fields with concrete operator-only data.
const baseStatus: any = {
  __typename: "CompanyBrainStatus" as const,
  tenantId: "tenant-1",
  storageTier: "default",
  activeBackend: "default",
  status: "ready",
  healthStatus: "healthy",
  counters: {
    __typename: "CompanyBrainOperationalCounters" as const,
    ingestionQueueDepth: 0,
    failedIngestCount: 0,
    graphEntityCount: 17,
    graphEdgeCount: 22,
    sourceArtifactCount: 4,
    vaultProjectionCount: 3,
    latestIngestAt: "2026-06-14T10:00:00.000Z",
    latestProjectionAt: "2026-06-14T10:05:00.000Z",
    ontologyVersion: "company-brain-v1",
  },
  capabilities: {
    __typename: "CompanyBrainCapabilities" as const,
    launch: [
      {
        __typename: "CompanyBrainCapability" as const,
        key: "retrieval",
        status: "enabled",
        message: null,
        source: "dogfood-smoke",
      },
      {
        __typename: "CompanyBrainCapability" as const,
        key: "provenance",
        status: "enabled",
        message: null,
        source: "artifact-manifests",
      },
    ],
    optional: [
      {
        __typename: "CompanyBrainCapability" as const,
        key: "mcp_read",
        status: "enabled",
        message: null,
        source: "context-engine",
      },
    ],
  },
  migration: {
    __typename: "CompanyBrainMigrationStatus" as const,
    id: null,
    phase: "none",
    status: "none",
    fromStorageTier: null,
    toStorageTier: null,
    requestedAt: null,
    startedAt: null,
    completedAt: null,
    rollbackWindowClosesAt: null,
    errorMessage: null,
    validationSummary: JSON.stringify({
      validationPassed: false,
      replayManifestCount: 0,
      sourceCount: 0,
    }),
  },
  evidence: null,
  createdAt: "2026-06-14T09:00:00.000Z",
  updatedAt: "2026-06-14T10:06:00.000Z",
};

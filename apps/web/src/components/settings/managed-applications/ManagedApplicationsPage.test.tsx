import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryDocs, useQueryMock } = vi.hoisted(() => ({
  queryDocs: {
    SettingsDeploymentStatusQuery: Symbol("deploymentStatus"),
    SettingsManagedApplicationsQuery: Symbol("managedApplications"),
  },
  useQueryMock: vi.fn(),
}));

vi.mock("urql", () => ({
  useMutation: () => [{ fetching: false }, vi.fn()],
  useQuery: useQueryMock,
}));

vi.mock("@/lib/settings-queries", () => queryDocs);

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

import { ManagedApplicationsPage } from "./ManagedApplicationsPage";

beforeEach(() => {
  useQueryMock.mockReset();
  useQueryMock.mockImplementation(({ query }: { query: unknown }) => {
    if (query === queryDocs.SettingsManagedApplicationsQuery) {
      return [
        { data: { managedApplications: managedApps }, fetching: false },
        vi.fn(),
      ];
    }
    if (query === queryDocs.SettingsDeploymentStatusQuery) {
      return [{ data: { deploymentStatus }, fetching: false }, vi.fn()];
    }
    return [{ fetching: false }, vi.fn()];
  });
});

afterEach(cleanup);

describe("ManagedApplicationsPage", () => {
  it("renders each managed application as a card linking to its detail page", () => {
    render(<ManagedApplicationsPage />);

    expect(
      screen.getByRole("link", { name: /open cognee/i }).getAttribute("href"),
    ).toBe("/settings/applications/cognee");
    expect(
      screen
        .getByRole("link", { name: /open twenty crm/i })
        .getAttribute("href"),
    ).toBe("/settings/crm");
  });

  it("does not render row-level lifecycle buttons", () => {
    render(<ManagedApplicationsPage />);

    expect(screen.queryByRole("button", { name: /plan deploy/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /plan destroy/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /view plan/i })).toBeNull();
  });
});

const managedApps = [
  {
    __typename: "ManagedApplication",
    id: "app-cognee",
    key: "cognee",
    displayName: "Cognee",
    desiredStatus: "disabled",
    currentStatus: "running",
    selectedReleaseVersion: "2026.06.06",
    selectedManifestDigest: "sha256:manifest",
    lastJobId: null,
    updatedAt: "2026-06-06T12:00:00Z",
  },
  {
    __typename: "ManagedApplication",
    id: "app-twenty",
    key: "twenty",
    displayName: "Twenty CRM",
    desiredStatus: "disabled",
    currentStatus: "running",
    selectedReleaseVersion: "2026.06.06",
    selectedManifestDigest: "sha256:manifest",
    lastJobId: null,
    updatedAt: "2026-06-06T12:00:00Z",
  },
];

const deploymentStatus = {
  __typename: "DeploymentStatus",
  managedApplications: [
    {
      __typename: "ManagedApplicationDeployment",
      key: "cognee",
      displayName: "Cognee",
      description: "Knowledge Graph service.",
      status: "running",
      enabled: true,
      provisioned: true,
      runtimeEnabled: true,
      url: null,
      endpoint: null,
      backendMode: null,
      logGroupName: null,
      logGroupNames: [],
      clusterArn: null,
      serviceName: null,
      serviceNames: [],
      albArn: null,
      targetGroupArn: null,
      storageBucketName: null,
      databaseName: null,
      message: "Cognee is running.",
      managedMcpServerId: null,
      managedMcpStatus: "missing",
      managedMcpInstalled: false,
      managedMcpInstallAvailable: false,
      managedMcpMessage: null,
    },
    {
      __typename: "ManagedApplicationDeployment",
      key: "twenty",
      displayName: "Twenty CRM",
      description: "Self-hosted CRM runtime managed by ThinkWork.",
      status: "running",
      enabled: true,
      provisioned: true,
      runtimeEnabled: true,
      url: "https://crm.example.com",
      endpoint: null,
      backendMode: null,
      logGroupName: null,
      logGroupNames: [],
      clusterArn: null,
      serviceName: null,
      serviceNames: [],
      albArn: null,
      targetGroupArn: null,
      storageBucketName: null,
      databaseName: null,
      message: "Twenty CRM is running.",
      managedMcpServerId: null,
      managedMcpStatus: "missing",
      managedMcpInstalled: false,
      managedMcpInstallAvailable: false,
      managedMcpMessage: null,
    },
  ],
};

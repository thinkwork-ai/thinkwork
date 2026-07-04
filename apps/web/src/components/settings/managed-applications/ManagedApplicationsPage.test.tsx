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
  it("renders only surviving managed applications as cards", () => {
    render(<ManagedApplicationsPage />);

    expect(
      screen
        .getByRole("link", { name: /open twenty crm/i })
        .getAttribute("href"),
    ).toBe("/settings/crm");
    expect(
      screen.getByRole("link", { name: /open n8n/i }).getAttribute("href"),
    ).toBe("/settings/plugins/n8n");
  });

  it("does not render row-level lifecycle buttons", () => {
    render(<ManagedApplicationsPage />);

    expect(screen.queryByRole("button", { name: /plan deploy/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /plan destroy/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /view plan/i })).toBeNull();
  });

  it("keeps surviving app rows independent of plugin installs", () => {
    render(<ManagedApplicationsPage />);

    expect(
      screen
        .getByRole("link", { name: /open twenty crm/i })
        .getAttribute("href"),
    ).toBe("/settings/crm");
  });
});

const managedApps = [
  {
    __typename: "ManagedApplication",
    id: "app-n8n",
    key: "n8n",
    displayName: "n8n",
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
      key: "n8n",
      displayName: "n8n",
      description: "Workflow automation runtime.",
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
      message: "n8n is running.",
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

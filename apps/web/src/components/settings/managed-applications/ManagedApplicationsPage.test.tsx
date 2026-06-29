import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryDocs, useQueryMock, pluginInstallsHolder } = vi.hoisted(() => ({
  queryDocs: {
    SettingsDeploymentStatusQuery: Symbol("deploymentStatus"),
    SettingsManagedApplicationsQuery: Symbol("managedApplications"),
    SettingsPluginInstallsQuery: Symbol("pluginInstalls"),
  },
  useQueryMock: vi.fn(),
  pluginInstallsHolder: { current: [] as Array<{ pluginKey: string }> },
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
  pluginInstallsHolder.current = [];
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
    if (query === queryDocs.SettingsPluginInstallsQuery) {
      return [
        {
          data: { pluginInstalls: pluginInstallsHolder.current },
          fetching: false,
        },
        vi.fn(),
      ];
    }
    return [{ fetching: false }, vi.fn()];
  });
});

afterEach(cleanup);

describe("ManagedApplicationsPage", () => {
  it("renders each managed application as a card linking to its product home", () => {
    render(<ManagedApplicationsPage />);

    expect(
      screen
        .getByRole("link", { name: /open thinkwork brain/i })
        .getAttribute("href"),
    ).toBe("/settings/plugins/company-brain");
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

  it("hides the Twenty row once a twenty plugin install exists while ThinkWork Brain is unaffected", () => {
    pluginInstallsHolder.current = [{ pluginKey: "twenty" }];
    render(<ManagedApplicationsPage />);

    expect(screen.queryByRole("link", { name: /open twenty crm/i })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: /open thinkwork brain/i })
        .getAttribute("href"),
    ).toBe("/settings/plugins/company-brain");
  });

  it("hides the ThinkWork Brain backing row once the company-brain plugin is installed", () => {
    pluginInstallsHolder.current = [{ pluginKey: "company-brain" }];
    render(<ManagedApplicationsPage />);

    expect(
      screen.queryByRole("link", { name: /open thinkwork brain/i }),
    ).toBeNull();
    expect(
      screen
        .getByRole("link", { name: /open twenty crm/i })
        .getAttribute("href"),
    ).toBe("/settings/crm");
  });

  it("keeps the Twenty row while only OTHER plugins are installed", () => {
    pluginInstallsHolder.current = [{ pluginKey: "lastmile" }];
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
    id: "app-cognee",
    key: "cognee",
    displayName: "ThinkWork Brain substrate",
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
      displayName: "ThinkWork Brain substrate",
      description: "Private context substrate.",
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
      message: "ThinkWork Brain substrate is running.",
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

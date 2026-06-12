import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useQueryMock, useTenantMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
  useTenantMock: vi.fn(),
}));

vi.mock("urql", () => ({
  useQuery: useQueryMock,
}));

vi.mock("@tanstack/react-router", () => ({
  Navigate: ({ to }: { to: string }) => <div>Navigate to {to}</div>,
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: useTenantMock,
}));

vi.mock("@/lib/settings-queries", () => ({
  SettingsDeploymentStatusQuery: Symbol("deploymentStatus"),
}));

import { ManagedApplicationRouteGuard } from "./ManagedApplicationRouteGuard";

beforeEach(() => {
  useQueryMock.mockReset();
  useTenantMock.mockReturnValue({ isOperator: true, roleResolved: true });
});

afterEach(cleanup);

describe("ManagedApplicationRouteGuard", () => {
  it("waits for deployment data before redirecting operator app routes", () => {
    useQueryMock.mockReturnValue([{ fetching: false }, vi.fn()]);

    render(
      <ManagedApplicationRouteGuard appKey="twenty" requireProvisioned>
        <div>CRM settings</div>
      </ManagedApplicationRouteGuard>,
    );

    expect(screen.queryByText("CRM settings")).toBeNull();
    expect(screen.queryByText("Navigate to /settings/general")).toBeNull();
  });

  it("renders provisioned app routes once deployment data confirms availability", () => {
    useQueryMock.mockReturnValue([
      {
        fetching: false,
        data: {
          deploymentStatus: {
            twentyProvisioned: true,
            managedApplications: [
              {
                key: "twenty",
                provisioned: true,
                runtimeEnabled: true,
              },
            ],
          },
        },
      },
      vi.fn(),
    ]);

    render(
      <ManagedApplicationRouteGuard appKey="twenty" requireProvisioned>
        <div>CRM settings</div>
      </ManagedApplicationRouteGuard>,
    );

    expect(screen.getByText("CRM settings")).toBeTruthy();
    expect(screen.queryByText("Navigate to /settings/general")).toBeNull();
  });

  it("renders disabled app routes when disabled state is explicitly allowed", () => {
    useQueryMock.mockReturnValue([
      {
        fetching: false,
        data: {
          deploymentStatus: {
            managedApplications: [
              {
                key: "cognee",
                provisioned: false,
                runtimeEnabled: false,
              },
            ],
          },
        },
      },
      vi.fn(),
    ]);

    render(
      <ManagedApplicationRouteGuard appKey="cognee" allowDisabled>
        <div>Cognee settings</div>
      </ManagedApplicationRouteGuard>,
    );

    expect(screen.getByText("Cognee settings")).toBeTruthy();
    expect(screen.queryByText("Navigate to /settings/general")).toBeNull();
  });
});

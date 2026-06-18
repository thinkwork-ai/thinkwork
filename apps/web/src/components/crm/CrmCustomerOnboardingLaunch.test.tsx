import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { startMutationMock, queryDocs } = vi.hoisted(() => ({
  startMutationMock: vi.fn(),
  queryDocs: {
    StartTwentyCustomerOnboardingMutation: Symbol(
      "StartTwentyCustomerOnboardingMutation",
    ),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => <a href={to}>{children}</a>,
}));

vi.mock("urql", () => ({
  useMutation: (doc: unknown) => {
    if (doc === queryDocs.StartTwentyCustomerOnboardingMutation) {
      return [{ fetching: false }, startMutationMock];
    }
    return [{ fetching: false }, vi.fn()];
  },
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({
    tenantId: "tenant-1",
    isLoading: false,
  }),
}));

vi.mock("@/lib/graphql-queries", () => queryDocs);

import { TwentyCustomerOnboardingLaunch } from "./CrmCustomerOnboardingLaunch";

beforeEach(() => {
  startMutationMock.mockReset();
  startMutationMock.mockResolvedValue({
    data: {
      startTwentyCustomerOnboarding: {
        action: "CREATED",
        threadId: "thread-1",
        goalId: "goal-1",
        pluginActivationRequired: false,
        statusWritebackState: "BLOCKED",
        missingFields: [],
        thread: {
          id: "thread-1",
          title: "Acme onboarding",
          spaceId: "space-1",
        },
        link: {
          id: "link-1",
          statusHandleState: "WRITEBACK_BLOCKED",
          failureCode: "NATIVE_TWENTY_WRITEBACK_NOT_VERIFIED",
          failureMessage:
            "Native Twenty app/status writeback requires deployed self-hosted runtime verification.",
        },
      },
    },
  });
});

afterEach(cleanup);

describe("TwentyCustomerOnboardingLaunch", () => {
  it("starts or resumes onboarding from a Twenty Opportunity launch", async () => {
    render(
      <TwentyCustomerOnboardingLaunch
        provider="twenty"
        objectType="opportunity"
        objectId="opp-1"
        workflowKey="customer_onboarding"
        search={{
          opportunityUrl: "https://twenty.example/opportunities/opp-1",
          opportunityName: "Expansion renewal",
          companyName: "Acme Corp",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start or resume/i }));

    await waitFor(() =>
      expect(startMutationMock).toHaveBeenCalledWith({
        input: expect.objectContaining({
          tenantId: "tenant-1",
          opportunityId: "opp-1",
          opportunityUrl: "https://twenty.example/opportunities/opp-1",
          opportunityName: "Expansion renewal",
          companyName: "Acme Corp",
          recordSnapshot: expect.objectContaining({
            source: "twenty_launch_route",
          }),
        }),
      }),
    );
    expect(await screen.findByText("Onboarding work started")).toBeTruthy();
    expect(screen.getByRole("link", { name: /open thread/i })).toBeTruthy();
  });

  it("does not submit unsupported CRM launch links", () => {
    render(
      <TwentyCustomerOnboardingLaunch
        provider="twenty"
        objectType="company"
        objectId="company-1"
        workflowKey="customer_onboarding"
        search={{}}
      />,
    );

    expect(screen.getByText("Unsupported CRM launch")).toBeTruthy();
    expect(startMutationMock).not.toHaveBeenCalled();
  });
});

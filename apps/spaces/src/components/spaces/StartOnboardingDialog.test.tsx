import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { startOnboardingMock, queryDocs } = vi.hoisted(() => ({
  startOnboardingMock: vi.fn(),
  queryDocs: {
    StartCustomerOnboardingMutation: Symbol("StartCustomerOnboardingMutation"),
  },
}));

vi.mock("urql", () => ({
  useMutation: (doc: unknown) => {
    if (doc === queryDocs.StartCustomerOnboardingMutation) {
      return [{ fetching: false }, startOnboardingMock];
    }
    return [{ fetching: false }, vi.fn()];
  },
}));

vi.mock("@/lib/graphql-queries", () => queryDocs);

import { StartOnboardingDialog } from "./StartOnboardingDialog";

beforeEach(() => {
  startOnboardingMock.mockReset();
  startOnboardingMock.mockResolvedValue({
    data: { startCustomerOnboarding: { threadId: "thread-1" } },
  });
});
afterEach(cleanup);

describe("StartOnboardingDialog", () => {
  it("submits CRM opportunity facts and returns the created Thread", async () => {
    const onStarted = vi.fn();
    render(
      <StartOnboardingDialog
        tenantId="tenant-1"
        spaceId="space-1"
        onStarted={onStarted}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fireEvent.change(screen.getByLabelText("Opportunity ID"), {
      target: { value: "OPP-1" },
    });
    fireEvent.change(screen.getByLabelText("Customer"), {
      target: { value: "Acme Inc" },
    });
    fireEvent.change(screen.getByLabelText("Sales rep"), {
      target: { value: "Jordan" },
    });
    fireEvent.change(screen.getByLabelText("Document URL"), {
      target: { value: "https://example.com/doc.pdf" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Thread" }));

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("thread-1"));
    expect(startOnboardingMock).toHaveBeenCalledWith({
      input: {
        tenantId: "tenant-1",
        spaceId: "space-1",
        opportunity: expect.objectContaining({
          opportunityId: "OPP-1",
          customerName: "Acme Inc",
          salesRep: "Jordan",
          documents: [
            {
              title: "Onboarding document",
              url: "https://example.com/doc.pdf",
            },
          ],
        }),
      },
    });
  });

  it("keeps the dialog open and surfaces mutation errors", async () => {
    startOnboardingMock.mockResolvedValue({
      error: { message: "LastMile unavailable" },
    });
    render(<StartOnboardingDialog tenantId="tenant-1" spaceId="space-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fireEvent.change(screen.getByLabelText("Opportunity ID"), {
      target: { value: "OPP-1" },
    });
    fireEvent.change(screen.getByLabelText("Customer"), {
      target: { value: "Acme Inc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Thread" }));

    await screen.findByText("LastMile unavailable");
  });
});

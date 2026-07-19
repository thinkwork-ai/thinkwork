/**
 * Starter-pack browser tests (THINK-320 U7, R11/AE4): pack cards with
 * per-type state badges, Install staging a change set and handing the first
 * pending candidate to the host's review flow, and the nothing-new notice
 * when every item merged, conflicted, or was skipped by a rejection
 * fingerprint.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { installMock, reexecuteMock, queryState, queryDocs } = vi.hoisted(
  () => ({
    installMock: vi.fn(),
    reexecuteMock: vi.fn(),
    queryState: {
      packs: {
        data: undefined as unknown,
        fetching: false,
        error: undefined as { message: string } | undefined,
      },
    },
    queryDocs: {
      SettingsOntologyPacksQuery: Symbol("packs"),
      SettingsInstallOntologyPackMutation: Symbol("installPack"),
    },
  }),
);

vi.mock("urql", () => ({
  useQuery: ({ query }: { query: unknown }) => {
    if (query === queryDocs.SettingsOntologyPacksQuery) {
      return [queryState.packs, reexecuteMock];
    }
    throw new Error("unexpected query");
  },
  useMutation: () => [{}, installMock],
}));
vi.mock("@/lib/settings-queries", () => queryDocs);
vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1", userId: "user-1" }),
}));

import { OntologyPacksView } from "./OntologyPacksView";

afterEach(cleanup);

const PACKS = [
  {
    slug: "customer-support",
    name: "Customer Support",
    description: "Support cases and commitments.",
    types: [
      {
        slug: "support_case",
        name: "Support Case",
        description: null,
        state: "AVAILABLE",
      },
      {
        slug: "commitment",
        name: "Commitment",
        description: null,
        state: "PENDING",
      },
      {
        slug: "customer",
        name: "Customer",
        description: null,
        state: "APPROVED",
      },
    ],
  },
  {
    slug: "revenue",
    name: "Revenue",
    description: "Deals and accounts.",
    types: [
      { slug: "deal", name: "Deal", description: null, state: "APPROVED" },
      {
        slug: "account",
        name: "Account",
        description: null,
        state: "PENDING",
      },
    ],
  },
];

describe("OntologyPacksView", () => {
  beforeEach(() => {
    installMock.mockReset();
    reexecuteMock.mockReset();
    queryState.packs = {
      data: { ontologyPacks: PACKS },
      fetching: false,
      error: undefined,
    };
  });

  it("renders a card per pack with per-type state badges", () => {
    render(<OntologyPacksView onOpenChangeSet={vi.fn()} />);

    expect(screen.getByText("Customer Support")).toBeTruthy();
    expect(screen.getByText("Revenue")).toBeTruthy();

    const supportTypes = screen.getByRole("list", {
      name: "Customer Support types",
    });
    expect(supportTypes.textContent).toContain("Support Case");
    expect(supportTypes.textContent).toContain("· available");
    expect(supportTypes.textContent).toContain("· pending");
    expect(supportTypes.textContent).toContain("· approved");
  });

  it("disables Install as 'Installed' when no type is still available", () => {
    render(<OntologyPacksView onOpenChangeSet={vi.fn()} />);

    const revenueButton = screen.getByRole("button", {
      name: "Install Revenue",
    }) as HTMLButtonElement;
    expect(revenueButton.textContent).toContain("Installed");
    expect(revenueButton.disabled).toBe(true);

    const supportButton = screen.getByRole("button", {
      name: "Install Customer Support",
    }) as HTMLButtonElement;
    expect(supportButton.textContent).toContain("Install");
    expect(supportButton.disabled).toBe(false);
  });

  it("opens the staged change set in the review flow after install (AE4)", async () => {
    installMock.mockResolvedValue({
      data: {
        installOntologyPack: {
          changeSet: {
            id: "set-9",
            status: "PENDING_REVIEW",
            updatedAt: "2026-07-19T00:00:00.000Z",
            items: [
              {
                id: "item-settled",
                status: "APPROVED",
                itemType: "ENTITY_TYPE",
                targetSlug: "customer",
                title: "Customer",
                proposedValue: { slug: "customer", name: "Customer" },
                editedValue: null,
              },
              {
                id: "item-9",
                status: "PENDING_REVIEW",
                itemType: "ENTITY_TYPE",
                targetSlug: "support_case",
                title: "Support Case",
                proposedValue: { slug: "support_case", name: "Support Case" },
                editedValue: null,
              },
            ],
          },
          mergedItemIds: [],
          skippedRejectedSlugs: [],
          conflicts: [],
        },
      },
    });
    const onOpenChangeSet = vi.fn();
    render(<OntologyPacksView onOpenChangeSet={onOpenChangeSet} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Install Customer Support" }),
    );

    await waitFor(() => {
      expect(onOpenChangeSet).toHaveBeenCalledWith({
        kind: "candidate",
        itemId: "item-9",
        changeSetId: "set-9",
        label: "Support Case",
      });
    });
    expect(installMock).toHaveBeenCalledWith({
      input: { tenantId: "tenant-1", packSlug: "customer-support" },
    });
  });

  it("shows the nothing-new notice when install stages no reviewable set", async () => {
    installMock.mockResolvedValue({
      data: {
        installOntologyPack: {
          changeSet: null,
          mergedItemIds: [],
          skippedRejectedSlugs: ["support_case"],
          conflicts: [],
        },
      },
    });
    const onOpenChangeSet = vi.fn();
    render(<OntologyPacksView onOpenChangeSet={onOpenChangeSet} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Install Customer Support" }),
    );

    const notice = await screen.findByRole("status");
    expect(notice.textContent).toContain("Nothing new to review");
    expect(notice.textContent).toContain("previously rejected");
    expect(onOpenChangeSet).not.toHaveBeenCalled();
    // Card states refresh so pending/approved badges stay truthful.
    expect(reexecuteMock).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
  });

  it("surfaces install failures inline", async () => {
    installMock.mockResolvedValue({ error: { message: "boom" } });
    render(<OntologyPacksView onOpenChangeSet={vi.fn()} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Install Customer Support" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("boom");
  });
});

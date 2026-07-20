/**
 * Identity stewardship list tests (THINK-321 U8): user-confirmed mappings
 * render visually distinct with their source turn (R11), revoke is a
 * two-click confirm that refetches on success, and the authoring/split
 * dialogs receive the expanded entity.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  revokeMock,
  reexecuteMock,
  queryState,
  queryDocs,
  authorDialogProps,
  splitDialogProps,
} = vi.hoisted(() => ({
  revokeMock: vi.fn(),
  reexecuteMock: vi.fn(),
  queryState: {
    entities: {
      data: undefined as unknown,
      fetching: false,
      error: undefined as { message: string } | undefined,
    },
  },
  queryDocs: {
    SettingsCanonicalEntitiesQuery: Symbol("entities"),
    SettingsRevokeEntitySourceMappingMutation: Symbol("revoke"),
  },
  authorDialogProps: { current: null as any },
  splitDialogProps: { current: null as any },
}));

vi.mock("urql", () => ({
  useQuery: ({ query }: { query: unknown }) => {
    if (query === queryDocs.SettingsCanonicalEntitiesQuery) {
      return [queryState.entities, reexecuteMock];
    }
    throw new Error("unexpected query");
  },
  useMutation: () => [{}, revokeMock],
}));
vi.mock("@/lib/settings-queries", () => queryDocs);
vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1", userId: "user-1" }),
}));
vi.mock("./MergeDialog", () => ({
  MergeDialog: () => null,
}));
vi.mock("./AuthorMappingDialog", () => ({
  AuthorMappingDialog: (props: any) => {
    authorDialogProps.current = props;
    return null;
  },
}));
vi.mock("./SplitDialog", () => ({
  SplitDialog: (props: any) => {
    splitDialogProps.current = props;
    return null;
  },
}));

import { IdentityList } from "./IdentityList";

afterEach(cleanup);

const ENTITY = {
  id: "c-1",
  entityTypeSlug: "customer",
  displayName: "Acme Fuel",
  normalizedName: "acme fuel",
  status: "active",
  mergedIntoId: null,
  version: 3,
  updatedAt: new Date().toISOString(),
  sourceMappings: [
    {
      id: "map-rule",
      sourceSystem: "lastmile",
      namespace: "",
      externalId: "cust-42",
      visibility: "tenant",
      createdBy: "rule",
      createdByUserId: null,
      createdThreadRef: null,
      createdAt: new Date().toISOString(),
    },
    {
      id: "map-user",
      sourceSystem: "twenty",
      namespace: "",
      externalId: "tw-9",
      visibility: "tenant",
      createdBy: "user",
      createdByUserId: "user-7",
      createdThreadRef: "thread-42",
      createdAt: new Date().toISOString(),
    },
  ],
};

function renderExpanded(entity = ENTITY) {
  queryState.entities.data = { canonicalEntities: [entity] };
  render(<IdentityList />);
  fireEvent.click(screen.getByRole("button", { name: /Acme Fuel/ }));
}

describe("IdentityList stewardship", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryState.entities.data = undefined;
    queryState.entities.error = undefined;
    authorDialogProps.current = null;
    splitDialogProps.current = null;
  });

  it("renders user-confirmed mappings visually distinct with their source turn (R11)", () => {
    renderExpanded();

    // The user-confirmed link gets a badge + turn ref; rule links plain text.
    expect(screen.getByText("user-confirmed")).toBeTruthy();
    expect(screen.getByText("turn thread-42")).toBeTruthy();
    expect(screen.getByText("by rule")).toBeTruthy();
    expect(screen.queryByText("by user")).toBeNull();
  });

  it("revokes only on the second click (arm/confirm) and refetches", async () => {
    revokeMock.mockResolvedValue({
      data: { revokeEntitySourceMapping: { status: "revoked", reason: null } },
    });
    renderExpanded();

    const revokeButton = screen.getByRole("button", {
      name: "Revoke mapping twenty tw-9",
    });
    fireEvent.click(revokeButton);
    // Armed, not yet revoked.
    expect(revokeMock).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Confirm revoke of twenty tw-9" }),
    );
    await waitFor(() => {
      expect(revokeMock).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        mappingId: "map-user",
        reason: null,
      });
      expect(reexecuteMock).toHaveBeenCalledWith({
        requestPolicy: "network-only",
      });
    });
  });

  it("surfaces a refused revoke instead of refetching", async () => {
    revokeMock.mockResolvedValue({
      data: {
        revokeEntitySourceMapping: {
          status: "refused",
          reason: "mapping_not_found",
        },
      },
    });
    renderExpanded();

    const revokeButton = screen.getByRole("button", {
      name: "Revoke mapping lastmile cust-42",
    });
    fireEvent.click(revokeButton);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Confirm revoke of lastmile cust-42",
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("Revoke refused: mapping_not_found"),
      ).toBeTruthy();
    });
    expect(reexecuteMock).not.toHaveBeenCalled();
  });

  it("opens the authoring dialog for the expanded entity", () => {
    renderExpanded();
    expect(authorDialogProps.current?.open).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Add mapping" }));
    expect(authorDialogProps.current?.open).toBe(true);
    expect(authorDialogProps.current?.entity?.id).toBe("c-1");
  });

  it("opens the split dialog for the expanded entity", () => {
    renderExpanded();
    expect(splitDialogProps.current?.open).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    expect(splitDialogProps.current?.open).toBe(true);
    expect(splitDialogProps.current?.entity?.id).toBe("c-1");
  });

  it("disables Split when there are fewer than two mappings to partition", () => {
    renderExpanded({
      ...ENTITY,
      sourceMappings: ENTITY.sourceMappings.slice(0, 1),
    });
    const splitButton = screen.getByRole("button", {
      name: "Split",
    }) as HTMLButtonElement;
    expect(splitButton.disabled).toBe(true);
  });
});

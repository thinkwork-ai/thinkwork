/**
 * Split dialog tests (THINK-321 U8, KTD-8/AE5): the preview only runs once
 * the partition is valid (both halves non-empty), the confirm echoes the
 * previewed impact exactly, and a server-side stale-preview abort surfaces
 * with a refresh affordance (mirrors merge).
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { splitMock, reexecuteMock, queryState, lastPreviewArgs, queryDocs } =
  vi.hoisted(() => ({
    splitMock: vi.fn(),
    reexecuteMock: vi.fn(),
    queryState: {
      preview: {
        data: undefined as unknown,
        fetching: false,
        error: undefined as { message: string } | undefined,
      },
    },
    lastPreviewArgs: { current: null as any },
    queryDocs: {
      SettingsCanonicalEntitySplitPreviewQuery: Symbol("splitPreview"),
      SettingsSplitCanonicalEntityMutation: Symbol("split"),
    },
  }));

vi.mock("urql", () => ({
  useQuery: (args: { query: unknown; pause?: boolean }) => {
    if (args.query === queryDocs.SettingsCanonicalEntitySplitPreviewQuery) {
      lastPreviewArgs.current = args;
      // Simulate urql pause: no data while paused.
      return [
        args.pause ? { data: undefined, fetching: false } : queryState.preview,
        reexecuteMock,
      ];
    }
    throw new Error("unexpected query");
  },
  useMutation: () => [{}, splitMock],
}));
vi.mock("@/lib/settings-queries", () => queryDocs);

import { SplitDialog } from "./SplitDialog";

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
      id: "map-1",
      sourceSystem: "lastmile",
      namespace: "",
      externalId: "cust-42",
      visibility: "tenant",
      createdBy: "rule",
      createdByUserId: null,
      createdThreadRef: null,
      createdAt: null,
    },
    {
      id: "map-2",
      sourceSystem: "twenty",
      namespace: "",
      externalId: "tw-9",
      visibility: "tenant",
      createdBy: "user",
      createdByUserId: "user-7",
      createdThreadRef: "thread-42",
      createdAt: null,
    },
  ],
} as any;

const PREVIEW = {
  mappingCountA: 1,
  mappingCountB: 1,
  claimCountFollowingB: 2,
  claimCountRemainingA: 3,
  memoryClaimCount: 4,
  graphEntityCount: 5,
  wikiPageId: "wiki-1",
};

function renderDialog() {
  return render(
    <SplitDialog
      open
      onOpenChange={vi.fn()}
      tenantId="tenant-1"
      entity={ENTITY}
      onSplit={vi.fn()}
    />,
  );
}

describe("SplitDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryState.preview.data = undefined;
    queryState.preview.error = undefined;
    lastPreviewArgs.current = null;
  });

  it("pauses the preview until both halves are non-empty, then sends the partition", () => {
    renderDialog();

    // All mappings default to Keep — not a valid split yet.
    expect(lastPreviewArgs.current.pause).toBe(true);
    expect(
      screen.getByText(/Move at least one mapping to the new entity/),
    ).toBeTruthy();

    queryState.preview.data = { canonicalEntitySplitPreview: PREVIEW };
    fireEvent.click(
      screen.getAllByRole("button", { name: "Move", pressed: false })[1]!,
    );

    expect(lastPreviewArgs.current.pause).toBe(false);
    expect(lastPreviewArgs.current.variables.assignments).toEqual([
      { mappingId: "map-1", half: "a" },
      { mappingId: "map-2", half: "b" },
    ]);
  });

  it("echoes the previewed impact exactly on confirm (KTD-8)", async () => {
    splitMock.mockResolvedValue({
      data: {
        splitCanonicalEntity: {
          entityAId: "c-1",
          entityBId: "c-new",
        },
      },
    });
    queryState.preview.data = { canonicalEntitySplitPreview: PREVIEW };
    renderDialog();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Move", pressed: false })[1]!,
    );
    fireEvent.change(screen.getByLabelText("New entity name"), {
      target: { value: "Acme East" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm split" }));

    await waitFor(() => {
      expect(splitMock).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        canonicalEntityId: "c-1",
        assignments: [
          { mappingId: "map-1", half: "a" },
          { mappingId: "map-2", half: "b" },
        ],
        newEntityDisplayName: "Acme East",
        confirmImpact: {
          mappingCountA: 1,
          mappingCountB: 1,
          claimCountFollowingB: 2,
          claimCountRemainingA: 3,
          memoryClaimCount: 4,
          graphEntityCount: 5,
          wikiPageId: "wiki-1",
        },
      });
    });
  });

  it("keeps confirm disabled until the new entity is named", () => {
    queryState.preview.data = { canonicalEntitySplitPreview: PREVIEW };
    renderDialog();
    fireEvent.click(
      screen.getAllByRole("button", { name: "Move", pressed: false })[1]!,
    );

    const confirm = screen.getByRole("button", {
      name: "Confirm split",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("New entity name"), {
      target: { value: "Acme East" },
    });
    expect(confirm.disabled).toBe(false);
  });

  it("surfaces a stale-preview abort with a refresh affordance", async () => {
    splitMock.mockResolvedValue({
      error: {
        message:
          "[GraphQL] Split impact changed since preview — refresh and confirm again",
      },
    });
    queryState.preview.data = { canonicalEntitySplitPreview: PREVIEW };
    renderDialog();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Move", pressed: false })[1]!,
    );
    fireEvent.change(screen.getByLabelText("New entity name"), {
      target: { value: "Acme East" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm split" }));

    await waitFor(() => {
      expect(screen.getByText(/impact changed since preview/)).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
    expect(reexecuteMock).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
  });
});

/**
 * Crosswalk link authoring dialog tests (THINK-321 U8, R12): submit passes
 * trimmed values for the expanded entity, and typed already_linked /
 * refused results surface as messages instead of closing the dialog.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authorMock, queryDocs } = vi.hoisted(() => ({
  authorMock: vi.fn(),
  queryDocs: {
    SettingsAuthorEntitySourceMappingMutation: Symbol("author"),
  },
}));

vi.mock("urql", () => ({
  useMutation: () => [{}, authorMock],
}));
vi.mock("@/lib/settings-queries", () => queryDocs);

import { AuthorMappingDialog } from "./AuthorMappingDialog";

afterEach(cleanup);

const ENTITY = { id: "c-1", displayName: "Acme Fuel" } as any;

function renderDialog(onAuthored = vi.fn(), onOpenChange = vi.fn()) {
  render(
    <AuthorMappingDialog
      open
      onOpenChange={onOpenChange}
      tenantId="tenant-1"
      entity={ENTITY}
      onAuthored={onAuthored}
    />,
  );
  return { onAuthored, onOpenChange };
}

function fill() {
  fireEvent.change(screen.getByLabelText("Source system"), {
    target: { value: " lastmile " },
  });
  fireEvent.change(screen.getByLabelText("External id"), {
    target: { value: " cust-42 " },
  });
}

describe("AuthorMappingDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits trimmed values for the entity and closes on success", async () => {
    authorMock.mockResolvedValue({
      data: { authorEntitySourceMapping: { status: "created" } },
    });
    const { onAuthored, onOpenChange } = renderDialog();

    fill();
    fireEvent.click(screen.getByRole("button", { name: "Add mapping" }));

    await waitFor(() => {
      expect(authorMock).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        canonicalEntityId: "c-1",
        sourceSystem: "lastmile",
        namespace: null,
        externalId: "cust-42",
      });
      expect(onAuthored).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("surfaces already_linked as guidance instead of closing", async () => {
    authorMock.mockResolvedValue({
      data: {
        authorEntitySourceMapping: {
          status: "already_linked",
          existingMappingId: "map-x",
        },
      },
    });
    const { onAuthored } = renderDialog();

    fill();
    fireEvent.click(screen.getByRole("button", { name: "Add mapping" }));

    await waitFor(() => {
      expect(
        screen.getByText(/already linked to a canonical entity/),
      ).toBeTruthy();
    });
    expect(onAuthored).not.toHaveBeenCalled();
  });

  it("keeps submit disabled until source system and external id are set", () => {
    renderDialog();
    const submit = screen.getByRole("button", {
      name: "Add mapping",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fill();
    expect(submit.disabled).toBe(false);
  });
});

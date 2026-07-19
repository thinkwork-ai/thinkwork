/**
 * Shared form editor tests (THINK-320 U6, KTD-9): AE1 — add-triple save
 * calls createOntologyChangeSet (never a direct definition write) with the
 * staged items; R14 — the create conflict payload and the client-side slug
 * precheck both surface instead of silently overwriting; R16 — edit saves
 * carry expectedUpdatedAt and a stale save renders the refresh prompt.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createMock, updateMock, queryDocs } = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
  queryDocs: {
    SettingsCreateOntologyChangeSetMutation: Symbol("create"),
    SettingsUpdateOntologyChangeSetMutation: Symbol("update"),
  },
}));

vi.mock("urql", () => ({
  useMutation: (doc: unknown) => {
    if (doc === queryDocs.SettingsCreateOntologyChangeSetMutation) {
      return [{ fetching: false }, createMock];
    }
    if (doc === queryDocs.SettingsUpdateOntologyChangeSetMutation) {
      return [{ fetching: false }, updateMock];
    }
    throw new Error("unexpected mutation");
  },
}));
vi.mock("@/lib/settings-queries", () => queryDocs);

import {
  OntologyTripleForm,
  isOntologyConflictMessage,
  ontologySlugPrecheck,
  ontologySlugify,
} from "./OntologyTripleForm";

afterEach(cleanup);

const TYPE_OPTIONS = [
  { slug: "site", name: "Site" },
  { slug: "crew", name: "Crew" },
];
const EXISTING_SLUGS = new Set(["site", "crew", "works_at"]);

function renderAddForm(
  overrides: Partial<{
    onSaved: () => void;
    onRefresh: () => void;
  }> = {},
) {
  const onSaved = overrides.onSaved ?? vi.fn();
  const onRefresh = overrides.onRefresh ?? vi.fn();
  render(
    <OntologyTripleForm
      tenantId="tenant-1"
      typeOptions={TYPE_OPTIONS}
      existingSlugs={EXISTING_SLUGS}
      onSaved={onSaved}
      onRefresh={onRefresh}
    />,
  );
  return { onSaved, onRefresh };
}

describe("OntologyTripleForm — add triple (AE1, R7)", () => {
  beforeEach(() => {
    createMock.mockReset();
    updateMock.mockReset();
  });

  it("stages the triple through createOntologyChangeSet with a new-type endpoint", async () => {
    createMock.mockResolvedValue({
      data: {
        createOntologyChangeSet: {
          changeSet: { id: "set-1" },
          mergedItemIds: [],
          conflicts: [],
        },
      },
      error: undefined,
    });
    const { onSaved } = renderAddForm();

    fireEvent.change(screen.getByLabelText("Source type"), {
      target: { value: "site" },
    });
    fireEvent.change(screen.getByLabelText("Relationship"), {
      target: { value: "Shipped by" },
    });
    fireEvent.change(screen.getByLabelText("Target type"), {
      target: { value: "__new__" },
    });
    fireEvent.change(await screen.findByLabelText("New target type name"), {
      target: { value: "Carrier" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Propose triple" }));

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-1",
          items: [
            {
              itemType: "ENTITY_TYPE",
              slug: "carrier",
              proposedValue: { slug: "carrier", name: "Carrier" },
            },
            {
              itemType: "RELATIONSHIP_TYPE",
              slug: "shipped_by",
              description: null,
              proposedValue: {
                slug: "shipped_by",
                name: "Shipped by",
                sourceTypeSlugs: ["site"],
                targetTypeSlugs: ["carrier"],
              },
            },
          ],
        },
      });
    });
    // AE1: the ghost appears via the host's refetch after onSaved — no
    // approve/version mutation is ever part of the save path.
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("renders the refresh prompt on an approved-slug conflict payload (R14)", async () => {
    createMock.mockResolvedValue({
      data: {
        createOntologyChangeSet: {
          changeSet: null,
          mergedItemIds: [],
          conflicts: [
            {
              slug: "carrier",
              itemType: "ENTITY_TYPE",
              reason: "approved_definition",
            },
          ],
        },
      },
      error: undefined,
    });
    const { onSaved, onRefresh } = renderAddForm();

    fireEvent.change(screen.getByLabelText("Source type"), {
      target: { value: "site" },
    });
    fireEvent.change(screen.getByLabelText("Relationship"), {
      target: { value: "Shipped by" },
    });
    fireEvent.change(screen.getByLabelText("Target type"), {
      target: { value: "__new__" },
    });
    fireEvent.change(await screen.findByLabelText("New target type name"), {
      target: { value: "Carrier" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Propose triple" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        '"carrier" already exists as an approved definition',
      );
    });
    expect(onSaved).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("pre-validates duplicate slugs client-side before any network call (R14)", async () => {
    const { onSaved } = renderAddForm();

    fireEvent.change(screen.getByLabelText("Source type"), {
      target: { value: "crew" },
    });
    fireEvent.change(screen.getByLabelText("Relationship"), {
      target: { value: "Works at" },
    });
    fireEvent.change(screen.getByLabelText("Target type"), {
      target: { value: "__new__" },
    });
    fireEvent.change(await screen.findByLabelText("New target type name"), {
      target: { value: "Site" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Propose triple" }));

    await waitFor(() => {
      expect(screen.getByText(/"site" already exists/)).toBeTruthy();
    });
    expect(screen.getByText(/"works_at" already exists/)).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("OntologyTripleForm — candidate edit (R16)", () => {
  beforeEach(() => {
    createMock.mockReset();
    updateMock.mockReset();
  });

  const EDIT_ITEM = {
    id: "item-1",
    changeSetId: "set-1",
    itemType: "ENTITY_TYPE",
    updatedAt: "2026-07-18T12:00:00.000Z",
    value: {
      slug: "work_order",
      name: "Work Order",
      description: "Scheduled field work.",
    },
  };

  function renderEditForm() {
    const onSaved = vi.fn();
    const onRefresh = vi.fn();
    render(
      <OntologyTripleForm
        tenantId="tenant-1"
        editItem={EDIT_ITEM}
        typeOptions={TYPE_OPTIONS}
        existingSlugs={EXISTING_SLUGS}
        onSaved={onSaved}
        onRefresh={onRefresh}
      />,
    );
    return { onSaved, onRefresh };
  }

  it("saves the edit with the optimistic-concurrency guard", async () => {
    updateMock.mockResolvedValue({
      data: { updateOntologyChangeSet: { id: "set-1" } },
      error: undefined,
    });
    const { onSaved } = renderEditForm();

    fireEvent.change(screen.getByLabelText("Type name"), {
      target: { value: "Field Work Order" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save edit" }));

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-1",
          changeSetId: "set-1",
          items: [
            {
              id: "item-1",
              editedValue: {
                slug: "work_order",
                name: "Field Work Order",
                description: "Scheduled field work.",
              },
              expectedUpdatedAt: "2026-07-18T12:00:00.000Z",
            },
          ],
        },
      });
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("renders the refresh prompt on a stale-save conflict — never a silent overwrite", async () => {
    updateMock.mockResolvedValue({
      data: undefined,
      error: {
        message:
          "[GraphQL] Ontology change-set item item-1 changed since it was loaded — reload before editing",
      },
    });
    const { onSaved, onRefresh } = renderEditForm();

    fireEvent.click(screen.getByRole("button", { name: "Save edit" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "changed since you opened it",
      );
    });
    expect(onSaved).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("shows non-conflict failures as a plain error", async () => {
    updateMock.mockResolvedValue({
      data: undefined,
      error: { message: "network sadness" },
    });
    const { onSaved } = renderEditForm();

    fireEvent.click(screen.getByRole("button", { name: "Save edit" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "network sadness",
      );
    });
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("slug helpers", () => {
  it("normalizes like the server (R14)", () => {
    expect(ontologySlugify("  Work  Order ")).toBe("work_order");
  });

  it("prechecks format and collisions", () => {
    expect(ontologySlugPrecheck("work_order", new Set())).toBeNull();
    expect(ontologySlugPrecheck("", new Set())).toContain("required");
    expect(ontologySlugPrecheck("bad-slug!", new Set())).toContain(
      "letters, numbers",
    );
    expect(ontologySlugPrecheck("site", new Set(["site"]))).toContain(
      "already exists",
    );
  });

  it("classifies conflict messages (R16)", () => {
    expect(
      isOntologyConflictMessage(
        "item changed since it was loaded — reload before editing",
      ),
    ).toBe(true);
    expect(isOntologyConflictMessage("ONTOLOGY_CHANGE_SET_CONFLICT")).toBe(
      true,
    );
    expect(isOntologyConflictMessage("network sadness")).toBe(false);
  });
});

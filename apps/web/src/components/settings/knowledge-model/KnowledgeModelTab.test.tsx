import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// React 19 gates act() on this flag; RTL only sets it inside its own
// helpers, and some tests drive captured child props directly.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { mapProps, packsProps } = vi.hoisted(() => ({
  mapProps: { current: null as any },
  packsProps: { current: null as any },
}));

vi.mock("@/components/settings/knowledge-graph/KnowledgeGraphTab", () => ({
  KnowledgeGraphTab: () => <div>Definitions content</div>,
}));

vi.mock("./IdentityList", () => ({
  IdentityList: () => <div>Identity content</div>,
}));

vi.mock("./ResolutionQueue", () => ({
  ResolutionQueue: () => <div>Resolution queue content</div>,
}));

vi.mock("./OntologyMapView", () => ({
  OntologyMapView: (props: any) => {
    mapProps.current = props;
    return <div>Living map content</div>;
  },
}));

vi.mock("./OntologyPacksView", () => ({
  OntologyPacksView: (props: any) => {
    packsProps.current = props;
    return <div>Starter packs content</div>;
  },
}));

import { KnowledgeModelTab } from "./KnowledgeModelTab";

afterEach(cleanup);

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const tabSource = read(
  "src/components/settings/knowledge-model/KnowledgeModelTab.tsx",
);
const definitionsSource = read(
  "src/components/settings/knowledge-graph/KnowledgeGraphTab.tsx",
);
const identitySource = read(
  "src/components/settings/knowledge-model/IdentityList.tsx",
);
const queueSource = read(
  "src/components/settings/knowledge-model/ResolutionQueue.tsx",
);

describe("KnowledgeModelTab", () => {
  beforeEach(() => {
    mapProps.current = null;
    packsProps.current = null;
  });

  it("owns a single title row whose title opens the view menu", () => {
    expect(tabSource).toContain("SettingsPageTitle");
    expect(tabSource).toContain("<DropdownMenu");
    expect(tabSource).toContain("<DropdownMenuTrigger");
    expect(tabSource).toContain("<DropdownMenuRadioGroup");
    expect(tabSource).toContain("aria-label={`Ontology view: ${title}`}");
    expect(tabSource).not.toContain("<ToggleGroup");
  });

  it("swaps title and description from the per-view map", () => {
    expect(tabSource).toContain("VIEW_TITLES");
    expect(tabSource).toContain('title: "Living Map"');
    expect(tabSource).toContain('title: "Definitions"');
    expect(tabSource).toContain('title: "Identity"');
    expect(tabSource).toContain('title: "Resolution Queue"');
  });

  it("lands on the Living Map by default (KTD-8)", () => {
    render(<KnowledgeModelTab />);

    expect(screen.getByText("Living map content")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Ontology view: Living Map" }),
    ).toBeTruthy();
    expect(screen.queryByText("Definitions content")).toBeNull();
  });

  it("keeps the Definitions tables reachable from the map default", async () => {
    render(<KnowledgeModelTab />);

    const trigger = screen.getByRole("button", {
      name: "Ontology view: Living Map",
    });
    fireEvent.keyDown(trigger, { key: "Enter", code: "Enter" });
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: "Definitions" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Definitions content")).toBeTruthy();
    });
  });

  it("titles the Definitions view without ontology jargon", () => {
    expect(tabSource).toContain(
      "Inspect approved terms and relationship definitions.",
    );
    expect(tabSource).not.toContain('title: "Ontology"');
    expect(tabSource).not.toContain("approved ontology terms");
  });

  it("switches views from the title menu", async () => {
    render(<KnowledgeModelTab />);

    expect(screen.getByText("Living map content")).toBeTruthy();
    const trigger = screen.getByRole("button", {
      name: "Ontology view: Living Map",
    });

    fireEvent.keyDown(trigger, { key: "Enter", code: "Enter" });
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: "Identity" }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Ontology view: Identity" }),
      ).toBeTruthy();
      expect(screen.getByText("Identity content")).toBeTruthy();
    });
  });

  it("makes the Starter Packs browser reachable from the view selector (U7)", async () => {
    render(<KnowledgeModelTab />);

    const trigger = screen.getByRole("button", {
      name: "Ontology view: Living Map",
    });
    fireEvent.keyDown(trigger, { key: "Enter", code: "Enter" });
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: "Starter Packs" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Starter packs content")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Ontology view: Starter Packs" }),
      ).toBeTruthy();
    });
  });

  it("routes the map's day-one callout to the packs view", () => {
    render(<KnowledgeModelTab />);

    act(() => mapProps.current.onOpenPacks());
    expect(screen.getByText("Starter packs content")).toBeTruthy();
  });

  it("hands a pack install off to the map's review flow, once (AE4)", () => {
    render(<KnowledgeModelTab />);

    act(() => mapProps.current.onOpenPacks());
    expect(screen.getByText("Starter packs content")).toBeTruthy();

    const focus = {
      kind: "candidate",
      itemId: "item-9",
      changeSetId: "set-9",
      label: "Support Case",
    };
    act(() => packsProps.current.onOpenChangeSet(focus));

    // Back on the map with the staged set focused.
    expect(screen.getByText("Living map content")).toBeTruthy();
    expect(mapProps.current.initialFocus).toEqual(focus);

    // Consumption clears the handoff so a later map visit doesn't re-open it.
    act(() => mapProps.current.onInitialFocusConsumed());
    expect(mapProps.current.initialFocus).toBeNull();
  });

  it("renders the sub-views as content only", () => {
    for (const source of [definitionsSource, identitySource, queueSource]) {
      expect(source).not.toContain("SettingsPageTitle");
    }
  });
});

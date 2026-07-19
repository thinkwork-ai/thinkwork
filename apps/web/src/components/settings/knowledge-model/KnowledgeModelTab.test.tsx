import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeModelTab } from "./KnowledgeModelTab";

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
  OntologyMapView: () => <div>Living map content</div>,
}));

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

  it("renders the sub-views as content only", () => {
    for (const source of [definitionsSource, identitySource, queueSource]) {
      expect(source).not.toContain("SettingsPageTitle");
    }
  });
});

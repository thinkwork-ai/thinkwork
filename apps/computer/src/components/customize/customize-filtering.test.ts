import { describe, expect, it } from "vitest";
import {
  filterCustomizeItems,
  uniqueCategories,
  type CustomizeItem,
} from "./customize-filtering";
import { ALL_CATEGORIES } from "./CustomizeToolbar";

const items: CustomizeItem[] = [
  {
    id: "slack",
    name: "Slack",
    description: "Messages",
    category: "Messaging",
    connected: true,
    featured: true,
  },
  {
    id: "github",
    name: "GitHub",
    description: "Repositories",
    category: "Engineering",
    connected: false,
    featured: true,
  },
  {
    id: "drive",
    name: "Google Drive",
    description: "Files",
    category: "Files",
    connected: false,
    featured: false,
  },
];

describe("filterCustomizeItems", () => {
  it("returns all items when no filters are active", () => {
    expect(
      filterCustomizeItems({
        items,
        search: "",
        category: ALL_CATEGORIES,
      }),
    ).toHaveLength(3);
  });

  it("filters by category", () => {
    const result = filterCustomizeItems({
      items,
      search: "",
      category: "Engineering",
    });
    expect(result.map((r) => r.id)).toEqual(["github"]);
  });

  it("filters by case-insensitive search across name/description/category", () => {
    expect(
      filterCustomizeItems({
        items,
        search: "drive",
        category: ALL_CATEGORIES,
      }).map((r) => r.id),
    ).toEqual(["drive"]);
    expect(
      filterCustomizeItems({
        items,
        search: "MESSAG",
        category: ALL_CATEGORIES,
      }).map((r) => r.id),
    ).toEqual(["slack"]);
  });

  it("combines search + category", () => {
    expect(
      filterCustomizeItems({
        items,
        search: "git",
        category: "Engineering",
      }).map((r) => r.id),
    ).toEqual(["github"]);
    expect(
      filterCustomizeItems({
        items,
        search: "git",
        category: "Files",
      }),
    ).toHaveLength(0);
  });
});

describe("uniqueCategories", () => {
  it("returns unique sorted categories from the items", () => {
    expect(uniqueCategories(items)).toEqual([
      "Engineering",
      "Files",
      "Messaging",
    ]);
  });

  it("ignores items without a category", () => {
    const partial: CustomizeItem[] = [
      { id: "a", name: "A", connected: false },
      { id: "b", name: "B", connected: false, category: "Beta" },
    ];
    expect(uniqueCategories(partial)).toEqual(["Beta"]);
  });
});

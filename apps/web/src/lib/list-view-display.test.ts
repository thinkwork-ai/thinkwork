import { describe, expect, it } from "vitest";
import {
  displayStateToSearch,
  groupDisplayRows,
  normalizeDisplayState,
  type DisplayListConfig,
} from "./list-view-display";

type Group = "status" | "type";
type Sort = "name" | "updated";
type Property = "status" | "type" | "updated";

const config: DisplayListConfig<Group, Sort, Property> = {
  modes: ["table", "list"],
  groups: [
    { value: "none", label: "None" },
    { value: "status", label: "Status" },
    { value: "type", label: "Type" },
  ],
  subgroups: [
    { value: "none", label: "None" },
    { value: "status", label: "Status" },
    { value: "type", label: "Type" },
  ],
  sorts: [
    { value: "name", label: "Name" },
    { value: "updated", label: "Updated" },
  ],
  properties: [
    { value: "status", label: "Status" },
    { value: "type", label: "Type" },
    { value: "updated", label: "Updated" },
  ],
  defaults: {
    view: "table",
    group: "status",
    subgroup: "type",
    sort: "name",
    dir: "asc",
    showEmptyGroups: true,
    showEmptySubgroups: false,
    properties: ["status", "type"],
  },
};

describe("list view display helpers", () => {
  it("normalizes valid route search into a supported display state", () => {
    expect(
      normalizeDisplayState(
        {
          view: "list",
          group: "type",
          subgroup: "status",
          sort: "updated",
          dir: "desc",
          emptyGroups: "false",
          emptySubgroups: "true",
          props: "updated,status,updated",
        },
        config,
      ),
    ).toEqual({
      view: "list",
      group: "type",
      subgroup: "status",
      sort: "updated",
      dir: "desc",
      showEmptyGroups: false,
      showEmptySubgroups: true,
      properties: ["updated", "status"],
    });
  });

  it("drops unsupported modes/options and falls back to screen defaults", () => {
    expect(
      normalizeDisplayState(
        {
          view: "board",
          group: "customer",
          subgroup: "status",
          sort: "customer",
          dir: "sideways",
          props: "unknown",
        },
        config,
      ),
    ).toEqual({ ...config.defaults, subgroup: "none" });
  });

  it("resets subgroup when it duplicates the primary group", () => {
    expect(
      normalizeDisplayState(
        { view: "list", group: "status", subgroup: "status" },
        config,
      ).subgroup,
    ).toBe("none");
  });

  it("clears stale subgroup state when primary grouping is none", () => {
    const state = normalizeDisplayState(
      { view: "list", group: "none", subgroup: "status" },
      config,
    );

    expect(state.subgroup).toBe("none");
    expect(displayStateToSearch(state, config)).toMatchObject({
      group: "none",
      subgroup: undefined,
    });
  });

  it("serializes list state and preserves non-default list params in table mode", () => {
    const listState = normalizeDisplayState(
      {
        view: "list",
        group: "type",
        subgroup: "status",
        sort: "updated",
        dir: "desc",
        emptyGroups: false,
        emptySubgroups: true,
        props: "status,updated",
      },
      config,
    );

    expect(displayStateToSearch(listState, config)).toEqual({
      view: "list",
      group: "type",
      subgroup: "status",
      sort: "updated",
      dir: "desc",
      emptyGroups: false,
      emptySubgroups: true,
      props: "status,updated",
    });
    expect(
      displayStateToSearch({ ...listState, view: "table" }, config),
    ).toEqual({
      view: undefined,
      group: "type",
      subgroup: "status",
      sort: "updated",
      dir: "desc",
      emptyGroups: false,
      emptySubgroups: true,
      props: "status,updated",
    });
    expect(displayStateToSearch(config.defaults, config)).toEqual({
      view: undefined,
      group: undefined,
      subgroup: undefined,
      sort: undefined,
      dir: undefined,
      emptyGroups: undefined,
      emptySubgroups: undefined,
      props: undefined,
    });
  });

  it("groups and sorts filtered row collections without replacing row identity", () => {
    const rows = [
      { id: "b", status: "active", type: "schedule", name: "Beta" },
      { id: "a", status: "disabled", type: "manual", name: "Alpha" },
    ];

    const groups = groupDisplayRows({
      rows,
      group: "status",
      subgroup: "type",
      sort: "name",
      dir: "asc",
      showEmptyGroups: true,
      showEmptySubgroups: false,
      groupingOptions: [
        {
          value: "status",
          label: "Status",
          group: (row) => row.status,
          labelFor: (key) => key,
          emptyKeys: [
            { key: "active", label: "Active" },
            { key: "disabled", label: "Disabled" },
          ],
        },
        {
          value: "type",
          label: "Type",
          group: (row) => row.type,
          labelFor: (key) => key,
        },
      ],
      sortOptions: [
        {
          value: "name",
          compare: (left, right) => left.name.localeCompare(right.name),
        },
      ],
    });

    expect(groups.map((group) => group.label)).toEqual(["Active", "Disabled"]);
    expect(groups[0]?.rows).toEqual([rows[0]]);
    expect(groups[1]?.subgroups?.[0]?.rows).toEqual([rows[1]]);
  });
});

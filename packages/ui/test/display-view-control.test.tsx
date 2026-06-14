// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DisplayViewControl, type DisplayControlState } from "../src/index.js";

type State = DisplayControlState<"status" | "type", "name", "status" | "type">;

const state: State = {
  view: "table",
  group: "status",
  subgroup: "type",
  sort: "name",
  dir: "asc",
  showEmptyGroups: true,
  showEmptySubgroups: false,
  properties: ["status"],
};

afterEach(() => cleanup());

describe("DisplayViewControl", () => {
  it("renders only supplied modes and switches to list", async () => {
    const onStateChange = vi.fn();

    render(
      <DisplayViewControl
        state={state}
        modes={[
          { value: "table", label: "Table" },
          { value: "list", label: "List" },
        ]}
        groups={[
          { value: "none", label: "None" },
          { value: "status", label: "Status" },
          { value: "type", label: "Type" },
        ]}
        subgroups={[
          { value: "none", label: "None" },
          { value: "status", label: "Status" },
          { value: "type", label: "Type" },
        ]}
        sorts={[{ value: "name", label: "Name" }]}
        properties={[
          { value: "status", label: "Status" },
          { value: "type", label: "Type" },
        ]}
        onStateChange={onStateChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /display/i }));

    expect(screen.getByRole("button", { name: /table/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /list/i })).toBeTruthy();
    expect(screen.queryByText("Board")).toBeNull();
    expect(screen.queryByText("Map")).toBeNull();
    expect(screen.queryByText("Calendar")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /list/i }));
    expect(onStateChange).toHaveBeenCalledWith({ ...state, view: "list" });
  });

  it("emits list configuration changes and keeps one property selected", async () => {
    const onStateChange = vi.fn();

    render(
      <DisplayViewControl
        state={{ ...state, view: "list" }}
        modes={[
          { value: "table", label: "Table" },
          { value: "list", label: "List" },
        ]}
        groups={[
          { value: "none", label: "None" },
          { value: "status", label: "Status" },
          { value: "type", label: "Type" },
        ]}
        subgroups={[
          { value: "none", label: "None" },
          { value: "status", label: "Status" },
          { value: "type", label: "Type" },
        ]}
        sorts={[{ value: "name", label: "Name" }]}
        properties={[
          { value: "status", label: "Status" },
          { value: "type", label: "Type" },
        ]}
        onStateChange={onStateChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /display/i }));
    fireEvent.click(screen.getByRole("button", { name: /ascending/i }));
    expect(onStateChange).toHaveBeenCalledWith({
      ...state,
      view: "list",
      dir: "desc",
    });

    fireEvent.click(screen.getByLabelText("Empty groups"));
    expect(onStateChange).toHaveBeenCalledWith({
      ...state,
      view: "list",
      dir: "desc",
      showEmptyGroups: false,
    });

    const statusProperty = screen.getByLabelText("Status");
    expect(statusProperty).toHaveProperty("disabled", true);
    fireEvent.click(statusProperty);
    expect(onStateChange).not.toHaveBeenCalledWith({
      ...state,
      view: "list",
      properties: [],
    });
  });
});

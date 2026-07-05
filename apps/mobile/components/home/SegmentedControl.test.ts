import { describe, expect, it, vi } from "vitest";
import React from "react";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  View: "View",
}));
vi.mock("nativewind", () => ({
  useColorScheme: () => ({ colorScheme: "light" }),
}));
vi.mock("@/components/ui/typography", () => ({
  Text: "Text",
}));
vi.mock("@/lib/theme", () => ({
  COLORS: {
    light: {
      foreground: "#171717",
      mutedForeground: "#737373",
    },
    dark: {
      foreground: "#fafafa",
      mutedForeground: "#a3a3a3",
    },
  },
}));

import {
  PersistentSegmentPanels,
  SegmentedControl,
  segmentPanelStyle,
  type SegmentOption,
} from "./SegmentedControl";
import { HOME_SEGMENTS } from "./segments";

describe("home segments", () => {
  it("registers exactly the three badge-free home segments in order", () => {
    expect(HOME_SEGMENTS.map((segment) => segment.key)).toEqual([
      "threads",
      "work-items",
      "wiki",
    ]);
    expect(HOME_SEGMENTS.map((segment) => segment.label)).toEqual([
      "Threads",
      "Work Items",
      "Wiki",
    ]);
    for (const segment of HOME_SEGMENTS) {
      expect("badge" in segment).toBe(false);
      expect("count" in segment).toBe(false);
    }
  });

  it("renders an appended segment through the same control component", () => {
    const segments: SegmentOption[] = [
      ...HOME_SEGMENTS,
      { key: "later", label: "Later" },
    ];
    const onChange = vi.fn();
    const element = SegmentedControl({
      segments,
      activeKey: "later",
      onChange,
    }) as React.ReactElement<any>;

    const outerChildren = React.Children.toArray(element.props.children);
    const pillContainer = outerChildren[0] as React.ReactElement<any>;
    const pills = React.Children.toArray(pillContainer.props.children);
    expect(pills).toHaveLength(4);

    const fourthPill = pills[3] as React.ReactElement<any>;
    fourthPill.props.onPress();
    expect(onChange).toHaveBeenCalledWith("later");
  });

  it("keeps every panel represented while only toggling display state", () => {
    const segments: SegmentOption[] = [
      ...HOME_SEGMENTS,
      { key: "later", label: "Later" },
    ];
    const externalDraftState = new Map<string, string>([
      ["threads", "keep this draft"],
    ]);
    const renderCalls: string[] = [];

    PersistentSegmentPanels({
      segments,
      activeKey: "work-items",
      renderSegment: (segment) => {
        renderCalls.push(segment.key);
        return externalDraftState.get(segment.key) ?? null;
      },
    });

    expect(renderCalls).toEqual(["threads", "work-items", "wiki", "later"]);
    expect(externalDraftState.get("threads")).toBe("keep this draft");
    expect(segmentPanelStyle("threads", "work-items")).toMatchObject({
      display: "none",
    });
    expect(segmentPanelStyle("threads", "threads")).toMatchObject({
      display: "flex",
    });
  });
});

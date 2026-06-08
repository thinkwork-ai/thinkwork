import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  InlineShortcutText,
  shortcutSegmentsForText,
} from "./InlineShortcutText";

describe("InlineShortcutText", () => {
  it("renders agent profile shortcuts without the trigger character", () => {
    render(
      <p>
        <InlineShortcutText
          text="Find the answer.#Research"
          fallbackAgentProfiles
        />
      </p>,
    );

    expect(screen.getByText("Research").getAttribute("data-shortcut-token")).toBe(
      "agent-profile",
    );
    expect(screen.queryByText("#Research")).toBeNull();
    expect(document.body.textContent).toContain("Find the answer.Research");
  });

  it("renders saved mention and skill tokens by display label", () => {
    const segments = shortcutSegmentsForText(
      "@Eric run /ce-plan with #Research",
      {
        mentions: [
          {
            targetType: "USER",
            displayName: "Eric Odom",
            rawText: "@Eric",
          },
        ],
        skillCatalog: [{ slug: "ce-plan", displayName: "CE Plan" }],
        fallbackAgentProfiles: true,
      },
    );

    expect(segments).toEqual([
      expect.objectContaining({ label: "Eric Odom", kind: "user" }),
      expect.objectContaining({ label: "CE Plan", kind: "skill" }),
      expect.objectContaining({ label: "Research", kind: "agent-profile" }),
    ]);
  });

  it("renders fallback mentions without rewriting email addresses", () => {
    render(
      <p>
        <InlineShortcutText
          text="e2e@Research email eric@thinkwork.ai"
          fallbackMentions
        />
      </p>,
    );

    expect(
      screen
        .getAllByText("Research")
        .some((node) => node.getAttribute("data-shortcut-token") === "user"),
    ).toBe(true);
    expect(document.body.textContent).toContain("e2eResearch email eric@thinkwork.ai");
    expect(document.body.textContent).not.toContain("@Research");
  });
});

import { describe, expect, it } from "vitest";
import {
  parseValueToSegments,
  renderSegments,
  serializeEditor,
} from "./SkillTokenInput";
import type { SkillOption } from "@/components/spaces/SkillMenu";

const catalog: SkillOption[] = [
  { slug: "crm-dashboard", displayName: "CRM Dashboard" },
  { slug: "invoice-parser", displayName: "Invoice Parser" },
];

describe("parseValueToSegments", () => {
  it("splits text around a /slug skill pill", () => {
    expect(parseValueToSegments("use /crm-dashboard now", catalog)).toEqual([
      { type: "text", text: "use " },
      { type: "skill", slug: "crm-dashboard", label: "CRM Dashboard" },
      { type: "text", text: " now" },
    ]);
  });

  it("uses the slug as the label when there is no display name", () => {
    const segs = parseValueToSegments("/crm-dashboard", [
      { slug: "crm-dashboard" },
    ]);
    expect(segs).toEqual([
      { type: "skill", slug: "crm-dashboard", label: "crm-dashboard" },
    ]);
  });

  it("leaves unknown /tokens as plain text", () => {
    expect(parseValueToSegments("see /Users/eric", catalog)).toEqual([
      { type: "text", text: "see /Users/eric" },
    ]);
  });

  it("handles multiple skill pills", () => {
    const segs = parseValueToSegments(
      "/crm-dashboard then /invoice-parser",
      catalog,
    );
    expect(segs.filter((s) => s.type === "skill").map((s) => s.slug)).toEqual([
      "crm-dashboard",
      "invoice-parser",
    ]);
  });

  it("renders @displayName as a mention pill (spaces allowed)", () => {
    const segs = parseValueToSegments("hi @Brett Odom there", catalog, [
      { displayName: "Brett Odom", targetType: "USER" },
    ]);
    expect(segs).toEqual([
      { type: "text", text: "hi " },
      { type: "mention", displayName: "Brett Odom", targetType: "USER" },
      { type: "text", text: " there" },
    ]);
  });

  it("interleaves skill and mention pills in order", () => {
    const segs = parseValueToSegments(
      "use /crm-dashboard with @Marco",
      catalog,
      [{ displayName: "Marco", targetType: "AGENT" }],
    );
    expect(segs.map((s) => s.type)).toEqual([
      "text",
      "skill",
      "text",
      "mention",
    ]);
  });

  it("prefers the longer mention when names overlap", () => {
    const segs = parseValueToSegments("@Brett Odom", catalog, [
      { displayName: "Brett", targetType: "USER" },
      { displayName: "Brett Odom", targetType: "USER" },
    ]);
    expect(segs).toEqual([
      { type: "mention", displayName: "Brett Odom", targetType: "USER" },
    ]);
  });
});

describe("renderSegments + serializeEditor round-trip", () => {
  const mentions = [{ displayName: "Brett Odom", targetType: "USER" as const }];
  const roundTrip = (value: string) => {
    const el = document.createElement("div");
    renderSegments(el, parseValueToSegments(value, catalog, mentions));
    return serializeEditor(el);
  };

  it("preserves plain text", () => {
    expect(roundTrip("just some text")).toBe("just some text");
  });

  it("serializes a skill pill back to its /slug token", () => {
    expect(roundTrip("use /crm-dashboard now")).toBe("use /crm-dashboard now");
  });

  it("serializes a mention pill back to its @name token", () => {
    expect(roundTrip("hi @Brett Odom there")).toBe("hi @Brett Odom there");
  });

  it("round-trips mixed skill + mention tokens", () => {
    expect(roundTrip("/crm-dashboard with @Brett Odom")).toBe(
      "/crm-dashboard with @Brett Odom",
    );
  });

  it("renders a skill pill as a non-editable element with the display label", () => {
    const el = document.createElement("div");
    renderSegments(el, parseValueToSegments("/crm-dashboard", catalog));
    const pill = el.querySelector("[data-slug]") as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.getAttribute("contenteditable")).toBe("false");
    expect(pill.textContent).toContain("CRM Dashboard");
  });

  it("renders a mention pill as a non-editable element with the name", () => {
    const el = document.createElement("div");
    renderSegments(el, parseValueToSegments("@Brett Odom", catalog, mentions));
    const pill = el.querySelector("[data-mention]") as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.getAttribute("contenteditable")).toBe("false");
    expect(pill.textContent).toContain("Brett Odom");
  });
});

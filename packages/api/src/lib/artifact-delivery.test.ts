import { describe, it, expect } from "vitest";
import { renderEmailDelivery } from "./artifact-delivery.js";

function artifactWith(content: string) {
  return {
    id: "art-1",
    title: "THINK-227 Smoke Report",
    type: "report",
    status: "final",
    content,
  };
}

describe("renderEmailDelivery — tw:* plate directives", () => {
  it("renders tw:stats as tiles, never as a raw code block", () => {
    const { htmlBody, textBody } = renderEmailDelivery(
      artifactWith(
        [
          "## Summary",
          "Healthy pipeline.",
          "",
          "```tw:stats",
          "items:",
          '  - { value: "$44,142", label: Total Pipeline Value }',
          '  - { value: "500", label: Active Orders }',
          "```",
          "",
          "More prose.",
        ].join("\n"),
      ),
    );
    expect(htmlBody).toContain("$44,142");
    expect(htmlBody).toContain("Total Pipeline Value");
    expect(htmlBody).not.toContain("items:");
    expect(htmlBody).not.toContain("<code");
    expect(textBody).toContain(
      "$44,142 Total Pipeline Value · 500 Active Orders",
    );
    expect(textBody).not.toContain("items:");
  });

  it("renders tw:verdict-grid as cards", () => {
    const { htmlBody } = renderEmailDelivery(
      artifactWith(
        [
          "```tw:verdict-grid",
          "cards:",
          "  - { question: Pipeline health, answer: Green, note: All deals on schedule }",
          "  - { question: Major blockers, answer: None }",
          "```",
        ].join("\n"),
      ),
    );
    expect(htmlBody).toContain("Pipeline health");
    expect(htmlBody).toContain("Green");
    expect(htmlBody).toContain("All deals on schedule");
    expect(htmlBody).not.toContain("cards:");
  });

  it("renders tw:chart as its data table with caption (email clients strip SVG)", () => {
    const { htmlBody, textBody } = renderEmailDelivery(
      artifactWith(
        [
          "```tw:chart",
          "type: funnel",
          "title: Pipeline by stage",
          "series:",
          "  - { label: Leads, value: 120 }",
          "  - { label: Qualified, value: 64 }",
          "caption: Qualification is the biggest drop-off.",
          "```",
        ].join("\n"),
      ),
    );
    expect(htmlBody).toContain("Pipeline by stage");
    expect(htmlBody).toContain("Leads");
    expect(htmlBody).toContain("120");
    expect(htmlBody).toContain("Qualification is the biggest drop-off.");
    expect(textBody).toContain("Pipeline by stage: Leads 120, Qualified 64");
  });

  it("renders tw:timeline as an ordered list", () => {
    const { htmlBody } = renderEmailDelivery(
      artifactWith(
        [
          "```tw:timeline",
          "items:",
          "  - { label: Kickoff, date: Jan 2026 }",
          "  - { label: Build, current: true }",
          "```",
        ].join("\n"),
      ),
    );
    expect(htmlBody).toContain("Kickoff");
    expect(htmlBody).toContain("Build");
    expect(htmlBody).toContain("(current)");
  });

  it("degrades unknown or malformed directives to a live-report note — raw YAML never leaks", () => {
    const { htmlBody, textBody } = renderEmailDelivery(
      artifactWith(
        [
          "```tw:mystery",
          "secret: payload",
          "```",
          "",
          "```tw:stats",
          "items: [not-a-mapping",
          "```",
        ].join("\n"),
      ),
    );
    expect(htmlBody).toContain("open the live report");
    expect(htmlBody).not.toContain("secret");
    expect(htmlBody).not.toContain("not-a-mapping");
    expect(textBody).not.toContain("secret");
  });

  it("leaves ordinary fenced code blocks untouched", () => {
    const { htmlBody } = renderEmailDelivery(
      artifactWith(["```sql", "select 1;", "```"].join("\n")),
    );
    expect(htmlBody).toContain("select 1;");
  });

  it("leaves an unclosed tw: fence to the markdown renderer instead of eating content", () => {
    const { htmlBody } = renderEmailDelivery(
      artifactWith(
        ["```tw:stats", "items:", "  - { value: 1, label: x }"].join("\n"),
      ),
    );
    // Content still present in some form — nothing silently dropped.
    expect(htmlBody).toContain("label");
  });
});

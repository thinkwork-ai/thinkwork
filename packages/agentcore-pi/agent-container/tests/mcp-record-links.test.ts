import { describe, expect, it } from "vitest";
import {
  enrichMcpRecordLinks,
  type EnrichMcpRecordLinksInput,
} from "../src/mcp-record-links.js";

const HINTS: EnrichMcpRecordLinksInput["hints"] = {
  schemaVersion: 1,
  source: "plugin-manifest",
  browserBaseUrl: "https://crm.example.com",
  routes: [
    {
      objectType: "opportunity",
      routeTemplate: "/object/opportunity/{id}",
      idFields: ["id", "opportunityId", "record.id"],
      labelFields: ["name", "opportunityName", "record.name"],
    },
  ],
};

function enrich(overrides: Partial<EnrichMcpRecordLinksInput>) {
  return enrichMcpRecordLinks({
    hints: HINTS,
    response: { content: [] },
    text: "Found records.",
    toolName: "find_many_opportunities",
    ...overrides,
  });
}

describe("enrichMcpRecordLinks", () => {
  it("adds one Opportunity link from parseable MCP text JSON", () => {
    const result = enrich({
      response: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              objectType: "opportunity",
              id: "c203680f-4d36-461b-b134-25aef43d62c5",
              name: "McPherson POC",
            }),
          },
        ],
      },
    });

    expect(result.recordLinks).toEqual([
      {
        objectType: "opportunity",
        id: "c203680f-4d36-461b-b134-25aef43d62c5",
        label: "McPherson POC",
        url: "https://crm.example.com/object/opportunity/c203680f-4d36-461b-b134-25aef43d62c5",
      },
    ]);
    expect(result.text).toContain("Record links:");
    expect(result.text).toContain(
      "https://crm.example.com/object/opportunity/c203680f-4d36-461b-b134-25aef43d62c5",
    );
  });

  it("dedupes repeated records and caps multi-record output", () => {
    const result = enrich({
      maxLinks: 2,
      response: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              opportunities: [
                { id: "opp-1", name: "One" },
                { id: "opp-1", name: "One duplicate" },
                { id: "opp-2", name: "Two" },
                { id: "opp-3", name: "Three" },
              ],
            }),
          },
        ],
      },
    });

    expect(result.recordLinks.map((link) => link.id)).toEqual([
      "opp-1",
      "opp-2",
    ]);
    expect(result.text.match(/https:\/\/crm\.example\.com/g)).toHaveLength(2);
  });

  it("uses a stable fallback label when a supported record has no name", () => {
    const result = enrich({
      response: {
        structuredContent: {
          id: "opp-1",
          objectType: "opportunity",
        },
      },
    });

    expect(result.recordLinks[0]).toMatchObject({
      id: "opp-1",
      label: "opportunity opp-1",
    });
  });

  it("does not add duplicate link blocks for records already linked in text", () => {
    const existingUrl = "https://crm.example.com/object/opportunity/opp-1";
    const result = enrich({
      text: `Already linked: ${existingUrl}`,
      response: {
        structuredContent: {
          id: "opp-1",
          objectType: "opportunity",
          name: "Already Linked",
        },
      },
    });

    expect(result.recordLinks).toEqual([]);
    expect(result.text).toBe(`Already linked: ${existingUrl}`);
  });

  it("ignores unsupported object types and unsafe ids", () => {
    const result = enrich({
      response: {
        content: [
          {
            type: "text",
            text: JSON.stringify([
              { id: "company-1", objectType: "company", name: "Acme" },
              {
                id: "opp-1?bad=true",
                objectType: "opportunity",
                name: "Bad ID",
              },
            ]),
          },
        ],
      },
    });

    expect(result.recordLinks).toEqual([]);
    expect(result.text).toBe("Found records.");
  });

  it("ignores ids that only appear in params/input-shaped response fields", () => {
    const result = enrich({
      response: {
        params: { id: "opp-from-params", objectType: "opportunity" },
        arguments: { id: "opp-from-arguments", objectType: "opportunity" },
        content: [{ type: "text", text: "No structured record here." }],
      },
    });

    expect(result.recordLinks).toEqual([]);
  });

  it.each([
    {
      name: "absolute route",
      routeTemplate: "https://crm.example.com/object/opportunity/{id}",
      browserBaseUrl: "https://crm.example.com",
    },
    {
      name: "query route",
      routeTemplate: "/object/opportunity/{id}?tab=details",
      browserBaseUrl: "https://crm.example.com",
    },
    {
      name: "embedded id segment",
      routeTemplate: "/object/opportunity/record-{id}",
      browserBaseUrl: "https://crm.example.com",
    },
    {
      name: "missing base URL",
      routeTemplate: "/object/opportunity/{id}",
      browserBaseUrl: "",
    },
  ])("returns no links for malformed hint metadata: $name", (malformed) => {
    const result = enrich({
      hints: {
        ...HINTS,
        browserBaseUrl: malformed.browserBaseUrl,
        routes: [
          {
            objectType: "opportunity",
            routeTemplate: malformed.routeTemplate,
            idFields: ["id"],
          },
        ],
      },
      response: {
        structuredContent: {
          id: "opp-1",
          objectType: "opportunity",
        },
      },
    });

    expect(result.recordLinks).toEqual([]);
    expect(result.text).toBe("Found records.");
  });
});

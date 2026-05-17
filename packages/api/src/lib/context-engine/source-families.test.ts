import { describe, expect, it } from "vitest";
import {
  sourceFamilyForHit,
  sourceFamilyForProvider,
} from "./source-families.js";
import type { ContextProviderDescriptor } from "./types.js";

function provider(
  overrides: Partial<ContextProviderDescriptor> & {
    id: string;
    family: ContextProviderDescriptor["family"];
  },
): ContextProviderDescriptor {
  return {
    displayName: overrides.id,
    defaultEnabled: true,
    query: async () => ({ hits: [] }),
    ...overrides,
  };
}

describe("Context Engine source families", () => {
  it("maps core providers to mobile source families", () => {
    expect(
      sourceFamilyForProvider(provider({ id: "memory", family: "memory" })),
    ).toBe("brain");
    expect(
      sourceFamilyForProvider(provider({ id: "brain", family: "brain" })),
    ).toBe("brain");
    expect(
      sourceFamilyForProvider(provider({ id: "wiki", family: "wiki" })),
    ).toBe("pages");
    expect(
      sourceFamilyForProvider(
        provider({ id: "bedrock-knowledge-base", family: "knowledge-base" }),
      ),
    ).toBe("knowledge-base");
  });

  it("detects web-backed MCP and sub-agent providers", () => {
    expect(
      sourceFamilyForProvider(
        provider({
          id: "approved-web-search",
          family: "mcp",
          displayName: "Approved Web Search",
        }),
      ),
    ).toBe("web");

    expect(
      sourceFamilyForProvider(
        provider({
          id: "external-source-agent",
          family: "sub-agent",
          displayName: "External Source Agent",
          subAgent: {
            promptRef: "brain/provider/web-search",
            toolAllowlist: ["web.search"],
            depthCap: 2,
            processModel: "lambda-bedrock-converse",
            seamState: "live",
          },
        }),
      ),
    ).toBe("web");
  });

  it("allows explicit provider overrides", () => {
    expect(
      sourceFamilyForProvider(
        provider({
          id: "wiki-source-agent",
          family: "sub-agent",
          sourceFamily: "pages",
        }),
      ),
    ).toBe("pages");
  });

  it("maps the tenant built-in Web Search provider explicitly", () => {
    expect(
      sourceFamilyForProvider(
        provider({
          id: "builtin:web-search",
          family: "mcp",
          sourceFamily: "web",
          displayName: "Web Search",
          defaultEnabled: false,
        }),
      ),
    ).toBe("web");
  });

  it("derives hit source family from hit family before provider family", () => {
    expect(
      sourceFamilyForHit(
        {
          id: "bridge",
          providerId: "memory",
          family: "wiki",
          title: "Page bridge",
          snippet: "snippet",
          scope: "auto",
          provenance: {},
        },
        provider({ id: "memory", family: "memory" }),
      ),
    ).toBe("pages");
  });
});

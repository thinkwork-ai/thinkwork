import { describe, expect, it } from "vitest";

import { resolveWebSearchConfigFromSkills } from "../web-search-config.js";

describe("resolveWebSearchConfigFromSkills", () => {
  it("returns Exa config when the web-search skill has an Exa key", () => {
    expect(
      resolveWebSearchConfigFromSkills([
        {
          skillId: "web-search",
          envOverrides: {
            WEB_SEARCH_PROVIDER: "exa",
            EXA_API_KEY: "exa-key",
          },
        },
      ]),
    ).toEqual({ provider: "exa", apiKey: "exa-key" });
  });

  it("returns SerpAPI config when the provider and key are configured", () => {
    expect(
      resolveWebSearchConfigFromSkills([
        {
          skillId: "web-search",
          envOverrides: {
            WEB_SEARCH_PROVIDER: "serpapi",
            SERPAPI_KEY: "serp-key",
          },
        },
      ]),
    ).toEqual({ provider: "serpapi", apiKey: "serp-key" });
  });

  it("does not register web search when the key is absent", () => {
    expect(
      resolveWebSearchConfigFromSkills([
        {
          skillId: "web-search",
          envOverrides: { WEB_SEARCH_PROVIDER: "exa" },
        },
      ]),
    ).toBeUndefined();
  });
});

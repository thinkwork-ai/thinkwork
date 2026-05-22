import { describe, expect, it } from "vitest";
import { mergePolicyFile, parsePolicyFile } from "./tool-policy-merger.js";

describe("tool-policy-merger", () => {
  it("parses inline and block frontmatter lists", () => {
    expect(
      parsePolicyFile(
        "---\nadds: [warehouse, browser]\nrestricts:\n  - send_email\n---\n# Body\n",
      ),
    ).toEqual({
      body: "# Body",
      adds: ["browser", "warehouse"],
      restricts: ["send_email"],
    });
  });

  it("merges baseline and Space policy prose with sorted tool directives", () => {
    const merged = mergePolicyFile({
      baseline: "---\nadds: [browser]\n---\n# Baseline\n",
      space: "---\nadds: [warehouse]\nrestricts: [send_email]\n---\n# Space\n",
      spaceSlug: "finance",
    });

    expect(merged).toContain("# Baseline");
    expect(merged).toContain("<!-- from: space:finance -->");
    expect(merged).toContain("- browser");
    expect(merged).toContain("- warehouse");
    expect(merged).toContain("- send_email");
  });
});

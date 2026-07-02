import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CUSTOMIZE_TABS } from "./customize";

const skillsRoute = readFileSync(
  resolve(process.cwd(), "src/routes/_authed/_shell/customize.skills.tsx"),
  "utf8",
);
const indexRoute = readFileSync(
  resolve(process.cwd(), "src/routes/_authed/_shell/customize.index.tsx"),
  "utf8",
);

// Composer plan U3 (R10): the Customize→Skills tab moved to
// Settings→Composer. Stale /customize/skills links must land on the
// Customize index instead of a 404, and the index must no longer point
// back at the removed skills tab (redirect loop).
describe("customize skills removal (Composer U3)", () => {
  it("keeps /customize/skills as a redirect to the customize index", () => {
    expect(skillsRoute).toContain("redirect({");
    expect(skillsRoute).toContain('to: "/customize"');
    expect(skillsRoute).not.toContain("useSkillItems");
    expect(skillsRoute).not.toContain("useSkillMutation");
    expect(skillsRoute).not.toContain("CustomizeTabBody");
  });

  it("points the customize index at workflows, not the removed skills tab", () => {
    expect(indexRoute).toContain('to: "/customize/workflows"');
    expect(indexRoute).not.toContain('to: "/customize/skills"');
  });

  it("offers no Skills tab", () => {
    // Widened to string[] — the `as const` tuple's literal types would
    // otherwise make the negative comparisons a TS2367 error.
    const tabTargets: string[] = CUSTOMIZE_TABS.map((t) => t.to);
    const tabLabels: string[] = CUSTOMIZE_TABS.map((t) => t.label);
    expect(tabTargets).not.toContain("/customize/skills");
    expect(tabLabels).not.toContain("Skills");
    expect(tabTargets).toContain("/customize/workflows");
  });
});

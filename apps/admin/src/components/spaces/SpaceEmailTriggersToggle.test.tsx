import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./SpaceEmailTriggersToggle.tsx", import.meta.url),
  "utf8",
);

describe("SpaceEmailTriggersToggle", () => {
  it("derives and displays the per-Space email address", () => {
    expect(source).toContain("deriveSpaceEmailAddress(tenantSlug, space.slug)");
    expect(source).toContain(
      "`${tenantSlug}.${spaceSlug}@agents.thinkwork.ai`",
    );
    expect(source).toContain("Cold-contact delivery to");
    expect(source).toContain("Copy Space email address");
  });

  it("optimistically toggles email triggers through GraphQL and reverts on failure", () => {
    expect(source).toContain("SetSpaceEmailTriggersMutation");
    expect(source).toContain("setEnabled(nextEnabled)");
    expect(source).toContain("setEnabled(previous)");
    expect(source).toContain("toast.error");
    expect(source).toContain("onSaved?.()");
  });

  it("communicates public/private and archived Space gate behavior", () => {
    expect(source).toContain("Only members of this Space");
    expect(source).toContain("Any registered user in this tenant");
    expect(source).toContain("Archived Spaces cannot receive");
    expect(source).toContain("disabled={archived || mutationResult.fetching}");
  });
});

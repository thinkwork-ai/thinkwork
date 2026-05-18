import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Knowledge User tab", () => {
  it("mounts the shared workspace editor against the selected user context", () => {
    const source = readFileSync(new URL("./user.tsx", import.meta.url), "utf8");

    expect(source).toContain(
      'createFileRoute("/_authed/_tenant/knowledge/user")',
    );
    expect(source).toContain("WorkspaceEditor");
    expect(source).toContain("target={{ userId: selectedUserId }}");
    expect(source).toContain('mode="context"');
  });
});

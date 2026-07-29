import { describe, expect, it } from "vitest";
import { createCoreContextProviders } from "../providers/index.js";

/**
 * Regression guard for the wiki-backend removal arc (plan 2026-07-24-002 U4).
 *
 * The two wiki context providers sat in the DEFAULT core set, so compiled wiki
 * content reached every tenant's context packs without any tool call and
 * without an opt-in row in `tenant_context_provider_settings`. That is what
 * made their removal a capability decision rather than a dead-code delete.
 *
 * These assertions fail loudly if a wiki provider is ever re-added to the core
 * set, which would silently restore that reach.
 */
describe("core context providers — wiki removal (U4)", () => {
  it("contains no wiki provider", () => {
    const ids = createCoreContextProviders().map((provider) => provider.id);

    expect(ids).not.toContain("wiki");
    expect(ids).not.toContain("wiki-source-agent");
    expect(ids.filter((id) => id.includes("wiki"))).toEqual([]);
  });

  it("exposes no provider in the wiki family", () => {
    // Both removed providers declared `family: "wiki"`. Their `sourceFamily`
    // was "pages", which is generic — assert on the provider family, which
    // was wiki-exclusive.
    const providers = createCoreContextProviders();

    expect(providers.filter((provider) => provider.family === "wiki")).toEqual(
      [],
    );
  });

  it("still ships the surviving core providers", () => {
    // Guards against the removal over-reaching: U4 takes the two wiki
    // providers and nothing else out of the default set.
    const ids = createCoreContextProviders().map((provider) => provider.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        "memory",
        "workspace-files",
        "erp-customer",
        "crm-opportunity",
        "support-case",
        "catalog",
      ]),
    );
  });
});

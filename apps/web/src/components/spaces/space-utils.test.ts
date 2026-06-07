import { describe, expect, it } from "vitest";

import { isDefaultSpace, spaceCrumbLabel } from "./space-utils";

describe("isDefaultSpace", () => {
  it("treats default/general slug, name, or templateKey as default (case-insensitive)", () => {
    expect(isDefaultSpace({ slug: "default" })).toBe(true);
    expect(isDefaultSpace({ slug: "general" })).toBe(true);
    expect(isDefaultSpace({ name: "Default" })).toBe(true);
    expect(isDefaultSpace({ name: "GENERAL" })).toBe(true);
    expect(isDefaultSpace({ templateKey: "default" })).toBe(true);
    expect(isDefaultSpace({ templateKey: "General" })).toBe(true);
  });

  it("treats named spaces as non-default", () => {
    expect(isDefaultSpace({ name: "Customer", slug: "customer" })).toBe(false);
    expect(isDefaultSpace({})).toBe(false);
    expect(isDefaultSpace({ name: null, slug: null, templateKey: null })).toBe(
      false,
    );
  });
});

describe("spaceCrumbLabel", () => {
  it('returns "Chats" for missing or default spaces', () => {
    expect(spaceCrumbLabel(null)).toBe("Chats");
    expect(spaceCrumbLabel(undefined)).toBe("Chats");
    expect(spaceCrumbLabel({ slug: "general" })).toBe("Chats");
    expect(spaceCrumbLabel({ name: "Default" })).toBe("Chats");
  });

  it("returns the human name for named spaces, falling back to slug", () => {
    expect(spaceCrumbLabel({ name: "Customer" })).toBe("Customer");
    expect(spaceCrumbLabel({ slug: "acme", name: null })).toBe("acme");
    expect(spaceCrumbLabel({})).toBe("Space");
  });
});

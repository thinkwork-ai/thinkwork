import { describe, expect, it } from "vitest";

import { toGraphQLPage } from "./mappers.js";

const ROW = {
  id: "page-1",
  tenant_id: "tenant-1",
  owner_id: null,
  type: "entity",
  entity_subtype: "customer",
  slug: "acme-corp",
  title: "Acme Corp",
  summary: "A customer",
  body_md: "## Overview\n\nAcme ships anvils.",
  status: "active",
  last_compiled_at: new Date("2026-07-13T07:00:00Z"),
  created_at: new Date("2026-07-01T00:00:00Z"),
  updated_at: new Date("2026-07-13T07:00:00Z"),
};

describe("toGraphQLPage renderHtml exposure (THINK-273)", () => {
  it("maps a stored render passed via extras (detail query shape)", () => {
    const page = toGraphQLPage(ROW, {
      sections: [],
      aliases: [],
      renderHtml: "<html><body>render</body></html>",
    });
    expect(page.renderHtml).toBe("<html><body>render</body></html>");
  });

  it("maps a NULL stored render to null on the detail query", () => {
    const page = toGraphQLPage(ROW, {
      sections: [],
      aliases: [],
      renderHtml: null,
    });
    expect(page.renderHtml).toBeNull();
  });

  it("omits renderHtml entirely for list-surface calls that never pass it", () => {
    const page = toGraphQLPage(ROW, { sections: [], aliases: [] });
    expect("renderHtml" in page).toBe(false);
  });
});

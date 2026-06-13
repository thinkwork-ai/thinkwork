import { describe, expect, it } from "vitest";
import {
  classifyMcpToolAccess,
  READ_TOOL_PREFIXES,
  WRITE_TOOL_PREFIXES,
} from "./mcp-tool-access.js";

describe("classifyMcpToolAccess", () => {
  it("classifies the CRM contract examples", () => {
    expect(classifyMcpToolAccess("opportunities_list")).toBe("read");
    expect(classifyMcpToolAccess("create_opportunity")).toBe("write");
    expect(classifyMcpToolAccess("totally_unknown_verb")).toBe("write");
  });

  it("classifies every leading read verb as read", () => {
    for (const verb of READ_TOOL_PREFIXES) {
      expect(classifyMcpToolAccess(`${verb}_widgets`)).toBe("read");
      expect(classifyMcpToolAccess(verb)).toBe("read");
      expect(classifyMcpToolAccess(`${verb}-widgets`)).toBe("read");
    }
  });

  it("classifies every leading write verb as write", () => {
    for (const verb of WRITE_TOOL_PREFIXES) {
      expect(classifyMcpToolAccess(`${verb}_widget`)).toBe("write");
      expect(classifyMcpToolAccess(verb)).toBe("write");
    }
  });

  it("is case-insensitive", () => {
    expect(classifyMcpToolAccess("LIST_Opportunities")).toBe("read");
    expect(classifyMcpToolAccess("Create_Opportunity")).toBe("write");
    expect(classifyMcpToolAccess("Opportunities_List")).toBe("read");
  });

  it("matches the local name after a server namespace", () => {
    expect(classifyMcpToolAccess("lastmile--crm.list_opportunities")).toBe(
      "read",
    );
    expect(classifyMcpToolAccess("crm__get_contact")).toBe("read");
    expect(classifyMcpToolAccess("crm/create_opportunity")).toBe("write");
    expect(classifyMcpToolAccess("svc__opportunities_list")).toBe("read");
  });

  it("honors the <noun>_<verb> trailing-verb shape", () => {
    expect(classifyMcpToolAccess("contacts_get")).toBe("read");
    expect(classifyMcpToolAccess("contact_create")).toBe("write");
    expect(classifyMcpToolAccess("opportunity_delete")).toBe("write");
  });

  it("lets a write verb in a non-leading segment win over a trailing read verb", () => {
    // No recognized LEADING verb here, so the segment scan runs: a write
    // segment (`delete`) wins over the trailing read segment (`list`).
    expect(classifyMcpToolAccess("contacts_delete_list")).toBe("write");
  });

  it("defaults ambiguous / verbless names to write", () => {
    expect(classifyMcpToolAccess("opportunities")).toBe("write");
    expect(classifyMcpToolAccess("crm")).toBe("write");
    expect(classifyMcpToolAccess("")).toBe("write");
    expect(classifyMcpToolAccess("   ")).toBe("write");
    expect(classifyMcpToolAccess("foobar")).toBe("write");
  });

  it("does not match a verb embedded mid-word", () => {
    // `listings` should not match the `list` prefix (no separator after).
    expect(classifyMcpToolAccess("listings")).toBe("write");
    // `settings` should not match the `set` write prefix → no verb → write.
    expect(classifyMcpToolAccess("settings")).toBe("write");
  });

  it("recognizes read-shaped exact introspection names (U15 Finding 3)", () => {
    expect(classifyMcpToolAccess("me")).toBe("read");
    expect(classifyMcpToolAccess("whoami")).toBe("read");
    expect(classifyMcpToolAccess("ping")).toBe("read");
    expect(classifyMcpToolAccess("health")).toBe("read");
    expect(classifyMcpToolAccess("status")).toBe("read");
    expect(classifyMcpToolAccess("info")).toBe("read");
    expect(classifyMcpToolAccess("schema")).toBe("read");
    expect(classifyMcpToolAccess("capabilities")).toBe("read");
    expect(classifyMcpToolAccess("version")).toBe("read");
    // Case-insensitive + namespaced.
    expect(classifyMcpToolAccess("ME")).toBe("read");
    expect(classifyMcpToolAccess("crm__me")).toBe("read");
  });

  it("recognizes read-shaped suffix patterns (U15 Finding 3)", () => {
    expect(classifyMcpToolAccess("crm_schema")).toBe("read");
    expect(classifyMcpToolAccess("data_catalog_schema")).toBe("read");
    expect(classifyMcpToolAccess("data_catalog")).toBe("read");
    expect(classifyMcpToolAccess("crm-schema")).toBe("read");
    expect(classifyMcpToolAccess("account_info")).toBe("read");
    expect(classifyMcpToolAccess("job_status")).toBe("read");
    // Namespaced read suffix still classifies on the local name.
    expect(classifyMcpToolAccess("lastmile--crm.crm_schema")).toBe("read");
  });

  it("keeps write/mutating names as write despite a read suffix (U15 Finding 3)", () => {
    // A write verb (leading or in any segment) must win over a read suffix.
    expect(classifyMcpToolAccess("schema_update")).toBe("write");
    expect(classifyMcpToolAccess("update_schema")).toBe("write");
    expect(classifyMcpToolAccess("delete_catalog")).toBe("write");
    expect(classifyMcpToolAccess("sync")).toBe("write");
    expect(classifyMcpToolAccess("create_x")).toBe("write");
    // `catalog_create` must stay write — only the `_catalog` SUFFIX reads, not
    // a leading `catalog`.
    expect(classifyMcpToolAccess("catalog_create")).toBe("write");
  });
});

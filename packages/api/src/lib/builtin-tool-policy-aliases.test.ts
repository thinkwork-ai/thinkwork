import { describe, expect, it } from "vitest";
import { toolPolicyAliases } from "./builtin-tool-policy-aliases.js";

describe("toolPolicyAliases", () => {
  it("maps runtime and Admin names for built-in tools", () => {
    expect(toolPolicyAliases("web_extract")).toEqual([
      "web_extract",
      "web-extract",
    ]);
    expect(toolPolicyAliases("agent-email-send")).toEqual([
      "agent-email-send",
      "send_email",
    ]);
  });

  it("treats Context Engine query tool slugs as one policy group", () => {
    expect(toolPolicyAliases("context_engine")).toEqual([
      "context_engine",
      "query_context",
      "query_erp_customer_context",
      "query_crm_opportunity_context",
      "query_support_case_context",
      "query_catalog_context",
    ]);
  });
});

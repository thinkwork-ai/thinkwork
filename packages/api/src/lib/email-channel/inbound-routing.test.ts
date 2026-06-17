import { describe, expect, it } from "vitest";
import { parseInboundRecipient } from "./inbound-routing.js";

describe("parseInboundRecipient", () => {
  it("recognizes tenant Space addresses under the ThinkWork email domain", () => {
    expect(
      parseInboundRecipient("Finance <finance@acme.thinkwork.ai>"),
    ).toEqual({
      localPart: "finance",
      domain: "acme.thinkwork.ai",
      parentDomain: "thinkwork.ai",
      tenantSlug: "acme",
    });
  });

  it("keeps non-tenant domains as exact-domain routes", () => {
    expect(parseInboundRecipient("hello@example.com")).toEqual({
      localPart: "hello",
      domain: "example.com",
      parentDomain: null,
      tenantSlug: null,
    });
  });
});

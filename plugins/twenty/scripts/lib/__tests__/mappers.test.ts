import { describe, expect, it } from "vitest";

import type {
  LastmileContact,
  LastmileCustomerNote,
  LastmileLead,
  LastmileOpportunity,
} from "../lastmile-reader";
import {
  buildOwnerIndex,
  contentHash,
  mapAccount,
  mapContact,
  mapCrmComment,
  mapCustomerNote,
  mapLead,
  mapLeadStatusToStage,
  mapOpportunity,
  mapOpportunityStage,
  normalizeEmail,
  normalizePhone,
  resolveOwner,
  sourceId,
  stableStringify,
  toAmountMicros,
  toQuantity,
} from "../mappers";

const ownerMap = new Map([["rep_jane", "member-jane-uuid"]]);
const companyMap = new Map([[sourceId("account", "acct_1"), "company-uuid-1"]]);

function lead(overrides: Partial<LastmileLead> = {}): LastmileLead {
  return {
    id: "lead_1",
    status: "00-New",
    companyName: "Acme Fuel",
    firstName: "Ann",
    lastName: "Lee",
    email: null,
    phone: null,
    source: null,
    description: null,
    ownerRepId: null,
    dateCreated: null,
    ...overrides,
  };
}

function opportunity(
  overrides: Partial<LastmileOpportunity> = {},
): LastmileOpportunity {
  return {
    id: "opp_1",
    name: "Bulk diesel contract",
    stage: "10-Prospect",
    amount: "1234.56",
    quantity: "100",
    productType: "Diesel",
    brand: "Mobil",
    closed: null,
    won: null,
    accountId: "acct_1",
    ownerRepId: "rep_jane",
    expectedCloseDate: "2026-08-01",
    description: null,
    dateCreated: null,
    ...overrides,
  };
}

describe("toAmountMicros", () => {
  it("converts $1,234.56 to 1234560000 micros", () => {
    expect(toAmountMicros("$1,234.56")).toBe(1_234_560_000);
    expect(toAmountMicros("1234.56")).toBe(1_234_560_000);
  });

  it("returns null for missing or garbage amounts", () => {
    expect(toAmountMicros(null)).toBeNull();
    expect(toAmountMicros("")).toBeNull();
    expect(toAmountMicros("n/a")).toBeNull();
  });
});

describe("toQuantity", () => {
  it("parses numeric text and rejects garbage", () => {
    expect(toQuantity("1,500")).toBe(1500);
    expect(toQuantity("about 12")).toBeNull();
    expect(toQuantity(null)).toBeNull();
  });
});

describe("normalizePhone", () => {
  it("normalizes US national formats to number + calling/country code", () => {
    expect(normalizePhone("512-825-8875")).toEqual({
      primaryPhoneNumber: "5128258875",
      primaryPhoneCallingCode: "+1",
      primaryPhoneCountryCode: "US",
    });
    expect(normalizePhone("(361) 664-9106")?.primaryPhoneNumber).toBe(
      "3616649106",
    );
    expect(normalizePhone("1-512-825-8875")?.primaryPhoneNumber).toBe(
      "5128258875",
    );
  });

  it("drops unparseable or non-US-shaped numbers", () => {
    expect(normalizePhone("call the office")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("011-44-20-7946-0958")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("lowercases and validates", () => {
    expect(normalizeEmail(" Jane@TEI.com ")).toBe("jane@tei.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
  });
});

describe("stage mapping", () => {
  it("maps messy lead statuses into the lead band", () => {
    expect(mapLeadStatusToStage("00-New").stage).toBe("LEAD");
    expect(mapLeadStatusToStage("new").stage).toBe("LEAD");
    expect(mapLeadStatusToStage(null).stage).toBe("LEAD");
    expect(mapLeadStatusToStage("20-Working").stage).toBe("LEAD_WORKING");
    expect(mapLeadStatusToStage("30-Nurturing").stage).toBe("LEAD_WORKING");
    expect(mapLeadStatusToStage("50-Qualified").stage).toBe("LEAD_QUALIFIED");
    expect(mapLeadStatusToStage("90-Unqualified").stage).toBe(
      "LEAD_UNQUALIFIED",
    );
    expect(mapLeadStatusToStage("Converted").stage).toBe("LEAD_QUALIFIED");
  });

  it("flags unknown lead statuses", () => {
    expect(mapLeadStatusToStage("13-Mystery")).toEqual({
      stage: "LEAD",
      unknown: true,
    });
  });

  it("maps opportunity stages including both Negotiate spellings", () => {
    expect(
      mapOpportunityStage({ stage: "60-Won", closed: null, won: null }).stage,
    ).toBe("WON");
    expect(
      mapOpportunityStage({ stage: "90-Lost", closed: null, won: null }).stage,
    ).toBe("LOST");
    expect(
      mapOpportunityStage({
        stage: "40-Negotiate to Close",
        closed: null,
        won: null,
      }).stage,
    ).toBe("NEGOTIATE");
    expect(
      mapOpportunityStage({
        stage: "40-Negotiation to Close",
        closed: null,
        won: null,
      }).stage,
    ).toBe("NEGOTIATE");
  });

  it("falls back to closed/won flags for blank stages", () => {
    expect(
      mapOpportunityStage({ stage: null, closed: "true", won: "true" }).stage,
    ).toBe("WON");
    expect(
      mapOpportunityStage({ stage: null, closed: "true", won: "false" }).stage,
    ).toBe("LOST");
    expect(
      mapOpportunityStage({ stage: null, closed: null, won: null }).stage,
    ).toBe("NEW");
  });
});

describe("mapAccount", () => {
  it("maps to a company with owner and namespaced sourceId", () => {
    const mapped = mapAccount(
      { id: "acct_1", name: "Acme", ownerRepId: "rep_jane" },
      ownerMap,
    );
    expect(mapped.input).toMatchObject({
      name: "Acme",
      accountOwnerId: "member-jane-uuid",
      sourceId: "account:acct_1",
    });
    expect(mapped.warnings).toEqual([]);
  });

  it("warns when the owner is unprovisioned", () => {
    const mapped = mapAccount(
      { id: "acct_2", name: "Beta", ownerRepId: "rep_gone" },
      ownerMap,
    );
    expect(mapped.input).not.toHaveProperty("accountOwnerId");
    expect(mapped.warnings[0]).toMatch(/rep_gone/);
  });
});

describe("mapContact", () => {
  function contact(overrides: Partial<LastmileContact> = {}): LastmileContact {
    return {
      id: "ct_1",
      accountId: "acct_1",
      firstName: "Ann",
      lastName: "Lee",
      email: "Ann@Acme.com",
      phone: "210-555-0101",
      phoneCellular: null,
      title: "Buyer",
      ...overrides,
    };
  }

  it("maps FullName split and company link", () => {
    const mapped = mapContact(contact(), companyMap);
    expect(mapped.input).toMatchObject({
      name: { firstName: "Ann", lastName: "Lee" },
      emails: { primaryEmail: "ann@acme.com" },
      phones: {
        primaryPhoneNumber: "2105550101",
        primaryPhoneCallingCode: "+1",
        primaryPhoneCountryCode: "US",
      },
      jobTitle: "Buyer",
      companyId: "company-uuid-1",
      sourceId: "contact:ct_1",
    });
  });

  it("keeps a contact without an account as a person with no company", () => {
    const mapped = mapContact(contact({ accountId: null }), companyMap);
    expect(mapped.input).not.toHaveProperty("companyId");
    expect(mapped.warnings).toEqual([]);
  });

  it("drops invalid emails with a warning", () => {
    const mapped = mapContact(contact({ email: "garbage" }), companyMap);
    expect(mapped.input).not.toHaveProperty("emails");
    expect(mapped.warnings[0]).toMatch(/invalid email/);
  });
});

describe("mapOpportunity", () => {
  it("maps stage, micros, custom fields, links, and owner (AE1 shape)", () => {
    const mapped = mapOpportunity(opportunity(), ownerMap, companyMap);
    expect(mapped.input).toMatchObject({
      name: "Bulk diesel contract",
      stage: "PROSPECT",
      amount: { amountMicros: 1_234_560_000, currencyCode: "USD" },
      ownerId: "member-jane-uuid",
      companyId: "company-uuid-1",
      product: "Diesel",
      quantity: 100,
      isMobil: true,
      sourceId: "opportunity:opp_1",
    });
  });

  it("is not Mobil when neither product nor brand mentions Mobil", () => {
    const mapped = mapOpportunity(
      opportunity({ brand: "Shell", productType: "Unleaded" }),
      ownerMap,
      companyMap,
    );
    expect(mapped.input.isMobil).toBe(false);
  });

  it("flags an unresolvable company and unprovisioned owner", () => {
    const mapped = mapOpportunity(
      opportunity({ accountId: "acct_missing", ownerRepId: "rep_gone" }),
      ownerMap,
      companyMap,
    );
    expect(mapped.input).not.toHaveProperty("companyId");
    expect(mapped.input).not.toHaveProperty("ownerId");
    expect(mapped.warnings).toHaveLength(2);
  });
});

describe("mapLead", () => {
  it("maps a lead row to the early Lead stage in the opportunity pipeline (AE3)", () => {
    const mapped = mapLead(lead(), ownerMap);
    expect(mapped.input).toMatchObject({
      name: "Acme Fuel",
      stage: "LEAD",
      sourceId: "lead:lead_1",
    });
  });

  it("names person-only leads by their person name", () => {
    const mapped = mapLead(lead({ companyName: null }), ownerMap);
    expect(mapped.input.name).toBe("Ann Lee");
  });
});

describe("notes mapping", () => {
  it("maps a CRM comment onto its lead/opportunity target", () => {
    const mapped = mapCrmComment({
      id: "tc_1",
      entityType: "opportunity",
      entityId: "opp_1",
      content: "Called the buyer.\nFollow up Friday.",
      isDeleted: false,
      createdAt: null,
    });
    expect(mapped).toMatchObject({
      sourceId: "task_comment:tc_1",
      title: "Called the buyer.",
      targetSourceId: "opportunity:opp_1",
      targetKind: "opportunity",
    });
  });

  it("maps a customer note only when the customer uniquely matches an account", () => {
    const base: LastmileCustomerNote = {
      id: "n_1",
      noteText: "Tank inspection notes",
      customerId: "cust_1",
      customerName: "Acme",
      matchedAccountId: "acct_1",
      dateCreated: null,
    };
    expect(mapCustomerNote(base)?.targetSourceId).toBe("account:acct_1");
    expect(mapCustomerNote({ ...base, matchedAccountId: null })).toBeNull();
  });
});

describe("contentHash", () => {
  it("is stable across key order and ignores sourceHash itself", () => {
    const a = contentHash({ name: "X", stage: "LEAD" });
    const b = contentHash({ stage: "LEAD", name: "X" });
    const c = contentHash({ stage: "LEAD", name: "X", sourceHash: "whatever" });
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it("changes when content changes (AE1: source edit → update)", () => {
    expect(contentHash({ amount: 1 })).not.toBe(contentHash({ amount: 2 }));
  });

  it("stableStringify sorts keys deterministically", () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(
      '{"a":[{"c":3,"d":2}],"b":1}',
    );
  });
});

describe("buildOwnerIndex / resolveOwner", () => {
  const reps = [
    { id: "rep_1", alias: "jbake", firstName: "Jane", lastName: "Baker" },
    { id: "rep_2", alias: null, firstName: "Daniel", lastName: "Emblen" },
    { id: "rep_3", alias: null, firstName: "Jose", lastName: "Vazquez" },
    { id: "rep_4", alias: null, firstName: "Jose", lastName: "Vazquez" },
  ];
  const memberIds = new Map([
    ["rep_1", "wm-1"],
    ["rep_2", "wm-2"],
    ["rep_3", "wm-3"],
    ["rep_4", "wm-4"],
  ]);
  const index = buildOwnerIndex(reps, memberIds);

  it("resolves rep ids, aliases, full names, and derived aliases", () => {
    expect(resolveOwner("rep_1", index)).toBe("wm-1");
    expect(resolveOwner("jbake", index)).toBe("wm-1");
    expect(resolveOwner("Jane Baker", index)).toBe("wm-1");
    expect(resolveOwner("dembl", index)).toBe("wm-2"); // derived: D + embl
  });

  it("refuses ambiguous names shared by two reps", () => {
    expect(resolveOwner("Jose Vazquez", index)).toBeNull();
    expect(resolveOwner("rep_3", index)).toBe("wm-3"); // ids stay exact
  });

  it("unknown refs resolve to null", () => {
    expect(resolveOwner("Data Migration", index)).toBeNull();
    expect(resolveOwner(null, index)).toBeNull();
  });
});

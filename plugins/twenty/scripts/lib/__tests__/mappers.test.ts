import { describe, expect, it } from "vitest";

import type {
  LastmileContact,
  LastmileCrmTask,
  LastmileCustomerNote,
} from "../lastmile-reader";
import {
  buildOwnerIndex,
  contentHash,
  dedupeContactEmails,
  deriveRepEmail,
  isMobilBrand,
  mapAccount,
  mapContact,
  mapCrmComment,
  mapCrmTask,
  mapOrganization,
  mapProduct,
  normalizeProductName,
  PRODUCT_CATALOG,
  productSourceId,
  mapTaskProducts,
  mapTaskStatusToStage,
  mapCustomerNote,
  mapOpportunityProduct,
  normalizeEmail,
  normalizePhone,
  resolveOwner,
  sourceId,
  stableStringify,
  toAmountMicros,
  toIsoTimestamp,
  toQuantity,
} from "../mappers";

const ownerMap = new Map([["rep_jane", "member-jane-uuid"]]);
const companyMap = new Map([[sourceId("account", "acct_1"), "company-uuid-1"]]);

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

describe("notes mapping", () => {
  it("maps a CRM comment onto its lead/opportunity target", () => {
    const mapped = mapCrmComment({
      id: "tc_1",
      entityType: "opportunity",
      entityId: "opp_1",
      content: "Called the buyer.\nFollow up Friday.",
      isDeleted: false,
      createdAt: null,
      authorName: null,
    });
    expect(mapped).toMatchObject({
      sourceId: "task_comment:tc_1",
      title: "Called the buyer.",
      targetSourceId: "opportunity:opp_1",
      targetKind: "opportunity",
    });
  });

  it("carries the LastMile authored-at time and author onto the note", () => {
    const mapped = mapCrmComment({
      id: "tc_2",
      entityType: "opportunity",
      entityId: "opp_1",
      content: "Sold them some products on cash account.",
      isDeleted: false,
      createdAt: new Date("2026-07-10T02:27:10.507Z"),
      authorName: "Reyes Valdez",
    });
    // Twenty's activity feed sorts on createdAt; without this the whole history
    // collapses onto the day the import ran.
    expect(mapped.createdAt).toBe("2026-07-10T02:27:10.507Z");
    expect(mapped.authorName).toBe("Reyes Valdez");
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

describe("toIsoTimestamp", () => {
  it("converts a Date to ISO-8601 and passes through parseable strings", () => {
    expect(toIsoTimestamp(new Date("2025-07-21T12:00:00Z"))).toBe(
      "2025-07-21T12:00:00.000Z",
    );
    expect(toIsoTimestamp("2026-07-10T02:27:10.507Z")).toBe(
      "2026-07-10T02:27:10.507Z",
    );
  });

  it("returns null for missing or unparseable values", () => {
    expect(toIsoTimestamp(null)).toBeNull();
    expect(toIsoTimestamp("not a date")).toBeNull();
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

describe("deriveRepEmail", () => {
  const domain = "texasenterprises.com";

  it("derives first-initial + lastname for real people", () => {
    expect(deriveRepEmail("Daniel", "Emblen", domain)).toBe(
      "demblen@texasenterprises.com",
    );
    expect(deriveRepEmail("Sal", "Carrizales", domain)).toBe(
      "scarrizales@texasenterprises.com",
    );
    expect(deriveRepEmail("Aaron", "Anderson", domain)).toBe(
      "aanderson@texasenterprises.com",
    );
  });

  it("strips hyphens and apostrophes from the last name", () => {
    expect(deriveRepEmail("Mary", "O'Brien", domain)).toBe(
      "mobrien@texasenterprises.com",
    );
    expect(deriveRepEmail("Jean", "Smith-Jones", domain)).toBe(
      "jsmithjones@texasenterprises.com",
    );
  });

  it("refuses house, intercompany, and placeholder rows", () => {
    expect(deriveRepEmail("House", "Mighty", domain)).toBeNull();
    expect(deriveRepEmail("House", "Golden West Laredo", domain)).toBeNull();
    expect(deriveRepEmail("Hotsy Austin", "House", domain)).toBeNull();
    expect(deriveRepEmail("Intercompany", "GWPP", domain)).toBeNull();
    expect(deriveRepEmail("TBD", "TBD", domain)).toBeNull();
    expect(deriveRepEmail("undefined", "undefined", domain)).toBeNull();
    expect(deriveRepEmail("UNKNOWN", "SALES REP", domain)).toBeNull();
    expect(deriveRepEmail("Buyback", "Unassigned", domain)).toBeNull();
    expect(deriveRepEmail("Oil", "Hauling", domain)).toBeNull();
  });

  it("refuses names with digits or underscores", () => {
    expect(deriveRepEmail("Chelsea", "Ervi_2", domain)).toBeNull();
    expect(deriveRepEmail("Bob", "Loa2", domain)).toBeNull();
    expect(deriveRepEmail(null, "Smith", domain)).toBeNull();
  });
});

describe("mapOpportunityProduct (multiple products per opportunity)", () => {
  const item = (overrides = {}) => ({
    opportunityId: "opp_1",
    index: 0,
    brand: "MOBIL",
    quantity: "6500",
    amount: "50000",
    ...overrides,
  });

  it("maps a line to product, quantity, currency micros, and its opportunity", () => {
    const mapped = mapOpportunityProduct(item());
    expect(mapped.sourceId).toBe("opportunity_item:opp_1#0");
    expect(mapped.opportunitySourceId).toBe("opportunity:opp_1");
    expect(mapped.input).toMatchObject({
      name: "Mobil",
      quantity: 6500,
      amount: { amountMicros: 50_000_000_000, currencyCode: "USD" },
      isMobil: true,
      lineNumber: 1,
    });
    expect(mapped.productSourceId).toBe("product:mobil");
  });

  it("gives each line on one opportunity a distinct, stable sourceId", () => {
    const lines = [
      mapOpportunityProduct(item({ index: 0, brand: "DEF" })),
      mapOpportunityProduct(item({ index: 1, brand: "GOLDEN WEST" })),
      mapOpportunityProduct(item({ index: 2, brand: "MOBIL" })),
    ];
    expect(lines.map((l) => l.sourceId)).toEqual([
      "opportunity_item:opp_1#0",
      "opportunity_item:opp_1#1",
      "opportunity_item:opp_1#2",
    ]);
    expect(new Set(lines.map((l) => l.opportunitySourceId)).size).toBe(1);
    expect(lines.map((l) => l.input.isMobil)).toEqual([false, false, true]);
    expect(lines.map((l) => l.productSourceId)).toEqual([
      "product:def",
      "product:golden_west",
      "product:mobil",
    ]);
    expect(lines.map((l) => l.input.lineNumber)).toEqual([1, 2, 3]);
  });

  it("names an unbranded line by its position and flags unparseable numbers", () => {
    const mapped = mapOpportunityProduct(
      item({ brand: null, quantity: "n/a", amount: "" }),
    );
    expect(mapped.input.name).toBe("Line 1");
    expect(mapped.productSourceId).toBeNull();
    expect(mapped.input).not.toHaveProperty("quantity");
    expect(mapped.input).not.toHaveProperty("amount");
    expect(mapped.input.isMobil).toBe(false);
    expect(mapped.warnings).toContain("unparseable line quantity n/a dropped");
  });

  it("treats MOBIL - CVL as Mobil, GOLDEN WEST as not", () => {
    expect(isMobilBrand("MOBIL - CVL")).toBe(true);
    expect(isMobilBrand("Mobil")).toBe(true);
    expect(isMobilBrand("GOLDEN WEST")).toBe(false);
    expect(isMobilBrand(null)).toBe(false);
  });
});

describe("mapTaskStatusToStage", () => {
  it("maps LastMile status names verbatim to pipeline stages", () => {
    expect(mapTaskStatusToStage("10-Prospect").stage).toBe("PROSPECT");
    expect(mapTaskStatusToStage("60-Won").stage).toBe("WON");
    expect(mapTaskStatusToStage("20-Account Needs").stage).toBe(
      "ACCOUNT_NEEDS",
    );
    expect(mapTaskStatusToStage("Converted").stage).toBe("CONVERTED");
    expect(mapTaskStatusToStage("90-Unqualified").stage).toBe("UNQUALIFIED");
  });

  it("flags an unmapped status instead of silently bucketing it", () => {
    expect(mapTaskStatusToStage("Zz-Unknown")).toEqual({
      stage: "NEW",
      unknown: true,
    });
    expect(mapTaskStatusToStage(null).unknown).toBe(true);
  });
});

describe("mapCrmTask (task table is the CRM authority)", () => {
  const ownerIndex = new Map([["rep_chad", "member-chad"]]);
  const companyMap = new Map([["account:acct_reign", "company-reign"]]);
  const orgMap = new Map([["organization:org_gwo", "org-gwo-300"]]);

  function task(overrides: Partial<LastmileCrmTask> = {}): LastmileCrmTask {
    return {
      taskId: "task_xdh6577weuhsc2ttlct1acyl",
      entityType: "opportunity",
      entityId: "opp_xdh6577weuhsc2ttlct1acyl",
      title: "Reign Rentals GW Lubes",
      description: "start up oilfield rental company with brand new equipment",
      accountId: "acct_reign",
      leadCompanyName: null,
      statusName: "10-Prospect",
      organizationId: "org_gwo",
      assigneeRepId: "rep_chad",
      dueDate: new Date("2026-07-23T00:00:00Z"),
      createdAt: null,
      items: [{ brand: "Golden West", amount: 12000, quantity: 40 }],
      ...overrides,
    };
  }

  it("reproduces the reference opportunity exactly", () => {
    const mapped = mapCrmTask(task(), ownerIndex, companyMap, orgMap);
    expect(mapped.sourceId).toBe("opportunity:opp_xdh6577weuhsc2ttlct1acyl");
    expect(mapped.input).toMatchObject({
      name: "Reign Rentals GW Lubes",
      stage: "PROSPECT",
      amount: { amountMicros: 12_000_000_000, currencyCode: "USD" },
      ownerId: "member-chad",
      companyId: "company-reign",
      organizationId: "org-gwo-300",
      isMobil: false,
    });
    expect(mapped.warnings).toEqual([]);
  });

  it("takes status from the task, not the stale opportunity.stage column", () => {
    // The opportunity row for this task says "30-Formulate Offer"; the task
    // says 10-Prospect, and the task wins.
    expect(mapCrmTask(task(), ownerIndex, companyMap, orgMap).input.stage).toBe(
      "PROSPECT",
    );
  });

  it("sums product lines into the deal amount and rolls up isMobil", () => {
    const mapped = mapCrmTask(
      task({
        items: [
          { brand: "DEF", amount: 1000, quantity: 1000 },
          { brand: "GOLDEN WEST", amount: 1000, quantity: 1000 },
          { brand: "MOBIL", amount: 1000, quantity: 500 },
        ],
      }),
      ownerIndex,
      companyMap,
      orgMap,
    );
    expect(mapped.input.amount).toEqual({
      amountMicros: 3_000_000_000,
      currencyCode: "USD",
    });
    expect(mapped.input.isMobil).toBe(true);
  });

  it("maps a lead with no account to a named opportunity with no company", () => {
    const mapped = mapCrmTask(
      task({
        entityType: "lead",
        entityId: "lead_1",
        title: null,
        accountId: null,
        leadCompanyName: "Alpine Silica",
        statusName: "50-Qualified",
        items: null,
      }),
      ownerIndex,
      companyMap,
      orgMap,
    );
    expect(mapped.sourceId).toBe("lead:lead_1");
    expect(mapped.input).toMatchObject({
      name: "Alpine Silica",
      stage: "QUALIFIED",
    });
    expect(mapped.input).not.toHaveProperty("companyId");
    expect(mapped.input).not.toHaveProperty("amount");
  });

  it("flags an unassigned task and an unmigrated organization", () => {
    const mapped = mapCrmTask(
      task({ assigneeRepId: null, organizationId: "org_missing" }),
      ownerIndex,
      companyMap,
      orgMap,
    );
    expect(mapped.input).not.toHaveProperty("ownerId");
    expect(mapped.input).not.toHaveProperty("organizationId");
    expect(mapped.warnings).toEqual([
      "task has no assignee; no owner",
      "organization org_missing not migrated",
    ]);
  });

  it("derives product lines from the task's items array", () => {
    const lines = mapTaskProducts(task());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      sourceId: "opportunity_item:opp_xdh6577weuhsc2ttlct1acyl#0",
      opportunitySourceId: "opportunity:opp_xdh6577weuhsc2ttlct1acyl",
    });
    expect(lines[0].input).toMatchObject({
      name: "Golden West",
      quantity: 40,
      amount: { amountMicros: 12_000_000_000, currencyCode: "USD" },
    });
    expect(lines[0].productSourceId).toBe("product:golden_west");
  });
});

describe("mapOrganization", () => {
  it("names the record by its abbreviation and keeps the full name", () => {
    const mapped = mapOrganization({
      id: "org_x3wdgjtw4x4jqx2a937amutm",
      name: "Golden West Oil Co..San Antonio (300)",
      abbv: "GWO 300",
      archived: false,
    });
    expect(mapped.sourceId).toBe("organization:org_x3wdgjtw4x4jqx2a937amutm");
    expect(mapped.input).toMatchObject({
      name: "GWO 300",
      fullName: "Golden West Oil Co..San Antonio (300)",
    });
  });

  it("falls back to the full name when there is no abbreviation", () => {
    const mapped = mapOrganization({
      id: "org_1",
      name: "UNKNOWN",
      abbv: null,
      archived: false,
    });
    expect(mapped.input.name).toBe("UNKNOWN");
  });
});

describe("dedupeContactEmails", () => {
  it("gives a shared address to the first contact by id and clears the rest", () => {
    const result = dedupeContactEmails([
      { id: "cont_b", email: "test@test.com" },
      { id: "cont_a", email: "Test@Test.com" },
      { id: "cont_c", email: "unique@tei.com" },
    ]);
    const byId = new Map(result.map((c) => [c.id, c.email]));
    expect(byId.get("cont_a")).toBe("Test@Test.com"); // first by id keeps it
    expect(byId.get("cont_b")).toBeNull();
    expect(byId.get("cont_c")).toBe("unique@tei.com");
  });

  it("is deterministic regardless of input order", () => {
    const rows = [
      { id: "cont_a", email: "x@y.com" },
      { id: "cont_b", email: "x@y.com" },
    ];
    const forward = dedupeContactEmails(rows);
    const reversed = dedupeContactEmails([...rows].reverse());
    expect(forward.map((c) => [c.id, c.email])).toEqual(
      reversed.map((c) => [c.id, c.email]),
    );
  });

  it("leaves invalid and missing emails alone", () => {
    const result = dedupeContactEmails([
      { id: "a", email: null },
      { id: "b", email: "garbage" },
      { id: "c", email: "garbage" },
    ]);
    expect(result.map((c) => c.email)).toEqual([null, "garbage", "garbage"]);
  });
});

describe("normalizeProductName (19 LastMile spellings -> 7 catalog products)", () => {
  it("folds channel suffixes into the parent product", () => {
    // CVL / PVL / INDUSTRIAL denote the sales channel, not a different product.
    expect(normalizeProductName("MOBIL - CVL")).toBe("Mobil");
    expect(normalizeProductName("MOBIL - PVL")).toBe("Mobil");
    expect(normalizeProductName("MOBIL - INDUSTRIAL")).toBe("Mobil");
    expect(normalizeProductName("GWO - CVL")).toBe("Golden West");
    expect(normalizeProductName("GWO - PVL")).toBe("Golden West");
    expect(normalizeProductName("GWO - INDUSTRIAL")).toBe("Golden West");
  });

  it("is case-insensitive across every observed spelling", () => {
    expect(normalizeProductName("MOBIL")).toBe("Mobil");
    expect(normalizeProductName("Mobil")).toBe("Mobil");
    expect(normalizeProductName("GOLDEN WEST")).toBe("Golden West");
    expect(normalizeProductName("Golden West")).toBe("Golden West");
    expect(normalizeProductName("FUEL")).toBe("Fuel");
    expect(normalizeProductName("DEF")).toBe("DEF");
    expect(normalizeProductName("MIGHTY")).toBe("Mighty");
    expect(normalizeProductName("Mighty")).toBe("Mighty");
    expect(normalizeProductName("ANCILLARY")).toBe("Ancillary");
    expect(normalizeProductName("HOTSY")).toBe("Hotsy");
    expect(normalizeProductName("Hotsy")).toBe("Hotsy");
  });

  it("every catalog name maps to itself", () => {
    for (const name of PRODUCT_CATALOG) {
      expect(normalizeProductName(name)).toBe(name);
    }
  });

  it("refuses to guess: UNKNOWN and blanks map to nothing", () => {
    expect(normalizeProductName("UNKNOWN")).toBeNull();
    expect(normalizeProductName("")).toBeNull();
    expect(normalizeProductName("   ")).toBeNull();
    expect(normalizeProductName(null)).toBeNull();
    expect(normalizeProductName("Kerosene")).toBeNull();
  });

  it("isMobil follows the catalog, not the raw string", () => {
    expect(isMobilBrand("MOBIL - CVL")).toBe(true);
    expect(isMobilBrand("Mobil")).toBe(true);
    expect(isMobilBrand("GOLDEN WEST")).toBe(false);
    expect(isMobilBrand("UNKNOWN")).toBe(false);
  });
});

describe("mapProduct", () => {
  it("gives each catalog product a stable sourceId", () => {
    expect(mapProduct("Golden West")).toMatchObject({
      sourceId: "product:golden_west",
      input: { name: "Golden West", sourceId: "product:golden_west" },
    });
    expect(mapProduct("DEF").sourceId).toBe("product:def");
    expect(productSourceId("Mobil")).toBe("product:mobil");
  });
});

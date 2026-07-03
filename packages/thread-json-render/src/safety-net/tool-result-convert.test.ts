import { describe, expect, it } from "vitest";

import { convertRecordsToGenUI } from "./tool-result-convert.js";

describe("convertRecordsToGenUI (U8)", () => {
  it("converts a homogeneous record array into a validated table part", () => {
    const result = convertRecordsToGenUI([
      { name: "Acme expansion", stage: "Negotiation", amount: 42000 },
      { name: "Globex renewal", stage: "Closed Won", amount: 18000 },
      { name: "Initech pilot", stage: "Discovery", amount: 5000 },
    ]);

    expect(result.matched).toBe(true);
    const table = result.part?.spec.elements.table;
    expect(table?.type).toBe("table");
    const props = table?.props as {
      columns: Array<{ id: string; header: string }>;
      rows: Array<Record<string, string>>;
    };
    expect(props.columns.map((c) => c.header)).toEqual([
      "name",
      "stage",
      "amount",
    ]);
    expect(props.rows).toHaveLength(3);
    // numbers are stringified into cells; null becomes ""
    expect(props.rows[0].amount).toBe("42000");
    expect(result.part?.mobileFallback.summary).toContain("3 rows");
  });

  it("stringifies numbers/booleans and renders null as empty", () => {
    const result = convertRecordsToGenUI([
      { name: "A", won: true, note: null },
      { name: "B", won: false, note: null },
    ]);
    expect(result.matched).toBe(true);
    const props = result.part?.spec.elements.table.props as {
      rows: Array<Record<string, string>>;
    };
    expect(props.rows[0].won).toBe("true");
    expect(props.rows[0].note).toBe("");
  });

  it.each([
    ["a scalar", 42],
    ["a string", "hello"],
    ["null", null],
    ["an object (not array)", { a: 1 }],
    ["an empty array", []],
    ["a single-record array", [{ a: 1 }]],
    ["records with no fields", [{}, {}]],
  ])("does not convert %s", (_label, value) => {
    expect(convertRecordsToGenUI(value).matched).toBe(false);
  });

  it("does not convert heterogeneous key sets", () => {
    expect(
      convertRecordsToGenUI([
        { name: "A", stage: "X" },
        { name: "B", amount: 10 },
      ]).matched,
    ).toBe(false);
  });

  it("does not convert records with nested (non-primitive) values", () => {
    expect(
      convertRecordsToGenUI([
        { name: "A", meta: { nested: true } },
        { name: "B", meta: { nested: false } },
      ]).matched,
    ).toBe(false);
    expect(
      convertRecordsToGenUI([
        { name: "A", tags: ["x"] },
        { name: "B", tags: ["y"] },
      ]).matched,
    ).toBe(false);
  });

  it("skips arrays larger than the table row cap (validator would reject)", () => {
    const big = Array.from({ length: 51 }, (_, i) => ({ id: i, name: `r${i}` }));
    expect(convertRecordsToGenUI(big).matched).toBe(false);
  });

  it("does not mutate the input", () => {
    const input = [
      { name: "A", amount: 1 },
      { name: "B", amount: 2 },
    ];
    const snapshot = JSON.stringify(input);
    convertRecordsToGenUI(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

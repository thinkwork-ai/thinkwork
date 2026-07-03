import { describe, expect, it } from "vitest";

import { createThreadJsonRenderSpecHash } from "../hash.js";
import {
  THREAD_JSON_RENDER_CATALOG_VERSION,
  THREAD_JSON_RENDER_SCHEMA_VERSION,
} from "../spec.js";
import { validateThreadJsonRenderData } from "../validation.js";
import { detectAndConvert } from "./detect-convert.js";

describe("detectAndConvert — GFM tables", () => {
  it("converts a piped GFM table into a validated table part", () => {
    const text = [
      "Here are the results:",
      "",
      "| Name | Owner | Score |",
      "| --- | --- | --- |",
      "| Kickoff | Codex | 3 |",
      "| Launch | Ada | 1 |",
      "",
      "Let me know if you need more.",
    ].join("\n");

    const result = detectAndConvert(text);
    expect(result.matched).toBe(true);
    expect(result.part).toBeDefined();

    const element = result.part!.spec.elements.table;
    expect(element.type).toBe("table");
    const props = element.props as {
      columns: Array<{ id: string; header: string }>;
      rows: Array<Record<string, unknown>>;
    };
    expect(props.columns.map((c) => c.header)).toEqual([
      "Name",
      "Owner",
      "Score",
    ]);
    expect(props.rows).toHaveLength(2);
    expect(props.rows[0]).toMatchObject({
      id: "row-1",
      name: "Kickoff",
      owner: "Codex",
      score: "3",
    });
  });

  it("re-validates the converted part through the strict validator", () => {
    const text = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const result = detectAndConvert(text);
    expect(result.matched).toBe(true);
    const revalidated = validateThreadJsonRenderData(result.part);
    expect(revalidated.ok).toBe(true);
  });

  it("emits schema/catalog versions and a matching specHash", () => {
    const text = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const result = detectAndConvert(text);
    expect(result.part!.schemaVersion).toBe(THREAD_JSON_RENDER_SCHEMA_VERSION);
    expect(result.part!.catalogVersion).toBe(
      THREAD_JSON_RENDER_CATALOG_VERSION,
    );
    expect(result.part!.specHash).toBe(
      createThreadJsonRenderSpecHash(result.part!.spec),
    );
  });

  it("builds a mobileFallback with title, summary, and first-N lines", () => {
    const text = "| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |";
    const result = detectAndConvert(text);
    const fallback = result.part!.mobileFallback;
    expect(fallback.title).toBe("Table");
    expect(fallback.summary).toBe("2 rows, 2 columns");
    expect(fallback.lines).toEqual(["1 — 2", "3 — 4"]);
  });

  it("caps mobileFallback lines at the validator limit", () => {
    const body = Array.from(
      { length: 20 },
      (_, i) => `| r${i} | ${i} |`,
    ).join("\n");
    const text = `| A | B |\n| --- | --- |\n${body}`;
    const result = detectAndConvert(text);
    expect(result.matched).toBe(true);
    expect(result.part!.mobileFallback.lines!.length).toBeLessThanOrEqual(12);
  });

  it("supports header rows without leading/trailing pipes", () => {
    const text = "Name | Score\n--- | ---\nAlice | 9\nBob | 4";
    const result = detectAndConvert(text);
    expect(result.matched).toBe(true);
    const props = result.part!.spec.elements.table.props as {
      columns: Array<{ header: string }>;
      rows: unknown[];
    };
    expect(props.columns.map((c) => c.header)).toEqual(["Name", "Score"]);
    expect(props.rows).toHaveLength(2);
  });

  it("honors alignment separators like :---: and ---:", () => {
    const text = "| A | B |\n| :--- | ---: |\n| 1 | 2 |";
    expect(detectAndConvert(text).matched).toBe(true);
  });

  it("honors backslash-escaped pipes inside cells", () => {
    const text = "| A | B |\n| --- | --- |\n| a \\| b | c |";
    const result = detectAndConvert(text);
    expect(result.matched).toBe(true);
    const props = result.part!.spec.elements.table.props as {
      rows: Array<Record<string, unknown>>;
    };
    expect(props.rows[0].a).toBe("a | b");
  });

  it("reports a source span covering the converted block", () => {
    const text = [
      "Intro line",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "outro",
    ].join("\n");
    const result = detectAndConvert(text);
    expect(result.sourceSpan).toEqual({ startLine: 1, endLine: 4 });
  });

  it("disambiguates duplicate and reserved column ids", () => {
    const text = "| id | Name | Name |\n| --- | --- | --- |\n| 1 | a | b |";
    const result = detectAndConvert(text);
    expect(result.matched).toBe(true);
    const props = result.part!.spec.elements.table.props as {
      columns: Array<{ id: string }>;
      rows: Array<Record<string, unknown>>;
    };
    const ids = props.columns.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The "id" header must not clobber the reserved row-identity key.
    expect(ids).not.toContain("id");
    expect(props.rows[0].id).toBe("row-1");
  });
});

describe("detectAndConvert — false-positive guards", () => {
  it("does not convert prose containing stray pipes", () => {
    const text =
      "The pipeline handles A | B routing and the ratio is 3 | 4 today.";
    expect(detectAndConvert(text).matched).toBe(false);
  });

  it("does not convert a single row with no separator", () => {
    const text = "| Name | Owner |\n| Alice | Bob |";
    expect(detectAndConvert(text).matched).toBe(false);
  });

  it("does not convert a header + separator with no body rows", () => {
    const text = "| A | B |\n| --- | --- |";
    expect(detectAndConvert(text).matched).toBe(false);
  });

  it("does not convert a single-column table", () => {
    const text = "| OnlyColumn |\n| --- |\n| value |";
    expect(detectAndConvert(text).matched).toBe(false);
  });

  it("does not convert a misaligned separator (wrong column count)", () => {
    const text = "| A | B | C |\n| --- | --- |\n| 1 | 2 | 3 |";
    expect(detectAndConvert(text).matched).toBe(false);
  });

  it("does not treat a non-dash separator line as a separator", () => {
    const text = "| A | B |\n| xx | yy |\n| 1 | 2 |";
    expect(detectAndConvert(text).matched).toBe(false);
  });

  it("does not convert a table inside a fenced code block", () => {
    const text = [
      "```",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "```",
    ].join("\n");
    expect(detectAndConvert(text).matched).toBe(false);
  });

  it("does not convert a table inside a tilde-fenced code block", () => {
    const text = [
      "~~~markdown",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "~~~",
    ].join("\n");
    expect(detectAndConvert(text).matched).toBe(false);
  });

  it("returns no match for empty or whitespace-only input", () => {
    expect(detectAndConvert("").matched).toBe(false);
    expect(detectAndConvert("   \n  \n").matched).toBe(false);
  });

  it("does not throw and does not mutate the input string", () => {
    const text = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const copy = String(text);
    expect(() => detectAndConvert(text)).not.toThrow();
    expect(text).toBe(copy);
  });

  it("terminates the body at the first ragged row", () => {
    const text = [
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "| 3 | 4 | 5 |",
      "| 6 | 7 |",
    ].join("\n");
    const result = detectAndConvert(text);
    expect(result.matched).toBe(true);
    const props = result.part!.spec.elements.table.props as { rows: unknown[] };
    // Only the first well-formed body row is captured before the ragged line.
    expect(props.rows).toHaveLength(1);
  });
});

describe("detectAndConvert — list of records", () => {
  it("converts a clean homogeneous list of records", () => {
    const text = [
      "- Name: Alice",
      "  Role: Engineer",
      "  Team: Platform",
      "- Name: Bob",
      "  Role: Designer",
      "  Team: Brand",
    ].join("\n");

    const result = detectAndConvert(text);
    expect(result.matched).toBe(true);
    const props = result.part!.spec.elements.table.props as {
      columns: Array<{ header: string }>;
      rows: Array<Record<string, unknown>>;
    };
    expect(props.columns.map((c) => c.header)).toEqual(["Name", "Role", "Team"]);
    expect(props.rows).toHaveLength(2);
    expect(props.rows[1]).toMatchObject({ name: "Bob", role: "Designer" });
  });

  it("skips a heterogeneous list of records (mismatched keys)", () => {
    const text = [
      "- Name: Alice",
      "  Role: Engineer",
      "- Name: Bob",
      "  Team: Brand",
    ].join("\n");
    expect(detectAndConvert(text).matched).toBe(false);
  });

  it("skips a list where records have only one field", () => {
    const text = ["- Name: Alice", "- Name: Bob"].join("\n");
    expect(detectAndConvert(text).matched).toBe(false);
  });

  it("skips a bullet list that is not key: value structured", () => {
    const text = ["- first thing to do", "- second thing to do"].join("\n");
    expect(detectAndConvert(text).matched).toBe(false);
  });

  it("skips a single record", () => {
    const text = ["- Name: Alice", "  Role: Engineer"].join("\n");
    expect(detectAndConvert(text).matched).toBe(false);
  });
});

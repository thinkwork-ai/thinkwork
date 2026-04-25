import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseRoutingTable,
  replaceRoutingTable,
  serializeRoutingRows,
} from "../routing-table";

const SAMPLE = `# Agent Map

## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| Receipts | expenses/ | expenses/CONTEXT.md | approve-receipt, tag-vendor |
| General | ./ | CONTEXT.md | |

## Notes

Keep prose intact.
`;

describe("routing-table", () => {
  it("parses the canonical workspace-defaults AGENTS.md fixture", () => {
    const canonical = readFileSync(
      new URL(
        "../../../../../../packages/workspace-defaults/files/AGENTS.md",
        import.meta.url,
      ),
      "utf8",
    );

	const result = parseRoutingTable(canonical);

	expect(result.warning).toBeUndefined();
	expect(result.rows).toEqual([]);
  });

  it("parses routing rows under the Routing heading", () => {
    const result = parseRoutingTable(SAMPLE);

    expect(result.warning).toBeUndefined();
    expect(result.rows).toEqual([
      {
        task: "Receipts",
        goTo: "expenses/",
        read: "expenses/CONTEXT.md",
        skills: ["approve-receipt", "tag-vendor"],
      },
      {
        task: "General",
        goTo: "./",
        read: "CONTEXT.md",
        skills: [],
      },
    ]);
  });

  it("serializes rows to the canonical markdown shape", () => {
    expect(
      serializeRoutingRows([
        {
          task: "Support",
          goTo: "support/",
          read: "support/CONTEXT.md",
          skills: ["triage", "tag"],
        },
      ]),
    ).toBe(`| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| Support | support/ | support/CONTEXT.md | triage, tag |`);
  });

  it("replaces only the routing table block", () => {
    const next = replaceRoutingTable(SAMPLE, [
      {
        task: "Ops",
        goTo: "ops/",
        read: "ops/CONTEXT.md",
        skills: ["handoff"],
      },
    ]);

    expect(next).toContain("# Agent Map");
    expect(next).toContain("## Notes");
    expect(parseRoutingTable(next).rows).toEqual([
      {
        task: "Ops",
        goTo: "ops/",
        read: "ops/CONTEXT.md",
        skills: ["handoff"],
      },
    ]);
  });

  it("appends a routing table when the Routing heading is absent", () => {
    const next = replaceRoutingTable(
      "# Agent Map\n\nIntro table:\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n",
      [
        {
          task: "Ops",
          goTo: "ops/",
          read: "ops/CONTEXT.md",
          skills: ["handoff"],
        },
      ],
    );

    expect(next).toContain("| A | B |");
    expect(parseRoutingTable(next).rows).toEqual([
      {
        task: "Ops",
        goTo: "ops/",
        read: "ops/CONTEXT.md",
        skills: ["handoff"],
      },
    ]);
  });

  it("normalizes pipes inside structured cells before serialization", () => {
    const next = replaceRoutingTable("## Routing\n\n", [
      {
        task: "A | B",
        goTo: "ops/",
        read: "ops/CONTEXT.md",
        skills: [],
      },
    ]);

    expect(next).not.toContain("\\|");
    expect(parseRoutingTable(next).rows[0]?.task).toBe("A / B");
  });

  it("does not read a table from a later section as the routing table", () => {
    const result = parseRoutingTable(`# Agent Map

## Routing

This section has no table yet.

## Notes

| A | B |
| --- | --- |
| 1 | 2 |
`);

    expect(result.rows).toEqual([]);
    expect(result.warning).toBe("No routing table found.");
  });

  it("inserts a missing table inside an existing Routing section", () => {
    const next = replaceRoutingTable(
      `# Agent Map

## Routing

This section has no table yet.

## Notes

Keep prose intact.
`,
      [
        {
          task: "Ops",
          goTo: "ops/",
          read: "ops/CONTEXT.md",
          skills: ["handoff"],
        },
      ],
    );

    expect(next.indexOf("| Task | Go to | Read | Skills |")).toBeLessThan(
      next.indexOf("## Notes"),
    );
    expect(parseRoutingTable(next).rows[0]?.goTo).toBe("ops/");
  });

  it("warns on reserved Go to folders", () => {
    const result = parseRoutingTable(`## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| Memory | memory/ | memory/CONTEXT.md | remember |
`);

    expect(result.rowWarnings?.[0]).toContain("reserved");
  });

  it("warns when required columns are missing", () => {
    const result = parseRoutingTable(`## Routing

| Task | Read | Skills |
| --- | --- | --- |
| Receipts | expenses/CONTEXT.md | approve-receipt |
`);

    expect(result.rows).toEqual([]);
    expect(result.warning).toContain("go to");
  });
});

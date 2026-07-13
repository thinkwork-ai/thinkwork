import { describe, expect, it } from "vitest";

import {
  DEFAULT_LEDGER,
  findLedgerComment,
  isLedgerComment,
  ledgerMarker,
  parseLedgerComment,
  renderLedgerComment,
  type Ledger,
} from "../src/linear/ledger.js";

const ID = "THINK-123";

const fullLedger: Ledger = {
  phase: "implement",
  lane: "Claude",
  worker: { id: "pid-4242", host: "mini" },
  attempt: 2,
  blocker: "Needs User",
  compounded: false,
};

describe("ledgerMarker", () => {
  it("builds the automation-ledger marker for an issue", () => {
    expect(ledgerMarker(ID)).toBe("automation-ledger:THINK-123");
  });
});

describe("isLedgerComment — exact first-line marker (spoof hardening)", () => {
  it("matches a real ledger comment (marker is the first line)", () => {
    expect(isLedgerComment(ID, renderLedgerComment(ID, fullLedger))).toBe(true);
    expect(isLedgerComment(ID, `automation-ledger:${ID}\n\nprose`)).toBe(true);
  });

  it("does NOT match a comment merely quoting the marker mid-body", () => {
    const quoting = [
      "Progress update:",
      `I updated the automation-ledger:${ID} comment above with new state.`,
    ].join("\n");
    expect(isLedgerComment(ID, quoting)).toBe(false);
  });

  it("does NOT match a longer identifier sharing this issue's prefix", () => {
    expect(
      isLedgerComment("THINK-12", `automation-ledger:THINK-123\n\nother issue`),
    ).toBe(false);
  });
});

describe("findLedgerComment — newest matching comment wins", () => {
  it("prefers the newest ledger comment over an older one", () => {
    const older = {
      id: "c-old",
      body: renderLedgerComment(ID, { ...DEFAULT_LEDGER, compounded: true }),
    };
    const newer = {
      id: "c-new",
      body: renderLedgerComment(ID, { ...DEFAULT_LEDGER, phase: "implement" }),
    };
    const found = findLedgerComment(ID, [older, newer]);
    expect(found?.id).toBe("c-new");
  });

  it("ignores mid-body quotes entirely", () => {
    const found = findLedgerComment(ID, [
      { id: "c-1", body: `see automation-ledger:${ID} for state` },
    ]);
    expect(found).toBeNull();
  });
});

describe("round-trip (write → parse → identical)", () => {
  it("round-trips a full ledger with prose exactly", () => {
    const prose = "Human notes.\n\nSecond paragraph with `code`.";
    const body = renderLedgerComment(ID, fullLedger, prose);
    const parsed = parseLedgerComment(ID, body);
    expect(parsed.synthesized).toBe(false);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.ledger).toEqual(fullLedger);
    expect(parsed.prose).toBe(prose);
    // Writer is stable: re-rendering the parse yields the identical body.
    expect(renderLedgerComment(ID, parsed.ledger, parsed.prose)).toBe(body);
  });

  it("round-trips null worker / null blocker / no prose", () => {
    const ledger: Ledger = {
      phase: "todo",
      lane: "unassigned",
      worker: null,
      attempt: 0,
      blocker: null,
      compounded: true,
    };
    const body = renderLedgerComment(ID, ledger);
    const parsed = parseLedgerComment(ID, body);
    expect(parsed.synthesized).toBe(false);
    expect(parsed.ledger).toEqual(ledger);
    expect(parsed.prose).toBe("");
    expect(renderLedgerComment(ID, parsed.ledger, parsed.prose)).toBe(body);
  });
});

describe("absent / legacy-prose ledgers", () => {
  it("synthesizes a fresh default block when the comment is absent", () => {
    const parsed = parseLedgerComment(ID, undefined);
    expect(parsed.synthesized).toBe(true);
    expect(parsed.ledger).toEqual(DEFAULT_LEDGER);
    expect(parsed.prose).toBe("");
  });

  it("synthesizes a block from a legacy prose ledger, preserving prose beneath the fence", () => {
    const legacy = [
      "automation-ledger:THINK-123",
      "",
      "Status: In Progress, worker pid 999 on mini.",
      "Next: open PR after tests pass.",
    ].join("\n");
    const parsed = parseLedgerComment(ID, legacy);
    expect(parsed.synthesized).toBe(true);
    expect(parsed.ledger).toEqual(DEFAULT_LEDGER);
    expect(parsed.prose).toContain("Status: In Progress, worker pid 999");
    expect(parsed.prose).toContain("Next: open PR after tests pass.");

    const rendered = renderLedgerComment(ID, parsed.ledger, parsed.prose);
    // Marker first, then the fence, then the original prose beneath it.
    expect(rendered.startsWith("automation-ledger:THINK-123")).toBe(true);
    const fenceEnd = rendered.lastIndexOf("```");
    expect(fenceEnd).toBeGreaterThan(-1);
    expect(rendered.indexOf("Status: In Progress")).toBeGreaterThan(fenceEnd);
    // And the synthesized comment now parses as a structured ledger.
    const reparsed = parseLedgerComment(ID, rendered);
    expect(reparsed.synthesized).toBe(false);
    expect(reparsed.ledger).toEqual(DEFAULT_LEDGER);
  });

  it("treats an empty YAML fence as legacy and resynthesizes", () => {
    const body = [
      "automation-ledger:THINK-123",
      "```yaml",
      "```",
      "trailing prose",
    ].join("\n");
    const parsed = parseLedgerComment(ID, body);
    expect(parsed.synthesized).toBe(true);
    expect(parsed.ledger).toEqual(DEFAULT_LEDGER);
    expect(parsed.prose).toContain("trailing prose");
  });

  it("treats malformed YAML in the fence as legacy, preserving the broken content as prose", () => {
    const body = [
      "automation-ledger:THINK-123",
      "```yaml",
      "phase: [unclosed",
      "```",
      "notes after",
    ].join("\n");
    const parsed = parseLedgerComment(ID, body);
    expect(parsed.synthesized).toBe(true);
    expect(parsed.ledger).toEqual(DEFAULT_LEDGER);
    // The malformed content is not silently dropped.
    expect(parsed.prose).toContain("phase: [unclosed");
    expect(parsed.prose).toContain("notes after");
  });
});

describe("enum tolerance", () => {
  it("preserves unknown enum values but flags them with warnings", () => {
    const weird: Ledger = {
      phase: "wizardry",
      lane: "Gemini",
      worker: null,
      attempt: 1,
      blocker: "Cursed",
      compounded: false,
    };
    const body = renderLedgerComment(ID, weird);
    const parsed = parseLedgerComment(ID, body);
    expect(parsed.synthesized).toBe(false);
    expect(parsed.ledger).toEqual(weird); // preserved verbatim
    expect(parsed.warnings.join(" ")).toContain("wizardry");
    expect(parsed.warnings.join(" ")).toContain("Gemini");
    expect(parsed.warnings.join(" ")).toContain("Cursed");
  });

  it("coerces wrong-typed fields to defaults with warnings", () => {
    const body = [
      "automation-ledger:THINK-123",
      "",
      "```yaml",
      "phase: implement",
      "lane: Claude",
      "worker: not-an-object",
      "attempt: soon",
      "blocker: null",
      "compounded: maybe",
      "```",
    ].join("\n");
    const parsed = parseLedgerComment(ID, body);
    expect(parsed.synthesized).toBe(false);
    expect(parsed.ledger.phase).toBe("implement");
    expect(parsed.ledger.worker).toBeNull();
    expect(parsed.ledger.attempt).toBe(0);
    expect(parsed.ledger.compounded).toBe(false);
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });
});

describe("parseWaitingOn", () => {
  it("parses the waiting-on blocker in its documented forms", async () => {
    const { parseWaitingOn } = await import("../src/linear/ledger.js");
    expect(parseWaitingOn("waiting-on: THINK-273")).toBe("THINK-273");
    expect(parseWaitingOn("waiting-on THINK-273")).toBe("THINK-273");
    expect(parseWaitingOn("Waiting-On: think-273 (merge gate)")).toBe("THINK-273");
    expect(parseWaitingOn("Needs User")).toBeNull();
    expect(parseWaitingOn(null)).toBeNull();
    expect(parseWaitingOn(undefined)).toBeNull();
    expect(parseWaitingOn("waiting-on:")).toBeNull();
  });

  it("does NOT warn 'unknown blocker' for a waiting-on value", async () => {
    const { parseLedgerComment, renderLedgerComment } = await import("../src/linear/ledger.js");
    const body = renderLedgerComment(
      "THINK-9",
      {
        phase: "implement",
        lane: "Claude",
        worker: null,
        attempt: 1,
        blocker: "waiting-on: THINK-273",
        compounded: false,
      },
      "",
    );
    const parsed = parseLedgerComment("THINK-9", body);
    expect(parsed.ledger.blocker).toBe("waiting-on: THINK-273");
    expect(parsed.warnings.filter((w) => w.includes("unknown blocker"))).toEqual([]);
  });
});

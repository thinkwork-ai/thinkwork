import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const source = read("src/components/settings/SettingsMemoryHome.tsx");
const memoryRoute = read("src/routes/_authed/settings.memory.tsx");

describe("SettingsMemoryHome", () => {
  it("owns a single stable Knowledge breadcrumb (U9 umbrella naming)", () => {
    expect(source).toContain('title: "Knowledge"');
    expect(source).toContain('breadcrumbs: [{ label: "Knowledge" }]');
  });

  it("publishes the Knowledge tabs into the page header", () => {
    expect(source).toContain("tabs: [");
    // Memory is the only tab (THINK-408).
    expect(source).not.toContain('label: "Company Brain"');
    expect(source).toContain('to: RECORDS, label: "Memory"');
    expect(source).not.toContain('label: "KBs"');
    // The bare /settings/memory path lands on Memory records.
    expect(source).toContain('return "memory";');
  });

  it("carries no Company Brain link-out (banner removed, Eric 2026-07-25)", () => {
    // The console link-out card shipped with THINK-339 U15 and was removed
    // by request — Knowledge stays purely Memory.
    expect(source).not.toContain("BrainConsoleCard");
    expect(source).not.toContain("https://brain.thinkwork.ai");
  });

  it("keeps the Memory refresh control visually interactive", () => {
    expect(source).toContain("hover:text-primary");
    expect(source).toContain("bg-primary/10 text-primary");
    expect(source).toContain('"animate-spin"');
    expect(source).toContain("setRefreshPending(true)");
  });

  it("renders the active facet selected by the current route", () => {
    expect(source).toContain("tabForPath");
    expect(source).toMatch(/<SettingsMemory\s+[\s\S]*?\bembedded\b/);
    // The twin explorer tab is gone (THINK-339 U15).
    expect(source).not.toContain("KnowledgeModelTab");
    expect(source).not.toContain("TwinExplorer");
    // No in-body tab strip — the tabs live in the header now.
    expect(source).not.toContain("TabsList");
  });

  it("mounts the combined page across the Memory sub-routes", () => {
    expect(memoryRoute).toContain("SettingsMemoryHome");
  });
});

/**
 * Blueprint-shape tests for the default governance files (Composer plan
 * 2026-07-02-001 U6; R6, AE3).
 *
 * The workspace-blueprint 3-layer context-delivery architecture maps onto
 * platform file positions as:
 *
 *   - agent-root AGENTS.md  = Layer 1, the map (always loaded)
 *   - agent-root CONTEXT.md = Layer 2, the task router
 *   - space SPACE.md        = Layer 3, the self-contained workspace layer
 *
 * The defaults must also keep carrying the U4 managed headings
 * (`## Folder Structure` + `## Skills & Tools` in AGENTS.md, `## Routing`
 * in CONTEXT.md) so the managed-sections engine fills their bodies at
 * render / map time.
 */

import { describe, expect, it } from "vitest";
import { loadFile } from "../index.js";

describe("AGENTS.md — Layer 1 map", () => {
  const content = loadFile("AGENTS.md");

  it("carries the managed headings the engine recomposes", () => {
    expect(content).toMatch(/^## Folder Structure$/m);
    expect(content).toMatch(/^## Skills & Tools$/m);
  });

  it("keeps the operator routing table with the canonical column set", () => {
    expect(content).toMatch(/^## Routing$/m);
    expect(content).toContain("| Task | Go to | Read | Skills |");
  });

  it("names the three context layers", () => {
    expect(content).toContain("Layer 1");
    expect(content).toContain("Layer 2");
    expect(content).toContain("Layer 3");
  });

  it("routes to root CONTEXT.md as the task router via Quick Navigation", () => {
    expect(content).toMatch(/^## Quick Navigation$/m);
    expect(content).toMatch(/\| Want to\.\.\. +\| Go here +\|/);
    expect(content).toContain("Layer 2 task router");
  });

  it("carries the blueprint token-management silo guidance", () => {
    expect(content).toMatch(/^## Token Management$/m);
    expect(content).toContain("Each workspace is siloed");
  });

  it("still carries the identity placeholder for bootstrap substitution", () => {
    expect(content).toContain("{{AGENT_NAME}}");
  });
});

describe("CONTEXT.md — Layer 2 router", () => {
  const content = loadFile("CONTEXT.md");

  it("carries the router table with the You'll Also Need column", () => {
    expect(content).toMatch(/^## Task Routing$/m);
    expect(content).toContain("| Your Task | Go Here | You'll Also Need |");
  });

  it("carries the workspace summary table", () => {
    expect(content).toMatch(/^## Workspace Summary$/m);
    expect(content).toContain("| Workspace | Purpose | Skills & Tools |");
  });

  it("carries the managed Routing heading the engine fills", () => {
    expect(content).toMatch(/^## Routing$/m);
  });

  it("keeps the top-level scope prose region", () => {
    expect(content).toMatch(/^## Scope$/m);
    expect(content).toContain("The agent's top-level scope.");
  });
});

describe("SPACE.md — Layer 3 workspace layer", () => {
  const content = loadFile("SPACE.md");

  it("keeps the H1 on line 0 and a blank line 1 (ensureSpaceMdSourceFile contract)", () => {
    const lines = content.split("\n");
    expect(lines[0]).toMatch(/^# /);
    expect(lines[1]).toBe("");
  });

  it("carries the what-to-load table with a Skip column", () => {
    expect(content).toMatch(/^## What to Load$/m);
    expect(content).toContain("| Task | Load These | Skip These |");
  });

  it("carries the skills & tools table with a trigger column", () => {
    expect(content).toMatch(/^## Skills & Tools$/m);
    expect(content).toContain("| Skill / Tool | When to Use | Purpose |");
  });

  it("carries the process and anti-pattern sections", () => {
    expect(content).toMatch(/^## The Process$/m);
    expect(content).toMatch(/^## What NOT to Do$/m);
  });

  it("keeps the capability-grant disclaimer", () => {
    expect(content).toContain("does not grant that\ncapability by itself");
  });
});

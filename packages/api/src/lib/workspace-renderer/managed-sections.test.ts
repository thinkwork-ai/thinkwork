/**
 * Managed-sections composer tests (Composer plan 2026-07-02-001 U4).
 *
 * Covers the U4 contract: byte-preservation of operator prose, canonical
 * append order, the render-equals-map unification (perspective-independent
 * sections, KTD-8), the fail-closed plugin gate on computed CONTEXT.md
 * Routing rows, immediate attach/detach reflection, round-trips of
 * prose-only and sections-only files, and legacy agents without a root
 * CONTEXT.md. Since U5 (KTD-9) the computed Routing section IS the live
 * render seam — `composeGeneratedContextMd` composes the managed
 * sections; the legacy snippet-line filter is retired.
 */

import { describe, expect, it } from "vitest";
import {
  AGENTS_MD_MANAGED_SECTION_ORDER,
  CONTEXT_MD_MANAGED_SECTION_ORDER,
  composeContextMdManagedSections,
  composeGeneratedContextMd,
  computeContextRoutingRows,
  getMarkdownSectionBody,
  renderContextRoutingSectionBody,
  replaceManagedSections,
  replaceMarkdownSection,
} from "./managed-sections.js";
import {
  renderDerivedAgentsMdSections,
  replaceDerivedAgentsMdSections,
} from "../workspace-map-generator.js";
import { composeAgentsMdWithRouting } from "./agents-md-composer.js";
import {
  EMPTY_PLUGIN_GATE,
  FAIL_CLOSED_PLUGIN_GATE,
  type PluginActivationGate,
} from "../plugins/gating.js";

const AGENTS_SECTIONS = {
  "Folder Structure": "\n```\nacme/\n├── CONTEXT.md\n└── memory/\n```\n",
  "Skills & Tools": "\nNo skills assigned.\n",
} as const;

function gateBlocking(prefixes: string[]): PluginActivationGate {
  return {
    hasPluginInstalls: true,
    allowedInstallIds: new Set(),
    blockedInstallIds: new Set(["install-1"]),
    blockedSkillFolderPrefixes: prefixes,
    blockAllNamespacedPluginFolders: false,
  };
}

describe("replaceManagedSections — byte preservation", () => {
  it("preserves prose before, between, and after managed headings byte-for-byte", () => {
    const before = "# Acme Map\n\nLead prose stays.\n\n";
    const between = "## Operator Notes\n\nBetween-sections prose stays.\n\n";
    const after = "## Token Management\n\nTrailing prose stays.\n";
    const input =
      `${before}## Folder Structure\n\nstale tree\n\n` +
      `${between}## Skills & Tools\n\nstale skills\n\n` +
      after;

    const output = replaceManagedSections(input, AGENTS_SECTIONS, {
      order: AGENTS_MD_MANAGED_SECTION_ORDER,
    });

    expect(output).toBe(
      `${before}## Folder Structure\n${AGENTS_SECTIONS["Folder Structure"]}` +
        `${between}## Skills & Tools\n${AGENTS_SECTIONS["Skills & Tools"]}` +
        after,
    );
  });

  it("appends absent managed headings in canonical order", () => {
    const output = replaceManagedSections(
      "# Acme Map\n\nOnly prose here.\n",
      AGENTS_SECTIONS,
      { order: AGENTS_MD_MANAGED_SECTION_ORDER },
    );

    expect(output).toBe(
      "# Acme Map\n\nOnly prose here.\n" +
        `---\n\n## Folder Structure\n${AGENTS_SECTIONS["Folder Structure"]}` +
        `---\n\n## Skills & Tools\n${AGENTS_SECTIONS["Skills & Tools"]}`,
    );
    expect(output.indexOf("## Folder Structure")).toBeLessThan(
      output.indexOf("## Skills & Tools"),
    );
  });

  it("round-trips a prose-only file (no managed headings)", () => {
    const prose = "# Notes\n\nJust operator prose, no managed headings.\n";
    const once = replaceManagedSections(prose, AGENTS_SECTIONS, {
      order: AGENTS_MD_MANAGED_SECTION_ORDER,
    });
    const twice = replaceManagedSections(once, AGENTS_SECTIONS, {
      order: AGENTS_MD_MANAGED_SECTION_ORDER,
    });

    expect(once.startsWith(prose)).toBe(true);
    expect(twice).toBe(once);
  });

  it("round-trips a file that is only managed sections", () => {
    const only =
      `## Folder Structure\n${AGENTS_SECTIONS["Folder Structure"]}` +
      `## Skills & Tools\n${AGENTS_SECTIONS["Skills & Tools"]}`;
    const once = replaceManagedSections(only, AGENTS_SECTIONS, {
      order: AGENTS_MD_MANAGED_SECTION_ORDER,
    });
    const twice = replaceManagedSections(once, AGENTS_SECTIONS, {
      order: AGENTS_MD_MANAGED_SECTION_ORDER,
    });

    expect(once).toBe(only);
    expect(twice).toBe(once);
  });

  it("matches the legacy replaceDerivedAgentsMdSections output byte-for-byte (characterization)", () => {
    const existing = [
      "# Acme Map",
      "",
      "## Folder Structure",
      "old tree",
      "",
      "---",
      "",
      "## Knowledge Bases",
      "legacy KB section",
      "",
      "---",
      "",
      "## Skills & Tools",
      "old skills",
      "",
    ].join("\n");

    expect(
      replaceManagedSections(existing, AGENTS_SECTIONS, {
        order: AGENTS_MD_MANAGED_SECTION_ORDER,
        removeSections: ["Knowledge Bases", "Workflows"],
      }),
    ).toBe(replaceDerivedAgentsMdSections(existing, { ...AGENTS_SECTIONS }));
  });
});

describe("render path == map path (unification, KTD-8 scope)", () => {
  it("the rendered AGENTS.md carries the map path's perspective-independent section bodies byte-for-byte", () => {
    // Map path: compute the perspective-independent sections and bake them
    // into the agent-source AGENTS.md (exactly what skill toggles do).
    const sections = renderDerivedAgentsMdSections({
      agentSlug: "acme-agent",
      workspaceObjectPaths: [
        "AGENTS.md",
        "CONTEXT.md",
        "memory/lessons.md",
        "skills/notes-helper/SKILL.md",
      ],
      skills: [
        {
          skillId: "notes-helper",
          name: "Notes Helper",
          description: "Capture notes",
          scope: "baseline",
          skillPath: "skills/notes-helper/SKILL.md",
        },
      ],
    });
    const baked = replaceDerivedAgentsMdSections(
      [
        "# Acme Agent — Workspace Map",
        "",
        "## Folder Structure",
        "stale",
        "",
        "## Skills & Tools",
        "stale",
        "",
        "## Operator Notes",
        "",
        "Operator prose after the managed sections.",
        "",
      ].join("\n"),
      sections,
    );

    // Render path: the per-thread generated AGENTS.md composed from that
    // baked baseline (perspective-dependent routing is marker-appended).
    const rendered = composeAgentsMdWithRouting({
      baseline: baked,
      spaces: [
        {
          name: "Default",
          folderPath: "Spaces/default/",
          accessMode: "public",
          isActive: true,
        },
      ],
      user: { name: "Eric", folderPath: "User/" },
    });

    for (const sectionName of AGENTS_MD_MANAGED_SECTION_ORDER) {
      expect(getMarkdownSectionBody(rendered, sectionName)).toBe(
        sections[sectionName],
      );
      expect(getMarkdownSectionBody(rendered, sectionName)).toBe(
        getMarkdownSectionBody(baked, sectionName),
      );
    }
    // Perspective-dependent content exists only in the render output.
    expect(rendered).toContain("## Workspace Routing");
    expect(baked).not.toContain("## Workspace Routing");
  });
});

describe("computeContextRoutingRows — plugin gate (fail-closed) + attach/detach", () => {
  const SKILLS = [
    { slug: "notes-helper" },
    { slug: "lastmile--crm-basics" },
  ] as const;

  it("a gated requester's computed rows carry NO routing row for an excluded plugin skill", () => {
    const rows = computeContextRoutingRows({
      skills: [...SKILLS],
      pluginGate: gateBlocking(["skills/lastmile--", "skills/lastmile-"]),
    });

    expect(rows.map((row) => row.slug)).toEqual(["notes-helper"]);
    const body = renderContextRoutingSectionBody(rows);
    expect(body).toContain("skills/notes-helper/SKILL.md");
    expect(body).not.toContain("lastmile--crm-basics");
  });

  it("a degraded fail-closed gate excludes every namespaced plugin skill, never fails open", () => {
    const rows = computeContextRoutingRows({
      skills: [...SKILLS],
      pluginGate: FAIL_CLOSED_PLUGIN_GATE,
    });
    expect(rows.map((row) => row.slug)).toEqual(["notes-helper"]);
  });

  it("an activated requester keeps the plugin skill row", () => {
    const rows = computeContextRoutingRows({
      skills: [...SKILLS],
      pluginGate: EMPTY_PLUGIN_GATE,
    });
    expect(rows.map((row) => row.slug)).toEqual([
      "lastmile--crm-basics",
      "notes-helper",
    ]);
  });

  it("reflects attach/detach immediately", () => {
    const attached = computeContextRoutingRows({
      skills: [{ slug: "notes-helper" }, { slug: "sales-prep" }],
    });
    expect(attached.map((row) => row.slug)).toEqual([
      "notes-helper",
      "sales-prep",
    ]);

    const detached = computeContextRoutingRows({
      skills: [{ slug: "notes-helper" }],
    });
    expect(detached.map((row) => row.slug)).toEqual(["notes-helper"]);
    expect(renderContextRoutingSectionBody(detached)).not.toContain(
      "sales-prep",
    );
  });

  it("omits disabled skills (inactive assignments carry no routing row)", () => {
    const rows = computeContextRoutingRows({
      skills: [
        { slug: "notes-helper" },
        { slug: "sales-prep", enabled: false },
      ],
    });
    expect(rows.map((row) => row.slug)).toEqual(["notes-helper"]);
  });

  it("omits trust-gated skills (active === false carries no routing row) while an active skill does", () => {
    const rows = computeContextRoutingRows({
      skills: [
        { slug: "crm-dashboard", active: true },
        { slug: "finance-audit-xls", active: false },
      ],
    });
    expect(rows.map((row) => row.slug)).toEqual(["crm-dashboard"]);
    expect(renderContextRoutingSectionBody(rows)).not.toContain(
      "finance-audit-xls",
    );
  });

  it("flipping the trust-gate state flips the routing row", () => {
    const gated = computeContextRoutingRows({
      skills: [{ slug: "finance-statement-analysis", active: false }],
    });
    expect(gated).toEqual([]);

    const trusted = computeContextRoutingRows({
      skills: [{ slug: "finance-statement-analysis", active: true }],
    });
    expect(trusted.map((row) => row.slug)).toEqual([
      "finance-statement-analysis",
    ]);
  });

  it("treats absent `active` as active (default), independent of the plugin gate", () => {
    const rows = computeContextRoutingRows({
      skills: [{ slug: "notes-helper" }],
      pluginGate: EMPTY_PLUGIN_GATE,
    });
    expect(rows.map((row) => row.slug)).toEqual(["notes-helper"]);
  });

  it("applies the trust gate and the plugin gate together (both must pass)", () => {
    const rows = computeContextRoutingRows({
      // trust-gated non-plugin skill, active plugin skill, trusted skill
      skills: [
        { slug: "finance-audit-xls", active: false },
        { slug: "lastmile--crm-basics", active: true },
        { slug: "crm-dashboard", active: true },
      ],
      pluginGate: gateBlocking(["skills/lastmile--", "skills/lastmile-"]),
    });
    // trust gate drops finance-audit-xls; plugin gate drops lastmile--crm-basics
    expect(rows.map((row) => row.slug)).toEqual(["crm-dashboard"]);
  });

  it("collapses description whitespace so rows cannot inject markdown structure", () => {
    const body = renderContextRoutingSectionBody(
      computeContextRoutingRows({
        skills: [
          { slug: "notes-helper", description: "Capture\nnotes\n## EVIL" },
        ],
      }),
    );
    expect(body).toContain("(Capture notes ## EVIL)");
    expect(body).not.toContain("\n## EVIL");
  });
});

describe("composeContextMdManagedSections (engine — INERT in live render until U5)", () => {
  it("preserves operator prose and appends the Routing section in canonical order", () => {
    const baseline =
      "# Acme — Context\n\nOperator routing prose stays.\n\n## Escalation\n\nCall a human.\n";
    const output = composeContextMdManagedSections({
      baseline,
      skills: [{ slug: "notes-helper" }],
    });

    expect(output.startsWith(baseline)).toBe(true);
    expect(CONTEXT_MD_MANAGED_SECTION_ORDER).toEqual(["Routing"]);
    expect(getMarkdownSectionBody(output, "Routing")).toContain(
      "- For tasks covered by the `notes-helper` skill, read skills/notes-helper/SKILL.md and follow it.",
    );
  });

  it("recomposes an existing Routing section in place, byte-preserving surrounding prose", () => {
    const first = composeContextMdManagedSections({
      baseline: "# Context\n\nProse before.\n",
      skills: [{ slug: "notes-helper" }, { slug: "sales-prep" }],
    });
    const second = composeContextMdManagedSections({
      baseline: first,
      skills: [{ slug: "notes-helper" }],
    });

    expect(second).toContain("Prose before.");
    expect(second).toContain("notes-helper");
    expect(second).not.toContain("sales-prep");
    // Idempotent for identical state.
    expect(
      composeContextMdManagedSections({
        baseline: second,
        skills: [{ slug: "notes-helper" }],
      }),
    ).toBe(second);
  });

  it("tolerates a legacy agent without a root CONTEXT.md", () => {
    for (const baseline of [null, undefined, "", "   \n"]) {
      const output = composeContextMdManagedSections({
        baseline,
        skills: [{ slug: "notes-helper" }],
        seedTitle: "Acme — Context",
      });
      expect(output).toContain("# Acme — Context");
      expect(getMarkdownSectionBody(output, "Routing")).toContain(
        "notes-helper",
      );
    }
  });

  it("renders an honest empty state when no skills are attached", () => {
    const output = composeContextMdManagedSections({
      baseline: "# Context\n",
      skills: [],
    });
    expect(getMarkdownSectionBody(output, "Routing")).toContain(
      "No skills attached.",
    );
  });

  it("applies the plugin gate: a gated requester's composed CONTEXT.md has no excluded-plugin row", () => {
    const output = composeContextMdManagedSections({
      baseline: "# Context\n",
      skills: [
        { slug: "notes-helper" },
        {
          slug: "lastmile--crm-basics",
          skillFolderPath: "skills/lastmile--crm-basics/",
        },
      ],
      pluginGate: gateBlocking(["skills/lastmile--", "skills/lastmile-"]),
    });
    expect(output).toContain("notes-helper");
    expect(output).not.toContain("lastmile--crm-basics");
  });
});

describe("composeGeneratedContextMd — live render seam (ACTIVE since U5)", () => {
  const SKILLS = [
    { slug: "notes-helper" },
    {
      slug: "lastmile--crm-basics",
      skillFolderPath: "skills/lastmile--crm-basics/",
    },
  ] as const;

  it("composes the managed sections engine — identical bytes to composeContextMdManagedSections", () => {
    const baseline = "# Context\n\nOperator prose stays.\n";
    for (const pluginGate of [
      EMPTY_PLUGIN_GATE,
      FAIL_CLOSED_PLUGIN_GATE,
      gateBlocking(["skills/lastmile--", "skills/lastmile-"]),
    ]) {
      expect(
        composeGeneratedContextMd({
          baseline,
          skills: [...SKILLS],
          pluginGate,
        }),
      ).toBe(
        composeContextMdManagedSections({
          baseline,
          skills: [...SKILLS],
          pluginGate,
        }),
      );
    }
  });

  it("a gated requester's rendered CONTEXT.md omits blocked plugin-skill rows (fail-closed) and keeps prose verbatim", () => {
    const baseline = "# Context\n\nOperator prose stays.\n";
    const output = composeGeneratedContextMd({
      baseline,
      skills: [...SKILLS],
      pluginGate: gateBlocking(["skills/lastmile--", "skills/lastmile-"]),
    });
    expect(output.startsWith(baseline)).toBe(true);
    expect(output).not.toContain("lastmile--crm-basics");
    expect(getMarkdownSectionBody(output, "Routing")).toContain(
      "- For tasks covered by the `notes-helper` skill, read skills/notes-helper/SKILL.md and follow it.",
    );
  });
});

describe("replaceMarkdownSection (shared primitive)", () => {
  it("keeps the legacy append shape used by CONTEXT.md folder-structure refresh", () => {
    const output = replaceMarkdownSection(
      "# Community\n\nExisting prose.\n",
      "Folder Structure",
      "\n```\ncommunity/\n```\n",
    );
    expect(output).toBe(
      "# Community\n\nExisting prose.\n\n---\n\n## Folder Structure\n```\ncommunity/\n```\n",
    );
  });
});

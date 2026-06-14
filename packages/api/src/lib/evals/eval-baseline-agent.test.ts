/**
 * Eval-baseline agent provisioning tests (Skill Tests & Evals U3).
 *
 * Covers the pure isolation logic (skill-folder parsing, the
 * exactly-one-skill backstop, wiring-choice selection) and the
 * re-materialization sequence against a fake workspace-ops seam — including
 * the bootstrap-no-prune regression guard: the assertion must catch a purge
 * that didn't run. S3/DB wiring is covered by the dev verification.
 */

import { describe, expect, it } from "vitest";
import { renderWiringMd } from "../wiring-md.js";
import {
  assertExactlyOneSkillFolder,
  EvalBaselineMaterializationError,
  firstWiringChoiceId,
  materializeWorkspaceForSkill,
  skillFoldersFromKeys,
  type EvalBaselineWorkspaceOps,
} from "./eval-baseline-agent.js";

const PREFIX = "tenants/acme/agents/eval-baseline-1/skills/";
const skillKey = (slug: string) => `${PREFIX}${slug}/SKILL.md`;

describe("skillFoldersFromKeys", () => {
  it("extracts distinct skill slugs from SKILL.md keys, ignoring other files", () => {
    expect(
      skillFoldersFromKeys([
        skillKey("crm-helper"),
        `${PREFIX}crm-helper/.catalog-ref.json`,
        `${PREFIX}crm-helper/references/guide.md`,
        skillKey("other-skill"),
      ]).sort(),
    ).toEqual(["crm-helper", "other-skill"]);
  });

  it("returns [] when no SKILL.md is present", () => {
    expect(skillFoldersFromKeys([`${PREFIX}crm-helper/notes.txt`])).toEqual([]);
  });
});

describe("assertExactlyOneSkillFolder", () => {
  it("passes for exactly the expected skill", () => {
    expect(() =>
      assertExactlyOneSkillFolder([skillKey("crm-helper")], "crm-helper"),
    ).not.toThrow();
  });

  it("throws on zero skill folders (install failed)", () => {
    expect(() => assertExactlyOneSkillFolder([], "crm-helper")).toThrow(
      EvalBaselineMaterializationError,
    );
  });

  it("throws on two skill folders (purge missed a prior run — the no-prune trap)", () => {
    expect(() =>
      assertExactlyOneSkillFolder(
        [skillKey("crm-helper"), skillKey("stale-skill")],
        "crm-helper",
      ),
    ).toThrow(/exactly the skill "crm-helper"/);
  });

  it("throws when the one present skill is the wrong one", () => {
    expect(() =>
      assertExactlyOneSkillFolder([skillKey("wrong-skill")], "crm-helper"),
    ).toThrow(EvalBaselineMaterializationError);
  });
});

describe("firstWiringChoiceId", () => {
  it("returns the first wiring suggestion id", () => {
    const wiring = renderWiringMd([
      {
        id: "always-on",
        title: "Always on",
        description: "d",
        snippet: "- read skills/x/SKILL.md\n",
      },
      {
        id: "stage-gate",
        title: "Stage gate",
        description: "d2",
        snippet: "- gate\n",
      },
    ]);
    expect(firstWiringChoiceId(wiring)).toBe("always-on");
  });

  it("throws when WIRING.md has no suggestions", () => {
    expect(() => firstWiringChoiceId("# nothing here")).toThrow(
      EvalBaselineMaterializationError,
    );
  });
});

// ---------------------------------------------------------------------------
// materializeWorkspaceForSkill — sequence + no-prune regression guard
// ---------------------------------------------------------------------------

/**
 * Fake workspace ops over an in-memory skill set. `pruneOnBootstrap`
 * defaults to false to model the real bootstrap (overwrite does NOT touch
 * skills/). `purgeWorks` lets a test simulate a broken purge to prove the
 * assertion is the backstop.
 */
function fakeOps(
  initialSkills: string[] = [],
  opts: { purgeWorks?: boolean; installAdds?: boolean } = {},
) {
  const skills = new Set(initialSkills);
  const calls: string[] = [];
  const ops: EvalBaselineWorkspaceOps = {
    async bootstrap() {
      calls.push("bootstrap"); // does NOT touch skills/ (the trap)
    },
    async purgeSkills() {
      calls.push("purge");
      if (opts.purgeWorks !== false) skills.clear();
    },
    async installSkill(slug) {
      calls.push(`install:${slug}`);
      if (opts.installAdds !== false) skills.add(slug);
    },
    async regenerateManifest() {
      calls.push("manifest");
    },
    async listSkillKeys() {
      return [...skills].map((s) => `${PREFIX}${s}/SKILL.md`);
    },
  };
  return { ops, skills, calls };
}

describe("materializeWorkspaceForSkill", () => {
  it("runs bootstrap → purge → install → manifest → assert and yields exactly the one skill", async () => {
    const { ops, skills, calls } = fakeOps();
    await materializeWorkspaceForSkill("crm-helper", ops, "agent-1");
    expect(calls).toEqual([
      "bootstrap",
      "purge",
      "install:crm-helper",
      "manifest",
    ]);
    expect([...skills]).toEqual(["crm-helper"]);
  });

  it("purges a prior run's skill folder (overwrite alone would leave it)", async () => {
    // Prior run left "old-skill"; bootstrap (fake) does not prune it.
    const { ops, skills } = fakeOps(["old-skill"]);
    await materializeWorkspaceForSkill("new-skill", ops, "agent-1");
    expect([...skills]).toEqual(["new-skill"]); // purge removed old-skill
  });

  it("the assertion catches a broken purge (regression guard for the no-prune trap)", async () => {
    // Prior "old-skill" + a purge that fails to clear → ends with two folders.
    const { ops } = fakeOps(["old-skill"], { purgeWorks: false });
    await expect(
      materializeWorkspaceForSkill("new-skill", ops, "agent-1"),
    ).rejects.toThrow(EvalBaselineMaterializationError);
  });

  it("the assertion catches a failed install (zero folders)", async () => {
    const { ops } = fakeOps([], { installAdds: false });
    await expect(
      materializeWorkspaceForSkill("crm-helper", ops, "agent-1"),
    ).rejects.toThrow(/exactly the skill "crm-helper"/);
  });
});

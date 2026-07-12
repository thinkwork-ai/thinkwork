import { describe, expect, it } from "vitest";

import type { LinearCommentSnapshot } from "../src/linear/client.js";
import type { Phase } from "../src/phases/engine.js";
import {
  PHASE_TEMPLATES,
  assemblePrompt,
  findNewestBaton,
  handoffMarker,
  synthesizeBaton,
} from "../src/phases/prompts.js";

const ID = "T-42";
const TITLE = "Fix clipped tooltip";

const ALL_PHASES: Phase[] = [
  "brainstorm",
  "plan",
  "debug",
  "implement",
  "verify",
  "compound",
];

describe("phase templates", () => {
  it("every phase has a template with no unfilled placeholders after assembly", () => {
    for (const phase of ALL_PHASES) {
      expect(PHASE_TEMPLATES[phase], phase).toBeTypeOf("string");
      const { prompt } = assemblePrompt({
        phase,
        issueId: ID,
        title: TITLE,
        comments: [],
        progressDoc: "Progress body",
      });
      expect(prompt, phase).toContain(ID);
      expect(prompt, phase).not.toContain("<ISSUE_ID>");
      expect(prompt, phase).not.toContain("<SHORT_TITLE>");
    }
  });

  it("templates stay faithful to launch-prompts.md per phase", () => {
    expect(PHASE_TEMPLATES.brainstorm).toContain("ce-brainstorm");
    expect(PHASE_TEMPLATES.plan).toContain("ce-plan");
    expect(PHASE_TEMPLATES.debug).toContain("ce-debug");
    expect(PHASE_TEMPLATES.implement).toContain("Autopilot Mode");
    expect(PHASE_TEMPLATES.verify).toContain("Dogfood Verification");
    expect(PHASE_TEMPLATES.verify).toContain("judge, not a");
    expect(PHASE_TEMPLATES.compound).toContain("ce-compound");
  });

  it("every assembled prompt carries the goal-discipline CI wait chain rules", () => {
    const { prompt } = assemblePrompt({
      phase: "implement",
      issueId: ID,
      title: TITLE,
      comments: [],
      progressDoc: "",
    });
    expect(prompt).toContain("gh pr merge");
    expect(prompt).toContain("--squash --auto --delete-branch");
  });
});

describe("baton discovery", () => {
  it("finds the NEWEST matching handoff comment (last wins)", () => {
    const comments: LinearCommentSnapshot[] = [
      { id: "c1", body: `${handoffMarker(ID, "Ready to Work")}\n\nGoal: old.` },
      { id: "c2", body: "unrelated" },
      { id: "c3", body: `${handoffMarker(ID, "Ready to Work")}\n\nGoal: new.` },
    ];
    const baton = findNewestBaton(ID, "Ready to Work", comments);
    expect(baton?.id).toBe("c3");
  });

  it("does not match another issue's baton or another phase's baton", () => {
    const comments: LinearCommentSnapshot[] = [
      { id: "c1", body: `${handoffMarker("T-999", "Ready to Work")}\n...` },
      { id: "c2", body: `${handoffMarker(ID, "Verification")}\n...` },
    ];
    expect(findNewestBaton(ID, "Ready to Work", comments)).toBeNull();
  });
});

describe("prompt assembly with an existing baton", () => {
  it("includes the newest baton VERBATIM under the handoff heading; nothing to post", () => {
    const batonBody = `${handoffMarker(ID, "Ready to Work")}\n\nGoal: implement unit U3.\n\nStart here:\n- src/foo.ts`;
    const { prompt, baton, batonToPost } = assemblePrompt({
      phase: "implement",
      issueId: ID,
      title: TITLE,
      comments: [{ id: "c1", body: batonBody }],
      progressDoc: "irrelevant",
    });
    expect(batonToPost).toBeNull();
    expect(baton).toBe(batonBody);
    expect(prompt).toContain("Handoff from previous phase:");
    expect(prompt).toContain(batonBody);
  });
});

describe("missing baton → synthesized from the Progress document (scenario 2)", () => {
  it("synthesizes a baton and returns it for posting BEFORE launch", () => {
    const progressDoc =
      "## Active Work\nUnit U2 in flight\n\n## Next Steps\n- wire the poller into cli run";
    const { prompt, baton, batonToPost } = assemblePrompt({
      phase: "implement",
      issueId: ID,
      title: TITLE,
      comments: [{ id: "c1", body: "no baton here" }],
      progressDoc,
    });
    expect(batonToPost).not.toBeNull();
    expect(batonToPost).toBe(baton);
    // Contract shape: marker + template fields.
    expect(baton).toContain(handoffMarker(ID, "Ready to Work"));
    expect(baton).toContain("Goal:");
    expect(baton).toContain("Start here:");
    expect(baton).toContain("Inputs:");
    expect(baton).toContain("Open questions / risks:");
    // Synthesized from the Progress document content:
    expect(baton).toContain("wire the poller into cli run");
    // And embedded in the launch prompt.
    expect(prompt).toContain(baton);
  });

  it("synthesizeBaton targets the phase's read-status marker", () => {
    const baton = synthesizeBaton({
      issueId: ID,
      phase: "verify",
      featureTitle: TITLE,
      progressDoc: "## Next Steps\n- verify on deployed dev",
    });
    expect(baton).toContain(handoffMarker(ID, "Verification"));
    expect(baton).toContain("verify on deployed dev");
  });

  it("synthesizes something usable even with an empty Progress document", () => {
    const baton = synthesizeBaton({
      issueId: ID,
      phase: "plan",
      featureTitle: TITLE,
      progressDoc: "",
    });
    expect(baton).toContain(handoffMarker(ID, "Planning"));
    expect(baton).toContain("Goal:");
  });
});

describe("repair pass", () => {
  it("implement prompt reads the Ready to Work baton for repair passes too", () => {
    const batonBody = `${handoffMarker(ID, "Ready to Work")}\n\nGoal: smallest correct repair for scenario 4.`;
    const { prompt, batonToPost } = assemblePrompt({
      phase: "implement",
      issueId: ID,
      title: TITLE,
      comments: [{ id: "c1", body: batonBody }],
      progressDoc: "",
      repair: true,
    });
    expect(batonToPost).toBeNull();
    expect(prompt).toContain(batonBody);
  });
});

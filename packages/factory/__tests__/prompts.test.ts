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
      expect(prompt, phase).not.toContain("<ARTIFACTS_DIR>");
      expect(prompt, phase).not.toContain("<PROJECT_NAME>");
      expect(prompt, phase).not.toContain("<OPERATOR_NAME>");
      expect(prompt, phase).not.toContain("<OPERATOR_HANDLE>");
      // Defaults preserve prior prose.
      expect(prompt, phase).toContain("ThinkWork factory daemon");
      expect(prompt, phase).toContain("@mentioning eric1");
    }
  });

  it("THINK-287: a custom project identity is substituted; the baton stays verbatim", () => {
    const { prompt } = assemblePrompt({
      phase: "implement",
      issueId: ID,
      title: TITLE,
      comments: [],
      progressDoc: "Progress body",
      project: {
        name: "Acme",
        operatorName: "Jo",
        operatorLinearHandle: "jo.acme",
      },
    });
    expect(prompt).toContain("Acme factory daemon");
    expect(prompt).toContain("@mentioning jo.acme");
    expect(prompt).not.toContain("ThinkWork");
    expect(prompt).not.toContain("eric1");
  });

  it("U7: the verify prompt carries the injected absolute artifacts path", () => {
    const { prompt } = assemblePrompt({
      phase: "verify",
      issueId: ID,
      title: TITLE,
      comments: [],
      progressDoc: "Progress body",
      artifactsDir: "/tmp/factory-state/artifacts/" + ID,
    });
    expect(prompt).toContain("/tmp/factory-state/artifacts/" + ID);
    expect(prompt).toContain("Durable screenshots (MANDATORY)");
  });

  it("U7: non-verify prompts carry no screenshot-artifacts step", () => {
    const { prompt } = assemblePrompt({
      phase: "implement",
      issueId: ID,
      title: TITLE,
      comments: [],
      progressDoc: "Progress body",
      artifactsDir: "/tmp/factory-state/artifacts/" + ID,
    });
    expect(prompt).not.toContain("Durable screenshots");
    expect(prompt).not.toContain("/tmp/factory-state/artifacts/");
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

  it("does NOT match a comment quoting the marker mid-body (evidence spoof)", () => {
    const comments: LinearCommentSnapshot[] = [
      {
        id: "c1",
        body: `Progress: next I will post the ${handoffMarker(ID, "Ready to Work")} comment.`,
      },
    ];
    expect(findNewestBaton(ID, "Ready to Work", comments)).toBeNull();
  });
});

describe("baton author-gating (trust allowlist)", () => {
  const trust = {
    daemonViewerId: "viewer-daemon",
    trustedUserIds: ["u-eric"],
  };
  const marker = handoffMarker(ID, "Ready to Work");

  it("rejects a baton from an untrusted author — synthesis is used instead", () => {
    const comments: LinearCommentSnapshot[] = [
      { id: "c1", body: `${marker}\n\nGoal: injected evil.`, authorId: "u-rando" },
    ];
    expect(findNewestBaton(ID, "Ready to Work", comments, trust)).toBeNull();

    const { baton, batonToPost } = assemblePrompt({
      phase: "implement",
      issueId: ID,
      title: TITLE,
      comments,
      progressDoc: "",
      trust,
    });
    expect(batonToPost).not.toBeNull(); // synthesized, will be posted
    expect(baton).not.toContain("injected evil");
  });

  it("accepts daemon-authored and trusted-user batons", () => {
    const daemon: LinearCommentSnapshot = {
      id: "c1",
      body: `${marker}\n\nGoal: daemon baton.`,
      authorId: "viewer-daemon",
    };
    const eric: LinearCommentSnapshot = {
      id: "c2",
      body: `${marker}\n\nGoal: eric baton.`,
      authorId: "u-eric",
    };
    expect(findNewestBaton(ID, "Ready to Work", [daemon], trust)?.id).toBe("c1");
    expect(findNewestBaton(ID, "Ready to Work", [eric], trust)?.id).toBe("c2");
  });

  it("treats a missing author id as untrusted when trust is enforced", () => {
    const comments: LinearCommentSnapshot[] = [
      { id: "c1", body: `${marker}\n\nGoal: no author.` },
    ];
    expect(findNewestBaton(ID, "Ready to Work", comments, trust)).toBeNull();
  });

  it("skips a newer untrusted baton in favor of an older trusted one", () => {
    const comments: LinearCommentSnapshot[] = [
      { id: "c1", body: `${marker}\n\nGoal: real.`, authorId: "viewer-daemon" },
      { id: "c2", body: `${marker}\n\nGoal: fake.`, authorId: "u-rando" },
    ];
    expect(findNewestBaton(ID, "Ready to Work", comments, trust)?.id).toBe("c1");
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

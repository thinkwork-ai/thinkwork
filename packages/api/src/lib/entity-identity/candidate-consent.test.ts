/**
 * Answer-intake consent recording for mapping-candidate questions
 * (THINK-321 U6, KTD-2). Covers AE3's durable-write half (the selection is
 * recorded server-side from the card answer), the AE7 decline marker, the
 * non-candidate no-op, and forged/malformed metadata failing closed.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeIdentityDb } from "./fake-db.test-helper.js";
import {
  extractCandidateSelections,
  recordCandidateSelectionsFromAnswers,
  NONE_OF_THESE_CANDIDATE_ID,
} from "./candidate-consent.js";
import { DECLINED_CANDIDATE_MARKER } from "./routing.js";

const TENANT = "tenant-1";
const THREAD = "thread-1";
const NOW = new Date("2026-07-19T12:00:00Z");
const FUTURE = new Date("2026-07-20T12:00:00Z");
const SET_ID = "3c9f2a10-2222-4444-8888-aaaabbbbcccc";

const candidateQuestion = (overrides: Record<string, unknown> = {}) => ({
  question: "Which Twenty company is Acme Fuel?",
  header: "CRM match",
  candidateSetId: SET_ID,
  options: [
    {
      label: "Acme Fuel Co (twenty co-7)",
      description: "matched on name, domain",
      candidateId: "cand-1",
    },
    {
      label: "Acme Fuels LLC (twenty co-9)",
      description: "matched on name",
      candidateId: "cand-2",
    },
    {
      label: "None of these",
      description: "file for an operator instead",
      candidateId: NONE_OF_THESE_CANDIDATE_ID,
    },
  ],
  ...overrides,
});

const plainQuestion = {
  question: "Which environment?",
  header: "Env",
  options: [
    { label: "Dev", description: "" },
    { label: "Prod", description: "" },
  ],
};

const openSetRow = (overrides: Record<string, unknown> = {}) => ({
  id: SET_ID,
  thread_ref: THREAD,
  status: "open",
  selected_candidate_id: null,
  candidates: [{ id: "cand-1" }, { id: "cand-2" }],
  expires_at: FUTURE,
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("extractCandidateSelections", () => {
  it("maps a header-keyed card answer to the selected option's candidate id", () => {
    expect(
      extractCandidateSelections([candidateQuestion()], {
        "CRM match": "Acme Fuel Co (twenty co-7)",
      }),
    ).toEqual([{ candidateSetId: SET_ID, candidateId: "cand-1" }]);
  });

  it("tolerates the ' (Recommended)' suffix and case differences in the answer", () => {
    const questions = [
      candidateQuestion({
        options: [
          {
            label: "Acme Fuel Co (Recommended)",
            description: "",
            candidateId: "cand-1",
          },
          {
            label: "None of these",
            description: "",
            candidateId: NONE_OF_THESE_CANDIDATE_ID,
          },
        ],
      }),
    ];
    expect(
      extractCandidateSelections(questions, {
        "crm match": "acme fuel co (Recommended)",
      }),
    ).toEqual([{ candidateSetId: SET_ID, candidateId: "cand-1" }]);
  });

  it("maps 'None of these' to the decline marker (first-class decline)", () => {
    expect(
      extractCandidateSelections([candidateQuestion()], {
        "CRM match": "None of these",
      }),
    ).toEqual([
      { candidateSetId: SET_ID, candidateId: DECLINED_CANDIDATE_MARKER },
    ]);
  });

  it("extracts nothing from non-candidate questions", () => {
    expect(extractCandidateSelections([plainQuestion], { Env: "Dev" })).toEqual(
      [],
    );
  });

  it("extracts nothing for free-text answers, multi-picks, or unanswered questions", () => {
    const questions = [candidateQuestion()];
    expect(
      extractCandidateSelections(questions, {
        "CRM match": "actually it is a different company",
      }),
    ).toEqual([]);
    expect(
      extractCandidateSelections(questions, {
        "CRM match": ["Acme Fuel Co (twenty co-7)", "None of these"],
      }),
    ).toEqual([]);
    expect(extractCandidateSelections(questions, {})).toEqual([]);
  });

  it("ignores malformed/forged metadata ids (bad charset extracts nothing)", () => {
    expect(
      extractCandidateSelections(
        [candidateQuestion({ candidateSetId: "not a valid id!" })],
        { "CRM match": "Acme Fuel Co (twenty co-7)" },
      ),
    ).toEqual([]);
    expect(
      extractCandidateSelections(
        [
          candidateQuestion({
            options: [
              {
                label: "Acme Fuel Co",
                description: "",
                candidateId: "<script>alert(1)</script>",
              },
              { label: "None of these", description: "", candidateId: "none" },
            ],
          }),
        ],
        { "CRM match": "Acme Fuel Co" },
      ),
    ).toEqual([]);
  });

  it("consumes answer keys in question order so a candidate question after a plain one still matches by index", () => {
    expect(
      extractCandidateSelections([plainQuestion, candidateQuestion()], {
        "0": "Dev",
        "1": "None of these",
      }),
    ).toEqual([
      { candidateSetId: SET_ID, candidateId: DECLINED_CANDIDATE_MARKER },
    ]);
  });
});

describe("recordCandidateSelectionsFromAnswers", () => {
  it("records the picked candidate against the open set (AE3 durable-write half)", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push([openSetRow()]);
    const result = await recordCandidateSelectionsFromAnswers(
      fake.db as never,
      {
        tenantId: TENANT,
        threadId: THREAD,
        questions: [candidateQuestion()],
        answers: { "CRM match": "Acme Fuel Co (twenty co-7)" },
        now: NOW,
      },
    );
    expect(result).toEqual({ recorded: 1, refused: 0 });
    expect(fake.updates[0]?.values).toEqual({
      selected_candidate_id: "cand-1",
    });
  });

  it("records the decline marker for a 'None of these' pick", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push([openSetRow()]);
    const result = await recordCandidateSelectionsFromAnswers(
      fake.db as never,
      {
        tenantId: TENANT,
        threadId: THREAD,
        questions: [candidateQuestion()],
        answers: { "CRM match": "None of these" },
        now: NOW,
      },
    );
    expect(result).toEqual({ recorded: 1, refused: 0 });
    expect(fake.updates[0]?.values).toEqual({
      selected_candidate_id: DECLINED_CANDIDATE_MARKER,
    });
  });

  it("makes NO db calls for a batch without candidate questions", async () => {
    const fake = createFakeIdentityDb();
    // No rows queued: any select would resolve [] and any refusal would
    // count — assert zero writes AND zero refusals.
    const result = await recordCandidateSelectionsFromAnswers(
      fake.db as never,
      {
        tenantId: TENANT,
        threadId: THREAD,
        questions: [plainQuestion],
        answers: { Env: "Dev" },
        now: NOW,
      },
    );
    expect(result).toEqual({ recorded: 0, refused: 0 });
    expect(fake.updates).toHaveLength(0);
  });

  it("a forged set (wrong thread / closed / expired / unknown) records nothing and never throws", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const fake = createFakeIdentityDb();
    fake.selectQueue.push([openSetRow({ thread_ref: "other-thread" })]);
    const result = await recordCandidateSelectionsFromAnswers(
      fake.db as never,
      {
        tenantId: TENANT,
        threadId: THREAD,
        questions: [candidateQuestion()],
        answers: { "CRM match": "Acme Fuel Co (twenty co-7)" },
        now: NOW,
      },
    );
    expect(result).toEqual({ recorded: 0, refused: 1 });
    expect(fake.updates).toHaveLength(0);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("thread_mismatch"),
    );
  });

  it("a thrown recording error is swallowed (fail closed downstream), logged, and counted refused", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const throwingDb = {
      select: () => {
        throw new Error("db down");
      },
    };
    const result = await recordCandidateSelectionsFromAnswers(
      throwingDb as never,
      {
        tenantId: TENANT,
        threadId: THREAD,
        questions: [candidateQuestion()],
        answers: { "CRM match": "None of these" },
        now: NOW,
      },
    );
    expect(result).toEqual({ recorded: 0, refused: 1 });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("selection recording failed"),
      expect.any(Error),
    );
  });
});

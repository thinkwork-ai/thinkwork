/**
 * brainExpertQuestions resolver tests (THINK-787): empty-list postures
 * (no identity, unconfigured Brain, non-expert caller), the routed-only
 * filter, field mapping, and the SERVICE_UNAVAILABLE surface.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSecret,
  mockCachedM2mToken,
  mockGetBrainOpsJson,
  mockGetConfig,
} = vi.hoisted(() => ({
  mockGetSecret: vi.fn(),
  mockCachedM2mToken: vi.fn(),
  mockGetBrainOpsJson: vi.fn(),
  mockGetConfig: vi.fn(),
}));

vi.mock("../../../lib/twin/m2m-token.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../lib/twin/m2m-token.js")>();
  return { ...original, cachedM2mToken: mockCachedM2mToken };
});

vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: mockGetConfig,
  getSecret: mockGetSecret,
}));

vi.mock("../../../lib/brain/expert-questions.js", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../../../lib/brain/expert-questions.js")
    >();
  return { ...original, getBrainOpsJson: mockGetBrainOpsJson };
});

import { brainExpertQuestions } from "./brainExpertQuestions.query.js";

function ctx(email = "expert@mcpherson.com") {
  return { auth: { authType: "cognito", email } } as any;
}

const EXPERTS = {
  kind: "ok",
  body: {
    experts: [{ id: "exp-1", email: "expert@mcpherson.com" }],
  },
};
const QUESTIONS = {
  kind: "ok",
  body: {
    expert_questions: [
      {
        id: "q-1",
        question: "What is the Waco depot generator's nickname?",
        context: { why: "Two conflicting names in the data." },
        domain: "fuel-logistics",
        expert_id: "exp-1",
        task_id: "task-1",
        status: "open",
        created_at: "2026-08-10T20:00:00Z",
      },
      {
        id: "q-2",
        question: "Unrouted question",
        expert_id: null,
        status: "open",
      },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetConfig.mockImplementation((key: string) => {
    if (key === "BRAIN_OPS_API_URL") return "https://ops.example";
    if (key === "BRAIN_OPS_M2M_SECRET_ARN") return "arn:secret";
    return "";
  });
  mockGetSecret.mockResolvedValue(
    JSON.stringify({
      client_id: "c",
      client_secret: "s",
      token_url: "https://pool.example/oauth2/token",
      scope: "etl-agent/tasks",
    }),
  );
  mockCachedM2mToken.mockResolvedValue("m2m-token");
  mockGetBrainOpsJson.mockImplementation(({ url }: { url: string }) =>
    Promise.resolve(url.includes("/experts") ? EXPERTS : QUESTIONS),
  );
});

describe("brainExpertQuestions", () => {
  it("returns [] without calling the Brain when the caller has no email", async () => {
    expect(await brainExpertQuestions(null, {}, ctx(""))).toEqual([]);
    expect(mockGetBrainOpsJson).not.toHaveBeenCalled();
  });

  it("returns [] when the Brain connection is unconfigured", async () => {
    mockGetConfig.mockReturnValue("");
    expect(await brainExpertQuestions(null, {}, ctx())).toEqual([]);
    expect(mockGetBrainOpsJson).not.toHaveBeenCalled();
  });

  it("returns [] when the caller is not a registered expert", async () => {
    expect(
      await brainExpertQuestions(null, {}, ctx("stranger@mcpherson.com")),
    ).toEqual([]);
  });

  it("maps the caller's routed open questions and drops unrouted ones", async () => {
    const result = await brainExpertQuestions(null, {}, ctx());
    expect(result).toEqual([
      {
        id: "q-1",
        question: "What is the Waco depot generator's nickname?",
        why: "Two conflicting names in the data.",
        domain: "fuel-logistics",
        taskId: "task-1",
        createdAt: "2026-08-10T20:00:00Z",
      },
    ]);
  });

  it("surfaces Brain reachability failures as SERVICE_UNAVAILABLE", async () => {
    mockGetBrainOpsJson.mockResolvedValue({
      kind: "error",
      status: 503,
      message: "HTTP 503",
    });
    await expect(brainExpertQuestions(null, {}, ctx())).rejects.toMatchObject({
      extensions: { code: "SERVICE_UNAVAILABLE" },
    });
  });
});

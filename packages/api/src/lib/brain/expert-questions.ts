/**
 * Brain expert-questions client (THINK-787).
 *
 * Pulls the Brain Consult loop's open questions
 * (`GET {brain_ops_api}/expert-questions?status=open`, THINK-786) and the
 * expert registry (`GET {brain_ops_api}/experts`) so the resolver can
 * match the signed-in user to their expert row by email and filter
 * questions to theirs. Same base URL and agent-identity m2m bearer as
 * /flags and /teachings.
 *
 * Questions with a null expert_id are unrouted — an operator concern,
 * never surfaced to end users.
 */

/** Default request timeout — the ops API answers reads quickly. */
const DEFAULT_TIMEOUT_MS = 20_000;

export interface BrainExpertQuestionRow {
  id: string;
  question: string;
  context?: {
    why?: string | null;
    asset_fqns?: string[] | null;
    matched_on?: string | null;
  } | null;
  domain?: string | null;
  expert_id?: string | null;
  expert_display_name?: string | null;
  task_id?: string | null;
  status?: string | null;
  asked_by?: string | null;
  created_at?: string | null;
}

export interface BrainExpertRow {
  id: string;
  email?: string | null;
  product_identity?: string | null;
}

export type GetBrainOpsResult<T> =
  | { kind: "ok"; body: T }
  | { kind: "error"; status: number | null; message: string };

function opsBaseFrom(mcpUrl: string): string {
  return mcpUrl.replace(/\/mcp(\/twin)?\/?$/, "").replace(/\/+$/, "");
}

export function brainExpertQuestionsUrlFrom(mcpUrl: string): string {
  return `${opsBaseFrom(mcpUrl)}/expert-questions?status=open`;
}

export function brainExpertsUrlFrom(mcpUrl: string): string {
  return `${opsBaseFrom(mcpUrl)}/experts`;
}

/** GET a Brain ops-api JSON resource; any failure maps to one error kind. */
export async function getBrainOpsJson<T>(input: {
  url: string;
  token: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<GetBrainOpsResult<T>> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  let response: Response;
  try {
    response = await fetchImpl(input.url, {
      method: "GET",
      headers: {
        accept: "application/json",
        ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
      },
      signal: controller.signal,
    });
  } catch (err) {
    return {
      kind: "error",
      status: null,
      message:
        err instanceof Error && err.name === "AbortError"
          ? "The Brain did not respond in time."
          : err instanceof Error
            ? err.message
            : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    return {
      kind: "error",
      status: response.status,
      message: `HTTP ${response.status}`,
    };
  }
  try {
    return { kind: "ok", body: (await response.json()) as T };
  } catch {
    return { kind: "error", status: response.status, message: "non-JSON body" };
  }
}

/** Match the signed-in user's email to an expert-registry row. */
export function matchExpertByEmail(
  experts: BrainExpertRow[],
  email: string,
): BrainExpertRow | null {
  const needle = email.trim().toLowerCase();
  if (!needle) return null;
  return (
    experts.find(
      (expert) =>
        (expert.email ?? "").trim().toLowerCase() === needle ||
        (expert.product_identity ?? "").trim().toLowerCase() === needle,
    ) ?? null
  );
}

/**
 * Open questions routed to the given expert, preserving the API's
 * oldest-first order. Unrouted rows (null expert_id) are dropped.
 */
export function questionsForExpert(
  questions: BrainExpertQuestionRow[],
  expertId: string,
): BrainExpertQuestionRow[] {
  return questions.filter(
    (q) =>
      q.expert_id === expertId &&
      (q.status ?? "open").toLowerCase() === "open" &&
      typeof q.id === "string" &&
      typeof q.question === "string",
  );
}

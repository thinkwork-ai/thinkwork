/**
 * Shared Brain ops-API POST semantics (THINK-781 / THINK-784, now the
 * Cortex `/submissions` front door).
 *
 * Every intake answers the same way: 2xx with a server-minted id is
 * acceptance (202 per contract; `task_id` may be absent when the Brain
 * accepted but could not immediately dispatch the investigation — still
 * success, annotated via `note`). 4xx is validation feedback to surface
 * verbatim; 5xx / network errors / timeouts are retryable ("couldn't
 * reach the Brain").
 */

/** Default request timeout — the Brain answers ops POSTs quickly. */
const DEFAULT_TIMEOUT_MS = 20_000;

export type PostBrainOpsResult =
  | {
      kind: "accepted";
      id: string;
      taskId: string | null;
      note: string | null;
    }
  | { kind: "rejected"; status: number; message: string }
  | { kind: "unreachable"; message: string };

export async function postBrainOps(input: {
  url: string;
  /** Response body key carrying the server-minted id (e.g. `submission_id`). */
  idField: string;
  token: string | null;
  headers?: Record<string, string>;
  payload: unknown;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<PostBrainOpsResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  let response: Response;
  try {
    response = await fetchImpl(input.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
        ...(input.headers ?? {}),
      },
      body: JSON.stringify(input.payload),
      signal: controller.signal,
    });
  } catch (err) {
    return {
      kind: "unreachable",
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

  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // Non-JSON body — fall through with the status alone.
  }

  if (response.ok) {
    const id =
      typeof body[input.idField] === "string"
        ? (body[input.idField] as string)
        : null;
    if (!id) {
      return {
        kind: "unreachable",
        message: `The Brain answered ${response.status} without a ${input.idField}.`,
      };
    }
    return {
      kind: "accepted",
      id,
      taskId: typeof body.task_id === "string" ? body.task_id : null,
      note: typeof body.note === "string" ? body.note : null,
    };
  }

  const detail =
    typeof body.error === "string"
      ? body.error
      : typeof body.message === "string"
        ? body.message
        : typeof body.detail === "string"
          ? body.detail
          : `HTTP ${response.status}`;
  if (response.status >= 400 && response.status < 500) {
    return { kind: "rejected", status: response.status, message: detail };
  }
  return { kind: "unreachable", message: detail };
}

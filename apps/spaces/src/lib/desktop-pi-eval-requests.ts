const STORAGE_KEY = "thinkwork:desktop-pi-eval-requests:v1";

type DesktopPiEvalRequestRecord = {
  requestId: string;
  startedAt: string;
};

type DesktopPiEvalRequestMap = Record<string, DesktopPiEvalRequestRecord>;

export function rememberDesktopPiEvalRequest(
  runId: string,
  requestId: string,
  storage: Storage | null = safeLocalStorage(),
): void {
  if (!storage || !runId || !requestId) return;
  const records = readRecords(storage);
  records[runId] = { requestId, startedAt: new Date().toISOString() };
  writeRecords(storage, records);
}

export function getDesktopPiEvalRequestId(
  runId: string,
  storage: Storage | null = safeLocalStorage(),
): string | null {
  if (!storage || !runId) return null;
  return readRecords(storage)[runId]?.requestId ?? null;
}

export function forgetDesktopPiEvalRequest(
  runId: string,
  storage: Storage | null = safeLocalStorage(),
): void {
  if (!storage || !runId) return;
  const records = readRecords(storage);
  if (!(runId in records)) return;
  delete records[runId];
  writeRecords(storage, records);
}

function readRecords(storage: Storage): DesktopPiEvalRequestMap {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const records: DesktopPiEvalRequestMap = {};
    for (const [runId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        continue;
      }
      const requestId = (value as { requestId?: unknown }).requestId;
      const startedAt = (value as { startedAt?: unknown }).startedAt;
      if (typeof requestId !== "string" || requestId.length === 0) continue;
      records[runId] = {
        requestId,
        startedAt:
          typeof startedAt === "string" && startedAt.length > 0
            ? startedAt
            : "",
      };
    }
    return records;
  } catch {
    return {};
  }
}

function writeRecords(
  storage: Storage,
  records: DesktopPiEvalRequestMap,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Best-effort local bookkeeping; the server-side cancel still runs.
  }
}

function safeLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

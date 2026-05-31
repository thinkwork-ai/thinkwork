export interface MobileTurnEventRow {
  seq: number;
  event_type: string;
  message?: string | null;
  payload?: unknown;
}

export interface MobileTurnCheckpoint {
  seq: number;
  safe: boolean;
  kind?: string;
  eventType?: string;
  unsafeReason?: string | null;
  userText?: string | null;
  transcript?: Array<{ role: string; content: string }>;
  eventLog?: unknown[];
  payload: Record<string, unknown>;
}

export interface MobileTurnCheckpointSelection {
  checkpoint: MobileTurnCheckpoint;
  baseline: MobileTurnCheckpoint;
  latestSeq: number;
  unsafeCheckpointSkipped: boolean;
  unsafeCheckpoint?: MobileTurnCheckpoint;
}

export class MobileTurnCheckpointError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "MobileTurnCheckpointError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeMessage(
  value: unknown,
): { role: string; content: string } | null {
  if (!isRecord(value)) return null;
  const role = typeof value.role === "string" ? value.role : null;
  const content = typeof value.content === "string" ? value.content : null;
  if (!role || !content) return null;
  return { role, content };
}

function normalizeCheckpoint(
  payload: unknown,
  fallbackSeq: number,
): MobileTurnCheckpoint | null {
  if (!isRecord(payload)) return null;
  const seq =
    typeof payload.seq === "number" && Number.isFinite(payload.seq)
      ? Math.trunc(payload.seq)
      : fallbackSeq;
  const transcript = Array.isArray(payload.transcript)
    ? payload.transcript.map(normalizeMessage).filter((item) => item !== null)
    : undefined;
  return {
    seq,
    safe: payload.safe !== false,
    kind: typeof payload.kind === "string" ? payload.kind : undefined,
    eventType:
      typeof payload.event_type === "string" ? payload.event_type : undefined,
    unsafeReason:
      typeof payload.unsafe_reason === "string" ? payload.unsafe_reason : null,
    userText: typeof payload.user_text === "string" ? payload.user_text : null,
    transcript,
    eventLog: Array.isArray(payload.event_log) ? payload.event_log : undefined,
    payload,
  };
}

export function selectMobileTurnCheckpoint(input: {
  contextSnapshot: unknown;
  events?: MobileTurnEventRow[];
}): MobileTurnCheckpointSelection {
  const snapshot = isRecord(input.contextSnapshot)
    ? input.contextSnapshot
    : null;
  const mobileTurn = isRecord(snapshot?.mobile_turn)
    ? snapshot.mobile_turn
    : null;
  const baseline = normalizeCheckpoint(mobileTurn?.checkpoint_0, 0);
  if (!baseline || baseline.kind !== "baseline" || !baseline.safe) {
    throw new MobileTurnCheckpointError(
      "Mobile turn baseline checkpoint is missing or corrupt",
      "BASELINE_CHECKPOINT_INVALID",
    );
  }

  const checkpoints = new Map<number, MobileTurnCheckpoint>();
  checkpoints.set(baseline.seq, baseline);

  for (const event of input.events ?? []) {
    if (event.event_type !== "mobile_pi_checkpoint") continue;
    const checkpoint = normalizeCheckpoint(event.payload, event.seq);
    if (!checkpoint) continue;
    checkpoints.set(checkpoint.seq, checkpoint);
  }

  const latestSnapshot = normalizeCheckpoint(
    mobileTurn?.latest_checkpoint,
    Number(mobileTurn?.latest_checkpoint_seq ?? 0),
  );
  if (latestSnapshot) {
    checkpoints.set(latestSnapshot.seq, latestSnapshot);
  }

  const ordered = [...checkpoints.values()].sort((a, b) => a.seq - b.seq);
  const latest = ordered[ordered.length - 1] ?? baseline;
  const safe = [...ordered].reverse().find((checkpoint) => checkpoint.safe);
  if (!safe) {
    throw new MobileTurnCheckpointError(
      "Mobile turn has no safe checkpoint",
      "SAFE_CHECKPOINT_MISSING",
    );
  }

  return {
    checkpoint: safe,
    baseline,
    latestSeq: latest.seq,
    unsafeCheckpointSkipped: latest.seq !== safe.seq && !latest.safe,
    unsafeCheckpoint:
      latest.seq !== safe.seq && !latest.safe ? latest : undefined,
  };
}

function formatTranscript(
  transcript: Array<{ role: string; content: string }> | undefined,
): string {
  if (!transcript || transcript.length === 0) return "(no partial transcript)";
  return transcript
    .slice(-12)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
}

function formatToolEvidence(checkpoint: MobileTurnCheckpoint): string {
  const payload = checkpoint.payload;
  if (isRecord(payload.result)) {
    return JSON.stringify(
      {
        tool: payload.name,
        result: payload.result,
      },
      null,
      2,
    ).slice(0, 6_000);
  }
  if (typeof payload.text === "string") return payload.text.slice(0, 6_000);
  return JSON.stringify(payload, null, 2).slice(0, 6_000);
}

export function renderMobileHandoffPrompt(
  selection: MobileTurnCheckpointSelection,
): string {
  const originalPrompt = selection.baseline.userText ?? "";
  const unsafeNote = selection.unsafeCheckpointSkipped
    ? `\n\nUnsafe checkpoint skipped: seq ${selection.unsafeCheckpoint?.seq ?? "unknown"} (${selection.unsafeCheckpoint?.unsafeReason ?? "unsafe in-flight work"}). Do not replay mutating or mobile-only actions unless durable evidence in the safe checkpoint proves they completed.`
    : "";

  return [
    "Continue this mobile Pi turn after the local mobile app stopped heartbeating.",
    "You are the managed AWS AgentCore Pi runtime and must complete the same logical turn.",
    "Use the existing thread history plus the safe mobile checkpoint below. Do not create a second visible turn.",
    "",
    `Original user message:\n${originalPrompt}`,
    "",
    `Safe checkpoint seq: ${selection.checkpoint.seq}`,
    `Latest observed checkpoint seq: ${selection.latestSeq}`,
    unsafeNote.trim(),
    "",
    "Partial transcript from the mobile host:",
    formatTranscript(selection.checkpoint.transcript),
    "",
    "Safe checkpoint evidence:",
    formatToolEvidence(selection.checkpoint),
  ]
    .filter((part) => part !== "")
    .join("\n");
}

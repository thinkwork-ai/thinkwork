/**
 * Offline capture queue — AsyncStorage-backed FIFO that survives app kill
 * and retries pending captures with exponential backoff.
 *
 * Retry triggers (no netinfo dep — keeps the surface small):
 *   - On enqueue (try once immediately).
 *   - On AppState transition to 'active'.
 *   - On any subsequent submit (opportunistic flush).
 *   - On backoff timer fire.
 *
 * Agent binding is captured at enqueue time and never rewritten — if the
 * user switches from Marco to Tara between enqueue and sync, the entry
 * still syncs to Marco's bank.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, type AppStateStatus } from "react-native";

export type CaptureQueueStatus = "saving" | "sync_pending" | "failed" | "synced";

export type QueuedCapture = {
	clientCaptureId: string;
	tenantId: string;
	agentId: string;
	content: string;
	factType: "FACT" | "PREFERENCE" | "EXPERIENCE" | "OBSERVATION";
	metadata: Record<string, unknown>;
	capturedAt: string;
	status: CaptureQueueStatus;
	attemptCount: number;
	lastError?: string;
	syncedId?: string;
};

export type CaptureSender = (input: {
	agentId: string;
	content: string;
	factType: QueuedCapture["factType"];
	metadata: Record<string, unknown>;
	clientCaptureId: string;
}) => Promise<{ id: string }>;

type Listener = (entries: QueuedCapture[]) => void;

const STORAGE_KEY = "thinkwork:capture-queue:v1";
// attemptCount -> delay (ms). index 0 is used as the initial retry delay
// after a fresh failure. Capped at 1h; attempts beyond drop the entry.
const BACKOFF_SCHEDULE_MS = [2_000, 8_000, 30_000, 120_000, 600_000, 3_600_000];
const MAX_ATTEMPTS = BACKOFF_SCHEDULE_MS.length;

let entries: QueuedCapture[] = [];
let hydrated = false;
let sender: CaptureSender | null = null;
const listeners = new Set<Listener>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
let appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;

function emit() {
	const snapshot = [...entries];
	for (const l of listeners) l(snapshot);
}

async function persist() {
	try {
		await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
	} catch {
		// AsyncStorage failure shouldn't crash the app; entries stay in memory.
	}
}

async function hydrate() {
	if (hydrated) return;
	try {
		const raw = await AsyncStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) entries = parsed as QueuedCapture[];
		}
	} catch {
		entries = [];
	}
	hydrated = true;
	// Anything not already synced becomes sync_pending on rehydrate — the
	// "saving" state is session-scoped and shouldn't persist across launches.
	let changed = false;
	for (const e of entries) {
		if (e.status === "saving") {
			e.status = "sync_pending";
			changed = true;
		}
	}
	if (changed) await persist();
	if (!appStateSub) {
		appStateSub = AppState.addEventListener("change", handleAppState);
	}
	emit();
}

function handleAppState(state: AppStateStatus) {
	if (state === "active") {
		flushPending().catch(() => {});
	}
}

function update(clientCaptureId: string, patch: Partial<QueuedCapture>) {
	const idx = entries.findIndex((e) => e.clientCaptureId === clientCaptureId);
	if (idx < 0) return;
	entries[idx] = { ...entries[idx], ...patch };
	void persist();
	emit();
}

function scheduleRetry(clientCaptureId: string, attemptCount: number) {
	const existing = retryTimers.get(clientCaptureId);
	if (existing) clearTimeout(existing);
	if (attemptCount >= MAX_ATTEMPTS) return;
	const delay = BACKOFF_SCHEDULE_MS[Math.min(attemptCount, BACKOFF_SCHEDULE_MS.length - 1)];
	const timer = setTimeout(() => {
		retryTimers.delete(clientCaptureId);
		attemptSync(clientCaptureId).catch(() => {});
	}, delay);
	retryTimers.set(clientCaptureId, timer);
}

async function attemptSync(clientCaptureId: string) {
	if (!sender) return;
	const entry = entries.find((e) => e.clientCaptureId === clientCaptureId);
	if (!entry || entry.status === "synced") return;
	update(clientCaptureId, { status: "saving", lastError: undefined });
	try {
		const res = await sender({
			agentId: entry.agentId,
			content: entry.content,
			factType: entry.factType,
			metadata: entry.metadata,
			clientCaptureId: entry.clientCaptureId,
		});
		update(clientCaptureId, { status: "synced", syncedId: res.id, attemptCount: 0 });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const nextAttempt = entry.attemptCount + 1;
		const finalStatus: CaptureQueueStatus = nextAttempt >= MAX_ATTEMPTS ? "failed" : "sync_pending";
		update(clientCaptureId, {
			status: finalStatus,
			attemptCount: nextAttempt,
			lastError: message,
		});
		if (finalStatus === "sync_pending") {
			scheduleRetry(clientCaptureId, nextAttempt);
		}
	}
}

export const captureQueue = {
	/** Register the function that actually sends a capture to the server. */
	setSender(fn: CaptureSender | null) {
		sender = fn;
	},

	/** Subscribe to entries changes. Returns an unsubscribe function. */
	subscribe(listener: Listener): () => void {
		listeners.add(listener);
		void hydrate();
		listener([...entries]);
		return () => {
			listeners.delete(listener);
		};
	},

	snapshot(): QueuedCapture[] {
		return [...entries];
	},

	async enqueue(
		input: Omit<QueuedCapture, "status" | "attemptCount" | "capturedAt"> & {
			capturedAt?: string;
		},
	): Promise<QueuedCapture> {
		await hydrate();
		const entry: QueuedCapture = {
			...input,
			capturedAt: input.capturedAt ?? new Date().toISOString(),
			status: "saving",
			attemptCount: 0,
		};
		entries = [entry, ...entries];
		await persist();
		emit();
		void attemptSync(entry.clientCaptureId);
		return entry;
	},

	/** Retry a specific entry immediately (used by tap-to-retry on failed rows). */
	retry(clientCaptureId: string) {
		const entry = entries.find((e) => e.clientCaptureId === clientCaptureId);
		if (!entry) return;
		// Reset attemptCount when user explicitly retries — they've signaled the
		// transient error is resolved in their view.
		update(clientCaptureId, { attemptCount: 0, status: "sync_pending" });
		void attemptSync(clientCaptureId);
	},

	/** Remove a local entry (used by Undo + swipe-delete on unsynced rows). */
	async remove(clientCaptureId: string) {
		const timer = retryTimers.get(clientCaptureId);
		if (timer) {
			clearTimeout(timer);
			retryTimers.delete(clientCaptureId);
		}
		entries = entries.filter((e) => e.clientCaptureId !== clientCaptureId);
		await persist();
		emit();
	},

	async flushPending() {
		await flushPending();
	},

	async reset() {
		for (const timer of retryTimers.values()) clearTimeout(timer);
		retryTimers.clear();
		entries = [];
		await AsyncStorage.removeItem(STORAGE_KEY);
		emit();
	},
};

async function flushPending() {
	if (!sender) return;
	for (const e of entries) {
		if (e.status === "sync_pending" || e.status === "failed") {
			await attemptSync(e.clientCaptureId);
		}
	}
}

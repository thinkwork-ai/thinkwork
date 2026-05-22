export interface SenderFrameEvent {
  senderFrame?: {
    url: string;
  } | null;
}

export interface SafeSenderFrameOptions {
  allowedUrlPrefixes?: readonly string[];
}

export const DEFAULT_ALLOWED_SENDER_URL_PREFIXES = [
  "thinkwork://app/",
  "thinkwork-dev://app/",
  "thinkwork-canary://app/",
  "http://localhost:5174/",
  "http://127.0.0.1:5174/",
] as const;

export function assertSafeSenderFrame(
  event: SenderFrameEvent,
  options: SafeSenderFrameOptions = {},
): void {
  const url = event.senderFrame?.url;
  const allowedPrefixes =
    options.allowedUrlPrefixes ?? DEFAULT_ALLOWED_SENDER_URL_PREFIXES;

  if (!url || !allowedPrefixes.some((prefix) => url.startsWith(prefix))) {
    throw new Error(
      `Rejected IPC call from untrusted sender frame: ${url ?? "unknown"}`,
    );
  }
}

export interface RateLimitOptions {
  key: string;
  intervalMs: number;
  now?: () => number;
}

const rateLimitState = new Map<string, number>();

export function rateLimit(options: RateLimitOptions): void {
  const now = options.now?.() ?? Date.now();
  const lastCall = rateLimitState.get(options.key);

  if (lastCall !== undefined && now - lastCall < options.intervalMs) {
    throw new Error(
      `Rate limit exceeded for ${options.key}; retry after ${
        options.intervalMs - (now - lastCall)
      }ms`,
    );
  }

  rateLimitState.set(options.key, now);
}

export function resetRateLimits(): void {
  rateLimitState.clear();
}

let cachedToken: string | null = null;
const listeners = new Set<(token: string | null) => void>();

export function setAuthToken(token: string | null) {
  cachedToken = token;
  for (const listener of listeners) listener(token);
}

export function getAuthToken(): string | null {
  return cachedToken;
}

export function onAuthTokenChange(listener: (token: string | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

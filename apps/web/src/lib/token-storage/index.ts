export interface TokenStorage {
  hydrate?(): Promise<void>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
}

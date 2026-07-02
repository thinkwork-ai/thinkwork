// Ambient typing for Vite-style import.meta.env. This package is consumed only
// under a Vite (or compatible) bundler that provides import.meta.env at
// runtime, and it re-exports @thinkwork/ui primitives (e.g. multi-select) that
// read it. Mirrors packages/ui/src/env.d.ts so this package's own typecheck
// passes without pulling vite/client as a dependency.
export {};

declare global {
  interface ImportMetaEnv {
    readonly DEV: boolean;
    readonly PROD: boolean;
    readonly MODE: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

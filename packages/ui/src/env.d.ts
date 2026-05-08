// Ambient typing for Vite-style import.meta.env used by some primitives
// (e.g. multi-select's dev-only console.warn paths). Consumers run under
// a Vite (or compatible) bundler that provides import.meta.env at runtime;
// this declaration lets the package's own typecheck pass without pulling
// vite/client as a dependency.
interface ImportMetaEnv {
  readonly DEV?: boolean;
  readonly PROD?: boolean;
  readonly MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

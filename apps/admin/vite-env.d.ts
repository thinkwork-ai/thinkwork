/// <reference types="vite/client" />

declare module "three";

interface ImportMetaEnv {
  readonly VITE_GRAPHQL_URL: string;
  readonly VITE_GRAPHQL_API_KEY: string;
  readonly VITE_SANDBOX_IFRAME_SRC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

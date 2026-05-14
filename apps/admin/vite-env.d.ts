/// <reference types="vite/client" />

declare module "three";

interface ImportMetaEnv {
  readonly VITE_GRAPHQL_URL: string;
  readonly VITE_GRAPHQL_API_KEY: string;
  readonly VITE_SANDBOX_IFRAME_SRC?: string;
  readonly VITE_ADMIN_EXTENSION_SAMPLE_ENABLED?: string;
  readonly VITE_ADMIN_EXTENSION_SAMPLE_ID?: string;
  readonly VITE_ADMIN_EXTENSION_SAMPLE_LABEL?: string;
  readonly VITE_ADMIN_EXTENSION_SAMPLE_URL?: string;
  readonly VITE_ADMIN_EXTENSION_SAMPLE_GRAPHQL_URL?: string;
  readonly VITE_ADMIN_EXTENSION_SAMPLE_NAV_GROUP?: string;
  readonly VITE_ADMIN_EXTENSION_SAMPLE_EMBED_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

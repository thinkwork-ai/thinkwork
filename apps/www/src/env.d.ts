/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  /**
   * Base URL of the ThinkWork HTTP API (e.g. https://api.thinkwork.ai).
   * Injected at build time by scripts/build-www.sh from the Terraform
   * `api_domain`/`api_endpoint` outputs. Read by /pages/cloud.astro to
   * POST /api/stripe/checkout-session.
   */
  readonly PUBLIC_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

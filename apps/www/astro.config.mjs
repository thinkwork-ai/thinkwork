import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";

export default defineConfig({
  site: "https://thinkwork.ai",
  integrations: [tailwind()],
  // /pricing was renamed to /cloud on 2026-04-24 as part of the Cloud/Services
  // IA split. The static build emits a meta-refresh + canonical HTML stub at
  // /pricing/index.html so inbound links (search results, Stripe cancels from
  // older mobile builds, external shares) keep resolving.
  redirects: {
    "/pricing": "/cloud",
  },
});

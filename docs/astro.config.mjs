import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  // site: "https://docs.thinkwork.ai",  // uncomment when custom domain is live
  integrations: [
    starlight({
      title: "Thinkwork",
      favicon: "/favicon.png",
      customCss: ["./src/styles/custom.css"],
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/thinkwork-ai/thinkwork" },
      ],
      sidebar: [
        { label: "Getting Started", slug: "getting-started" },
        {
          label: "Concepts",
          items: [
            { label: "Agents", slug: "concepts/agents" },
            { label: "Threads", slug: "concepts/threads" },
            { label: "Connectors", slug: "concepts/connectors" },
            { label: "MCP Servers", slug: "concepts/mcp-servers" },
            { label: "Automations", slug: "concepts/automations" },
            { label: "Control", slug: "concepts/control" },
            { label: "Knowledge", slug: "concepts/knowledge" },
          ],
        },
        {
          label: "Deploy",
          items: [
            { label: "Greenfield AWS", slug: "deploy/greenfield" },
            { label: "BYO Infrastructure", slug: "deploy/byo" },
            { label: "Configuration Reference", slug: "deploy/configuration" },
          ],
        },
        {
          label: "CLI Reference",
          items: [
            { label: "Overview", slug: "cli" },
            { label: "Commands", slug: "cli/commands" },
          ],
        },
        {
          label: "API Reference",
          items: [
            { label: "GraphQL Schema", slug: "api/graphql" },
          ],
        },
        {
          label: "Authoring Guides",
          items: [
            { label: "Skill Packs", slug: "guides/skill-packs" },
            { label: "Connectors", slug: "guides/connectors" },
            { label: "Eval Packs", slug: "guides/eval-packs" },
          ],
        },
        { label: "Architecture", slug: "architecture" },
        { label: "Roadmap", slug: "roadmap" },
      ],
    }),
  ],
});

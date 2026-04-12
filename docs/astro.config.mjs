import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  // site: "https://docs.thinkwork.ai",  // uncomment when custom domain is live
  integrations: [
    starlight({
      title: "Thinkwork",
      favicon: "/favicon.png",
      head: [
        { tag: "link", attrs: { rel: "icon", type: "image/png", href: "/favicon.png" } },
        { tag: "link", attrs: { rel: "apple-touch-icon", href: "/favicon.png" } },
      ],
      customCss: ["./src/styles/custom.css"],
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/thinkwork-ai/thinkwork" },
      ],
      sidebar: [
        { label: "Getting Started", slug: "getting-started" },
        {
          label: "Concepts",
          items: [
            {
              label: "Agents",
              items: [
                { label: "Overview", slug: "concepts/agents" },
                { label: "Managed Agents", slug: "concepts/agents/managed-agents" },
                { label: "Templates and Skills", slug: "concepts/agents/templates-and-skills" },
              ],
            },
            {
              label: "Threads",
              items: [
                { label: "Overview", slug: "concepts/threads" },
                { label: "Lifecycle and Types", slug: "concepts/threads/lifecycle-and-types" },
                { label: "Routing and Metadata", slug: "concepts/threads/routing-and-metadata" },
              ],
            },
            {
              label: "Memory",
              items: [
                { label: "Overview", slug: "concepts/knowledge" },
                { label: "Document Knowledge", slug: "concepts/knowledge/document-knowledge" },
                { label: "Long-term Memory", slug: "concepts/knowledge/memory" },
                { label: "Retrieval and Context", slug: "concepts/knowledge/retrieval-and-context" },
                { label: "Knowledge Graph Direction", slug: "concepts/knowledge/knowledge-graph" },
              ],
            },
            {
              label: "Connectors",
              items: [
                { label: "Overview", slug: "concepts/connectors" },
                { label: "Integrations", slug: "concepts/connectors/integrations" },
                { label: "MCP Tools", slug: "concepts/connectors/mcp-tools" },
              ],
            },
            {
              label: "Automations",
              items: [
                { label: "Overview", slug: "concepts/automations" },
                { label: "Scheduled and Event-driven", slug: "concepts/automations/scheduled-and-event-driven" },
                { label: "Routines and Execution Model", slug: "concepts/automations/routines-and-execution-model" },
              ],
            },
            {
              label: "Control",
              items: [
                { label: "Overview", slug: "concepts/control" },
                { label: "Guardrails", slug: "concepts/control/guardrails" },
                { label: "Budgets, Usage, and Audit", slug: "concepts/control/budgets-usage-and-audit" },
              ],
            },
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

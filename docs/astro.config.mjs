import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  // site: "https://docs.thinkwork.ai",  // uncomment when custom domain is live
  integrations: [
    starlight({
      title: "ThinkWork",
      components: {
        Hero: "./src/components/Hero.astro",
      },
      favicon: "/favicon.png",
      logo: {
        src: "./src/assets/logo.png",
        alt: "ThinkWork",
      },
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
          collapsed: true,
          items: [
            {
              label: "Threads",
              collapsed: true,
              items: [
                { label: "Overview", slug: "concepts/threads" },
                { label: "Lifecycle and Types", slug: "concepts/threads/lifecycle-and-types" },
                { label: "Routing and Metadata", slug: "concepts/threads/routing-and-metadata" },
              ],
            },
            {
              label: "Agents",
              collapsed: true,
              items: [
                { label: "Overview", slug: "concepts/agents" },
                { label: "Managed Agents", slug: "concepts/agents/managed-agents" },
                { label: "Templates and Skills", slug: "concepts/agents/templates-and-skills" },
              ],
            },
            {
              label: "Memory",
              collapsed: true,
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
              collapsed: true,
              items: [
                { label: "Overview", slug: "concepts/connectors" },
                { label: "Integrations", slug: "concepts/connectors/integrations" },
                { label: "MCP Tools", slug: "concepts/connectors/mcp-tools" },
                { label: "External Tasks", slug: "concepts/connectors/external-tasks" },
              ],
            },
            {
              label: "Control",
              collapsed: true,
              items: [
                { label: "Overview", slug: "concepts/control" },
                { label: "Guardrails", slug: "concepts/control/guardrails" },
                { label: "Budgets, Usage, and Audit", slug: "concepts/control/budgets-usage-and-audit" },
              ],
            },
            {
              label: "Automations",
              collapsed: true,
              items: [
                { label: "Overview", slug: "concepts/automations" },
                { label: "Scheduled and Event-driven", slug: "concepts/automations/scheduled-and-event-driven" },
                { label: "Routines and Execution Model", slug: "concepts/automations/routines-and-execution-model" },
              ],
            },
          ],
        },
        {
          label: "Applications",
          collapsed: true,
          items: [
            {
              label: "Admin",
              collapsed: true,
              items: [
                { label: "Overview", slug: "applications/admin" },
                { label: "Authentication & Tenancy", slug: "applications/admin/authentication-and-tenancy" },
                {
                  label: "Work",
                  collapsed: true,
                  items: [
                    { label: "Dashboard", slug: "applications/admin/dashboard" },
                    { label: "Threads", slug: "applications/admin/threads" },
                    { label: "Inbox", slug: "applications/admin/inbox" },
                  ],
                },
                {
                  label: "Agents",
                  collapsed: true,
                  items: [
                    { label: "Agents", slug: "applications/admin/agents" },
                    { label: "Agent Templates", slug: "applications/admin/agent-templates" },
                    { label: "Agent Invites", slug: "applications/admin/agent-invites" },
                    { label: "Skills Catalog", slug: "applications/admin/skills-catalog" },
                    { label: "Tenant MCP Servers", slug: "applications/admin/mcp-servers" },
                    { label: "Built-in Tools", slug: "applications/admin/builtin-tools" },
                    { label: "Security Center", slug: "applications/admin/security-center" },
                  ],
                },
                {
                  label: "Manage",
                  collapsed: true,
                  items: [
                    { label: "Memory", slug: "applications/admin/memory" },
                    { label: "Knowledge Bases", slug: "applications/admin/knowledge-bases" },
                    { label: "Analytics", slug: "applications/admin/analytics" },
                    { label: "Scheduled Jobs", slug: "applications/admin/scheduled-jobs" },
                    { label: "Evaluations", slug: "applications/admin/evaluations" },
                    { label: "Routines", slug: "applications/admin/routines" },
                    { label: "Connectors", slug: "applications/admin/connectors" },
                    { label: "Webhooks", slug: "applications/admin/webhooks" },
                    { label: "Artifacts", slug: "applications/admin/artifacts" },
                    { label: "Humans", slug: "applications/admin/humans" },
                    { label: "Settings", slug: "applications/admin/settings" },
                  ],
                },
              ],
            },
            {
              label: "Mobile",
              collapsed: true,
              items: [
                { label: "Overview", slug: "applications/mobile" },
                { label: "Authentication", slug: "applications/mobile/authentication" },
                { label: "Threads & Chat", slug: "applications/mobile/threads-and-chat" },
                { label: "Integrations & MCP Connect", slug: "applications/mobile/integrations-and-mcp-connect" },
                { label: "External Tasks", slug: "applications/mobile/external-tasks" },
                { label: "Push Notifications", slug: "applications/mobile/push-notifications" },
                { label: "Distribution", slug: "applications/mobile/distribution" },
              ],
            },
            {
              label: "CLI",
              collapsed: true,
              items: [
                { label: "Overview", slug: "applications/cli" },
                { label: "Commands", slug: "applications/cli/commands" },
              ],
            },
          ],
        },
        {
          label: "Deploy",
          collapsed: true,
          items: [
            { label: "Greenfield AWS", slug: "deploy/greenfield" },
            { label: "BYO Infrastructure", slug: "deploy/byo" },
            { label: "Configuration Reference", slug: "deploy/configuration" },
          ],
        },
        {
          label: "API Reference",
          collapsed: true,
          items: [
            { label: "GraphQL Schema", slug: "api/graphql" },
          ],
        },
        {
          label: "SDKs",
          collapsed: true,
          items: [
            {
              label: "React Native",
              collapsed: true,
              items: [
                { label: "Overview", slug: "sdks/react-native" },
                { label: "Install & Setup", slug: "sdks/react-native/install-and-setup" },
                { label: "Hook Guide", slug: "sdks/react-native/hook-reference" },
                { label: "How Threads & Agents Work", slug: "sdks/react-native/thread-agent-model" },
                { label: "Integration Recipes", slug: "sdks/react-native/integration-recipes" },
                { label: "Upgrading from 0.1", slug: "sdks/react-native/migration" },
              ],
            },
          ],
        },
        {
          label: "Authoring Guides",
          collapsed: true,
          items: [
            { label: "Skill Packs", slug: "guides/skill-packs" },
            { label: "Connectors", slug: "guides/connectors" },
            { label: "External Tasks", slug: "guides/external-tasks" },
            { label: "Evaluations", slug: "guides/evaluations" },
          ],
        },
        { label: "Architecture", slug: "architecture" },
        { label: "Roadmap", slug: "roadmap" },
      ],
    }),
  ],
});

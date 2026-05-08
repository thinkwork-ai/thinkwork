import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  // site: "https://docs.thinkwork.ai",  // uncomment when custom domain is live
  integrations: [
    starlight({
      title: "ThinkWork",
      components: {
        Hero: "./src/components/Hero.astro",
        SiteTitle: "./src/components/SiteTitle.astro",
      },
      favicon: "/favicon.png",
      head: [
        {
          tag: "link",
          attrs: { rel: "icon", type: "image/png", href: "/favicon.png" },
        },
        {
          tag: "link",
          attrs: { rel: "apple-touch-icon", href: "/favicon.png" },
        },
      ],
      customCss: ["./src/styles/custom.css"],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/thinkwork-ai/thinkwork",
        },
      ],
      sidebar: [
        {
          label: "Architecture",
          items: [
            { label: "Getting Started", slug: "getting-started" },
            { label: "Architecture", slug: "architecture" },
            { label: "Roadmap", slug: "roadmap" },
          ],
        },
        {
          label: "Components",
          collapsed: true,
          items: [
            {
              label: "Threads",
              collapsed: true,
              items: [
                { label: "Overview", slug: "concepts/threads" },
                {
                  label: "Lifecycle and Types",
                  slug: "concepts/threads/lifecycle-and-types",
                },
                {
                  label: "Routing and Metadata",
                  slug: "concepts/threads/routing-and-metadata",
                },
              ],
            },
            {
              label: "Agents",
              collapsed: true,
              items: [
                { label: "Overview", slug: "concepts/agents" },
                {
                  label: "Managed Agents",
                  slug: "concepts/agents/managed-agents",
                },
                {
                  label: "Runtime Selection",
                  slug: "concepts/agents/runtime-selection",
                },
                { label: "Templates", slug: "concepts/agents/templates" },
                {
                  label: "Workspace Overlay",
                  slug: "concepts/agents/workspace-overlay",
                },
                {
                  label: "Workspace Orchestration",
                  slug: "concepts/agents/workspace-orchestration",
                },
                {
                  label: "Agent Design",
                  collapsed: true,
                  items: [
                    { label: "Overview", slug: "agent-design" },
                    {
                      label: "Folder Is the Agent",
                      slug: "agent-design/folder-is-the-agent",
                    },
                    {
                      label: "Inheritance Rules",
                      slug: "agent-design/inheritance-rules",
                    },
                    {
                      label: "Authoring Templates",
                      slug: "agent-design/authoring-templates",
                    },
                    {
                      label: "Import FOG/FITA Bundles",
                      slug: "agent-design/import-fog-fita",
                    },
                  ],
                },
                { label: "Skills", slug: "concepts/agents/skills" },
                { label: "Code Sandbox", slug: "concepts/agents/code-sandbox" },
              ],
            },
            {
              label: "Company Brain",
              collapsed: true,
              items: [
                { label: "Overview", slug: "concepts/knowledge" },
                {
                  label: "Sources and Knowledge Bases",
                  slug: "concepts/knowledge/document-knowledge",
                },
                {
                  label: "Memory Facet",
                  slug: "concepts/knowledge/memory",
                },
                {
                  label: "Compiled Pages",
                  slug: "concepts/knowledge/compounding-memory",
                },
                {
                  label: "Compile Pipeline",
                  slug: "concepts/knowledge/compounding-memory-pipeline",
                },
                {
                  label: "Page Model",
                  slug: "concepts/knowledge/compounding-memory-pages",
                },
                {
                  label: "Source Routing",
                  slug: "concepts/knowledge/retrieval-and-context",
                },
                {
                  label: "Graph Direction",
                  slug: "concepts/knowledge/knowledge-graph",
                },
              ],
            },
            {
              label: "Connectors",
              collapsed: true,
              items: [
                { label: "Overview", slug: "concepts/connectors" },
                {
                  label: "Lifecycle",
                  slug: "concepts/connectors/lifecycle",
                },
                {
                  label: "Integrations",
                  slug: "concepts/connectors/integrations",
                },
                { label: "MCP Tools", slug: "concepts/connectors/mcp-tools" },
              ],
            },
            {
              label: "Control",
              collapsed: true,
              items: [
                { label: "Overview", slug: "concepts/control" },
                { label: "Guardrails", slug: "concepts/control/guardrails" },
                {
                  label: "Budgets, Usage, and Audit",
                  slug: "concepts/control/budgets-usage-and-audit",
                },
              ],
            },
            {
              label: "Automations",
              collapsed: true,
              items: [
                { label: "Overview", slug: "concepts/automations" },
                {
                  label: "Scheduled and Event-driven",
                  slug: "concepts/automations/scheduled-and-event-driven",
                },
                {
                  label: "Routines and Execution Model",
                  slug: "concepts/automations/routines-and-execution-model",
                },
              ],
            },
          ],
        },
        {
          label: "Compliance",
          collapsed: true,
          items: [
            { label: "Overview", slug: "compliance" },
            { label: "What it does", slug: "compliance/overview" },
            { label: "Architecture", slug: "compliance/architecture" },
            { label: "Operator runbook", slug: "compliance/operator-runbook" },
            {
              label: "Auditor walkthrough",
              slug: "compliance/auditor-walkthrough",
            },
            { label: "Developer guide", slug: "compliance/developer-guide" },
            { label: "On-call notes", slug: "compliance/oncall" },
            { label: "Changelog", slug: "compliance/changelog" },
          ],
        },
        {
          label: "Configure",
          collapsed: true,
          items: [
            {
              label: "Deploy",
              collapsed: true,
              items: [
                { label: "Greenfield AWS", slug: "deploy/greenfield" },
                { label: "BYO Infrastructure", slug: "deploy/byo" },
                {
                  label: "Configuration Reference",
                  slug: "deploy/configuration",
                },
              ],
            },
            {
              label: "Authoring Guides",
              collapsed: true,
              items: [
                { label: "Skill Packs", slug: "guides/skill-packs" },
                { label: "Connectors", slug: "guides/connectors" },
                {
                  label: "Symphony Linear Checkpoint",
                  slug: "guides/symphony-linear-checkpoint",
                },
                { label: "Evaluations", slug: "guides/evaluations" },
                {
                  label: "Operating Compiled Pages",
                  slug: "guides/compounding-memory-operations",
                },
              ],
            },
          ],
        },
        {
          label: "Reference",
          collapsed: true,
          items: [
            {
              label: "API Reference",
              collapsed: true,
              items: [
                { label: "GraphQL Schema", slug: "api/graphql" },
                { label: "Compiled Pages", slug: "api/compounding-memory" },
                { label: "Company Brain Context", slug: "api/context-engine" },
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
                    {
                      label: "Install & Setup",
                      slug: "sdks/react-native/install-and-setup",
                    },
                    {
                      label: "Hook Guide",
                      slug: "sdks/react-native/hook-reference",
                    },
                    {
                      label: "How Threads & Agents Work",
                      slug: "sdks/react-native/thread-agent-model",
                    },
                    {
                      label: "Integration Recipes",
                      slug: "sdks/react-native/integration-recipes",
                    },
                    {
                      label: "Upgrading from 0.1",
                      slug: "sdks/react-native/migration",
                    },
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
                    {
                      label: "Authentication & Tenancy",
                      slug: "applications/admin/authentication-and-tenancy",
                    },
                    {
                      label: "Work",
                      collapsed: true,
                      items: [
                        {
                          label: "Dashboard",
                          slug: "applications/admin/dashboard",
                        },
                        {
                          label: "Symphony",
                          slug: "applications/admin/symphony",
                        },
                        {
                          label: "Threads",
                          slug: "applications/admin/threads",
                        },
                        { label: "Inbox", slug: "applications/admin/inbox" },
                        {
                          label: "Automations",
                          slug: "applications/admin/automations",
                        },
                      ],
                    },
                    {
                      label: "Agents",
                      collapsed: true,
                      items: [
                        { label: "Agents", slug: "applications/admin/agents" },
                        {
                          label: "Agent Templates",
                          slug: "applications/admin/agent-templates",
                        },
                        {
                          label: "Agent Invites",
                          slug: "applications/admin/agent-invites",
                        },
                        {
                          label: "Skills Catalog",
                          slug: "applications/admin/skills-catalog",
                        },
                        {
                          label: "Tenant MCP Servers",
                          slug: "applications/admin/mcp-servers",
                        },
                        {
                          label: "Built-in Tools",
                          slug: "applications/admin/builtin-tools",
                        },
                        {
                          label: "Security Center",
                          slug: "applications/admin/security-center",
                        },
                      ],
                    },
                    {
                      label: "Manage",
                      collapsed: true,
                      items: [
                        {
                          label: "Company Brain",
                          slug: "applications/admin/knowledge",
                        },
                        {
                          label: "Memory Facet",
                          slug: "applications/admin/memory",
                        },
                        {
                          label: "Knowledge Bases",
                          slug: "applications/admin/knowledge-bases",
                        },
                        {
                          label: "Analytics",
                          slug: "applications/admin/analytics",
                        },
                        {
                          label: "Evaluations",
                          slug: "applications/admin/evaluations",
                        },
                        {
                          label: "Webhooks",
                          slug: "applications/admin/webhooks",
                        },
                        {
                          label: "Artifacts",
                          slug: "applications/admin/artifacts",
                        },
                        { label: "Humans", slug: "applications/admin/humans" },
                        {
                          label: "Settings",
                          slug: "applications/admin/settings",
                        },
                      ],
                    },
                  ],
                },
                {
                  label: "Mobile",
                  collapsed: true,
                  items: [
                    { label: "Overview", slug: "applications/mobile" },
                    {
                      label: "Authentication",
                      slug: "applications/mobile/authentication",
                    },
                    {
                      label: "Threads & Chat",
                      slug: "applications/mobile/threads-and-chat",
                    },
                    {
                      label: "Integrations & MCP Connect",
                      slug: "applications/mobile/integrations-and-mcp-connect",
                    },
                    {
                      label: "Push Notifications",
                      slug: "applications/mobile/push-notifications",
                    },
                    {
                      label: "Distribution",
                      slug: "applications/mobile/distribution",
                    },
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
          ],
        },
      ],
    }),
  ],
});

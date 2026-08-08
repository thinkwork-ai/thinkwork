/**
 * The docs registry (THINK-694): one place that knows every published page,
 * its nav section and its on-page TOC. The shell (DocsPage) renders nav and
 * TOC from here; a page that isn't in the registry doesn't exist.
 *
 * PLANNED_PAGES lists what is scoped but not yet published — the home page
 * shows those as in-progress, so readers see the map without dead links in
 * the nav.
 */
import type { ComponentType } from "react";
import { GettingStarted, GETTING_STARTED_TOC } from "./pages/GettingStarted";
import { Concepts, CONCEPTS_TOC } from "./pages/Concepts";
import { AppTour, APP_TOUR_TOC } from "./pages/AppTour";
import { AgentFolder, AGENT_FOLDER_TOC } from "./pages/AgentFolder";
import {
  WorkspaceComposition,
  WORKSPACE_COMPOSITION_TOC,
} from "./pages/WorkspaceComposition";
import { Skills, SKILLS_TOC } from "./pages/Skills";
import {
  SubagentsAndTemplates,
  SUBAGENTS_AND_TEMPLATES_TOC,
} from "./pages/SubagentsAndTemplates";
import { Spaces, SPACES_TOC } from "./pages/Spaces";
import {
  WorkspaceContext,
  WORKSPACE_CONTEXT_TOC,
} from "./pages/WorkspaceContext";
import {
  TriggersAndChannels,
  TRIGGERS_AND_CHANNELS_TOC,
} from "./pages/TriggersAndChannels";
import { Threads, THREADS_TOC } from "./pages/Threads";
import { Memory, MEMORY_TOC } from "./pages/Memory";
import {
  CompoundingMemory,
  COMPOUNDING_MEMORY_TOC,
} from "./pages/CompoundingMemory";
import {
  RetrievalAndContext,
  RETRIEVAL_AND_CONTEXT_TOC,
} from "./pages/RetrievalAndContext";
import {
  ConnectorsAndMcp,
  CONNECTORS_AND_MCP_TOC,
} from "./pages/ConnectorsAndMcp";
import { SlackDocs, SLACK_DOCS_TOC } from "./pages/SlackDocs";
import {
  GithubAndGoogle,
  GITHUB_AND_GOOGLE_TOC,
} from "./pages/GithubAndGoogle";
import {
  ChartsAndArtifacts,
  CHARTS_AND_ARTIFACTS_TOC,
} from "./pages/ChartsAndArtifacts";
import { Automations, AUTOMATIONS_TOC } from "./pages/Automations";
import { Evaluations, EVALUATIONS_TOC } from "./pages/Evaluations";
import {
  ApprovalsAndGuardrails,
  APPROVALS_AND_GUARDRAILS_TOC,
} from "./pages/ApprovalsAndGuardrails";
import {
  SecurityAndTenancy,
  SECURITY_AND_TENANCY_TOC,
} from "./pages/SecurityAndTenancy";
import { MobileApp, MOBILE_APP_TOC } from "./pages/MobileApp";
import {
  CliAndDeployment,
  CLI_AND_DEPLOYMENT_TOC,
} from "./pages/CliAndDeployment";
import { ModelCatalog, MODEL_CATALOG_TOC } from "./pages/ModelCatalog";

export interface DocTocEntry {
  id: string;
  title: string;
}

export interface DocPageDef {
  slug: string;
  title: string;
  /** Card blurb on the docs home; one line. */
  blurb: string;
  toc: DocTocEntry[];
  component: ComponentType;
}

export interface DocSectionDef {
  label: string;
  pages: DocPageDef[];
}

/**
 * Seven sections, grouped by the question a reader is asking: orientation,
 * what an agent is, where work happens, what the agent remembers, what it
 * can reach, how you keep it honest, how you run the platform. No section
 * has fewer than three pages — a one-page section is just a page.
 */
export const DOC_SECTIONS: DocSectionDef[] = [
  {
    label: "Start here",
    pages: [
      {
        slug: "getting-started",
        title: "Getting started",
        blurb:
          "What ThinkWork Agent is, and the shortest path from signing in to a working agent.",
        toc: GETTING_STARTED_TOC,
        component: GettingStarted,
      },
      {
        slug: "concepts",
        title: "Core concepts",
        blurb:
          "The vocabulary every other page uses — agent, workspace, space, thread, skill, memory.",
        toc: CONCEPTS_TOC,
        component: Concepts,
      },
      {
        slug: "app-tour",
        title: "App tour",
        blurb:
          "Every surface of the app in order, with the shared idioms explained once.",
        toc: APP_TOUR_TOC,
        component: AppTour,
      },
    ],
  },
  {
    label: "Agents",
    pages: [
      {
        slug: "agent-folder",
        title: "The agent folder",
        blurb:
          "One recursive shape: INSTRUCTIONS.md, skills, connectors and agents, at every level.",
        toc: AGENT_FOLDER_TOC,
        component: AgentFolder,
      },
      {
        slug: "workspace-composition",
        title: "Workspace composition & inheritance",
        blurb:
          "How defaults, tenant policy and the agent's own folder combine into one effective workspace.",
        toc: WORKSPACE_COMPOSITION_TOC,
        component: WorkspaceComposition,
      },
      {
        slug: "skills",
        title: "Skills",
        blurb:
          "Packaged procedures an agent installs — the catalog, the install, and per-assignment state.",
        toc: SKILLS_TOC,
        component: Skills,
      },
      {
        slug: "subagents-and-templates",
        title: "Sub-agents & templates",
        blurb:
          "Delegating a slice of work to a narrower agent, and rolling one shape out across a fleet.",
        toc: SUBAGENTS_AND_TEMPLATES_TOC,
        component: SubagentsAndTemplates,
      },
    ],
  },
  {
    label: "Spaces & threads",
    pages: [
      {
        slug: "spaces",
        title: "Spaces",
        blurb:
          "The container the work lives in — who is in it, what it can see, how to organize it.",
        toc: SPACES_TOC,
        component: Spaces,
      },
      {
        slug: "workspace-context",
        title: "Workspace context",
        blurb:
          "What the agent can actually see in a turn, and how to widen or narrow it.",
        toc: WORKSPACE_CONTEXT_TOC,
        component: WorkspaceContext,
      },
      {
        slug: "triggers-and-channels",
        title: "Triggers & channels",
        blurb:
          "Everything that can start a turn, and every place an answer can come back.",
        toc: TRIGGERS_AND_CHANNELS_TOC,
        component: TriggersAndChannels,
      },
      {
        slug: "threads",
        title: "Threads",
        blurb:
          "The unit of conversation — anatomy, live progress, and what persists afterwards.",
        toc: THREADS_TOC,
        component: Threads,
      },
    ],
  },
  {
    label: "Memory",
    pages: [
      {
        slug: "memory",
        title: "How memory works",
        blurb:
          "The managed memory engine, what gets written to it, and what never does.",
        toc: MEMORY_TOC,
        component: Memory,
      },
      {
        slug: "compounding-memory",
        title: "Compounding memory",
        blurb:
          "Scattered memories distilled into Entity, Topic and Decision pages you can browse.",
        toc: COMPOUNDING_MEMORY_TOC,
        component: CompoundingMemory,
      },
      {
        slug: "retrieval-and-context",
        title: "Retrieval & context",
        blurb:
          "How the right memory reaches the right turn, and how to tell whether it did.",
        toc: RETRIEVAL_AND_CONTEXT_TOC,
        component: RetrievalAndContext,
      },
    ],
  },
  {
    label: "Tools & integrations",
    pages: [
      {
        slug: "connectors-and-mcp",
        title: "Connectors & MCP tools",
        blurb:
          "How an agent reaches outside systems — connectors, MCP servers, and the permission fence.",
        toc: CONNECTORS_AND_MCP_TOC,
        component: ConnectorsAndMcp,
      },
      {
        slug: "slack",
        title: "Slack",
        blurb:
          "Installing the Slack app, working with an agent in a channel, and the limits to know.",
        toc: SLACK_DOCS_TOC,
        component: SlackDocs,
      },
      {
        slug: "github-and-google",
        title: "GitHub & Google Workspace",
        blurb:
          "The two developer-and-document connectors, and how per-user OAuth keeps them personal.",
        toc: GITHUB_AND_GOOGLE_TOC,
        component: GithubAndGoogle,
      },
      {
        slug: "charts-and-artifacts",
        title: "Charts & artifacts",
        blurb:
          "What an agent hands back beyond text — inline charts, artifacts, and how to share them.",
        toc: CHARTS_AND_ARTIFACTS_TOC,
        component: ChartsAndArtifacts,
      },
    ],
  },
  {
    label: "Automations & quality",
    pages: [
      {
        slug: "automations",
        title: "Automations & scheduling",
        blurb:
          "Standing duties: scheduled jobs, wakeups, and how to tell a healthy one from a stuck one.",
        toc: AUTOMATIONS_TOC,
        component: Automations,
      },
      {
        slug: "evaluations",
        title: "Evaluations",
        blurb:
          "Test cases, evaluators and runs — proving the agent is right, repeatedly.",
        toc: EVALUATIONS_TOC,
        component: Evaluations,
      },
      {
        slug: "approvals-and-guardrails",
        title: "Approvals & guardrails",
        blurb:
          "The two ways to bound an agent: refuse in advance, or ask a human first.",
        toc: APPROVALS_AND_GUARDRAILS_TOC,
        component: ApprovalsAndGuardrails,
      },
    ],
  },
  {
    label: "Operations",
    pages: [
      {
        slug: "security-and-tenancy",
        title: "Security & tenancy",
        blurb:
          "Where the tenant boundary is drawn, who can sign in, and what never crosses it.",
        toc: SECURITY_AND_TENANCY_TOC,
        component: SecurityAndTenancy,
      },
      {
        slug: "mobile-app",
        title: "Mobile app",
        blurb:
          "The iOS app — getting it, what it does that the web does not, and connecting your accounts.",
        toc: MOBILE_APP_TOC,
        component: MobileApp,
      },
      {
        slug: "cli-and-deployment",
        title: "CLI & deployment",
        blurb:
          "The thinkwork CLI, the stage model it deploys into, and day-two operations.",
        toc: CLI_AND_DEPLOYMENT_TOC,
        component: CliAndDeployment,
      },
      {
        slug: "model-catalog",
        title: "Model catalog",
        blurb:
          "Which models are available, how one gets chosen for a turn, and what it costs.",
        toc: MODEL_CATALOG_TOC,
        component: ModelCatalog,
      },
    ],
  },
];

/** Scoped but not yet published — shown as in-progress on the docs home. */
export const PLANNED_PAGES: { title: string; blurb: string }[] = [];

/**
 * Slugs that used to address a page and still appear in the wild — bookmarks,
 * pasted links, older screenshots. Kept resolving so a rename never 404s a
 * URL someone already has. Empty until the first rename.
 */
const LEGACY_SLUGS: Record<string, string> = {};

export function findDocPage(slug: string): DocPageDef | null {
  const resolved = LEGACY_SLUGS[slug] ?? slug;
  for (const section of DOC_SECTIONS) {
    const page = section.pages.find((candidate) => candidate.slug === resolved);
    if (page) return page;
  }
  return null;
}

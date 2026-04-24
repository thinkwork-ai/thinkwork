// Single source of truth for homepage copy. Every section component imports from here.
//
// Voice guardrails:
// - Noun-first, architectural. Avoid verb-forward marketing language ("transform", "unlock", "empower").
// - No specific verticals (healthcare, finance, legal).
// - No unearned compliance claims (no SOC2/HIPAA/ISO badges until earned).
// - No unverifiable stats in hero or proof points.
// - Every capability claim must map to an admin surface or schema that actually ships.

export const external = {
  docs: "https://docs.thinkwork.ai",
  github: "https://github.com/thinkwork-ai/thinkwork",
  admin: "https://admin.thinkwork.ai",
  quickStartDocs: "https://docs.thinkwork.ai/getting-started",
};

// Top nav is deliberately short — Platform / Services / Cloud / Docs is the
// whole surface. Platform = the homepage (product overview); Services = the
// delivered engagement surface; Cloud = hosted ThinkWork plans. Homepage
// section anchors (Journey / How it works / Governance / Quick start) are
// still reachable by scrolling once on `/`.
//
// Docs + GitHub icon + Login are hardcoded in Header.astro after this list.
export const nav = [
  { label: "Platform", href: "/" },
  { label: "Services", href: "/services" },
  { label: "Cloud", href: "/cloud" },
];

export const meta = {
  title: "ThinkWork — Start small. Build trust. Scale AI safely.",
  description:
    "The path from AI experiments to trusted AI work. Visible work, governed expansion, and infrastructure you own.",
};

export const hero = {
  eyebrow: "The AI adoption journey",
  headlinePart1: "Start small. Build trust.",
  headlineAccent: "Scale AI safely.",
  lede: "The path from AI experiments to trusted AI work — visible work, governed expansion, and an AWS environment you own.",
  primaryCta: { label: "Read the docs", href: external.docs },
  secondaryCta: { label: "View on GitHub", href: external.github },
  headlineCandidates: [
    // Locked: first entry is the winner; runner-ups kept for future copy iteration.
    "Start small. Build trust. Scale AI safely.",
    "From AI experiments to trusted AI work.",
    "A controlled path to real AI work.",
    "Adopt AI. Keep control.",
  ],
  ledeCandidates: [
    // Locked: first entry is the winner; runner-ups kept for future copy iteration.
    "The path from AI experiments to trusted AI work — visible work, governed expansion, and an AWS deployment boundary you own.",
    "ThinkWork helps organizations move from AI experiments to trusted AI work through visible workflows, governed expansion, and an AWS deployment boundary they own.",
    "ThinkWork helps organizations adopt AI through small wins, visible work, governed expansion, and a deployment boundary they own.",
    "ThinkWork is the path from AI experiments to trusted AI work — visible threads, durable memory, capability-granted templates, and a deployment boundary that stays inside the AWS account your team already operates.",
  ],
};

export const proofStrip = [
  {
    label: "Start small",
    detail:
      "One assistant, one workflow, one team. Pilot without a platform bet.",
  },
  {
    label: "Visible work",
    detail:
      "Every request, action, and outcome lives inside a durable, inspectable thread.",
  },
  {
    label: "Governed expansion",
    detail:
      "Approved capabilities per agent, budgets that cap spend, and evaluations that scale with usage.",
  },
  {
    label: "Your boundary",
    detail: "Runtime, data, audit trail, and memory stay inside your boundary.",
  },
  {
    label: "One system at every scale",
    detail:
      "The runtime a developer spins up in five commands is the runtime production runs on.",
  },
];

export const journey = {
  eyebrow: "The AI adoption journey",
  headline: "A practical path to AI adoption.",
  lede: "Start small, keep every action visible, expand as trust grows — without changing the governance model underneath.",
  steps: [
    {
      n: "01",
      title: "Start with small wins",
      lede: "One assistant, one workflow, one team. Pilot without a platform bet.",
    },
    {
      n: "02",
      title: "Build trust through visible work",
      lede: "Every action lives in a thread — attributed, audited, inspectable.",
    },
    {
      n: "03",
      title: "Expand as confidence grows",
      lede: "Assistants take on more scope as reliable results earn it.",
    },
    {
      n: "04",
      title: "Keep the harness yours",
      lede: "Runtime, data, audit trail, and memory stay inside your boundary.",
    },
  ],
};

export const howItWorks = {
  eyebrow: "How ThinkWork works",
  headline: "Four primitives, one system harness.",
  lede: "Threads, memory, templates, and controls — built into the runtime, not bolted on later.",
  primitives: [
    {
      title: "Threads",
      oneLiner: "Threads keep work visible.",
      detail:
        "Every request, action, and outcome lives in one system of record — durable, attributed, and inspectable per thread, per agent, per tenant.",
      href: "#audit",
    },
    {
      title: "Memory",
      oneLiner: "Memory carries context forward.",
      detail:
        "Agents do not start from zero every time. Useful context, decisions, and knowledge stay available across threads, across teams, across time.",
      href: "#memory",
    },
    {
      title: "Sandbox",
      oneLiner: "Sandbox runs code at reasoning time.",
      detail:
        "A per-turn execution surface on AWS Bedrock AgentCore for ad-hoc transforms, API stitching, and one-off CLI calls — isolated, tenant-scoped, and audited alongside every other turn in the thread.",
      href: "",
    },
    {
      title: "Controls",
      oneLiner: "Controls make adoption governable.",
      detail:
        "Templates contract each agent to an approved set of tools, models, and knowledge. Budgets, guardrails, evaluations, and audit trails keep AI accountable as usage grows.",
      href: "#controls",
    },
  ],
};

export const controls = {
  eyebrow: "Governance that grows with usage",
  headline: "Governance, enforced in code, not in policy documents.",
  lede: "As agents multiply, spend climbs, and scope expands, the governance surface scales with usage — not an architecture rewrite. Five first-class controls keep AI accountable at every stage of adoption.",
  items: [
    {
      title: "Runs in your AWS",
      desc: "The runtime deploys into your account. Your data, IAM, and network stay yours.",
      icon: "aws",
    },
    {
      title: "Approved agent capabilities",
      desc: "Each agent inherits an approved set of tools, models, and knowledge from its template — policy becomes code, not paperwork.",
      icon: "templates",
    },
    {
      title: "Centralized management",
      desc: "One admin console for agents, templates, budgets, evaluations, memory, and audit — no fragmented toolchain.",
      icon: "admin",
    },
    {
      title: "Cost control and analysis",
      desc: "Real-time cost events per agent and model. Budgets cap spend before a runaway loop becomes an invoice.",
      icon: "cost",
    },
    {
      title: "Security + accuracy evaluations",
      desc: "Evaluation suite for every template — AWS Bedrock AgentCore evaluators plus custom assertions.",
      icon: "evals",
    },
  ],
};

export const agentTemplates = {
  eyebrow: "Templates",
  headline: "You decide what each agent can do.",
  lede: "Agent templates are the contract between a policy decision and the agents that enforce it. Define a template once and every agent created from it inherits those limits.",
  features: [
    {
      title: "Tool block-lists",
      desc: "Block any built-in tool or MCP server a template shouldn't reach. Agents created from the template inherit the block.",
    },
    {
      title: "Model pinning",
      desc: "Lock the model per template. Overrides require an explicit policy flag, not a quiet flag change.",
    },
    {
      title: "Guardrails by reference",
      desc: "Attach a guardrail once; every agent created from the template inherits future edits automatically.",
    },
    {
      title: "Scoped knowledge",
      desc: "Bind knowledge bases to specific templates so sensitive corpora stay out of reach for general agents.",
    },
  ],
  caption: "Admin web · agent-templates editor",
  imagePath: "/images/admin/agent-templates.png",
};

export const audit = {
  eyebrow: "Audit",
  headline: "Every turn leaves a trace.",
  lede: "Every tool call, every token, every cost event is captured inside the thread that produced it. The record is durable, tenant-scoped, and inspectable per thread, per agent, per tenant.",
  features: [
    {
      title: "Step-by-step execution",
      desc: "Every tool call — with its arguments, result, and duration — is captured inline with the turn that fired it.",
    },
    {
      title: "Token + cost per turn",
      desc: "Every turn records its token use and model spend, so cost lives next to the decision that drove it.",
    },
    {
      title: "Status + attribution",
      desc: "Thread status, priority, and the agent that ran each step travel with the record — nothing is anonymous.",
    },
    {
      title: "Evaluations run on the same trace",
      desc: "AWS Bedrock AgentCore evaluators score tool safety, helpfulness, accuracy, and hallucination on the recorded turns.",
    },
  ],
  caption: "Admin web · thread detail and execution trace",
  imagePath: "/images/admin/thread-detail.png",
};

export const costControl = {
  eyebrow: "Cost",
  headline: "Cost attributed where it happens.",
  lede: "Every model call emits a cost event tagged by tenant, agent, and model. Per-agent budgets pause execution before overruns compound.",
  features: [
    {
      title: "Owned cost ledger",
      desc: "Every invocation emits a cost event tagged by tenant, agent, and model, written to the Postgres you deployed.",
    },
    {
      title: "Enforced budgets",
      desc: "Per-agent hard caps pause execution before a runaway loop compounds into a bill.",
    },
    {
      title: "Evaluated in context",
      desc: "Cost shows up next to the turn that produced it, so spend and quality travel together.",
    },
    {
      title: "Per-model breakdown",
      desc: "Tokens in, tokens out, and cost broken out per model, so high-spend calls surface next to the choice that drove them.",
    },
  ],
  caption: "Admin web · analytics · cost view",
  imagePath: "/images/admin/cost-analytics.png",
};

// Evals intentionally lives as a sub-feature inside Audit (see `audit.features`)
// and as a pillar in `controls.items` / `proofStrip` until a real
// /evaluations/$runId screenshot is captured. When it ships, these
// bullets can seed a dedicated Evals showcase.
export const evals = {
  eyebrow: "Evals",
  headline: "Security and accuracy, verified against the trace.",
  lede: "Re-run evaluations against any template version. AgentCore evaluators and your own deterministic assertions run against the same traces the admin already captures.",
  bullets: [
    "AWS Bedrock AgentCore built-in evaluators for tool safety, helpfulness, accuracy, and hallucination.",
    "Custom deterministic assertions — regex, equals, contains, JSON path.",
    "Red-team, tool-safety, and knowledge-base seed packs to build on.",
    "Per-template pass rates and per-test evaluator scores, archived per run.",
  ],
  caption: "Admin web · evaluations · run detail",
  imagePath: "/images/admin/evals-run.png",
};

export const systemModel = {
  eyebrow: "One admin console",
  headline: "One surface where the primitives connect.",
  lede: "Threads, memory, agents, and connectors meet in one admin surface. Governance, audit, and spend travel with them — no fragmented toolchain, no per-tool control plane.",
  nodes: [
    {
      title: "Threads",
      desc: "The system of record for AI work. Every request, action, and outcome lives here.",
    },
    {
      title: "Memory",
      desc: "A portable, harness-owned context layer that carries work forward between threads and agents.",
    },
    {
      title: "Agents",
      desc: "Managed or self-hosted. They operate inside the same thread and control model.",
    },
    {
      title: "Connectors",
      desc: "Approved system access — without the connector becoming the product contract.",
    },
  ],
  controlLabel: "Control",
  controlDetail: "Budgets · Approvals · Guardrails · Audit",
  dashboardCaption: "Admin web · the system running",
};

export const memory = {
  eyebrow: "The durable benefit",
  headline: "A memory asset you own, not a vendor's API.",
  lede: "Once the controls are in place, the thing your organization actually gets is a memory layer you own. Every artifact your agents produce is inspectable, exportable, and portable.",
  memoryPoints: [
    "A harness-owned context layer, not a backend vendor's API.",
    "Portable and inspectable — read it, export it, move it.",
    "A stable memory contract above pluggable engines. Hindsight and AgentCore are adapters, not the product.",
  ],
  wikiPoints: [
    "Wiki Memories compile conversations into durable, browsable knowledge pages.",
    "Inspect the graph that connects entities, pages, and sources.",
    "Ship the same view to the mobile app so end users see what the org has learned.",
  ],
  caption: "Admin web · browse, search, and inspect every memory",
};

export const mobile = {
  eyebrow: "End-user surface",
  headline: "End users get a real work surface too.",
  lede: "Governed AI is not just an admin surface. The operator story lives in the admin web; the user story is a native iOS app on the same threads, agents, and connectors — live on TestFlight today.",
  highlights: [
    {
      title: "Assigned work, one place",
      desc: "Chats, automations, emails, and external tasks flow into a single inbox. Nothing asking the user to keep five tools open in parallel.",
    },
    {
      title: "Native GenUI, not markdown",
      desc: "Task cards render as native mobile components — fields, actions, activity — from a bounded block grammar the server controls.",
    },
    {
      title: "Realtime by default",
      desc: "Webhook events, agent turns, and status changes land on-device within seconds over AppSync.",
    },
    {
      title: "Memory, browseable",
      desc: "The Wiki tab surfaces the same entities, pages, and knowledge graph the admin shows — so end users can see what the org has learned.",
    },
  ],
};

export const quickStart = {
  eyebrow: "Quick start",
  headline: "Five commands. One AWS account.",
  lede: "Real infrastructure, not a hand-wave. Clone, configure, deploy — in your account. Full setup steps and backend options live in the docs.",
  ctaLabel: "Full getting started",
  ctaHref: external.quickStartDocs,
  commands: [
    { n: "01", text: "npm install -g thinkwork-cli" },
    { n: "02", text: "thinkwork login" },
    { n: "03", text: "thinkwork init -s dev" },
    { n: "04", text: "thinkwork deploy -s dev" },
    { n: "05", text: "thinkwork doctor -s dev" },
  ],
};

export const finalCta = {
  eyebrow: "Your AWS · Your rules",
  headlinePart1: "Adopt AI.",
  headlineAccent: "Keep control.",
  lede: "Deploy into the account your ops team already runs. Every agent, thread, cost event, and memory stays inside the IAM and governance your ops team already enforces.",
  points: [
    { title: "Runtime", desc: "Stays in your AWS." },
    { title: "Data", desc: "Stays in your account." },
    { title: "Audit trail", desc: "Stays inspectable." },
    { title: "Memory", desc: "Stays portable." },
    { title: "Harness", desc: "Stays yours." },
  ],
  primaryCta: { label: "Read the docs", href: external.docs },
  secondaryCta: { label: "View on GitHub", href: external.github },
};

// Plan catalog pulled from the shared workspace package so the mobile app
// renders the exact same plans without duplication. Don't edit plan data
// here — change it in packages/pricing-config/src/plans.ts and it ripples
// to both surfaces.
import { plans as sharedPlans } from "@thinkwork/pricing-config";

// /cloud page — ThinkWork Cloud is the hosted-plans product surface. Managed
// deployments inside the customer's own AWS boundary — we operate the runtime,
// they own the account. Export name stays `pricing` for now to avoid transient
// breakage while pricing.astro still imports from it; the file is deleted in
// the same PR, and any rename can happen in a follow-up sweep.
export const pricing = {
  meta: {
    title: "ThinkWork Cloud — Hosted agent plans in your AWS boundary.",
    description:
      "Managed ThinkWork deployments inside your own AWS account. Plans for teams adopting governed AI work — visible workflows, durable memory, and evaluations that scale with usage.",
  },
  eyebrow: "ThinkWork Cloud",
  headline: "Hosted agent infrastructure,",
  headlineAccent: "deployed inside your AWS.",
  lede:
    "Managed plans for teams adopting governed AI work. Every plan deploys into the AWS account your team already operates — ThinkWork runs the runtime, you own the boundary.",
  clarifier: [
    "This page covers hosted ThinkWork Cloud plans.",
    "Services (strategy, launch, operations, advisory) are separate — see Services.",
    "AWS usage (Bedrock, Aurora, CloudFront) is billed separately to your account.",
    "Self-hosted deployment remains available through the open-source docs.",
  ],
  plans: sharedPlans,
  smallPrint: [
    "Every plan deploys into your AWS account; we never operate shared infrastructure.",
    "Charged in USD, billed monthly. Annual contracts available on Enterprise.",
    "Prices exclude AWS usage (Bedrock, Aurora, CloudFront) and Stripe processing fees.",
  ],
  finePrint:
    "Final pricing confirmed during checkout. Contact us for procurement, security review, or annual billing.",
  servicesCrossLink: {
    prompt: "Need help launching workflows, governance, or rollout?",
    linkLabel: "See Services",
    href: "/services",
  },
};

// Services page. Peer of /cloud — productized delivery (strategy, launch,
// ops, expansion, governance, advisory), not hosted-plan shapes. Contact is
// mailto-only; subject lines route inbound by package so the services mailbox
// can triage without a form. Cross-linking Services → Cloud is expected
// (Cloud Hosting card); the older "do not cross-link" rule was written when
// /pricing was a generic subscription page and has been superseded by the
// 2026-04-24 Cloud/Services IA split.
export const servicesContactEmail = "hello@thinkwork.ai";

export type ServicesMailto = {
  label: string;
  mailtoSubject: string;
};

export type ServicePackage = {
  id: string;
  name: string;
  type: "Fixed-fee" | "Ongoing operations";
  timeline: string;
  oneLiner: string;
  body: string;
  includes: string[];
  outcome: string;
  bestFor: string;
  variant: "featured" | "secondary";
};

export const services = {
  meta: {
    title: "ThinkWork Services — Pilot to production, governed.",
    description:
      "Productized services for AI adoption: strategy, pilot launch, managed operations, workflow expansion, governance, and program advisory. Delivered on ThinkWork Cloud or into your own deployment.",
  },
  hero: {
    eyebrow: "Services",
    headlinePart1: "First pilot. Full rollout.",
    headlineAccent: "One operating model.",
    headlineOutcome:
      "We help teams launch their first governed AI workflow, then operate and expand it safely.",
    lede:
      "Strategy, launch, and ongoing operations for teams adopting AI — productized services, not open-ended consulting.",
    primaryCta: {
      label: "Scope a pilot",
      mailtoSubject: "ThinkWork Services — scope a pilot",
    } satisfies ServicesMailto,
    secondaryCta: {
      label: "See service packages",
      href: "#packages",
    },
  },
  proof: {
    eyebrow: "Platform and posture",
    items: [
      {
        label: "AWS Bedrock AgentCore",
        detail: "Native agent execution with Bedrock's governance primitives — not hand-rolled orchestration.",
      },
      {
        label: "Per-tenant Cognito + IAM",
        detail: "Identity isolation enforced at the AWS layer, not in application glue.",
      },
      {
        label: "Full audit + evaluation log",
        detail: "Every agent run, tool call, and evaluation result retained for QA and compliance review.",
      },
      {
        label: "Cloud or self-hosted",
        detail: "Same platform either way — hosted by us or inside your own AWS account.",
      },
    ] as Array<{ label: string; detail?: string }>,
  },
  positioning: {
    headline: "One partner across the full adoption arc.",
    body:
      "Scoping, launch, managed operations, workflow expansion, governance, and program advisory — packaged as fixed-fee engagements and ongoing operational support rather than billable hours. The shape of the engagement is named up front; the scope doesn't drift.",
    startingPointsLabel: "Common starting points",
    startingPoints: [
      {
        title: "Support and triage",
        body: "Inbox, ticket routing, and first-response automation anchored in the workflows your team already runs.",
      },
      {
        title: "Approvals and internal ops",
        body: "Multi-step approval chains and operational handoffs with human gates kept exactly where they matter.",
      },
      {
        title: "Reporting and automation",
        body: "Scheduled reports, cross-system data stitching, and recurring workflows that replace manual pulls.",
      },
      {
        title: "Connector-driven task flows",
        body: "Agents that act through Slack, GitHub, and Google Workspace — not just chat about them.",
      },
    ],
  },
  how: {
    eyebrow: "Engagement lifecycle",
    headline: "Four phases. One engagement arc.",
    lede:
      "Scope, launch, expand, operate — in that order. Each phase has a defined shape and a defined exit. Later phases compound the earlier ones; they don't replace them.",
    steps: [
      {
        n: "01",
        title: "Scope the first win",
        body:
          "One workflow, one team, one set of controls. Success metrics, ownership, and governance model named before any code lands.",
      },
      {
        n: "02",
        title: "Launch the pilot",
        body:
          "The first assistant or workflow, live in production. Templates, connectors, and evaluations configured. Visible output in days, not quarters.",
      },
      {
        n: "03",
        title: "Expand safely",
        body:
          "Workflows, connectors, and templates added as trust grows. The governance model stays constant; surface area expands beneath it.",
      },
      {
        n: "04",
        title: "Run and improve",
        body:
          "Ongoing platform support, optimization, and governance review. A steady operating cadence — no quarterly restarts, no re-onboarding.",
      },
    ],
  },
  packages: {
    eyebrow: "Service packages",
    headline: "Fixed-fee launches. Ongoing operations.",
    lede:
      "Every package scoped up front — no billable hours, no open meter, no drift from the engagement shape we agreed to.",
    secondaryHeadline: "Additional packages",
    secondaryLede:
      "Ongoing governance and program-level support for teams that have moved past the first workflow.",
    items: [
      {
        id: "strategy-sprint",
        name: "AI Adoption Strategy Sprint",
        type: "Fixed-fee",
        timeline: "2 weeks",
        oneLiner: "The first workflow, the first metric, the first rollout plan.",
        body:
          "A focused strategy engagement that ends with a chosen starting point, a governance model, and a 30/60/90 rollout plan.",
        includes: [
          "Use case and workflow selection",
          "Governance and controls model",
          "Pilot success metrics",
          "30/60/90 rollout plan",
        ],
        outcome:
          "A named first workflow, a governance model, and a rollout plan — decisions made, not a deck.",
        bestFor: "Teams at the beginning.",
        variant: "featured",
      },
      {
        id: "pilot-launch",
        name: "ThinkWork Pilot Launch",
        type: "Fixed-fee",
        timeline: "4–6 weeks",
        oneLiner: "The first governed workflow, live in production.",
        body:
          "Environment setup, first workflow, templates, connectors, and evaluations — shipped on Cloud or self-hosted.",
        includes: [
          "Environment setup (Cloud or self-hosted)",
          "First assistant or workflow",
          "Templates, controls, and connectors",
          "Launch and handoff",
        ],
        outcome:
          "One governed workflow in production, with its first success metrics tracked.",
        bestFor: "Teams ready to move from planning to execution.",
        variant: "featured",
      },
      {
        id: "managed-ops",
        name: "Managed ThinkWork Operations",
        type: "Ongoing operations",
        timeline: "Ongoing",
        oneLiner: "Ongoing operations for a production ThinkWork deployment.",
        body:
          "Recurring support that keeps the platform healthy and governed — without building an in-house platform team on day one.",
        includes: [
          "Environment health and issue triage",
          "Admin, configuration, and upgrade support",
          "Operations review on a regular cadence",
        ],
        outcome:
          "A production deployment that stays current, audited, and operational — without a dedicated in-house platform team.",
        bestFor: "Teams running ThinkWork in production without dedicated platform ops.",
        variant: "featured",
      },
      {
        id: "workflow-expansion",
        name: "Workflow Expansion Support",
        type: "Ongoing operations",
        timeline: "Ongoing",
        oneLiner: "The next wave of workflows, shipped on a cadence.",
        body:
          "Recurring delivery of new assistants, workflows, connectors, and templates as the organization earns trust in earlier ones.",
        includes: [
          "New workflows on a regular cadence",
          "Connector rollout and template updates",
          "Backlog prioritization and cross-team rollout",
        ],
        outcome:
          "A steady cadence of new governed workflows shipping on top of your existing deployment.",
        bestFor: "Teams with early traction that want to keep shipping.",
        variant: "featured",
      },
      {
        id: "governance-eval",
        name: "Governance & Evaluation Support",
        type: "Ongoing operations",
        timeline: "Ongoing",
        oneLiner: "Governance that evolves with usage.",
        body:
          "Evaluation tuning, guardrail updates, incident review, and audit support — so quality and safety scale with adoption.",
        includes: [
          "Evaluation tuning and guardrail updates",
          "Incident review and audit support",
          "Policy refinement as usage grows",
        ],
        outcome:
          "Controls that keep pace with usage growth, with incident and audit coverage maintained.",
        bestFor: "Security-conscious teams and growing deployments.",
        variant: "secondary",
      },
      {
        id: "advisory",
        name: "AI Program Advisory",
        type: "Ongoing operations",
        timeline: "Quarterly cadence",
        oneLiner: "Cross-functional rollout support for leadership.",
        body:
          "Advisory support for adoption sequencing, KPI review, cross-team planning, and executive alignment — above any single pilot.",
        includes: [
          "Adoption roadmap and rollout prioritization",
          "KPI and outcome review",
          "Cross-team planning and leadership check-ins",
        ],
        outcome:
          "A program-level view of adoption — sequencing, KPIs, and cross-team alignment kept visible to leadership.",
        bestFor: "Organizations turning early wins into a broader AI program.",
        variant: "secondary",
      },
    ] satisfies ServicePackage[],
  },
  faq: {
    eyebrow: "FAQ",
    headline: "Common questions.",
    items: [
      {
        q: "How is this different from hiring an AI consultant?",
        a:
          "A consultant delivers a recommendation. ThinkWork services deliver a governed workflow running in production — and optionally, the ongoing operating model that keeps it running.",
      },
      {
        q: "What does the first engagement usually look like?",
        a:
          "Either an AI Adoption Strategy Sprint (for teams still choosing where to start) or a ThinkWork Pilot Launch (for teams ready to ship a first workflow). Both are fixed-fee and time-boxed.",
      },
      {
        q: "Do services cover hosted and self-hosted deployments?",
        a:
          "Both. ThinkWork is open-source; the hosted option is the same platform, just operated by us. Services cover launch, operations, and expansion on either path, and teams can move between them without rewriting workflows.",
      },
      {
        q: "What happens after launch?",
        a:
          "Managed Operations, Workflow Expansion Support, Governance & Evaluation Support, and Program Advisory are all ongoing-operations packages. Scope, cadence, and deliverables are named up front — no billable-hour meter, no end-of-month reconciliation.",
      },
      {
        q: "Can we start small?",
        a:
          "Yes — that's the default shape. Start with one workflow, prove value, expand from there. The governance model stays the same as surface area grows.",
      },
      {
        q: "Do you only work on strategy?",
        a:
          "No. Strategy, deployment, launch, governance, expansion, and ongoing operations are all in scope. The through-line is delivery, not advice.",
      },
    ],
  },
  closingCta: {
    eyebrow: "Start with one workflow",
    headlinePart1: "One workflow, governed.",
    headlineAccent: "Running in production.",
    body:
      "Whether you need help scoping the first pilot or operating ThinkWork as adoption grows, the starting point is an email. Tell us where you are and we'll come back with a shape.",
    primaryCta: {
      label: "Scope a pilot",
      mailtoSubject: "ThinkWork Services — scope a pilot",
    } satisfies ServicesMailto,
  },
};

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

export const nav = [
  { label: "Controls", href: "#controls" },
  { label: "System", href: "#system" },
  { label: "Memory", href: "#memory" },
  { label: "Quick start", href: "#quick-start" },
];

export const meta = {
  title: "ThinkWork — The control plane for governed AI adoption",
  description:
    "Enterprise-grade agent infrastructure with template-level capability grants, per-agent spend budgets, and security and accuracy evals — running inside the AWS account your team already operates.",
};

export const hero = {
  eyebrow: "Governed AI adoption",
  headlinePart1: "The control plane for",
  headlineAccent: "governed AI adoption.",
  lede: "Capability-granted agent templates, per-agent spend budgets, security and accuracy evals, and one admin surface for all of it — running inside the AWS account your team already operates.",
  primaryCta: { label: "Read the docs", href: external.docs },
  secondaryCta: { label: "View on GitHub", href: external.github },
  headlineCandidates: [
    // Locked: first entry is the winner; runner-ups kept for future copy iteration.
    "The control plane for governed AI adoption.",
    "AI adoption, governed from day one.",
    "Agents your security team can sign off on.",
  ],
};

export const proofStrip = [
  {
    label: "Runs in your AWS",
    detail: "Deployed into the account your team already operates. No shared control plane.",
  },
  {
    label: "Capability grants",
    detail: "Template-level control over the tools, models, and knowledge each agent may use.",
  },
  {
    label: "Centralized admin",
    detail: "One surface for agents, templates, budgets, evals, memory, and audit.",
  },
  {
    label: "Spend budgets",
    detail: "Real-time cost attribution per agent and model, with hard caps.",
  },
  {
    label: "Security + accuracy evals",
    detail: "Automated gates on every template change, powered by AWS Bedrock AgentCore.",
  },
];

export const adoption = {
  eyebrow: "The third option",
  headline:
    "You shouldn't have to choose between banning AI and betting the company on it.",
  lede: "Most organizations are being pushed toward one of two bad options: block agentic AI entirely and watch it happen through back channels anyway, or adopt it faster than the controls can keep up. ThinkWork is the third option — an agent platform designed so your security, cost, and audit teams can sign off on it from day one.",
  bullets: [
    "Not a SaaS control plane you have to trust. Your runtime, your network, your data.",
    "Not a policy document. Controls are enforced in code, on every run.",
    "Not a pilot that can't scale. The same harness a developer spins up in five commands is what an enterprise runs in production.",
  ],
};

export const controls = {
  eyebrow: "Five controls",
  headline: "The guardrails your adoption review already requires.",
  lede: "Every control a skeptical CTO expects to see before approving a rollout — shipped as first-class primitives, not add-ons.",
  items: [
    {
      title: "Runs in your AWS",
      desc: "The runtime deploys into the account your team already operates. Your data, IAM, and network boundaries stay yours.",
      icon: "aws",
    },
    {
      title: "Capability-granted templates",
      desc: "Templates pin the model, allow-list tools, attach guardrails, and gate knowledge access. Agents inherit the boundary.",
      icon: "templates",
    },
    {
      title: "Centralized management",
      desc: "One admin surface for agents, templates, budgets, evals, memory, and audit — no fragmented toolchain.",
      icon: "admin",
    },
    {
      title: "Cost control and analysis",
      desc: "Real-time cost events per agent and model. Budgets cap spend before a runaway loop becomes an invoice.",
      icon: "cost",
    },
    {
      title: "Security + accuracy evals",
      desc: "Automated gates on every template change — AWS Bedrock AgentCore evaluators plus custom assertions.",
      icon: "evals",
    },
  ],
};

export const agentTemplates = {
  eyebrow: "Templates",
  headline: "You decide what each agent is allowed to do.",
  lede: "Agent templates are the contract between a policy decision and the agents that enforce it. Define a template once and every agent created from it inherits the boundary.",
  bullets: [
    "Allow-list the tools and MCP servers each template can call.",
    "Pin the model. Override only when explicitly permitted.",
    "Attach guardrails by reference so policy changes propagate.",
    "Scope knowledge bases to the templates that should see them.",
  ],
  caption: "Admin web · agent-templates editor",
  imagePath: "/images/admin/agent-templates.png",
};

export const costControl = {
  eyebrow: "Cost",
  headline: "No surprise invoices from a runaway agent.",
  lede: "Every model call emits a cost event tagged by tenant, agent, and model. Attribution is real-time. Budgets are enforced before the loop runs away.",
  bullets: [
    "Per-agent, per-model, and per-tenant cost attribution — no after-the-fact guessing.",
    "30-day rolling spend charts for every agent.",
    "Hard budgets that pause an agent before a loop becomes an invoice.",
    "Raw cost events exportable to your own FinOps system.",
  ],
  caption: "Admin web · analytics · cost view",
  imagePath: "/images/admin/cost-analytics.png",
};

export const evals = {
  eyebrow: "Evals",
  headline: "Security and accuracy, gated automatically.",
  lede: "Evaluations run on every template change. AWS Bedrock AgentCore ships sixteen built-in evaluators — tool safety, helpfulness, accuracy, hallucination, and more — and ThinkWork runs them alongside your custom assertions in one pass.",
  bullets: [
    "AWS Bedrock AgentCore built-in evaluators for safety and accuracy.",
    "Custom deterministic assertions — regex, equals, contains, JSON path.",
    "Red-team, tool-safety, and knowledge-base eval packs out of the box.",
    "Per-template pass rates and per-test evaluator scores, archived per run.",
  ],
  caption: "Admin web · evaluations · run detail",
  imagePath: "/images/admin/evals-run.png",
};

export const systemModel = {
  eyebrow: "One admin surface",
  headline: "Agents, templates, cost, evals, memory — one control plane.",
  lede: "Four primitives, one surface wrapping them. Simple enough to explain to a board, strict enough to ship against.",
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
  eyebrow: "End-user app",
  headline: "Your users get a real mobile app.",
  lede: "The operator story lives in the admin web. The user story lives in a native-feeling iOS app built on the same threads, agents, and connectors the rest of the system uses.",
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
      desc: "Webhook events, agent turns, and status changes land on-device within seconds over AppSync. No pull-to-refresh dance.",
    },
    {
      title: "On TestFlight today",
      desc: "iOS first, live for early users. The Expo codebase is cross-platform; Android ships when the iOS shape is stable.",
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
  headlinePart1: "The harness stays",
  headlineAccent: "yours.",
  lede: "Deploy a governed, production-grade agent system inside the AWS account your team already runs. Keep the runtime. Keep the memory. Keep the work record.",
  primaryCta: { label: "Read the docs", href: external.docs },
  secondaryCta: { label: "View on GitHub", href: external.github },
};

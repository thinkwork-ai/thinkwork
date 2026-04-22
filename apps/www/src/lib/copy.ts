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
  { label: "Journey", href: "#journey" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Governance", href: "#controls" },
  { label: "Ownership", href: "#ownership" },
  { label: "Quick start", href: "#quick-start" },
];

export const meta = {
  title: "ThinkWork — Start small. Build trust. Scale AI safely.",
  description:
    "The path from AI experiments to trusted AI work. Visible work, governed expansion, and an AWS deployment boundary you own.",
};

export const hero = {
  eyebrow: "The AI adoption journey",
  headlinePart1: "Start small. Build trust.",
  headlineAccent: "Scale AI safely.",
  lede: "The path from AI experiments to trusted AI work — visible work, governed expansion, and an AWS deployment boundary you own.",
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
    label: "Your AWS account",
    detail: "Runtime, data, audit trail, and memory stay inside your boundary.",
  },
  {
    label: "One system at every scale",
    detail:
      "The runtime a developer spins up in five commands is the runtime production runs on.",
  },
];

export const adoption = {
  eyebrow: "The third option",
  headline:
    "You shouldn't have to choose between banning AI and betting the company on it.",
  lede: "Most organizations are being pushed toward one of two bad options. ThinkWork is the third — a gradual, governed path your security, cost, and audit teams can sign off on from day one.",
  bullets: [
    "Option one — block AI entirely, then watch shadow adoption spread through back channels anyway.",
    "Option two — adopt faster than controls can keep up, without audit trail, ownership, or cost attribution.",
    "Option three — adopt AI gradually, prove value early, and expand safely as trust grows.",
  ],
};

export const journey = {
  eyebrow: "The AI adoption journey",
  headline: "A practical path to AI adoption.",
  lede: "Start with one useful assistant in one real workflow. Keep every action visible in threads. Carry context forward with memory. Enforce boundaries with templates, budgets, and evaluations. Expand the role of AI as trust grows — without changing the governance model underneath.",
  steps: [
    {
      n: "01",
      title: "Start with small wins",
      lede: "Begin with one assistant, one workflow, one team. Not full autonomy, not a moonshot — useful work like triaging inbound requests, drafting responses, summarizing work, routing tasks, or assisting inside a defined process.",
    },
    {
      n: "02",
      title: "Build trust through visible work",
      lede: "Every action runs inside a thread with history, attribution, and audit. Memory carries context forward. Templates define what each agent can access and do. Budgets and evaluations keep adoption grounded.",
    },
    {
      n: "03",
      title: "Expand as confidence grows",
      lede: "As teams see reliable results, assistants take on more responsibility, more system access, and bigger workflows — without changing the governance model.",
    },
    {
      n: "04",
      title: "Keep the harness yours",
      lede: "As AI becomes more important, the boundary matters more. Your runtime, data, audit trail, and memory stay inside the AWS account your team already operates.",
    },
  ],
};

export const howItWorks = {
  eyebrow: "How ThinkWork works",
  headline: "Four primitives, one system.",
  lede: "Threads, memory, templates, and controls — built into the runtime, not bolted on later. Each primitive is a named surface your team can inspect, govern, and expand.",
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
      title: "Templates",
      oneLiner: "Templates enforce boundaries.",
      detail:
        "You decide what each agent is allowed to do — which tools, models, and knowledge it can use. Agents inherit that boundary.",
      href: "#templates",
    },
    {
      title: "Controls",
      oneLiner: "Controls make adoption governable.",
      detail:
        "Budgets, guardrails, evaluations, and audit trails keep AI accountable as usage grows.",
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
      desc: "The runtime deploys into the account your team already operates. Your data, IAM, and network boundaries stay yours.",
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
  lede: "Agent templates are the contract between a policy decision and the agents that enforce it. Define a template once and every agent created from it inherits the boundary.",
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

export const ownership = {
  eyebrow: "Ownership",
  headline: "Keep the harness yours.",
  lede: "ThinkWork deploys into the AWS account your team already operates. As AI becomes part of operations, your runtime, data, audit trail, and memory stay inside the boundary your ops team already enforces.",
  points: [
    { title: "Runtime", desc: "Stays in your AWS account." },
    { title: "Data", desc: "Stays in your boundary." },
    { title: "Audit trail", desc: "Stays inspectable." },
    { title: "Memory", desc: "Stays portable." },
    { title: "Harness", desc: "Stays yours." },
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
  lede: "Deploy into the AWS account your team already operates. Every agent, thread, cost event, and memory stays inside your boundary — under the IAM and governance your ops team already enforces.",
  primaryCta: { label: "Read the docs", href: external.docs },
  secondaryCta: { label: "View on GitHub", href: external.github },
};

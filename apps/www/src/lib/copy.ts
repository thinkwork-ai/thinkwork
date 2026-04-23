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
  { label: "Pricing", href: "/pricing" },
  { label: "Quick start", href: "#quick-start" },
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

export const pricing = {
  meta: {
    title: "ThinkWork pricing — Agent infrastructure in your AWS.",
    description:
      "Plans for teams adopting AI work inside their own AWS boundary — visible workflows, governed expansion, durable memory, and evaluations that scale with usage.",
  },
  eyebrow: "Pricing",
  headline: "Infrastructure you own.",
  headlineAccent: "Plans that scale with usage.",
  lede:
    "Every plan ships the same AWS-native runtime. Deployment boundary stays inside the account your team already operates. Pick a plan by the shape of your operation — not by the capabilities you're allowed to use.",
  plans: sharedPlans,
  smallPrint: [
    "Every plan deploys into your AWS account; we never operate shared infrastructure.",
    "Charged in USD, billed monthly. Annual contracts available on Enterprise.",
    "Prices exclude AWS usage (Bedrock, Aurora, CloudFront) and Stripe processing fees.",
  ],
  finePrint:
    "Final pricing confirmed during checkout. Contact us for procurement, security review, or annual billing.",
};

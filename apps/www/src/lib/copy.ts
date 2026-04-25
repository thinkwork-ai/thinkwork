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
  title: "ThinkWork — Agent Harness for Business",
  description:
    "Infrastructure to run AI agents in production: threads, memory, tools, sandboxes, cost controls, and audit trails. Use the open-source platform yourself or run on ThinkWork Cloud.",
};

export const hero = {
  eyebrow: "Agent Harness for Business",
  headlinePart1: "The runtime",
  headlinePart2: "for",
  headlineAccentPart1: "AI agents",
  headlineAccentPart2: "at work.",
  // Per the 2026-04-25 messaging-feedback memo: when "Agent Harness" is
  // introduced early, follow it with a teaching line so readers do not have
  // to know the category coming in. The lede names the runtime pieces first,
  // then explains the operating model.
  lede: "ThinkWork gives teams the infrastructure to run AI agents in production: threads, memory, tools, sandboxes, cost controls, and audit trails. Use the open-source platform yourself or run on ThinkWork Cloud.",
  primaryCta: { label: "Read the docs", href: external.docs },
  secondaryCta: { label: "View on GitHub", href: external.github },
  headlineCandidates: [
    // Locked: first entry is the winner; runner-ups kept for future copy iteration.
    "Production AI work, under your control.",
    "The open Agent Harness, for Business.",
    "Agent Harness for Business — open or operated.",
    "Production agents, on the AWS account you own.",
  ],
  ledeCandidates: [
    // Locked: first entry is the winner; runner-ups kept for future copy iteration.
    "Models need more than prompts. ThinkWork adds the runtime: threads, memory, sandboxing, tools, controls, cost, and audit. Self-host it, run it with us, or add services.",
    "ThinkWork is the open Agent Harness — Reliability, Efficiency, Security, and Traceability built into the runtime, not bolted on. Self-host on your AWS, run it with us, or wrap it with services.",
    "An Agent Harness for Business: threads, memory, agents, connectors, automations, and control wired into one production-grade system, deployable into the AWS account your team already runs.",
    "The open Agent Harness for Business — production AI work that stays inside your AWS boundary, with the option to have us operate it or wrap it with services.",
  ],
};

// Outcome-speak labels per the 2026-04-25 messaging-feedback steering memo.
// The four pillars are still Reliability, Efficiency, Security, Traceability,
// but the homepage strip leads with what those mean for the reader (recovery,
// cost visibility, capability gating, end-to-end traces) rather than the
// framework-speak labels. Docs may still reference the four guarantees by
// name; marketing surfaces lead with the consequence.
export const proofStrip = [
  {
    label: "Recoverable by design",
    detail:
      "Checkpoints, idempotent writes, retries — the harness recovers a turn from where it stopped, not where it started over.",
  },
  {
    label: "Cost stays visible",
    detail:
      "Token budgets, per-agent spend caps, and cost attached to the turn that produced it — no monthly invoice surprises.",
  },
  {
    label: "Capability-gated",
    detail:
      "Approved tools per template, sandboxed execution on AgentCore, prompt-injection and PII filtering at the I/O boundary.",
  },
  {
    label: "Traceable every turn",
    detail:
      "Every model call, every tool call, every guardrail decision — recorded against the thread that triggered it.",
  },
];

// The four-step rollout-path component (rendered by AdoptionJourney.astro
// pending a future RolloutPath.astro rename — internal-only naming, no
// product impact). Replaces the prior "AI adoption journey" framing per
// docs/STYLE.md (banned: "journey").
export const journey = {
  eyebrow: "The rollout path",
  headline: "Deploy. Prove. Expand. Operate.",
  lede: "ThinkWork ships the production controls first. Start with one workflow, prove the agent's work in threads and evaluations, then expand without changing the runtime underneath.",
  steps: [
    {
      n: "01",
      title: "Deploy",
      lede: "Self-host the open platform or start in ThinkWork Cloud.",
    },
    {
      n: "02",
      title: "Prove",
      lede: "Every turn carries its thread, cost, tools, outputs, and evaluations.",
    },
    {
      n: "03",
      title: "Expand",
      lede: "Add agents, workflows, connectors, and memory as confidence grows.",
    },
    {
      n: "04",
      title: "Operate",
      lede: "Keep running on the same platform: open source, Cloud, or Enterprise.",
    },
  ],
};

export const howItWorks = {
  eyebrow: "Inside the harness",
  headline: "Four primitives. One agent harness.",
  // The 4-primitive view (Threads / Memory / Sandbox / Controls) is the
  // homepage mental model — what makes the harness understandable in one
  // glance. The 6-component view (adding Agents + Connectors + Automations)
  // is the docs system model. Per the 2026-04-25 messaging-feedback memo,
  // bridge the two so readers know they can move between views without
  // surprise: "Four primitives explain the harness. Six components
  // implement it."
  lede: "Four primitives explain the harness; six components implement it. Threads, memory, sandbox, and controls are the engineered mechanisms that turn raw model output into reliable, traceable, auditable agent work — and Agents, Connectors, and Automations are the surfaces that wire them together. Same harness either way.",
  primitives: [
    {
      title: "Threads",
      oneLiner: "The harness's perception and history layer.",
      detail:
        "Every request, every tool call, every outcome lands in one durable record. Per-thread, per-agent, per-tenant — the trace the harness reasons over and the audit a reviewer reads.",
      href: "#audit",
    },
    {
      title: "Memory",
      oneLiner: "The harness's context-management layer.",
      detail:
        "Agents stop starting from zero. The harness carries useful context, decisions, and knowledge across threads, teams, and time — under your IAM, in your account, on a contract you can swap engines under.",
      href: "#memory",
    },
    {
      title: "Sandbox",
      oneLiner: "Deterministic execution for non-deterministic plans.",
      detail:
        "Per-turn isolated execution on AWS Bedrock AgentCore for code, transforms, API stitching, and CLI calls — tenant-scoped, capability-gated, and traced alongside every other turn.",
      href: "",
    },
    {
      title: "Controls",
      oneLiner: "Governance enforced in code, not policy documents.",
      detail:
        "Templates contract each agent to an approved tool set, models, and knowledge. Budgets, guardrails, evaluations, and audit travel with every turn — Reliability, Efficiency, Security, and Traceability built in, not bolted on.",
      href: "#controls",
    },
  ],
};

// The five governance controls below map 1:N to the four operating
// guarantees (Reliability · Efficiency · Security · Traceability). The
// chip-label on each card carries the guarantee(s) the control implements;
// FiveControls.astro renders these as small uppercase tags. Mapping is
// locked in plan U1 pre-flight and consumed verbatim by
// docs/concepts/control.mdx (U8).
export const controls = {
  eyebrow: "Four operating guarantees",
  headline: "Reliability, efficiency, security, and traceability — built into every agent run.",
  lede: "These guarantees are not aspirations. ThinkWork implements them as concrete controls across the runtime: deployment boundary, approved capabilities, management surface, cost controls, and evaluations.",
  items: [
    {
      title: "Open or hosted",
      desc: "Self-host the open-source platform in your AWS or run on ThinkWork Cloud. The operating model changes; the controls stay recognizable.",
      icon: "aws",
      guarantee: "Security · Traceability",
    },
    {
      title: "Approved agent capabilities",
      desc: "Each agent inherits an approved set of tools, models, and knowledge from its template — policy becomes code, not paperwork.",
      icon: "templates",
      guarantee: "Security · Reliability",
    },
    {
      title: "Centralized management",
      desc: "One admin console for agents, templates, budgets, evaluations, memory, and audit — no fragmented toolchain.",
      icon: "admin",
      guarantee: "Traceability",
    },
    {
      title: "Cost control and analysis",
      desc: "Real-time cost events per agent and model. Budgets cap spend before a runaway loop becomes an invoice.",
      icon: "cost",
      guarantee: "Efficiency",
    },
    {
      title: "Security + accuracy evaluations",
      desc: "Evaluation suite for every template — AWS Bedrock AgentCore evaluators plus custom assertions.",
      icon: "evals",
      guarantee: "Reliability · Security",
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
  eyebrow: "Admin web",
  headline: "One place to operate agents.",
  lede: "Agents, threads, memory, cost, and audit live in one operator surface. The screenshot is the claim.",
  nodes: [
    {
      title: "Threads",
      desc: "The harness's system of record. Every request, action, and outcome lives here.",
    },
    {
      title: "Memory",
      desc: "A portable, harness-owned context layer carrying work forward between threads and agents.",
    },
    {
      title: "Agents",
      desc: "Managed or self-hosted. Both operate inside the same thread, the same controls, the same trace.",
    },
    {
      title: "Connectors",
      desc: "Approved system access — Slack, GitHub, Google Workspace — without the connector becoming the product contract.",
    },
  ],
  controlLabel: "Control",
  controlDetail: "Budgets · Approvals · Guardrails · Audit",
  dashboardCaption: "Admin web · the system running",
};

export const memory = {
  eyebrow: "The durable asset",
  headline: "A memory layer you own, not a vendor's API.",
  lede: "The harness's context layer is the asset that compounds. Every artifact your agents produce is inspectable, exportable, and portable — under your IAM, in your account, on a contract you can swap engines under.",
  memoryPoints: [
    "A harness-owned context layer, not a backend vendor's API.",
    "Portable and inspectable — read it, export it, move it between deployment models.",
    "A stable memory contract above pluggable engines. Hindsight and AgentCore are adapters, not the product.",
  ],
  wikiPoints: [
    "Compounding Memory pages distill conversations into durable, browsable Entity / Topic / Decision pages.",
    "Inspect the graph that links entities, pages, and source threads.",
    "Ship the same view to mobile so end users see what the org has learned.",
  ],
  caption: "Admin web · browse, search, and inspect every memory",
};

export const mobile = {
  eyebrow: "End-user surface",
  headline: "The harness reaches end users, not just operators.",
  lede: "The admin web is the operator surface. The end-user surface is a native iOS app on the same threads, agents, and connectors — live on TestFlight today.",
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
  eyebrow: "Self-host the harness",
  headline: "Five commands. One AWS account.",
  lede: "The open Agent Harness installs into your AWS as Terraform modules. Clone, configure, deploy. If you'd rather we operate it, that's ThinkWork for Business.",
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

// North-star copy block per the 2026-04-25 messaging-feedback memo. The
// closing section earns the page's whole argument in three lines: what
// ThinkWork is, what the harness gives you, and the three doors. Every
// other section is in service of this block.
export const finalCta = {
  eyebrow: "Open · Operated · Enterprise",
  headlinePart1: "Run it yourself,",
  headlineAccent: "or run it with us.",
  lede: "Start with the open harness, use hosted ThinkWork, or add services when a workflow needs launch help.",
  points: [
    { title: "Open", desc: "Self-host in your AWS." },
    { title: "Cloud", desc: "Hosted and operated by us." },
    { title: "Enterprise", desc: "Strategy, launch, and ongoing operations." },
  ],
  primaryCta: { label: "Read the docs", href: external.docs },
  secondaryCta: { label: "View on GitHub", href: external.github },
};

// Cloud-variant FinalCTA. Same shape as `finalCta` so the component can swap
// between them via a prop. /cloud is the hosted/operated path for teams that
// want ThinkWork without running the harness themselves.
export const finalCtaCloud: typeof finalCta = {
  eyebrow: "Hosted · Operated",
  headlinePart1: "Adopt AI.",
  headlineAccent: "We operate the harness for you.",
  lede: "ThinkWork Cloud lets your team use the platform without running it. We operate the runtime end-to-end — governance, evaluations, memory, and audit included.",
  points: [
    { title: "Runtime", desc: "Hosted and operated by us." },
    { title: "Governance", desc: "Built in." },
    { title: "Evaluations", desc: "Run for you on every turn." },
    { title: "Memory", desc: "Durable and exportable." },
    { title: "Audit log", desc: "Always on." },
  ],
  primaryCta: { label: "Read the docs", href: external.docs },
  secondaryCta: { label: "View on GitHub", href: external.github },
};

// Plan catalog pulled from the shared workspace package so the mobile app
// renders the exact same plans without duplication. Don't edit plan data
// here — change it in packages/pricing-config/src/plans.ts and it ripples
// to both surfaces.
import { plans as sharedPlans } from "@thinkwork/pricing-config";

// /cloud page — ThinkWork Cloud is the fully-hosted product surface for
// teams that want to use ThinkWork without operating the Enterprise Agent
// Harness themselves. Self-managed (customer-run AWS deployment) is the
// separate Enterprise product; Services is the separate human-delivered
// engagement surface. Export name stays `pricing` for now to avoid
// transient breakage while the earlier rename settles.
export const pricing = {
  meta: {
    title: "ThinkWork Pricing — Three doors into the Agent Harness for Business.",
    description:
      "Self-host the open Agent Harness on your AWS, run it with us as ThinkWork for Business, or wrap either with ThinkWork Enterprise services. One harness, three deployment models.",
  },
  eyebrow: "Open · Operated · Enterprise",
  headline: "One harness,",
  headlineAccent: "three ways to run it.",
  // Per the 2026-04-25 messaging-feedback memo: every deployment-model
  // page should make explicit that "managed does not mean vendor-hosted"
  // — the For Business operating model deploys into the customer's AWS,
  // we just run it for them. Embed that distinction here so visitors
  // arriving on /cloud read it before scanning the plan grid.
  lede:
    "ThinkWork is the open Agent Harness for Business. Self-host on your AWS for free, run it with us as ThinkWork for Business (managed does not mean vendor-hosted — the runtime still lives in your AWS), or wrap either with ThinkWork Enterprise services. The product is identical across tiers; only who operates it differs. The harness stays yours.",
  plans: sharedPlans,
  smallPrint: [
    "Open — Apache 2.0, self-hosted on your AWS, community-supported. No Stripe. The full harness, no operating partner.",
    "For Business — operated by us, deployed into your AWS account. Charged in USD, billed monthly. Managed does not mean vendor-hosted: data, IAM, and runtime stay in your account.",
    "Enterprise — services tier on top of either path. Sales-led; annual contracts available.",
  ],
  finePrint:
    "For Business pricing confirmed during checkout. Contact us for procurement, security review, or annual billing.",
  servicesCrossLink: {
    prompt: "Need help scoping a pilot or operating the harness?",
    linkLabel: "See Enterprise services",
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
  // Optional CTA. Only the Cloud Hosting card uses this today — all other
  // services intake through the shared hero + closing CTAs. If this field
  // is unset, the card renders without a button (the historical pattern).
  ctaHref?: string;
  ctaLabel?: string;
};

export const services = {
  meta: {
    title: "ThinkWork Enterprise — Services for the Agent Harness for Business",
    description:
      "Strategy, pilot launch, managed operations, and workflow expansion services on top of the Agent Harness — for teams running ThinkWork (open) or ThinkWork for Business (operated).",
  },
  hero: {
    eyebrow: "ThinkWork Enterprise · Services",
    headlinePart1: "Strategy, launch, and operations,",
    headlineAccent: "for the Agent Harness.",
    headlineOutcome:
      "We help teams scope, launch, operate, and expand governed agent workflows on the Agent Harness — whether you self-host or run it with us.",
    primaryCta: {
      label: "Scope a pilot",
      mailtoSubject: "ThinkWork Enterprise — scope a pilot",
    } satisfies ServicesMailto,
    secondaryCta: {
      label: "See service packages",
      href: "#packages",
    },
  },
  proof: {
    eyebrow: "What you get with the harness",
    items: [
      {
        label: "Production-grade Agent Harness",
        detail: "Threads, memory, agents, connectors, automations, and control — wired together, not assembled from parts.",
      },
      {
        label: "AWS Bedrock AgentCore runtime",
        detail: "Sandboxed execution with Bedrock guardrails — not hand-rolled orchestration.",
      },
      {
        label: "Per-tenant Cognito + IAM",
        detail: "Identity isolation enforced at the AWS layer, not in application glue.",
      },
      {
        label: "Full audit + per-turn evaluations",
        detail: "Every turn traced; Reliability, Efficiency, Security, and Traceability evaluators run on the same trace.",
      },
    ] as Array<{ label: string; detail?: string }>,
  },
  positioning: {
    headline: "One partner across the harness — open, operated, or services-led.",
    body:
      "ThinkWork Enterprise is the services tier of the three-tier ladder. Whether you self-host the open Agent Harness on your AWS or run it with us as ThinkWork for Business, Enterprise wraps either model with strategy, launch, and ongoing operations — packaged as fixed-fee engagements, not billable hours. The shape of the engagement is named up front; the scope doesn't drift.",
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
  packages: {
    eyebrow: "Services",
    headline: "Practical help from first workflow to ongoing operations.",
    lede:
      "Every package scoped up front — no billable hours, no open meter, no drift from the engagement shape we agreed to. Each one maps to a phase of the harness's adoption arc and names the components, controls, and operating guarantees it touches.",
    items: [
      {
        id: "strategy-sprint",
        name: "AI Adoption Strategy Sprint",
        type: "Fixed-fee",
        timeline: "2 weeks",
        oneLiner: "The first workflow, the first metric, the first rollout plan.",
        body:
          "A two-week engagement that ends with three concrete artifacts — a named first workflow, a governance model expressed against the harness's five controls, and a 30/60/90 rollout plan. We pick the workflow that pays back fastest, agree on the templates that bound the agent's capability, and choose the success metric that proves it worked. No deck; the output is decisions you can hand to engineering on Monday.",
        includes: [
          "Use case and workflow selection (with discard pile)",
          "Templates + capability grants — Reliability + Security guarantees",
          "Pilot success metric + the dashboard it lands on",
          "30/60/90 rollout plan with explicit gates",
          "Risk register: what fails, how we'd notice, who handles it",
        ],
        outcome:
          "A named first workflow, a governance model expressed against the FiveControls, a rollout plan with concrete gates, and a one-page risk register — decisions made, not a deck.",
        bestFor: "Teams at the beginning who'd rather decide than discover.",
      },
      {
        id: "pilot-launch",
        name: "ThinkWork Pilot Launch",
        type: "Fixed-fee",
        timeline: "4–6 weeks",
        oneLiner: "The first governed workflow, live in production.",
        body:
          "Four to six weeks from kickoff to a governed workflow running in production. We stand up the deployment (in your AWS or on ThinkWork for Business), configure templates with model + guardrail pinning, wire the first connector, define the agent system prompt, build evaluations against real expected outcomes, and ship. By week four the agent is doing real work; by week six the audit, cost, and evaluation surfaces are tuned for steady-state operations.",
        includes: [
          "Environment setup — open self-host or ThinkWork for Business",
          "First agent: template + capability grants + system prompt",
          "First connector wired (Slack / GitHub / Google / MCP / Email)",
          "Evaluation suite seeded against real expected outcomes",
          "Cost ledger + per-agent budget tuned to your guardrails",
          "Launch + handoff with operator runbook",
        ],
        outcome:
          "One governed workflow live in production with its evaluation pass-rate tracked, its cost attributed per turn, and an operator runbook your team can drive without us.",
        bestFor: "Teams ready to move from planning to execution.",
      },
      {
        id: "managed-ops",
        name: "Managed ThinkWork Operations",
        type: "Ongoing operations",
        timeline: "Ongoing",
        oneLiner: "Ongoing operations for a production ThinkWork deployment.",
        body:
          "Recurring operations support that keeps the harness healthy, governed, and evaluated without you hiring a platform team on day one. Weekly we triage incidents, tune guardrails against real traffic, refresh evaluations as the workflow's expected outcomes evolve, and apply harness upgrades. Quarterly we review cost trends, spend efficiency, and evaluation drift against the original Reliability + Efficiency targets — and adjust the operating model when the data says we should.",
        includes: [
          "Environment health and incident triage (weekly cadence)",
          "Guardrail tuning + evaluation refresh — Reliability + Security guarantees",
          "Harness upgrades + admin / configuration support",
          "Per-agent cost reviews against budget — Efficiency guarantee",
          "Quarterly operations review with explicit recalibration",
        ],
        outcome:
          "A production deployment that stays current, audited, evaluated, and operational — without a dedicated platform team and without ops drift between releases.",
        bestFor: "Teams running ThinkWork in production without dedicated platform ops.",
      },
      {
        id: "workflow-expansion",
        name: "Workflow Expansion Support",
        type: "Ongoing operations",
        timeline: "Ongoing",
        oneLiner: "The next wave of workflows, shipped on a cadence.",
        body:
          "Recurring delivery of new agents, workflows, connectors, and templates as the organization earns trust in earlier ones. Each cadence ships new agent templates calibrated against the same operating guarantees as the pilot, new connectors wired with the same credential-vault discipline, and new evaluation suites that prove each addition before it touches production traffic. The control model stays constant; the surface area grows beneath it.",
        includes: [
          "New agent templates per cadence — capability grants + guardrails",
          "Connector rollout (Slack / GitHub / Google / MCP / Email)",
          "Template updates + skill-pack additions for fleet reuse",
          "Evaluation suites for each new workflow before launch",
          "Backlog prioritization + cross-team rollout coordination",
        ],
        outcome:
          "A steady cadence of new governed workflows shipping on top of your existing deployment — each one launched against evaluations, audited end-to-end, and traced back to the original control model.",
        bestFor: "Teams with early traction that want to keep shipping without reinventing governance per workflow.",
      },
      {
        id: "cloud-hosting",
        name: "ThinkWork for Business",
        type: "Ongoing operations",
        timeline: "Per plan tier",
        oneLiner: "Same Agent Harness, operated by us — deployed in your AWS.",
        body:
          "The middle door of the three-tier ladder: same harness, same controls, same six components — but you don't operate it. We run the runtime end-to-end inside your AWS account, take ownership of upgrades and incident response, and surface the same admin web your team would have run themselves. The product is identical to the open self-host path; only the operator changes.",
        includes: [
          "Runtime operated by ThinkWork, deployed in your AWS",
          "No AWS / Terraform setup on your side",
          "Managed updates, upgrades, and incident response",
          "Plan tiers that scale with usage",
          "Same admin web, same audit log, same operating guarantees",
        ],
        outcome:
          "ThinkWork running as a managed product — deployed, updated, audited, and governed by us inside your AWS boundary, with the operator-facing surfaces unchanged from the open path.",
        bestFor: "Teams that want the harness, not the operating burden.",
        ctaHref: "/cloud",
        ctaLabel: "View plans",
      },
    ] satisfies ServicePackage[],
  },
  engagementArc: {
    eyebrow: "How an engagement looks",
    headline: "Scope. Launch. Operate. Expand.",
    lede:
      "Most ThinkWork Enterprise engagements run through the same arc — even the ones that start mid-stream. The arc is what keeps the governance model constant while the surface area grows.",
    phases: [
      {
        n: "01",
        title: "Scope (week 1–2)",
        body:
          "An AI Adoption Strategy Sprint, or the discovery phase of a Pilot Launch. We pick one workflow that pays back fastest, agree on the templates that bound the agent's capability, choose the success metric that proves it worked, and write down the risks. No code yet — the output is the contract between you and the harness: which components are involved, which operating guarantees matter most, and what 'done' looks like for the pilot.",
      },
      {
        n: "02",
        title: "Launch (week 3–6)",
        body:
          "A ThinkWork Pilot Launch executes the contract. Environment stands up (open self-host or ThinkWork for Business), the first template is configured with model + guardrail pinning, the first connector wires up, the agent's system prompt is written, evaluations seed against real expected outcomes, and the workflow ships. At handoff your operator can read the audit trail, watch cost per turn, and explain a guardrail decision without us in the room.",
      },
      {
        n: "03",
        title: "Operate (steady state)",
        body:
          "Managed ThinkWork Operations — weekly triage, guardrail tuning, evaluation refresh, harness upgrades. Quarterly we review cost trends, evaluation drift, and the operating model itself. The operating guarantees that mattered at scope time are now measured in production: Reliability shows up as agent-paused-on-failure events, Efficiency as cost per turn, Security as guardrail activation rate, Traceability as audit query latency.",
      },
      {
        n: "04",
        title: "Expand (as trust earns it)",
        body:
          "Workflow Expansion Support delivers the second, third, and fourth workflows on a cadence — new templates, new connectors, new evaluation suites — without re-litigating governance per workflow. The control model from phase 1 holds; new agents inherit the same template-level discipline. The harness's job is to make this growth boring; ours is to keep the cadence steady.",
      },
    ],
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
        q: "How does Enterprise relate to ThinkWork (open) and ThinkWork for Business?",
        a:
          "Three doors into the same Agent Harness. ThinkWork is the open Agent Harness — Apache 2.0, self-hosted on your AWS, community-supported. ThinkWork for Business is the same harness operated by us — managed updates, priority support, still deployed inside your AWS. ThinkWork Enterprise (this page) wraps either with strategy, pilot launch, managed operations, and workflow expansion services. Teams move between tiers without rewriting workflows; only the operating model changes.",
      },
      {
        q: "Do services cover both open self-host and ThinkWork for Business?",
        a:
          "Yes. Enterprise services run on top of either deployment model. The harness, threads, memory, agents, connectors, automations, and controls are identical between them — only who operates the runtime differs.",
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
    headlinePart1: "One harness. One workflow.",
    headlineAccent: "Running in production.",
    body:
      "ThinkWork Enterprise is the services tier of the Agent Harness for Business. Whether you self-host the open Agent Harness, run it with us as ThinkWork for Business, or want both wrapped with strategy, launch, and operations — the starting point is an email. Tell us where you are and we'll come back with a shape.",
    primaryCta: {
      label: "Scope a pilot",
      mailtoSubject: "ThinkWork Enterprise — scope a pilot",
    } satisfies ServicesMailto,
  },
};

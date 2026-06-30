import type { ReactNode } from "react";
import { Check } from "lucide-react";

import type {
  EngagementAccount,
  EngagementOpportunityWithLayers,
} from "../data/useTwentyEngagementData";

const agendaItems = [
  {
    time: "0-5 min",
    title: "Introductions & Context Setting",
    description:
      "ThinkWork briefly explains the discovery process and what we are setting up today. No slides - just a quick framing.",
    tags: [{ label: "ThinkWork Facilitates", tone: "cyan" }],
  },
  {
    time: "5-20 min",
    title: "Strategic Pain Point Conversation",
    description:
      "Walk through the top three operational challenges: the things that cost the most time, money, or visibility. We are listening for patterns and leverage points beyond the current project.",
    tags: [{ label: "Open Discussion", tone: "violet" }],
  },
  {
    time: "20-35 min",
    title: "Opportunity Framing",
    description:
      "ThinkWork reflects back what we heard and begins mapping pain points to AI opportunity areas, including an initial hypothesis on where the biggest ROI potential lives.",
    tags: [
      { label: "ThinkWork Facilitates", tone: "cyan" },
      { label: "Open Discussion", tone: "violet" },
    ],
  },
  {
    time: "35-50 min",
    title: "Expert Access Planning",
    description:
      "Identify the two to four subject matter experts whose knowledge is critical to discovery, then agree on how to schedule short, focused follow-up sessions.",
    tags: [{ label: "Deliverable: SME List", tone: "green" }],
  },
  {
    time: "50-60 min",
    title: "Next Steps & Kickoff Alignment",
    description:
      "Confirm the Discovery Kickoff format and audience, then agree on the two to three priority areas to deep-dive with the broader team.",
    tags: [{ label: "Deliverable: Kickoff Brief", tone: "green" }],
  },
] satisfies {
  time: string;
  title: string;
  description: string;
  tags: { label: string; tone: "cyan" | "green" | "violet" }[];
}[];

const painPrompts = [
  {
    label: "Biggest Time Drain",
    prompt:
      "Where does the team spend time on tasks that feel like they should be automated or streamlined?",
  },
  {
    label: "Visibility Gap",
    prompt:
      "Where are decisions made with incomplete information, or where do problems surface too late?",
  },
  {
    label: "Growth Bottleneck",
    prompt:
      "What process or system limits the ability to scale customers, capacity, locations, or service quality?",
  },
];

const processSteps = [
  {
    step: "Step 1 - Now",
    name: "Value Discovery & Alignment",
    description:
      "30-60 min with one or two leaders. Align on pain points, identify SMEs, and set the stage.",
    active: true,
  },
  {
    step: "Step 2 - Next",
    name: "Discovery Kickoff",
    description:
      "90-120 min with the broader team. Deep dive into current state, workflows, and priorities.",
    active: false,
  },
  {
    step: "Step 3",
    name: "Scope of Work & Proposal",
    description:
      "ThinkWork delivers a prioritized roadmap and proposal based on discovery findings.",
    active: false,
  },
  {
    step: "Step 4 - Ongoing",
    name: "KPI Tracker & Measurement",
    description:
      "A shared dashboard tracks initiative progress, outcomes, and ROI over time.",
    active: false,
  },
];

const clientAsks = [
  "Come with the top three operational pain points, even if they are rough or unpolished.",
  "Think about who has the deepest knowledge of each area so we can plan SME conversations.",
  "Be candid about where things are broken, slow, or opaque; we cannot fix what we do not see clearly.",
  "Designate an internal coordinator to help schedule two to four short expert follow-up conversations before kickoff.",
  "No prep materials required - just perspective and 60 minutes.",
];

const sessionOutcomes = [
  "A shared understanding of ThinkWork's discovery methodology and what to expect from each step.",
  "Documented top-three priority pain points reflected back in ThinkWork's own words.",
  "A confirmed SME list: the right people for the right follow-on conversations.",
  "A clear agenda and audience plan for the Discovery Kickoff.",
  "Confidence that the team is aligned before scaling the engagement to the broader organization.",
];

export function ValueAlignmentTool({
  account,
  opportunity,
}: {
  account: EngagementAccount | null;
  opportunity: EngagementOpportunityWithLayers | null;
}) {
  const clientName = account?.company.name ?? "Selected Client";
  const opportunityName = opportunity?.opportunity.name ?? null;

  return (
    <article className="mx-auto max-w-6xl overflow-hidden rounded-lg border border-border bg-slate-50 text-slate-900 shadow-sm">
      <section className="bg-[#0d1b2e] px-6 py-8 text-white sm:px-10 lg:px-14 lg:py-12">
        <div className="flex flex-col gap-8">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-lg border-2 border-white bg-[#0d1b2e]">
              <img
                src="/logo.png"
                alt=""
                className="size-7 object-contain"
                aria-hidden="true"
              />
            </div>
            <div>
              <div className="text-base font-bold tracking-[0.08em] text-white">
                ThinkWork <span className="text-cyan-300">AI</span>
              </div>
              <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Intelligence for Operations
              </div>
            </div>
          </div>

          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/40 bg-cyan-300/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-300">
              <span className="flex size-6 items-center justify-center rounded-full bg-cyan-300 text-xs font-extrabold text-[#0d1b2e]">
                1
              </span>
              Engagement Step 1 of 4
            </div>

            <p className="mt-8 text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">
              Confidential - Pre-Planning
            </p>
            <h1 className="mt-3 max-w-3xl text-4xl font-extrabold leading-tight tracking-normal text-white sm:text-5xl">
              Value Discovery &{" "}
              <span className="text-cyan-300">Alignment Session</span>
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-7 text-slate-300">
              A focused 30-60 minute conversation to align on strategic
              priorities, introduce ThinkWork's discovery process, and set the
              stage for a high-impact kickoff.
            </p>
          </div>

          <dl className="grid gap-5 border-t border-[#1e3a5f] pt-7 sm:grid-cols-2 lg:grid-cols-4">
            <MetaItem label="Client" value={clientName} />
            <MetaItem label="Format" value="30-60 min - 1:1 / 2-Person" />
            <MetaItem
              label="Audience"
              value="Executive Champion + Operations Lead"
            />
            <MetaItem label="Facilitator" value="ThinkWork AI" />
          </dl>

          {opportunityName ? (
            <div className="rounded-md border border-cyan-300/25 bg-cyan-300/10 px-4 py-3 text-sm text-slate-200">
              Opportunity context:{" "}
              <span className="font-semibold text-white">{opportunityName}</span>
            </div>
          ) : null}
        </div>
      </section>

      <div className="mx-auto max-w-4xl px-5 py-10 sm:px-8 lg:py-14">
        <BriefSection number={1} title="Purpose of This Session">
          <Callout label="Why We're Here">
            This session is not a demo or a sales meeting. It is a working
            conversation - a chance for ThinkWork to listen before we build.
            Before bringing in the broader team, we want the right foundation:
            shared understanding of top priorities, clarity on what success
            looks like, and alignment on who needs to be in the room.
          </Callout>

          <div className="grid gap-4 md:grid-cols-2">
            <SummaryCard
              label="Our Goal Today"
              title="Align on what matters most"
              body="Understand the top challenges beyond the current project, so discovery can be scoped to maximize value."
            />
            <SummaryCard
              label="Your Goal Today"
              title="Shape the engagement"
              body="Tell us what is most painful, who the right experts are, and where AI could make the biggest dent."
            />
          </div>
        </BriefSection>

        <BriefSection number={2} title="Session Agenda">
          <div className="divide-y divide-slate-200">
            {agendaItems.map((item) => (
              <div
                key={item.title}
                className="grid gap-3 py-5 sm:grid-cols-[96px_1fr]"
              >
                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-600">
                  {item.time}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {item.title}
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    {item.description}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.tags.map((tag) => (
                      <span
                        key={tag.label}
                        className={tagClassName(tag.tone)}
                      >
                        {tag.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </BriefSection>

        <BriefSection number={3} title="Your Top 3 - What We Want to Understand">
          <p className="mb-5 text-sm leading-6 text-slate-600">
            Before the meeting, come with three operational challenges top of
            mind: the areas where the team loses the most time, where visibility
            breaks down, or where manual processes limit growth. Raw and real is
            exactly what we are looking for.
          </p>

          <div className="grid gap-4 lg:grid-cols-3">
            {painPrompts.map((item, index) => (
              <article
                key={item.label}
                className="rounded-lg border border-slate-200 bg-white p-5 text-center"
              >
                <div className="mx-auto flex size-10 items-center justify-center rounded-full border-2 border-cyan-400 bg-cyan-50 text-sm font-extrabold text-cyan-600">
                  {index + 1}
                </div>
                <h3 className="mt-3 text-sm font-bold text-slate-900">
                  {item.label}
                </h3>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  {item.prompt}
                </p>
              </article>
            ))}
          </div>

          <Callout label="How We'll Use This" className="mt-5">
            These three inputs anchor the Discovery Kickoff and help focus
            expert conversations on what matters most - not just what is visible
            on the surface.
          </Callout>
        </BriefSection>

        <BriefSection number={4} title="How the ThinkWork Engagement Works">
          <p className="mb-5 text-sm leading-6 text-slate-600">
            Today is Step 1. The full process is designed to move quickly,
            respect the team's time, and deliver a clear, actionable roadmap.
          </p>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="bg-[#0d1b2e] px-4 py-3 text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-300">
              ThinkWork 4-Step Engagement Process
            </div>
            <div className="grid divide-y divide-slate-200 lg:grid-cols-4 lg:divide-x lg:divide-y-0">
              {processSteps.map((item) => (
                <div
                  key={item.step}
                  className={
                    item.active
                      ? "bg-cyan-50 p-4 ring-2 ring-inset ring-cyan-300"
                      : "p-4"
                  }
                >
                  <div
                    className={
                      item.active
                        ? "text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-600"
                        : "text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500"
                    }
                  >
                    {item.step}
                  </div>
                  <h3 className="mt-2 text-sm font-bold leading-5 text-slate-900">
                    {item.name}
                  </h3>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </BriefSection>

        <BriefSection number={5} title="What We Ask of You">
          <OutcomeList items={clientAsks} />
          <Callout label="Our Commitment to You" className="mt-5">
            ThinkWork will come prepared, stay focused, and leave with clear
            next steps. The goal is to make the process feel effortless while
            producing insight that translates directly into business value.
          </Callout>
        </BriefSection>

        <BriefSection number={6} title="What You'll Leave With">
          <OutcomeList items={sessionOutcomes} />
        </BriefSection>
      </div>

      <footer className="bg-[#0d1b2e] px-6 py-5 text-center text-[11px] font-medium tracking-[0.08em] text-slate-500">
        Prepared by{" "}
        <span className="font-semibold text-cyan-300">ThinkWork AI</span> -
        Confidential for {clientName} use only
      </footer>
    </article>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold text-slate-300">{value}</dd>
    </div>
  );
}

function BriefSection({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-10 last:mb-0">
      <div className="mb-5 flex items-center gap-3 rounded-lg bg-[#0d1b2e] px-5 py-3 text-white">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-cyan-300 text-sm font-extrabold text-[#0d1b2e]">
          {number}
        </span>
        <h2 className="text-sm font-bold tracking-[0.04em]">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Callout({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mb-5 rounded-r-lg border-l-4 border-cyan-400 bg-cyan-50 px-5 py-4 ${className}`}
    >
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-600">
        {label}
      </div>
      <p className="mt-2 text-sm leading-7 text-slate-700">{children}</p>
    </div>
  );
}

function SummaryCard({
  label,
  title,
  body,
}: {
  label: string;
  title: string;
  body: string;
}) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </p>
      <h3 className="mt-2 text-base font-bold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
    </article>
  );
}

function OutcomeList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-sm leading-6 text-slate-700">
          <Check className="mt-1 size-4 shrink-0 text-emerald-600" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function tagClassName(tone: "cyan" | "green" | "violet"): string {
  const base =
    "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em]";
  if (tone === "cyan") return `${base} bg-cyan-50 text-cyan-700`;
  if (tone === "green") return `${base} bg-emerald-50 text-emerald-700`;
  return `${base} bg-violet-50 text-violet-700`;
}

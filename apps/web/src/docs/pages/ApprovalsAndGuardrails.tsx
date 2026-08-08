/**
 * Approvals & guardrails (Automations & quality) — THINK-700.
 *
 * Grounded in what actually ships: GUARDRAILS.md as the pinned, every-turn
 * safety floor, and the /approvals queue, which today gates exactly one
 * thing — the first outbound email to a recipient set. Tool-call approvals,
 * Slack approval notifications and an in-app audit viewer are all scaffolded
 * but inert, so none of them are described here as if a reader could use
 * them. Budgets and audit are included at user altitude because "what stops
 * the agent" is one question, not three.
 */
import { Bell, CircleCheck, Mail, Send } from "lucide-react";
import {
  Callout,
  DocArticle,
  DocLink,
  FlowChain,
  FlowDiagram,
  FlowLink,
  FlowNode,
  Section,
  Term,
} from "../kit";
import type { DocTocEntry } from "../registry";

export const APPROVALS_AND_GUARDRAILS_TOC: DocTocEntry[] = [
  { id: "guardrails", title: "Guardrails" },
  { id: "approvals", title: "Approvals" },
  { id: "budgets-and-usage", title: "Budgets and usage" },
  { id: "audit-trail", title: "What gets recorded" },
];

export function ApprovalsAndGuardrails() {
  return (
    <DocArticle
      eyebrow="Automations & quality"
      title="Approvals & guardrails"
      lead="There are two ways to bound what an agent does: rule it out in advance with a guardrail, or route it to a person with an approval. Budgets are the third bound — the one that stops work by cost rather than by kind."
    >
      <Section id="guardrails" title="Guardrails">
        <p>
          Every agent reads a file called <code>GUARDRAILS.md</code> on every
          single turn. It is the safety floor: the rules that apply no matter
          which <Term>space</Term> the work is in, which{" "}
          <DocLink slug="skills">skill</DocLink> is running, or what the
          instructions in front of it say.
        </p>
        <p>The default file ships with the platform and covers six areas:</p>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Area</th>
                <th className="px-3 py-2 font-medium">What it rules out</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Confidentiality
                </td>
                <td className="text-foreground/80">
                  Carrying information across tenant or client boundaries, or
                  answering questions about organisations and people outside the
                  current scope.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Data handling</td>
                <td className="text-foreground/80">
                  Writing secrets, keys or card numbers into memory or thread
                  comments; echoing sensitive input back; keeping health or
                  other special-category personal data in workspace records.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Authorization boundaries
                </td>
                <td className="text-foreground/80">
                  Reaching systems it was not given tools for, using credentials
                  it was not given, and — importantly — treating instructions
                  found inside documents, issue bodies or tool output as
                  authority. It also forbids the agent from rewriting its own
                  rules to loosen them.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Artifact and UX integrity
                </td>
                <td className="text-foreground/80">
                  Rendering credentials into artifacts, putting identifiers or
                  emails into share links, deceptive interfaces, and unbounded
                  loops with no stop condition.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Deployment and release safety
                </td>
                <td className="text-foreground/80">
                  Deploying, publishing or migrating outside the reviewed
                  pipeline — including &ldquo;just this once&rdquo; console or
                  local-CLI shortcuts, which it is told to refuse and redirect.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Human escalation
                </td>
                <td className="text-foreground/80">
                  Guessing on high-consequence uncertainty. Legal, financial and
                  personnel judgement calls go to a person, and the agent is
                  told to escalate the thread rather than fail quietly.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p>
          Two design choices matter more than the contents.{" "}
          <strong>Position:</strong> guardrails are read after the agent&apos;s
          own instructions and its context, and before anything space- or
          user-specific, so nothing further down the stack reads as permission
          to ignore them. <strong>Pinning:</strong> <code>GUARDRAILS.md</code>{" "}
          is the one workspace file that is version-pinned at the moment an
          agent is created. The exact bytes are hashed and kept, so an
          agent&apos;s safety floor cannot shift underneath it when the template
          it was built from moves on.
        </p>

        <Callout tone="note" title="Editing them">
          <p>
            Guardrails are an ordinary workspace file, edited in the workspace
            editor wherever it appears — a Space&apos;s settings, a user&apos;s,
            your own profile. Owners and admins can write; everyone else sees
            them read-only, which is intentional: people should be able to read
            the rules their agents are following. A deeper folder can carry its
            own <code>GUARDRAILS.md</code> to tighten the rules for that branch
            of work, and the nearest one wins.
          </p>
        </Callout>

        <Callout tone="warn" title="Add, don't subtract">
          <p>
            The useful edit is a rule of your own: a system that is off limits,
            a phrase that must never appear in customer-facing text, a threshold
            above which somebody is asked. Deleting a default is almost never
            the right fix for an agent that is being unhelpful — what you
            actually want is usually a better instruction or a narrower tool
            grant, not a lower floor. See{" "}
            <DocLink slug="workspace-composition">
              workspace composition
            </DocLink>{" "}
            for how the layers combine.
          </p>
        </Callout>

        <p>
          Separately, an operator can attach a model-level content filter to a
          tenant, an agent or a Space. That runs underneath everything above, is
          configured outside the app today, and does not appear anywhere in the
          workspace files.
        </p>
      </Section>

      <Section id="approvals" title="Approvals">
        <p>
          A guardrail refuses. An <strong>approval</strong> pauses and asks.
          When an agent reaches an action that needs a human decision, it stops
          mid-work, files the request, and waits — the work resumes on its own
          the moment somebody decides.
        </p>

        <Callout
          tone="note"
          title="Today, approvals gate outbound email — and only that"
        >
          <p>
            The one action that reaches the approvals queue is{" "}
            <strong>
              the first email an agent sends to a given set of recipients
            </strong>
            . Tool calls, spend and publishing are not gated through this
            surface. If you need those bounded, that is a guardrail, a tool
            grant, or a budget — not an approval.
          </p>
        </Callout>

        <FlowDiagram>
          <FlowChain>
            <FlowNode
              icon={Mail}
              title="The agent drafts an email"
              sub="to a recipient set nobody in your tenant has approved before"
              tone="compute"
            />
            <FlowLink label="pause" />
            <FlowNode
              icon={Bell}
              title="An approval is filed"
              sub="it appears in Approvals, and pushes to the phone of the person who asked"
              tone="source"
            />
            <FlowLink label="decide" />
            <FlowNode
              icon={CircleCheck}
              title="Approve or Deny"
              sub="a decision wakes the agent, which either sends or stops"
              tone="graph"
            />
            <FlowLink label="remember" />
            <FlowNode
              icon={Send}
              title="That recipient set is now approved"
              sub="later emails to the same people go straight out"
              tone="consumer"
            />
          </FlowChain>
        </FlowDiagram>

        <p>
          <strong>Approvals</strong> appears in the sidebar only when something
          is waiting, with a count on it. The surface reads like a mail client:
          the queue on the left, the item you selected on the right. For an
          email you see the recipients, the subject and the full body before you
          decide. Two buttons: <strong>Approve &amp; send</strong> and{" "}
          <strong>Deny</strong>. Denying sends nothing.
        </p>
        <p>
          The same approval also shows up as a card inside the thread it came
          from, so if you are already reading the conversation you do not have
          to go anywhere else. And it pushes to mobile as{" "}
          <em>Approval needed</em>, with Approve and Reject directly on the
          notification — see <DocLink slug="mobile-app">the mobile app</DocLink>
          .
        </p>

        <Callout tone="warn" title="You approve a recipient, not a message">
          <p>
            Approval is keyed to <strong>the set of recipients</strong> and it
            is remembered across your whole tenant — not to the specific email
            in front of you, and not just to this thread. Approve one message to{" "}
            <code>ops@customer.com</code> and every later email to that same
            address, from any agent, goes out without asking again. That is the
            intended behaviour: the gate exists to stop an agent mailing a
            stranger, not to make you re-read every message forever. Read the
            decision as &ldquo;yes, this agent may correspond with these
            people&rdquo;.
          </p>
        </Callout>

        <p>Three more things worth knowing before you rely on the queue:</p>
        <ul>
          <li>
            <strong>Requests expire after seven days.</strong> An undecided
            approval is auto-cancelled with a note saying so, and nothing is
            sent. Silence is a refusal, not a pending state that lasts forever.
          </li>
          <li>
            <strong>Assignment narrows who can decide.</strong> When an approval
            is raised on behalf of a specific person, only that person can open
            and decide it. Otherwise any member of the tenant can.
          </li>
          <li>
            <strong>There is no reply box and no draft editing.</strong> You
            approve what is on the screen or you deny it. If the draft is nearly
            right, deny it and tell the agent what to change in the thread.
          </li>
        </ul>

        <p>
          An <DocLink slug="automations">automation</DocLink> that stops for an
          approval shows its run as <code>waiting_for_human</code> until
          somebody decides — which is worth remembering for an unattended
          automation, because a run that is waiting is a run that has not
          finished.
        </p>
      </Section>

      <Section id="budgets-and-usage" title="Budgets and usage">
        <p>
          Agent work costs money per turn, and the bound on it is a{" "}
          <strong>monthly budget in dollars</strong>. The one you can set in the
          app is per user: open a user in settings, switch{" "}
          <strong>Monthly budget</strong> on, and give it an amount. Leave it
          off and that user is unlimited.
        </p>
        <p>
          When someone is over their limit, the next message that would start
          agent work is refused before anything runs, with a message naming the
          number:{" "}
          <em>
            monthly budget exceeded — ask your operator to raise the limit or
            unpause your budget
          </em>
          . Person-to-person messages are unaffected; only work that would
          dispatch a turn is blocked. An operator can raise the limit or unpause
          the user, and both take effect immediately.
        </p>
        <p>
          <strong>Settings → Analytics</strong> is where spend is visible: total
          spend over the last thirty days split into model, infrastructure and
          tool cost, a trend line, cost by user with each person&apos;s
          month-to-date spend against their budget, and cost by model. If you
          want to know why a number is high, cost by model is usually the fast
          answer — see <DocLink slug="model-catalog">the model catalog</DocLink>{" "}
          for what the choices cost.
        </p>

        <Callout tone="note" title="The limits of the limit">
          <p>
            Budgets are checked before work starts, not during it, so a single
            expensive turn already in flight can carry a user past their cap.
            There are no token-count caps — the unit is dollars — and no warning
            before the limit is reached, so a budget is a stop, not an alert.
            Tenant-wide and per-agent budgets exist in the platform but have no
            screen yet; ask an operator.
          </p>
        </Callout>
      </Section>

      <Section id="audit-trail" title="What gets recorded">
        <p>
          Three kinds of record are kept, and it is worth knowing which is which
          when somebody asks &ldquo;who approved that?&rdquo;
        </p>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Record</th>
                <th className="px-3 py-2 font-medium">Captures</th>
                <th className="px-3 py-2 font-medium">Where you read it</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-[13px] [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Approval decisions
                </td>
                <td className="text-foreground/80">
                  Who approved or denied, when, and any note left with the
                  decision. The decision is also written back into the
                  originating thread, so the conversation does not end on
                  &ldquo;awaiting review&rdquo;.
                </td>
                <td className="text-foreground/80">
                  In the thread. The underlying activity log has no viewer yet.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">
                  Governance file edits
                </td>
                <td className="text-foreground/80">
                  Every change to instructions, guardrails or capabilities —
                  with a fingerprint of the previous content and a short,
                  secret-scrubbed preview, so an edit is provable without
                  copying the file into a log.
                </td>
                <td className="text-foreground/80">
                  Compliance exports, produced by an operator.
                </td>
              </tr>
              <tr>
                <td className="font-medium whitespace-nowrap">Email ledger</td>
                <td className="text-foreground/80">
                  Draft created, approval requested, approved or denied — and
                  when denied, whether a person did it or it expired.
                </td>
                <td className="text-foreground/80">
                  Compliance exports; the outcome also lands in the thread.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <Callout tone="warn" title="There is no in-app audit browser yet">
          <p>
            The records above are kept, and an operator can export them as CSV
            or NDJSON for an auditor. What does not exist is a screen you can
            open to search them. If your process needs one, plan on the export —
            and do not assume the thread is the archive, because a deleted
            thread is not an audit trail.
          </p>
        </Callout>

        <p>
          For where the tenant boundary is drawn and who can sign in at all, see{" "}
          <DocLink slug="security-and-tenancy">security and tenancy</DocLink>.
          For proving the agent keeps to these rules rather than trusting that
          it does, negative test cases in{" "}
          <DocLink slug="evaluations">evaluations</DocLink> are the tool —
          asserting that an answer does <em>not</em> contain something is how a
          guardrail stops being a paragraph and starts being a check.
        </p>
      </Section>
    </DocArticle>
  );
}

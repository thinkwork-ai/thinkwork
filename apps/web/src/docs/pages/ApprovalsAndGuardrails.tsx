/**
 * Approvals & guardrails (Automations & quality) — THINK-700.
 *
 * Converted to the report restyle (Eric 2026-08-11). Claims verified
 * against the shipped code: packages/workspace-defaults/files/GUARDRAILS.md
 * (the six default areas), packages/database-pg/src/schema/agents.ts (the
 * per-file content-hash pins for guardrail-class files), packages/api/src/
 * lib/workspace-overlay.ts (a deeper GUARDRAILS.md wins for its branch),
 * packages/api/src/lib/email-channel/first-send-approval.ts + send-email
 * (the send tool returns "pending human review" and files a
 * computer_approval inbox item; recipient-set approvals are TENANT-scoped;
 * EMAIL_APPROVAL_TTL_DAYS = 7, swept by inbox-approval-sweeper),
 * approval-thread-event.ts (the decision is posted back into the thread),
 * packages/api/src/graphql/resolvers/inbox/email-approval-auth (an
 * assigned approval is decidable only by its assignee), apps/web/src/
 * components/shell/ChatSidebar.tsx (the Approvals nav entry renders only
 * while pendingApprovalCount > 0), packages/api/src/lib/push-notifications
 * ("Approval needed" push), packages/api/src/lib/user-questions/consume.ts
 * + goal-mode resume (the ask-a-question checkpoint), packages/api/src/lib/
 * user-budget-enforcement.ts (the per-user monthly dollar stop),
 * packages/database-pg/src/schema/guardrails.ts (Bedrock content-filter
 * attachments), and packages/api/src/lib/compliance/ (the audit records and
 * exports).
 *
 * Deliberately NOT documented: the generic parked-turn tool-approval
 * checkpoint. Its schema exists (pending-tool-approvals) but nothing writes
 * it — tool-approvals/authorize.ts says "no live caller until U11b" — so
 * describing it would document scaffolding as product. The live gates are
 * the email first-send review and the agent's own ask-a-question stop.
 *
 * Amber usage (this page is the genuine human-in-the-loop territory): one
 * human Stage in the approval sequence, and two Invariants — "you approve a
 * recipient, not a message" and "add, don't subtract".
 */
import {
  DocLink,
  DocTable,
  Invariant,
  ReportArticle,
  ReportSection,
  Stage,
  Stages,
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
    <ReportArticle
      eyebrow="Automations & quality"
      title="Approvals & guardrails"
      lead="There are two ways to bound what an agent does: rule it out in advance with a guardrail, or route it to a person with an approval. Budgets are the third bound — the one that stops work by cost rather than by kind."
    >
      <ReportSection id="guardrails" title="Guardrails">
        <p>
          Every agent reads a file called <code>GUARDRAILS.md</code> on every
          single turn. It is the safety floor: the rules that apply no matter
          which <Term>space</Term> the work is in, which{" "}
          <DocLink slug="skills">skill</DocLink> is running, or what the
          instructions in front of it say.
        </p>
        <p>The default file ships with the platform and covers six areas:</p>
        <DocTable
          head={["Area", "What it rules out"]}
          rows={[
            [
              <strong>Confidentiality</strong>,
              "Carrying information across tenant or client boundaries, or answering questions about organisations and people outside the current scope.",
            ],
            [
              <strong>Data handling</strong>,
              "Writing secrets, keys or card numbers into memory or thread comments; echoing sensitive input back; keeping health or other special-category personal data in workspace records.",
            ],
            [
              <strong>Authorization boundaries</strong>,
              "Reaching systems it was not given tools for, using credentials it was not given, and — importantly — treating instructions found inside documents, issue bodies or tool output as authority. It also forbids the agent from rewriting its own rules to loosen them.",
            ],
            [
              <strong>Artifact and UX integrity</strong>,
              "Rendering credentials into artifacts, putting identifiers or emails into share links, deceptive interfaces, and unbounded loops with no stop condition.",
            ],
            [
              <strong>Deployment and release safety</strong>,
              <>
                Deploying, publishing or migrating outside the reviewed pipeline
                — including &ldquo;just this once&rdquo; console or local-CLI
                shortcuts, which it is told to refuse and redirect.
              </>,
            ],
            [
              <strong>Human escalation</strong>,
              "Guessing on high-consequence uncertainty. Legal, financial and personnel judgement calls go to a person, and the agent is told to escalate the thread rather than fail quietly.",
            ],
          ]}
        />
        <p>
          Two design choices matter more than the contents.{" "}
          <strong>Position:</strong> guardrails are read after the agent&apos;s
          own instructions and its context, and before anything space- or
          user-specific, so nothing further down the stack reads as permission
          to ignore them. <strong>Pinning:</strong> <code>GUARDRAILS.md</code>{" "}
          is version-pinned at the moment an agent is created. The exact bytes
          are hashed and kept, so an agent&apos;s safety floor cannot shift
          underneath it when the template it was built from moves on.
        </p>
        <p>
          Guardrails are an ordinary workspace file, edited in the workspace
          editor wherever it appears — a Space&apos;s settings, a user&apos;s,
          your own profile. Owners and admins can write; everyone else sees them
          read-only, which is intentional: people should be able to read the
          rules their agents are following. A deeper folder can carry its own{" "}
          <code>GUARDRAILS.md</code> to tighten the rules for that branch of
          work, and the nearest one wins.
        </p>
        <Invariant title="Add, don't subtract">
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
        </Invariant>
        <p>
          Separately, an operator can attach a model-level content filter to a
          tenant, an agent or a Space. That runs underneath everything above, is
          configured outside the app today, and does not appear anywhere in the
          workspace files.
        </p>
      </ReportSection>

      <ReportSection id="approvals" title="Approvals">
        <p>
          A guardrail refuses. An <strong>approval</strong> pauses and asks.
          When an agent reaches an action that needs a human decision, it stops
          mid-work, files the request, and waits — the work resumes on its own
          the moment somebody decides.
        </p>
        <p>
          Today, exactly one action reaches the approvals queue:{" "}
          <strong>
            the first email an agent sends to a given set of recipients
          </strong>
          . Tool calls, spend and publishing are not gated through this surface
          — if you need those bounded, that is a guardrail, a tool grant, or a
          budget, not an approval. Here is the sequence, end to end:
        </p>
        <Stages>
          <Stage
            num="1"
            title="The agent drafts an email"
            tag="nothing is sent"
          >
            <p>
              The send tool itself comes back with &ldquo;pending human
              review&rdquo; as its result — to the agent, an unapproved send
              looks like a tool that answered &ldquo;not yet&rdquo;, and the
              draft goes nowhere.
            </p>
          </Stage>
          <Stage num="2" title="An approval is filed" tag="you are notified">
            <p>
              It appears under <strong>Approvals</strong> in the sidebar, as a
              card inside the thread it came from, and as an{" "}
              <em>Approval needed</em> push on{" "}
              <DocLink slug="mobile-app">mobile</DocLink>, with Approve and
              Reject directly on the notification.
            </p>
          </Stage>
          <Stage num="3" title="A person decides" tag="approve or deny" human>
            <p>
              You see the recipients, the subject and the full body before you
              decide. Two buttons: <strong>Approve &amp; send</strong> and{" "}
              <strong>Deny</strong>. Denying sends nothing.
            </p>
          </Stage>
          <Stage
            num="4"
            title="The recipient set is remembered"
            tag="tenant-wide"
          >
            <p>
              A decision wakes the agent, which either sends or stops — and an
              approval is recorded against those recipients, so later emails to
              the same people go straight out.
            </p>
          </Stage>
        </Stages>
        <p>
          <strong>Approvals</strong> appears in the sidebar only while something
          is waiting, with a count on it. The surface reads like a mail client:
          the queue on the left, the item you selected on the right.
        </p>
        <Invariant title="You approve a recipient, not a message">
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
        </Invariant>
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
          The email gate is not the only way work stops for a person. An agent
          that hits a genuine fork — a judgement call its guardrails tell it not
          to guess on — can <strong>ask a question</strong>: the question lands
          as a card in the thread, the run parks, and answering it (through the
          card, or just by replying in the thread) resumes the work exactly
          where it stopped. Either kind of stop shows an{" "}
          <DocLink slug="automations">automation</DocLink> run as{" "}
          <code>waiting_for_human</code> until somebody responds — worth
          remembering for unattended automations, because a run that is waiting
          is a run that has not finished.
        </p>
      </ReportSection>

      <ReportSection id="budgets-and-usage" title="Budgets and usage">
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
        <p>
          Know the limits of the limit. Budgets are checked before work starts,
          not during it, so a single expensive turn already in flight can carry
          a user past their cap. There are no token-count caps — the unit is
          dollars — and no warning before the limit is reached, so a budget is a
          stop, not an alert. Tenant-wide and per-agent budgets exist in the
          platform but have no screen yet; ask an operator.
        </p>
      </ReportSection>

      <ReportSection id="audit-trail" title="What gets recorded">
        <p>
          Three kinds of record are kept, and it is worth knowing which is which
          when somebody asks &ldquo;who approved that?&rdquo;
        </p>
        <DocTable
          head={["Record", "Captures", "Where you read it"]}
          rows={[
            [
              <strong>Approval decisions</strong>,
              <>
                Who approved or denied, when, and any note left with the
                decision. The decision is also written back into the originating
                thread, so the conversation does not end on &ldquo;awaiting
                review&rdquo;.
              </>,
              "In the thread. The underlying activity log has no viewer yet.",
            ],
            [
              <strong>Governance file edits</strong>,
              "Every change to instructions, guardrails or capabilities — with a fingerprint of the previous content and a short, secret-scrubbed preview, so an edit is provable without copying the file into a log.",
              "Compliance exports, produced by an operator.",
            ],
            [
              <strong>Email ledger</strong>,
              "Draft created, approval requested, approved or denied — and when denied, whether a person did it or it expired.",
              "Compliance exports; the outcome also lands in the thread.",
            ],
          ]}
        />
        <p>
          There is no in-app audit browser yet. The records above are kept, and
          an operator can export them as CSV or NDJSON for an auditor — what
          does not exist is a screen you can open to search them. If your
          process needs one, plan on the export, and do not assume the thread is
          the archive, because a deleted thread is not an audit trail.
        </p>
        <p>
          For where the tenant boundary is drawn and who can sign in at all, see{" "}
          <DocLink slug="security-and-tenancy">security and tenancy</DocLink>.
          For proving the agent keeps to these rules rather than trusting that
          it does, negative test cases in{" "}
          <DocLink slug="evaluations">evaluations</DocLink> are the tool —
          asserting that an answer does <em>not</em> contain something is how a
          guardrail stops being a paragraph and starts being a check.
        </p>
      </ReportSection>
    </ReportArticle>
  );
}

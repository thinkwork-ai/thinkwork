/**
 * Mobile app (Operations) — THINK-701.
 *
 * One page replacing the six-page mobile subtree in the old Starlight docs.
 * Everything here was re-verified against apps/mobile rather than ported:
 * the tab bar is now Threads + Settings (the old docs' three-tab "Tasks"
 * story is gone), the two integration screens merged into the Credential
 * Locker (app/settings/credentials.tsx), sign-in routes come from
 * /api/auth/options rather than a hardcoded Google button, and the chart
 * inspector (THINK-682/683) is new since those docs were written.
 *
 * EAS channel / build-pipeline detail is deliberately omitted: that is
 * release engineering for the people who ship the app, not product docs.
 */
import {
  BellRing,
  Fingerprint,
  Link2,
  MessageSquare,
  Smartphone,
} from "lucide-react";
import {
  Callout,
  DocArticle,
  DocLink,
  FlowChain,
  FlowChip,
  FlowDiagram,
  FlowLink,
  FlowNode,
  Section,
  Term,
} from "../kit";
import type { DocTocEntry } from "../registry";

export const MOBILE_APP_TOC: DocTocEntry[] = [
  { id: "getting-the-app", title: "Getting the app" },
  { id: "signing-in", title: "Signing in" },
  { id: "what-it-does", title: "Threads and chat" },
  { id: "charts", title: "Charts you can pull apart" },
  { id: "connecting-accounts", title: "Connecting your accounts" },
  { id: "notifications", title: "Notifications" },
];

export function MobileApp() {
  return (
    <DocArticle
      eyebrow="Operations"
      title="Mobile app"
      lead="The mobile app is not a shrunken web app: it is where your personal connector accounts live, and where work reaches you between desks."
    >
      <Section id="getting-the-app" title="Getting the app">
        <p>
          The app is <strong>iOS, distributed through TestFlight</strong>. Your
          operator sends a TestFlight invitation to your work email; accepting
          it installs Apple&apos;s TestFlight app and then ThinkWork Agent
          inside it. There is no App Store listing to search for, and there is
          no Android build yet.
        </p>
        <p>
          Because a <DocLink slug="security-and-tenancy">deployment</DocLink> is
          its own stack with its own URLs, the app has to be pointed at yours.
          Most people never touch this — the build arrives configured — but{" "}
          <strong>Settings → Environments</strong> is where a deployment is
          added or switched if you work across more than one.
        </p>
        <Callout tone="tip" title="Update from inside the app">
          <p>
            Most releases ship as an over-the-air update rather than a new
            TestFlight build. <strong>Settings → Check for Updates</strong>{" "}
            fetches one and installs it on the next launch. If something looks
            wrong after a platform change, that button is the first thing to
            try.
          </p>
        </Callout>
      </Section>

      <Section id="signing-in" title="Signing in">
        <p>
          Sign-in goes through the same{" "}
          <DocLink slug="security-and-tenancy">Cognito pool</DocLink> as the web
          app, and the app asks your deployment which routes it offers rather
          than assuming — so you see the Google button, the Microsoft button, an
          email and password form, or some combination, depending on how your
          stack is configured.
        </p>
        <p>
          Federated sign-in opens a real browser session rather than an in-app
          form, which is what lets iOS fill your saved credentials and lets you
          pick between accounts. After the first success the session is
          refreshed silently, so cold starts land you in your threads rather
          than on the sign-in screen.
        </p>
        <FlowDiagram>
          <FlowChain>
            <FlowNode
              icon={Smartphone}
              title="First sign-in"
              sub="pick a route your deployment publishes"
              tone="consumer"
            >
              <FlowChip>Google</FlowChip>
              <FlowChip>Microsoft</FlowChip>
              <FlowChip>password</FlowChip>
            </FlowNode>
            <FlowLink label="tokens to the keychain" />
            <FlowNode
              icon={Fingerprint}
              title="Every launch after that"
              sub="the session refreshes itself"
              tone="compute"
            >
              <FlowChip>Face ID optional</FlowChip>
            </FlowNode>
          </FlowChain>
        </FlowDiagram>
        <p>
          Turning on <strong>Face ID</strong> (Settings → the biometric toggle)
          adds a lock screen at launch and when the app returns from the
          background. It is a second gate on a phone you already unlocked, not a
          second credential: unlocking reveals the UI and does not re-issue
          anything.
        </p>
        <Callout tone="warn" title="Signing out is global on purpose">
          <p>
            Sign-out clears the stored session for the deployment you are signed
            in to, not just the current screen. That is what you want when you
            hand the phone over or switch accounts — and it means you will go
            through the full sign-in route again next time, including the
            account chooser.
          </p>
        </Callout>
      </Section>

      <Section id="what-it-does" title="Threads and chat">
        <p>
          The app has two tabs: <strong>Threads</strong> and{" "}
          <strong>Settings</strong>. Everything that is work happens in the
          first one.
        </p>
        <p>
          A <Term>thread</Term> on the phone is the same thread as on the web —
          same messages, same history, same live progress, streamed over the
          same subscriptions. Open one on your laptop, keep reading it in a
          taxi. What the composer gives you:
        </p>
        <ul>
          <li>
            <strong>A space picker</strong> — the chip above the input chooses
            which <DocLink slug="spaces">space</DocLink> the next message runs
            in, which is what decides the files, tools and memory the agent has.
          </li>
          <li>
            <strong>Voice dictation</strong> — the microphone transcribes on the
            device and drops text into the input, so you can edit before
            sending.
          </li>
          <li>
            <strong>Quick actions</strong> — your saved one-tap prompts, run
            against the selected space.
          </li>
          <li>
            <strong>A model picker</strong> — visible when more than one model
            has been approved for you. See{" "}
            <DocLink slug="model-catalog">model catalog</DocLink>.
          </li>
        </ul>
        <p>
          When an agent stops to ask for a decision, the request lands in the
          thread rather than in a separate queue: threads waiting on you sort to
          the top and carry a badge, and the confirmation card in the thread
          gives you approve, continue or reject with an optional note. That is
          the same mechanism described in{" "}
          <DocLink slug="approvals-and-guardrails">
            approvals and guardrails
          </DocLink>
          , seen from a phone.
        </p>
        <Callout tone="note" title="Nothing runs on the phone">
          <p>
            The app is a client. Your message is written through the API and the
            turn runs in the deployed runtime, which is why closing the app
            mid-turn loses nothing and why a long-running job finishes whether
            or not you are watching.
          </p>
        </Callout>
      </Section>

      <Section id="charts" title="Charts you can pull apart">
        <p>
          When an agent answers with numbers, it can hand back a chart inline in
          the thread instead of a wall of figures. The card in the timeline is
          deliberately small — a title, the chart, a one-line reading of it.
        </p>
        <p>
          <strong>Tap the card</strong> and it opens into a full-height
          inspector: the chart drawn large and interactive, and the underlying
          data as a table you can read row by row. Bars, lines and donuts get
          the interactive treatment; the shapes that have no interactive
          equivalent — funnels, meters, stat strips — open enlarged with the
          data table already expanded, which is the honest version of the same
          idea.
        </p>
        <p>
          The chart itself is drawn by the same renderer the web app and
          documents use, so a chart you saw on a laptop is the same chart on the
          phone. More on where charts come from in{" "}
          <DocLink slug="charts-and-artifacts">charts &amp; artifacts</DocLink>.
        </p>
      </Section>

      <Section id="connecting-accounts" title="Connecting your accounts">
        <p>
          This is the part of the product that lives on mobile rather than on
          the web. <strong>Settings → Credential Locker</strong> is where{" "}
          <em>your</em> accounts get connected — not the tenant&apos;s.
        </p>
        <FlowDiagram>
          <FlowChain>
            <FlowNode
              icon={Link2}
              title="Credential Locker"
              sub="one screen, two lists"
              tone="consumer"
            >
              <FlowChip>connected accounts</FlowChip>
              <FlowChip>MCP servers</FlowChip>
            </FlowNode>
            <FlowLink label="tap Connect" />
            <FlowNode
              icon={MessageSquare}
              title="Consent in the browser"
              sub="the provider authenticates you, not the app"
              tone="source"
            />
            <FlowLink label="token stored server-side" />
            <FlowNode
              icon={Fingerprint}
              title="Agents act as you"
              sub="only in turns you started"
              tone="compute"
            />
          </FlowChain>
        </FlowDiagram>
        <p>
          The first list is <strong>connected accounts</strong>: Google
          Workspace, Microsoft 365 and the other first-party providers your
          tenant supports. The second is <strong>MCP servers</strong> your
          operator registered that need a personal sign-in. Both work the same
          way — tap the badge, consent in a browser, come back to a green
          status.
        </p>
        <p>
          Status badges are the whole interface: <strong>Connect</strong> means
          you never have, <strong>Active</strong> means you are good, and{" "}
          <strong>Expired</strong> means a refresh failed for real and needs a
          new consent. Tapping an active row offers to disconnect, which removes
          your access only — the tenant&apos;s registration of that provider
          stays.
        </p>
        <Callout tone="warn" title="An operator cannot connect on your behalf">
          <p>
            Operators register <em>which</em> providers exist; the credential is
            always the individual&apos;s. So &ldquo;the agent can&apos;t see my
            calendar&rdquo; is nearly always a Credential Locker problem on your
            own phone, not a settings problem in the web app. The matching
            operator-side concepts are in{" "}
            <DocLink slug="connectors-and-mcp">connectors &amp; MCP</DocLink>.
          </p>
        </Callout>
      </Section>

      <Section id="notifications" title="Notifications">
        <p>
          The app asks for notification permission once, after your first
          sign-in, and registers a push token against your user. From then on
          the platform can reach you when something needs you — a thread waiting
          on an approval, work assigned to you, an agent finishing something you
          asked for.
        </p>
        <FlowDiagram>
          <FlowChain>
            <FlowNode
              icon={BellRing}
              title="A push arrives"
              sub="shown even when the app is open"
              tone="source"
            />
            <FlowLink label="tap, or act in place" />
            <FlowNode
              icon={MessageSquare}
              title="Straight to the thread"
              sub="cold start, background or foreground"
              tone="consumer"
            >
              <FlowChip>Approve</FlowChip>
              <FlowChip>Reject</FlowChip>
            </FlowNode>
          </FlowChain>
        </FlowDiagram>
        <p>
          Approval notifications carry <strong>Approve</strong> and{" "}
          <strong>Reject</strong> actions you can use without opening the app —
          long-press the banner, choose one, and the decision is recorded (iOS
          asks you to authenticate first). Tapping the notification itself
          always opens the thread it is about, whether the app was closed,
          backgrounded, or already on screen.
        </p>
        <Callout tone="note" title="Muting is an iOS setting for now">
          <p>
            There are no per-category push toggles or quiet hours inside the
            app. Use iOS&apos;s own notification settings for ThinkWork Agent if
            you want to quiet it down.
          </p>
        </Callout>
      </Section>
    </DocArticle>
  );
}

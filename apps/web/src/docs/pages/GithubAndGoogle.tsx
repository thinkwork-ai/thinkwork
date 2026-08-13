/**
 * GitHub & Google Workspace (Tools & integrations) — THINK-699.
 *
 * These two names get grouped together in people's heads and they are
 * almost opposites: Google Workspace is the canonical per-user connector,
 * while GitHub is mostly platform-level plumbing with per-user reach
 * arriving through your own GitHub connection or an ordinary MCP connector.
 *
 * Report restyle (2026-08-11). Claims verified against the shipped code:
 * packages/database-pg/src/schema/integrations.ts (connections owned by
 * one user), apps/web/src/components/settings/SettingsConnections.tsx and
 * apps/mobile/components/credentials/IntegrationsSection.tsx (the
 * Connections rows, statuses, Reconnect), packages/api/src/lib/
 * oauth-token.ts (owner-only resolution, expiry marking, quiet failure,
 * GITHUB_ACCESS_TOKEN for the sandbox, buildSkillEnvOverrides binding a
 * wired connection to the agent), packages/api/src/lib/memory-sources/
 * adapters/gmail.ts + resolvers/memory-sources/* (owner-only mail source,
 * content-free evidence rows, encrypted S3 storage, personal automation
 * schedules), packages/api/src/handlers/connections.ts (disconnect =
 * secret deletion, nothing else touched), packages/api/src/handlers/
 * github-app.ts (the App surface: installations + webhook deliveries),
 * and packages/api/src/lib/pi-extensions/github-import.ts (repo + ref
 * extension import for review).
 *
 * Dropped from the pre-restyle page: the claim that the GitHub App keeps
 * agent workspaces under version control with the repo as source of truth
 * — that library (packages/lambda/github-workspace.ts) is retired Code
 * Factory code with no Terraform wiring, and the shipped workspace design
 * (workspace-overlay.ts) makes the S3 prefix the source of truth.
 */
import {
  CardGrid,
  DocLink,
  DocTable,
  InfoCard,
  Invariant,
  ReportArticle,
  ReportSection,
} from "../kit";
import type { DocTocEntry } from "../registry";

export const GITHUB_AND_GOOGLE_TOC: DocTocEntry[] = [
  { id: "per-user-oauth", title: "Why these two are different" },
  { id: "google-workspace", title: "Google Workspace" },
  { id: "microsoft-365", title: "Microsoft 365" },
  { id: "github", title: "GitHub" },
  { id: "expiry", title: "Expiry, reconnecting and revoking" },
];

export function GithubAndGoogle() {
  return (
    <ReportArticle
      eyebrow="Tools & integrations"
      title="GitHub & Google Workspace"
      lead="Google Workspace is the connector that acts as a specific person — you. GitHub is mostly the opposite: platform-level plumbing, with your own GitHub identity as a separate, optional connection. Knowing which is which saves a lot of confused setup."
    >
      <ReportSection id="per-user-oauth" title="Why these two are different">
        <p>
          Both are &quot;GitHub&quot; and &quot;Google&quot; in conversation,
          and they sit at opposite ends of the{" "}
          <DocLink slug="connectors-and-mcp">credential split</DocLink>:
        </p>
        <CardGrid>
          <InfoCard title="Google Workspace — acts as you">
            <p>
              Each member connects their own account, and the agent works in
              that member&apos;s mail and calendar with that member&apos;s
              token. There is no tenant-wide Google credential.
            </p>
          </InfoCard>
          <InfoCard title="GitHub — mostly platform plumbing">
            <p>
              The tenant-level GitHub App install and the extension-import
              workflow are operator machinery. Your own reach into GitHub is a
              separate, personal connection — or an MCP connector.
            </p>
          </InfoCard>
        </CardGrid>
        <p>
          The reason a per-user connection exists at all is that some work has
          no meaningful tenant-wide answer. &quot;Check my calendar&quot; is a
          different question for every member, and the only correct credential
          is that member&apos;s own.
        </p>
      </ReportSection>

      <ReportSection id="google-workspace" title="Google Workspace">
        <p>
          <strong>Settings → Connectors → Linked Accounts</strong> in the web app,
          or the <strong>Credential Locker</strong> on{" "}
          <DocLink slug="mobile-app">mobile</DocLink>. One row, one Connect
          button, a Google consent screen, done. The row then reads{" "}
          <em>active</em>, <em>expired</em> or <em>not connected</em>.
        </p>
        <p>
          Connecting grants Gmail and Google Calendar access, which enables:
        </p>
        <ul>
          <li>
            <strong>Doing things in your mail and calendar</strong> — the
            agent acting as you through the skills and connectors your tenant
            has wired to Google. It is your token that is used, so anything
            the agent does is something you could have done yourself, and
            shows up in Google&apos;s own audit trail as you.
          </li>
          <li>
            <strong>Mail as a memory source</strong> — your own correspondence
            distilled into your personal{" "}
            <DocLink slug="memory">memory</DocLink>, so the agent knows the
            context of an ongoing thread without you pasting it in. This is
            opt-in and personal: it feeds your memory, not the tenant&apos;s.
          </li>
          <li>
            <strong>Personal automations</strong> — the standing kind of duty
            described on{" "}
            <DocLink slug="automations">Automations &amp; scheduling</DocLink>
            , running against your own account on a schedule you own.
          </li>
        </ul>
        <p>
          What is stored from your mail is deliberately thin. Message content
          never lands inline in the database: a processed mail thread is
          stored encrypted in your own AWS account, and the row that indexes
          it keeps only ids, counts and a content hash. Attachments are
          recorded as metadata — filename, type, size — never content.
        </p>
        <Invariant title="A mailbox is only ever read as its owner">
          <p>
            The mail path fails closed: reading your mailbox requires an
            active connection that <strong>you</strong> own, whether the
            reader is a turn you started or an automation running overnight.
            No operator, teammate, or tenant-wide credential can stand in for
            it. One consequence for teams: a workflow that depends on Google
            works for exactly the people who have connected, and quietly does
            less for everyone else — treat &quot;everyone connects&quot; as
            part of the rollout, not an afterthought.
          </p>
        </Invariant>
        <p>
          One nuance for operators wiring skills: a skill wired to a specific
          connection acts through <em>that</em> connection wherever the agent
          runs. Wire a shared agent&apos;s skill to a shared credential, not
          to your own account.
        </p>
      </ReportSection>

      <ReportSection id="microsoft-365" title="Microsoft 365">
        <p>
          The same shape, for Outlook mail and calendar: your own connection,
          made in the same places, with the same per-person semantics. If your
          organisation runs Microsoft rather than Google, connect the
          Microsoft 365 row instead. One current asymmetry: mail as a{" "}
          <em>memory source</em> is Google-only today — the Microsoft
          connection covers acting on your mail and calendar, not distilling
          your correspondence into memory.
        </p>
        <p>
          There is no benefit to connecting both unless you genuinely use
          both.
        </p>
      </ReportSection>

      <ReportSection id="github" title="GitHub">
        <p>
          GitHub shows up in ThinkWork in three places, and none of them is
          the one people usually expect.
        </p>
        <DocTable
          head={["Piece", "What it is", "Set up by"]}
          rows={[
            [
              <strong>The GitHub App install</strong>,
              "The tenant-level integration surface: it records which installations exist and logs the webhook deliveries GitHub sends. Plumbing, not agent tools.",
              "An operator, once per tenant",
            ],
            [
              <strong>Extension import</strong>,
              "An operator points the platform at a repository and ref to bring a platform extension in for review. An operator workflow, not an agent capability.",
              "An operator, per import",
            ],
            [
              <strong>Your GitHub connection</strong>,
              <>
                A personal connection like Google&apos;s: once connected, a
                sandbox turn you run carries your GitHub token, so the{" "}
                <code>gh</code> CLI works as you.
              </>,
              "You, for yourself",
            ],
          ]}
        />
        <p>
          The trap worth naming: installing the GitHub App does{" "}
          <strong>not</strong> give the agent tools for browsing issues,
          reviewing pull requests or committing to your repositories. If you
          want the agent to work <em>on</em> GitHub during a turn, connect
          your own GitHub account — or register GitHub&apos;s MCP server as an
          ordinary <DocLink slug="connectors-and-mcp">connector</DocLink> with
          per-user OAuth, so each engineer&apos;s reach in GitHub is their
          own. Two different systems, similar names.
        </p>
      </ReportSection>

      <ReportSection id="expiry" title="Expiry, reconnecting and revoking">
        <ul>
          <li>
            <strong>Expiry is normal and visible.</strong> Provider tokens age
            out; the connection row flips to <em>expired</em> and Connect
            turns into Reconnect. Reconnecting is the same one-tap flow.
          </li>
          <li>
            <strong>An expired connection fails quietly at the edges.</strong>{" "}
            The turn still runs, minus that capability — so an automation that
            used to email you and now does not is worth checking here first.
          </li>
          <li>
            <strong>Disconnect is a real revoke.</strong> Disconnecting from
            Linked Accounts or the Credential Locker deletes the stored credential
            outright. Work already done — threads, memories, artifacts —
            stays; it is a credential, not an eraser.
          </li>
          <li>
            <strong>Revoking at the provider works too</strong>, and shows up
            here as an expired connection the next time the token is used.
            Doing both is the belt and braces.
          </li>
        </ul>
      </ReportSection>
    </ReportArticle>
  );
}
